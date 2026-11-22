// Runs the actual Electron windows with isolated settings and muted audio.
const { app, BrowserWindow, screen, ipcMain } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'plana-desktop-smoke-')));
let cursor = { x: -20000, y: -20000 };
app.whenReady().then(() => { screen.getCursorScreenPoint = () => cursor; });
const mainEntry = process.env.PLANA_SMOKE_APP || '../main.cjs';
// The harness otherwise reports the development Electron runtime's version.
const productVersion = require(path.join(path.dirname(require.resolve(mainEntry)), 'package.json')).version;
app.getVersion = () => productVersion;
require(mainEntry);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, label, timeout = 45000) {
  const started = Date.now();
  while (Date.now() - started < timeout) { const value = await check(); if (value) return value; await delay(150); }
  throw new Error('Timed out: ' + label);
}
app.whenReady().then(async () => {
  try {
    const windows = await until(() => BrowserWindow.getAllWindows().length === 3 && BrowserWindow.getAllWindows(), 'windows');
    const display = windows.find(w => w.getTitle() === '普拉娜');
    const panel = windows.find(w => w.getTitle() === '普拉娜 · 消息与设置');
    const bubble = windows.find(w => w.getTitle() === '普拉娜 · 对话气泡');
    panel.webContents.setAudioMuted(true);
    const errors = [];
    for (const w of windows) w.webContents.on('console-message', event => { if (event.level === 'error') { errors.push(event.message); console.error('Renderer:', event.message); } });
    await until(async () => {
      try { return await display.webContents.executeJavaScript("Number(document.getElementById('canvas')?.dataset.frameCount) > 15"); } catch { return false; }
    }, 'rendered character');
    await until(async () => panel.webContents.executeJavaScript("document.getElementById('online')?.textContent === '云端已连接'"), 'panel ready');
    console.log('PASS: bundled display, cloud SSE and model render');
    const model = await display.webContents.executeJavaScript("JSON.parse(document.getElementById('canvas').dataset.modelRect)");
    const bounds = display.getBounds(); cursor = { x: Math.round(bounds.x + model.x + model.width / 2), y: Math.round(bounds.y + model.y + model.height / 2) };
    await until(() => panel.isVisible(), 'hover dialog');
    assert.equal(await panel.webContents.executeJavaScript("document.body.classList.contains('quick')"), true);
    assert.equal(panel.getContentBounds().height, panel.getBounds().height);
    assert.equal(await panel.webContents.executeJavaScript("document.getElementById('send').getClientRects().length"), 0);
    console.log('PASS: hover dialog');
    await panel.webContents.executeJavaScript("window.plana.configure({windowLocked:true,subtitleFontSize:32,subtitleX:6,subtitleY:9,dialogWidth:380})");
    assert.equal(display.isMovable(), false);
    await until(async () => display.webContents.executeJavaScript("document.getElementById('subtitle').style.fontSize === '32px'"), 'subtitle settings');
    console.log('PASS: lock and subtitle style');
    await panel.webContents.executeJavaScript("window.plana.configure({clickThrough:true})");
    await until(() => !panel.isVisible(), 'click-through hides quick dialog');
    console.log('PASS: click-through hides dialog');
    await panel.webContents.executeJavaScript("window.plana.configure({clickThrough:false,windowLocked:false})");
    await until(() => panel.isVisible(), 'restored hover dialog');
    const head = await display.webContents.executeJavaScript("JSON.parse(document.getElementById('canvas').dataset.headRect)");
    display.webContents.send('display:pointer', { x: head.x + head.width + 80, y: head.y });
    await delay(400);
    assert.ok(Number(await display.webContents.executeJavaScript("document.getElementById('canvas').dataset.gazeX")) !== 0);
    await panel.webContents.executeJavaScript("window.plana.configure({windowLocked:true})");
    const hx = Math.round(head.x + head.width / 2), hy = Math.round(head.y + head.height / 2);
    display.webContents.sendInputEvent({ type: 'mouseDown', x: hx, y: hy, button: 'left', clickCount: 1 });
    await delay(100);
    display.webContents.sendInputEvent({ type: 'mouseMove', x: hx + 30, y: hy, movementX: 30, movementY: 0 });
    await until(async () => display.webContents.executeJavaScript("document.getElementById('canvas').dataset.desktopPetHeld === 'true'"), 'trusted headpat');
    assert.deepEqual(display.getBounds(), bounds);
    await delay(200);
    const out = path.resolve(__dirname, '../../test-output'); fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(out, 'desktop-character.png'), (await display.webContents.capturePage()).toPNG());
    fs.writeFileSync(path.join(out, 'desktop-hover-dialog.png'), (await panel.webContents.capturePage()).toPNG());
    display.webContents.sendInputEvent({ type: 'mouseUp', x: hx + 30, y: hy, button: 'left', clickCount: 1 });
    await until(async () => display.webContents.executeJavaScript("document.getElementById('canvas').dataset.desktopPetHeld === 'false'"), 'headpat released');
    console.log('PASS: mouse tracking and trusted headpat while locked');
    const bx = Math.round(model.x + model.width / 2), by = Math.round(model.y + model.height * .65);
    display.webContents.sendInputEvent({ type: 'mouseDown', x: bx, y: by, button: 'left', clickCount: 1 });
    await delay(50);
    display.webContents.sendInputEvent({ type: 'mouseUp', x: bx, y: by, button: 'left', clickCount: 1 });
    await until(async () => panel.webContents.executeJavaScript("!document.getElementById('audio').paused && document.getElementById('audio').currentTime > 0"), 'original touch voice');
    await until(async () => display.webContents.executeJavaScript("document.getElementById('subtitle').textContent.includes('老师可以')"), 'touch subtitle over SSE');
    await until(() => bubble.isVisible(), 'speech bubble visible');
    assert.equal(await display.webContents.executeJavaScript("document.getElementById('subtitle').getClientRects().length"), 0);
    await until(async () => bubble.webContents.executeJavaScript("getComputedStyle(document.getElementById('bubble')).fontSize === '32px' && document.getElementById('text').textContent.includes('老师可以')"), 'bubble text and settings');
    console.log('PASS: original voice playback and synchronized speech bubble');
    await panel.webContents.executeJavaScript("document.getElementById('stop').click()");
    await display.webContents.executeJavaScript("document.addEventListener('plana:desktop-config',event=>{document.documentElement.dataset.windowLocked=String(event.detail.windowLocked)})");
    await panel.webContents.executeJavaScript("window.plana.configure({windowLocked:false})");
    await until(async () => display.webContents.executeJavaScript("document.documentElement.dataset.windowLocked === 'false'"), 'display received unlock');
    display.focus();
    await delay(200);
    let dragStarted = false;
    const observeDrag = (_event, action) => { if (action === 'start') dragStarted = true; };
    ipcMain.on('display:drag', observeDrag);
    const before = display.getBounds();
    display.webContents.sendInputEvent({ type: 'mouseDown', x: bx, y: by, button: 'left', clickCount: 1 });
    await until(() => dragStarted, 'body starts drag');
    cursor = { x: cursor.x + 30, y: cursor.y + 20 };
    display.webContents.sendInputEvent({ type: 'mouseMove', x: bx + 30, y: by + 20, movementX: 30, movementY: 20 });
    await until(() => display.getBounds().x === before.x + 30, 'drag window');
    display.webContents.sendInputEvent({ type: 'mouseUp', x: bx, y: by, button: 'left', clickCount: 1 });
    console.log('PASS: unlocked body drag');
    await delay(150);
    dragStarted = false;
    const transparentBefore = display.getBounds();
    display.webContents.sendInputEvent({ type: 'mouseDown', x: 8, y: 8, button: 'left', clickCount: 1 });
    await until(() => dragStarted, 'transparent region starts drag');
    cursor = { x: cursor.x - 40, y: cursor.y - 25 };
    await until(() => display.getBounds().x === transparentBefore.x - 40 && display.getBounds().y === transparentBefore.y - 25, 'transparent region moves window');
    display.webContents.sendInputEvent({ type: 'mouseUp', x: 8, y: 8, button: 'left', clickCount: 1 });
    await panel.webContents.executeJavaScript("window.plana.configure({windowLocked:true})");
    await until(async () => display.webContents.executeJavaScript("document.documentElement.dataset.windowLocked === 'true'"), 'display received lock');
    const lockedBefore = display.getBounds();
    display.webContents.sendInputEvent({ type: 'mouseDown', x: 8, y: 8, button: 'left', clickCount: 1 });
    cursor = { x: cursor.x + 25, y: cursor.y + 25 };
    await delay(200);
    assert.deepEqual(display.getBounds(), lockedBefore);
    display.webContents.sendInputEvent({ type: 'mouseUp', x: 8, y: 8, button: 'left', clickCount: 1 });
    ipcMain.removeListener('display:drag', observeDrag);
    console.log('PASS: transparent region drag and position lock');
    const sendBounds = display.getBounds();
    cursor = {x: Math.round(sendBounds.x + model.x + model.width / 2), y: Math.round(sendBounds.y + model.y + model.height / 2)};
    await until(() => panel.isVisible(), 'input before sending');
    await panel.webContents.executeJavaScript("window.plana.configure({subtitleFontSize:16,subtitleX:0,subtitleY:0})");
    await panel.webContents.executeJavaScript("document.getElementById('mode').value='subtitle';document.getElementById('message').value='精简输入框验证';document.getElementById('message').focus()");
    panel.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' });
    panel.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' });
    await until(async () => display.webContents.executeJavaScript("document.getElementById('subtitle').textContent === '精简输入框验证'"), 'Enter sends from the input');
    console.log('PASS: frameless input only and Enter sends');
    assert.ok(await panel.webContents.executeJavaScript("document.getElementById('quick-status').getClientRects().length > 0 && document.getElementById('quick-status').textContent === '字幕已显示'"));
    await delay(150);
    // Windows may retain a 39px native minimum; the visible pill is only 24px.
    assert.ok(panel.getBounds().height <= 40);
    assert.equal(await panel.webContents.executeJavaScript("document.getElementById('quick-status').getBoundingClientRect().height"), 24);
    assert.equal(await panel.webContents.executeJavaScript("document.getElementById('message').getClientRects().length"), 0);
    await until(async () => panel.webContents.executeJavaScript("document.getElementById('message').value === ''"), 'successful send clears draft');
    await until(async () => bubble.webContents.executeJavaScript("document.getElementById('text').textContent === '精简输入框验证' && getComputedStyle(document.getElementById('bubble')).fontSize === '16px'"), 'new bubble subtitle');
    await delay(400);
    fs.writeFileSync(path.join(out, 'desktop-speech-bubble.png'), (await bubble.webContents.capturePage()).toPNG());
    fs.writeFileSync(path.join(out, 'desktop-compact-status.png'), (await panel.webContents.capturePage()).toPNG());
    await delay(2800);
    assert.equal(panel.isVisible(), false);
    cursor = {x:-20000,y:-20000}; await delay(200);
    cursor = {x:Math.round(sendBounds.x + model.x + model.width / 2),y:Math.round(sendBounds.y + model.y + model.height / 2)};
    await until(async () => panel.isVisible() && panel.webContents.executeJavaScript("document.getElementById('message').getClientRects().length > 0"), 'leave and reenter opens input');
    console.log('PASS: input collapses after sending, clears draft, stays hidden and reopens on reentry');
    if (process.env.PLANA_SMOKE_CHAT === '1') {
      const voice = process.env.PLANA_SMOKE_CHAT_VOICE === '1';
      await panel.webContents.executeJavaScript("document.getElementById('mode').value='chat';document.getElementById('voice-enabled').checked=" + voice + ";document.getElementById('message').value='普拉娜，晚上好，简单打个招呼吧。';document.getElementById('message').focus()");
      panel.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' });
      panel.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' });
      await until(async () => panel.webContents.executeJavaScript("document.querySelectorAll('.chat-entry').length > 0 && " + (voice ? "document.getElementById('audio').currentTime > 0 && !document.getElementById('audio').paused" : "document.getElementById('quick-status').textContent === '回复已显示'")), 'real cloud chat reply', voice ? 240000 : 90000);
      assert.ok(await display.webContents.executeJavaScript("document.getElementById('subtitle').textContent.length > 0 && document.getElementById('subtitle').textContent !== '精简输入框验证'"));
      console.log('PASS: real Enter-to-chat, role response, expression and subtitle');
      if (voice) console.log('PASS: generated Japanese voice playback and synchronized subtitle');
    }
    if (process.env.PLANA_SMOKE_SEGMENTS === '1') {
      await panel.webContents.executeJavaScript("document.getElementById('stop').click()");
      cursor = {x:-20000,y:-20000}; await delay(200);
      cursor = {x:Math.round(sendBounds.x + model.x + model.width / 2),y:Math.round(sendBounds.y + model.y + model.height / 2)};
      await until(async () => panel.isVisible() && panel.webContents.executeJavaScript("document.getElementById('message').getClientRects().length > 0"), 'input for segmented voice');
      await panel.webContents.executeJavaScript(`
        window.segmentEvents=[];window.segmentEnds=0;
        document.getElementById('audio').addEventListener('ended',()=>window.segmentEnds++);
        document.getElementById('audio').addEventListener('playing',()=>{
          const src=document.getElementById('audio').src;
          if(!window.segmentEvents.some(e=>e.src===src))window.segmentEvents.push({src,ends:window.segmentEnds});
        });
        document.getElementById('mode').value='voice';
        document.getElementById('message').value='先生、今日は少し休みながら進めましょう。私もここでお手伝いします。無理をせず、ひとつずつ片づけていけば大丈夫です。急ぐ必要はありません。';
        document.getElementById('message').focus();
      `);
      const began=Date.now();
      panel.webContents.sendInputEvent({type:'keyDown',keyCode:'Enter'});
      panel.webContents.sendInputEvent({type:'keyUp',keyCode:'Enter'});
      await until(async () => panel.webContents.executeJavaScript('window.segmentEvents.length >= 1'), 'first synthesized voice segment',180000);
      console.log('PASS: first voice segment starts after', Math.round((Date.now()-began)/1000),'seconds');
      await until(async () => panel.webContents.executeJavaScript('window.segmentEvents.length >= 2'), 'second synthesized voice segment',180000);
      assert.ok(await panel.webContents.executeJavaScript('window.segmentEvents[1].ends >= 1'));
      await until(async () => panel.webContents.executeJavaScript("!document.getElementById('send').disabled"), 'all segments started',180000);
      console.log('PASS: real segmented TTS starts early, prefetches and plays sequentially');
    }
    await panel.webContents.executeJavaScript("document.getElementById('stop').click()");
    console.log('Renderer errors:', JSON.stringify(errors));
    assert.equal(errors.length, 0);
    app.exit(0);
  } catch (error) {
    console.error(error.stack);
    for (const w of BrowserWindow.getAllWindows()) {
      console.error('Window:', w.getTitle(), w.webContents.getURL());
      try { console.error(await w.webContents.executeJavaScript("JSON.stringify({state:document.readyState,body:document.body.innerText.slice(0,1000),canvas:document.getElementById('canvas')?.dataset})")); } catch {}
    }
    app.exit(1);
  }
});
