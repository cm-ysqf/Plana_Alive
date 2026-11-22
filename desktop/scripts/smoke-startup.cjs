// Hidden, isolated window: reproduces gateway denials using the bundled display.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'plana-startup-')));
app.whenReady().then(async () => {
  let server;
  try {
    const root = process.env.PLANA_STARTUP_DISPLAY || path.resolve(__dirname, '../display');
    const { catalogFor } = await import(pathToFileURL(path.resolve(__dirname, '../../model-data.mjs')));
    const catalog = catalogFor(root);
    const state = { character:'plana', revision:0, expression:'00', mouthMode:'auto', mouth:0,
      closedMouth:catalog.plana.closed, openMouth:catalog.plana.open, gazeX:0, gazeY:0,
      zoom:1, x:0, y:0, subtitle:'', emotion:'custom', intensity:.7, halo:'auto',
      headTilt:0, bodyLean:0, haloLift:0, haloRotation:0, blush:-1, sweat:-1, tears:-1 };
    let deniedRoute = '/api/catalog', status = 429, message = '请求达到今日限额，请稍后重试';
    server = http.createServer((req, res) => {
      if (req.url === deniedRoute) { res.writeHead(status, {'Content-Type':'application/json'}); return res.end(JSON.stringify({error:message})); }
      if (req.url === '/api/catalog' || req.url === '/api/state') { res.setHeader('Content-Type','application/json'); return res.end(JSON.stringify(req.url === '/api/catalog' ? catalog : state)); }
      if (req.url === '/api/events') { res.writeHead(200,{'Content-Type':'text/event-stream'}); return res.write(': ready\n\n'); }
      const file = path.join(root, req.url === '/display' ? 'index.html' : req.url.slice(1));
      const type = {'.js':'text/javascript','.css':'text/css','.html':'text/html','.png':'image/png'}[path.extname(file)] || 'application/octet-stream';
      if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {res.writeHead(404);return res.end();}
      res.setHeader('Content-Type',type);fs.createReadStream(file).pipe(res);
    });
    await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
    const window = new BrowserWindow({show:false,width:420,height:640,webPreferences:{offscreen:true,backgroundThrottling:false,sandbox:true}});
    const errors=[];
    window.webContents.on('console-message', event => { if (/TypeError|Uncaught/.test(event.message)) errors.push(event.message); });
    const run = code => window.webContents.executeJavaScript(code);
    const until = async code => {const began=Date.now();while(!await run(code)){if(Date.now()-began>20000)throw Error('Timed out: '+code);await new Promise(r=>setTimeout(r,80));}};
    const url = `http://127.0.0.1:${server.address().port}/display`;
    for (deniedRoute of ['/api/catalog','/api/state']) {
      for (const scenario of [[429,'请求达到今日限额，请稍后重试'],[403,'当前地区暂不提供服务'],[502,'后台服务暂不可用']]) {
        [status,message]=scenario;
        await window.loadURL(url);
        await until(`document.getElementById('loading').textContent === ${JSON.stringify('启动失败：'+message)}`);
        assert.equal(await run('window.presenterDiagnostics().loading'),true);
        console.log('PASS:',deniedRoute,status,'shows actual server error');
      }
    }
    deniedRoute=null;
    await window.loadURL(url);
    await until("Number(document.getElementById('canvas').dataset.frameCount)>15");
    assert.equal(await run('window.presenterDiagnostics().character'),'plana');
    assert.deepEqual(errors,[]);
    console.log('PASS: reconnect after quota recovery renders bundled character; no uncaught renderer errors');
    window.destroy();server.closeAllConnections();server.close();app.exit(0);
  } catch(error) {console.error(error.stack);server?.closeAllConnections();server?.close();app.exit(1);}
});
