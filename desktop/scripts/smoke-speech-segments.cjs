// Exercise the real isolated panel with local API fixtures and a real WAV.
const {app,BrowserWindow,ipcMain}=require('electron');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const assert=require('node:assert/strict');
app.setPath('userData',fs.mkdtempSync(path.join(os.tmpdir(),'plana-panel-audio-')));
app.whenReady().then(async()=>{
  try{
    const audio=fs.readFileSync(path.resolve(__dirname,'../../test-output/tts-audio-check.wav')).toString('base64');
    let state={character:'plana',revision:0,emotion:'neutral',intensity:.5,expression:'00',subtitle:'',mouthMode:'auto',mouth:0};
    const subtitles=[],feedbacks=[];
    const settings={...require('../settings.cjs').defaults,shortcuts:{},cloud:'local-fixture'};
    ipcMain.handle('panel:initialize',()=>settings);
    ipcMain.handle('panel:request',(_event,{route,body})=>{
      if(route==='/api/state')return state;
      if(route==='/api/inference/config')return {chatReady:true};
      if(route==='/api/chat')return {reply:'老师，您好。今天也请多关照。',speech:'先生、こんにちは。今日もよろしくお願いします。',segments:[{reply:'老师，您好。',speech:'先生、こんにちは。'},{reply:'今天也请多关照。',speech:'今日もよろしくお願いします。'}],control:{emotion:'neutral',intensity:.5}};
      if(route==='/api/feedback'){feedbacks.push(body);return {id:body.requestId,received:true};}
      if(route==='/api/tts')return {audio};
      if(route==='/api/control'){if(body.subtitle)subtitles.push(body.subtitle);state={...state,...body,revision:state.revision+1};return state;}
      if(route==='/api/action')return {ok:true};
      throw Error('Unexpected API '+route);
    });
    const window=new BrowserWindow({show:false,webPreferences:{preload:path.resolve(__dirname,'../preload-panel.cjs'),contextIsolation:true,sandbox:true,backgroundThrottling:false,autoplayPolicy:'no-user-gesture-required'}});
    window.webContents.setAudioMuted(true);
    const messages=[];
    window.webContents.on('console-message',e=>{messages.push(e.message);console.log('Console:',e.message);});
    await window.loadFile(process.argv[2] ? path.resolve(process.argv[2]) : path.resolve(__dirname,'../ui/index.html'));
    const run=code=>window.webContents.executeJavaScript(code);
    const until=async code=>{const began=Date.now();while(!await run(code)){if(Date.now()-began>12000)throw Error('Timed out: '+code);await new Promise(r=>setTimeout(r,60));}};
    await until("document.getElementById('online').textContent==='云端已连接'");
    await run(`window.playbackTimeline=[];for(const event of ['playing','ended'])document.getElementById('audio').addEventListener(event,()=>window.playbackTimeline.push({event,time:performance.now()}));window.audioObservations=[];const create=AudioContext.prototype.createAnalyser;AudioContext.prototype.createAnalyser=function(){const a=create.call(this);window.testAnalyser=a;window.testContext=this;return a;};
      document.getElementById('audio').addEventListener('playing',()=>{const interval=setInterval(()=>{const data=new Float32Array(1024);window.testAnalyser.getFloatTimeDomainData(data);window.audioObservations.push({src:document.getElementById('audio').src,rms:Math.sqrt(data.reduce((s,x)=>s+x*x,0)/data.length),context:window.testContext.state});},50);setTimeout(()=>clearInterval(interval),2400);});`);
    for(const mode of ['chat']){
      await run('window.audioObservations=[]');
      if(mode==='original')window.webContents.send('panel:touch');
      else await run("document.getElementById('message').value='你好';document.getElementById('send').click()");
      await until("window.audioObservations.length>12");
      const observations=await run('window.audioObservations');
      console.log(mode,JSON.stringify({maximumRMS:Math.max(...observations.map(x=>x.rms)),contexts:[...new Set(observations.map(x=>x.context))],status:await run("document.getElementById('status').textContent")}));
      assert.ok(observations.some(x=>x.rms>.01),'No signal for '+mode);
      await until("document.getElementById('audio').paused && !document.getElementById('send').disabled");
      const timeline=await run('window.playbackTimeline');assert.deepEqual(timeline.map(e=>e.event),['playing','ended','playing','ended']);const gap=timeline[2].time-timeline[1].time;assert.ok(gap>=300,'Missing breath gap: '+gap);console.log('Breath gap ms:',gap);assert.deepEqual(subtitles,['老师，您好。','今天也请多关照。']);console.log('PASS: paired subtitles, two audio segments and completed send');
    }
    await run("document.getElementById('tab-settings').click();document.getElementById('feedback-title').value='播放建议';document.getElementById('feedback-content').value='希望更自然的停顿';document.getElementById('feedback-form').requestSubmit(document.getElementById('feedback-submit'))");
    await until("document.getElementById('feedback-status').textContent.includes('反馈已收到')");
    assert.equal(feedbacks.length,1);assert.equal(feedbacks[0].content,'希望更自然的停顿');assert.equal(feedbacks[0].appVersion,'0.3.7');assert.equal(await run("document.getElementById('feedback-content').value"),'');
    console.log('PASS: client feedback submit, idempotency identifier and form reset');
    console.log('PASS: generated sentences have nonzero WebAudio signal through real panel');
    window.destroy();app.exit(0);
  }catch(error){console.error(error.stack);app.exit(1);}
});
