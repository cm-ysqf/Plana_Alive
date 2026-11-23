const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {spawn}=require('node:child_process');
const PUBLIC_KEY=require('./update-public-key.json').publicKey;
function compareVersions(a,b){
  const parse=value=>{if(typeof value!=='string'||!/^\d{1,4}\.\d{1,4}\.\d{1,4}(?:-[a-zA-Z0-9.-]{1,40})?$/.test(value))throw Error('更新版本无效');const [main,...tail]=value.split('-');return {parts:main.split('.').map(Number),pre:tail.join('-')};};
  const x=parse(a),y=parse(b);for(let i=0;i<3;i++)if(x.parts[i]!==y.parts[i])return Math.sign(x.parts[i]-y.parts[i]);
  if(x.pre===y.pre)return 0;if(!x.pre)return 1;if(!y.pre)return -1;return x.pre.localeCompare(y.pre,undefined,{numeric:true});
}
function verifyManifest(envelope,publicKey=PUBLIC_KEY){
  if(!envelope||typeof envelope.payload!=='string'||envelope.payload.length>40000||typeof envelope.signature!=='string'||!crypto.verify(null,Buffer.from(envelope.payload),publicKey,Buffer.from(envelope.signature,'base64')))throw Error('更新信息签名校验失败');
  const data=JSON.parse(Buffer.from(envelope.payload,'base64').toString('utf8'));
  if(!data||typeof data!=='object'||Array.isArray(data)||data.schema!==1||data.channel!=='Pre-Release'||!Number.isFinite(Date.parse(data.checkedAt))||Math.abs(Date.now()-Date.parse(data.checkedAt))>86400000)throw Error('更新信息无效或已过期');
  if(data.version){compareVersions(data.version,'0.0.0');if(!/^[a-f0-9]{64}$/.test(data.sha256)||!Number.isSafeInteger(data.size)||data.size<1000000||data.size>500000000||data.artifact!==`PlanaAlive-${data.version}-Portable.exe`||data.downloadPath!=='/api/releases/download/'+data.artifact)throw Error('更新包信息无效');}
  for(const value of [data.notes,data.announcement?.title,data.announcement?.body])if(value!==undefined&&(typeof value!=='string'||value.length>6000))throw Error('公告格式无效');
  if(data.announcement&&(typeof data.announcement.id!=='string'||data.announcement.id.length>100||typeof data.announcement.title!=='string'||data.announcement.title.length>120||typeof data.announcement.body!=='string'))throw Error('公告格式无效');
  return data;
}
async function downloadUpdate({manifest,cloudSession,origin,directory,onProgress=()=>{}}){
  fs.mkdirSync(directory,{recursive:true});const destination=path.join(directory,manifest.artifact),temporary=destination+'.part';
  const response=await cloudSession.fetch(origin+manifest.downloadPath,{redirect:'error',signal:AbortSignal.timeout(300000)});
  if(!response.ok)throw Error(`更新下载失败（${response.status}）`);
  const hash=crypto.createHash('sha256'),handle=fs.openSync(temporary,'w');let size=0,reader;
  try{
    reader=response.body.getReader();
    while(true){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>manifest.size)throw Error('更新包超过预期大小');hash.update(value);let offset=0;while(offset<value.length)offset+=fs.writeSync(handle,value,offset,value.length-offset);onProgress(Math.floor(size/manifest.size*100));}
    if(size!==manifest.size||hash.digest('hex')!==manifest.sha256)throw Error('更新包完整性校验失败');
  }catch(error){try{await reader?.cancel();}catch{}fs.closeSync(handle);fs.rmSync(temporary,{force:true});throw error;}
  fs.closeSync(handle);fs.renameSync(temporary,destination);return destination;
}
function installPortable({source,target,pid,sha256,directory}){
  if(!path.isAbsolute(source)||!path.isAbsolute(target)||path.extname(target).toLowerCase()!=='.exe'||source===target||!/^[a-f0-9]{64}$/.test(sha256)||!Number.isInteger(pid))throw Error('更新安装路径无效');
  // Pass user paths as base64 data, never interpolate them into PowerShell code.
  const payload=Buffer.from(JSON.stringify({source,target,pid,sha256}),'utf8').toString('base64');
  const script=`$ErrorActionPreference='Stop'
$p=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${payload}'))|ConvertFrom-Json
$log=[IO.Path]::Combine([IO.Path]::GetDirectoryName($p.source),'install.log')
try {
  $owner=$null;try{$owner=[Diagnostics.Process]::GetProcessById($p.pid)}catch{}
  if($owner){$owner.WaitForExit()}
  $backup=$p.target+'.previous';$next=$p.target+'.next'
  [IO.File]::Copy($p.source,$next,$true)
  $hasher=[Security.Cryptography.SHA256]::Create();$stream=[IO.File]::OpenRead($next)
  try{$actual=([BitConverter]::ToString($hasher.ComputeHash($stream))).Replace('-','').ToLower()}finally{$stream.Dispose();$hasher.Dispose()}
  if($actual -ne $p.sha256){throw 'Update checksum failed'}
  $replaced=$false
  for($attempt=0;$attempt -lt 120;$attempt++){
    try{if([IO.File]::Exists($backup)){[IO.File]::Delete($backup)};[IO.File]::Replace($next,$p.target,$backup);$replaced=$true;break}catch{[Threading.Thread]::Sleep(500)}
  }
  if(!$replaced){throw 'Could not replace portable executable; original retained'}
  try{$launch=New-Object Diagnostics.ProcessStartInfo;$launch.FileName=$p.target;$launch.WorkingDirectory=[IO.Path]::GetDirectoryName($p.target);$launch.UseShellExecute=$false;$launch.CreateNoWindow=$true;[Diagnostics.Process]::Start($launch)|Out-Null}catch{[IO.File]::Copy($backup,$p.target,$true);throw}
  [IO.File]::WriteAllText($log,'Update installed; previous executable retained beside target')
}catch{[IO.File]::WriteAllText($log,$_.Exception.Message)}
`;
  const encoded=Buffer.from(script,'utf16le').toString('base64');
  const shell=path.join(process.env.SystemRoot||'C:\\Windows','System32/WindowsPowerShell/v1.0/powershell.exe');
  // Start-Process creates an independent hidden Windows console. Directly
  // detaching PowerShell 5 can silently exit before executing its command.
  const launch=`$ErrorActionPreference='Stop';Start-Process -FilePath ([IO.Path]::Combine($PSHOME,'powershell.exe')) -ArgumentList @('-NoProfile','-NonInteractive','-EncodedCommand','${encoded}') -WindowStyle Hidden | Out-Null`;
  const child=spawn(shell,['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(launch,'utf16le').toString('base64')],{windowsHide:true,stdio:'ignore'});
  return new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(Error('无法启动更新助手')));});
}
module.exports={compareVersions,verifyManifest,downloadUpdate,installPortable};
