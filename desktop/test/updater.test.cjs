const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
test('Windows updater replaces, backs up and relaunches executable with literal Unicode and special-character paths',{skip:process.platform!=='win32'},async()=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),"plana-更新 '$[]-"));
  const target=path.join(directory,'client.exe'),source=path.join(directory,'update.exe'),compileDir=fs.mkdtempSync(path.join(os.tmpdir(),'plana-compile-'));
  try{
    const compiled=path.join(compileDir,'test.exe'),payload=Buffer.from(JSON.stringify({target:compiled})).toString('base64');
    const script=`$ErrorActionPreference='Stop'
$p=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${payload}'))|ConvertFrom-Json
Add-Type -TypeDefinition 'using System; using System.IO; using System.Reflection; public class Smoke { public static void Main() { File.WriteAllText(Assembly.GetExecutingAssembly().Location + ".launched", "ok"); } }' -OutputAssembly $p.target -OutputType WindowsApplication`;
    execFileSync('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{windowsHide:true});
    fs.copyFileSync(compiled,target);const original=fs.readFileSync(target),updated=Buffer.concat([original,Buffer.from('new-release')]);fs.writeFileSync(source,updated);
    const options=Buffer.from(JSON.stringify({source,target,sha256:crypto.createHash('sha256').update(updated).digest('hex'),directory})).toString('base64');
    execFileSync(process.execPath,['-e',`require(${JSON.stringify(require.resolve('../updater.cjs'))}).installPortable({...JSON.parse(Buffer.from('${options}','base64').toString()),pid:process.pid}).then(()=>process.exit(0))`],{windowsHide:true});
    const started=Date.now();while(!fs.existsSync(target+'.launched')){if(Date.now()-started>20000)throw Error('Installer did not relaunch: '+(fs.existsSync(path.join(directory,'install.log'))?fs.readFileSync(path.join(directory,'install.log'),'utf8'):'no log'));await new Promise(r=>setTimeout(r,100));}
    assert.deepEqual(fs.readFileSync(target),updated);assert.deepEqual(fs.readFileSync(target+'.previous'),original);
  }finally{fs.rmSync(directory,{recursive:true,force:true});fs.rmSync(compileDir,{recursive:true,force:true});}
});
