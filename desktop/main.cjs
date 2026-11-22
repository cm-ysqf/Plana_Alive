const { app, BrowserWindow, Menu, Tray, nativeImage, ipcMain, session, globalShortcut, screen, dialog, protocol, net } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { defaults, validateSettings, visibleBounds } = require('./settings.cjs');
const { contains, quickBounds, statusBounds, bubbleBounds, validGeometry } = require('./geometry.cjs');
const { uploadHardware } = require('./hardware.cjs');
const CLOUD = 'http://8.156.38.132';
const DISPLAY = 'plana://desktop/display';
protocol.registerSchemesAsPrivileged([{ scheme: 'plana', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);
let modelGeometry, pointerTimer, quickMode = false, lastNear = 0, lastTap = 0;
let quickCollapsed = false, quickBusy = false, quickAway = false, quickFinishedAt = 0, activityText = '正在发送…';
let bubble, bubbleText = '', bubbleHeight = 80, bubbleTimer, bubblePayload = '';
let display, panel, tray, cloudSession, settings, settingsFile, quitting = false, drag, saveTimer, controlTail = Promise.resolve(), configurationTail = Promise.resolve();
let shortcuts = { clickThrough: '', messages: '' };
const requests = new Map();
const panelURL = pathToFileURL(path.join(__dirname, 'ui/index.html')).href;
const bubbleURL = pathToFileURL(path.join(__dirname, 'ui/bubble.html')).href;
app.setAppUserModelId('PLANA.ALIVE.Desktop');
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (display) { display.show(); openPanel('chat'); } });
  app.whenReady().then(boot).catch(error => { dialog.showErrorBox('普拉娜启动失败', error.message); app.quit(); });
}
function log(message) { try { fs.appendFileSync(path.join(app.getPath('userData'), 'client.log'), `${new Date().toISOString()} ${message}\n`); } catch {} }
function save() {
  clearTimeout(saveTimer); saveTimer = setTimeout(() => {
    try { fs.writeFileSync(settingsFile + '.tmp', JSON.stringify(settings, null, 2)); fs.renameSync(settingsFile + '.tmp', settingsFile); } catch (e) { log(e.message); }
  }, 250);
}
function notifySettings() {
  if (panel && !panel.isDestroyed()) panel.webContents.send('panel:settings', { ...settings, shortcuts });
  if (display && !display.isDestroyed()) display.webContents.send('display:settings', settings);
}
function configure(patch) {
  const result = configurationTail.then(() => applySettings(patch));
  configurationTail = result.catch(() => {}); return result;
}
async function applySettings(patch) {
  const next = validateSettings(patch, settings);
  if ('zoom' in patch || 'x' in patch || 'y' in patch) await cloudRequest('/api/control', { zoom: next.zoom, x: next.x, y: next.y });
  settings = next;
  drag = null;
  if ('width' in patch || 'height' in patch) display.setSize(settings.width, settings.height);
  display.setAlwaysOnTop(settings.alwaysOnTop, 'screen-saver');
  display.setIgnoreMouseEvents(settings.clickThrough, { forward: true });
  display.setBackgroundColor(settings.clickThrough ? '#00000000' : '#00000001');
  display.setMovable(!settings.windowLocked);
  panel?.setAlwaysOnTop(settings.alwaysOnTop, 'screen-saver');
  bubble?.setAlwaysOnTop(settings.alwaysOnTop, 'screen-saver');
  if (quickMode && (settings.clickThrough || !settings.hoverDialog)) panel.hide();
  save(); updateTray(); notifySettings();
  return { ...settings, shortcuts };
}
function report(error) { log(error.message); dialog.showMessageBox({ type: 'error', title: '普拉娜', message: error.message }); }
function openPanel(tab = 'chat') {
  if (!panel) createPanel();
  quickMode = false;
  quickCollapsed = false;
  panel.setResizable(true);
  panel.setFocusable(true); panel.setIgnoreMouseEvents(false);
  panel.setMinimumSize(400, 560); panel.setSize(470, 710);
  const area = screen.getDisplayMatching(panel.getBounds()).workArea;
  const bounds = panel.getBounds();
  panel.setPosition(Math.max(area.x, Math.min(bounds.x, area.x + area.width - bounds.width)), Math.max(area.y, Math.min(bounds.y, area.y + area.height - bounds.height)));
  const show = () => { panel.webContents.send('panel:tab', tab); panel.show(); panel.focus(); };
  panel.webContents.send('panel:mode', { quick: false });
  if (panel.webContents.isLoading()) panel.webContents.once('did-finish-load', show); else show();
}
function menuTemplate() {
  return [
    { label: '向普拉娜发送消息…', click: () => openPanel('chat') },
    { label: '窗口与角色设置…', click: () => openPanel('settings') },
    { type: 'separator' },
    { label: '始终置于最顶层', type: 'checkbox', checked: settings.alwaysOnTop, click: item => configure({ alwaysOnTop: item.checked }).catch(report) },
    { label: '锁定窗口位置', type: 'checkbox', checked: settings.windowLocked, click: item => configure({ windowLocked: item.checked }).catch(report) },
    { label: '靠近角色显示对话框', type: 'checkbox', checked: settings.hoverDialog, click: item => configure({ hoverDialog: item.checked }).catch(report) },
    { label: `点击穿透${shortcuts.clickThrough ? '（' + shortcuts.clickThrough + ' 切换）' : '（托盘菜单恢复）'}`, type: 'checkbox', checked: settings.clickThrough, click: item => configure({ clickThrough: item.checked }).catch(report) },
    { label: '窗口大小', submenu: [ [300, 460, '小'], [420, 640, '中'], [560, 840, '大'] ].map(([width, height, label]) => ({ label: `${label} · ${width} × ${height}`, click: () => configure({ width, height }).catch(report) })) },
    { label: '角色缩放', submenu: [.75, 1, 1.25, 1.5, 2].map(zoom => ({ label: `${Math.round(zoom * 100)}%`, type: 'radio', checked: settings.zoom === zoom, click: () => configure({ zoom }).catch(report) })) },
    { label: '重置角色位置与缩放', click: () => configure({ zoom: 1, x: 0, y: 0 }).catch(report) },
    { label: '停止语音和字幕', click: () => { createPanel(); panel.webContents.send('panel:stop'); cloudRequest('/api/action', { action: 'stop' }).catch(report); } },
    { label: display?.isVisible() ? '隐藏角色' : '显示角色', click: () => { if (display.isVisible()) display.hide(); else display.show(); updateTray(); } },
    { label: '重新连接云端', click: () => { reconnect().catch(report); } },
    { type: 'separator' },
    { label: '退出普拉娜', click: () => app.quit() }
  ];
}
function updateTray() { if (tray) { tray.setToolTip(`普拉娜 · ${settings.clickThrough ? '点击穿透中，' + (shortcuts.clickThrough || '托盘菜单') + ' 恢复' : '右键打开菜单'}`); tray.setContextMenu(Menu.buildFromTemplate(menuTemplate())); } }
function registerShortcut(candidates, callback) {
  for (const accelerator of candidates) if (globalShortcut.register(accelerator, callback)) return accelerator;
  return '';
}
function trusted(event) { return panel && event.sender === panel.webContents && event.senderFrame?.url === panelURL; }
function requirePanel(event) { if (!trusted(event)) throw new Error('来源窗口无效'); }
async function cloudRequest(route, body, signal) {
  const execute = async () => {
    const response = await cloudSession.fetch(CLOUD + route, { method: body === undefined ? 'GET' : 'POST',
      credentials: 'include', redirect: 'error', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(210000)]) : AbortSignal.timeout(210000),
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    if (!response.ok) { const value = await response.json().catch(() => ({})); throw new Error(value.error || `云端请求失败（${response.status}）`); }
    return route === '/api/tts' ? { audio: Buffer.from(await response.arrayBuffer()).toString('base64') } : response.json();
  };
  if (['/api/control', '/api/action'].includes(route)) { const result = controlTail.then(execute); controlTail = result.catch(() => {}); return result; }
  return execute();
}
function createPanel() {
  if (panel) return;
  panel = new BrowserWindow({ width: 470, height: 710, minWidth: 400, minHeight: 560, show: false, title: '普拉娜 · 消息与设置',
    frame: false, thickFrame: false, transparent: true, backgroundColor: '#00000000', hasShadow: false,
    icon: path.join(__dirname, 'assets/app.ico'), autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload-panel.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false, autoplayPolicy: 'no-user-gesture-required' } });
  panel.setMenu(null); panel.loadFile(path.join(__dirname, 'ui/index.html'));
  panel.setAlwaysOnTop(settings.alwaysOnTop, 'screen-saver');
  panel.webContents.on('did-finish-load', () => { notifySettings(); panel.webContents.send('panel:mode', { quick: quickMode }); });
  panel.webContents.on('context-menu', () => Menu.buildFromTemplate([
    { role: 'undo', label: '撤销' }, { role: 'cut', label: '剪切' }, { role: 'copy', label: '复制' }, { role: 'paste', label: '粘贴' },
    { type: 'separator' }, ...menuTemplate()
  ]).popup({ window: panel }));
  panel.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  panel.webContents.on('will-navigate', (event, url) => { if (url !== panelURL) event.preventDefault(); });
  panel.on('close', event => { if (!quitting) { event.preventDefault(); panel.hide(); } });
  panel.webContents.on('render-process-gone', (_event, details) => log(`panel crashed: ${details.reason}`));
}
function connectDisplay() {
  display.loadURL(DISPLAY).catch(e => log(`display connection: ${e.message}`));
}
function createBubble() {
  bubble = new BrowserWindow({ width: 240, height: 80, show: false, title: '普拉娜 · 对话气泡',
    frame: false, transparent: true, backgroundColor: '#00000000', hasShadow: false, focusable: false,
    skipTaskbar: true, resizable: false, maximizable: false, fullscreenable: false,
    webPreferences: { preload: path.join(__dirname, 'preload-bubble.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false } });
  bubble.setMenu(null); bubble.setIgnoreMouseEvents(true);
  bubble.setAlwaysOnTop(settings.alwaysOnTop, 'screen-saver');
  bubble.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  bubble.webContents.on('will-navigate', (event, url) => { if (url !== bubbleURL) event.preventDefault(); });
  bubble.webContents.on('did-finish-load', () => { bubblePayload = ''; updateBubble(); });
  bubble.loadFile(path.join(__dirname, 'ui/bubble.html'));
}
function updateBubble() {
  if (!bubble || bubble.isDestroyed() || !modelGeometry || !display || display.isDestroyed()) return;
  if (!display.isVisible()) { bubble.hide(); return; }
  const bounds = display.getBounds(), area = screen.getDisplayMatching(bounds).workArea;
  const maxHeight = Math.max(100, Math.floor(area.height * .6));
  const width = Math.round(Math.min(320, Math.max(180, modelGeometry.model.height * .48 * settings.subtitleWidth / 55)));
  const next = bubbleBounds(bounds, modelGeometry.head, { width, height: Math.min(bubbleHeight, maxHeight) }, area, settings);
  const payload = JSON.stringify({ text: bubbleText, side: next.side, fontSize: settings.subtitleFontSize, maxHeight });
  if (payload !== bubblePayload && !bubble.webContents.isLoading()) { bubblePayload = payload; bubble.webContents.send('bubble:update', JSON.parse(payload)); }
  const current = bubble.getBounds();
  if (['x', 'y', 'width', 'height'].some(key => current[key] !== next[key])) {
    const { side, ...rect } = next; bubble.setBounds(rect);
  }
  if (bubbleText && !bubble.isVisible() && !bubble.webContents.isLoading()) bubble.showInactive();
}
function compactPanel() {
  panel.blur(); panel.setFocusable(false); panel.setIgnoreMouseEvents(true);
  panel.setResizable(false);
  panel.setMinimumSize(60, 22);
  panel.webContents.send('panel:mode', { quick: true, compact: true });
}
function trackDesktop() {
  if (!display || display.isDestroyed()) return;
  const cursor = screen.getCursorScreenPoint();
  if (drag && !settings.clickThrough && !settings.windowLocked) {
    const dx = cursor.x - drag.cursor.x, dy = cursor.y - drag.cursor.y;
    if (drag.moved || Math.hypot(dx, dy) > 5) {
      drag.moved = true;
      display.setPosition(drag.bounds.x + dx, drag.bounds.y + dy);
    }
  }
  const bounds = display.getBounds();
  const point = { x: cursor.x - bounds.x, y: cursor.y - bounds.y };
  display.webContents.send('display:pointer', point);
  updateBubble();
  if (!panel || !modelGeometry) return;
  const near = contains(point, modelGeometry.model, 35);
  const overPanel = panel.isVisible() && contains(cursor, panel.getBounds());
  if (near || overPanel || panel.isFocused()) lastNear = Date.now();
  if (!display.isVisible() || settings.clickThrough || !settings.hoverDialog) { if (quickMode) panel.hide(); return; }
  if (panel.isVisible() && !quickMode) return;
  if (quickCollapsed) {
    if (!near) quickAway = true;
    if (near && quickAway && !quickBusy) {
      quickCollapsed = false; panel.setFocusable(true); panel.setIgnoreMouseEvents(false); panel.setMinimumSize(120, 32);
    } else {
      if (quickBusy || Date.now() - quickFinishedAt < 2500) {
        panel.setBounds(statusBounds(bounds, modelGeometry.model, settings, screen.getDisplayMatching(bounds).workArea, activityText));
        if (!panel.isVisible()) panel.showInactive();
      } else panel.hide();
      return;
    }
  }
  if (near && !drag && !panel.webContents.isLoading()) {
    const next = quickBounds(bounds, modelGeometry.model, settings, screen.getDisplayMatching(bounds).workArea);
    if (!quickMode) { quickMode = true; panel.setMinimumSize(120, 32); panel.webContents.send('panel:tab', 'chat'); }
    panel.webContents.send('panel:mode', { quick: true, compact: false, fontSize: Math.max(11, Math.min(24, settings.dialogFontSize * modelGeometry.model.height / 560)) });
    if (!panel.isFocused()) panel.setBounds(next);
    if (!panel.isVisible()) panel.showInactive();
  } else if (quickMode && !panel.isFocused() && Date.now() - lastNear > 900) panel.hide();
}
function installDisplayProtocol() {
  const webRoot = path.join(__dirname, 'display');
  cloudSession.protocol.handle('plana', async request => {
    try {
      const url = new URL(request.url);
      if (url.host !== 'desktop') return new Response('Invalid host', { status: 403 });
      if (url.pathname.startsWith('/api/')) {
        const allowed = request.method === 'GET' ? ['/api/state', '/api/catalog', '/api/events'] : request.method === 'POST' ? ['/api/control', '/api/action'] : [];
        if (!allowed.includes(url.pathname)) return new Response('Forbidden', { status: 403 });
        return await cloudSession.fetch(CLOUD + url.pathname, { method: request.method, credentials: 'include', redirect: 'error',
          headers: request.method === 'POST' ? { 'Content-Type': 'application/json' } : {},
          body: request.method === 'POST' ? await request.text() : undefined, signal: request.signal });
      }
      if (request.method !== 'GET') return new Response('Forbidden', { status: 405 });
      const filename = path.resolve(webRoot, url.pathname === '/display' ? 'index.html' : '.' + decodeURIComponent(url.pathname));
      if (!filename.startsWith(webRoot + path.sep)) return new Response('Forbidden', { status: 403 });
      return await net.fetch(pathToFileURL(filename).href);
    } catch (e) { log(e.message); return new Response('展示页连接失败', { status: 502 }); }
  });
}
async function reconnect() {
  try { await cloudRequest('/api/control', { zoom: settings.zoom, x: settings.x, y: settings.y }, AbortSignal.timeout(12000)); }
  finally { connectDisplay(); panel?.webContents.send('panel:reconnect'); }
}
async function boot() {
  settingsFile = path.join(app.getPath('userData'), 'settings.json');
  try {
    const stored = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
    if (stored.subtitleFontSize === 24 && stored.subtitleWidth === 85 && stored.subtitleX === 0 && stored.subtitleY === 5) {
      Object.assign(stored, { subtitleFontSize: 16, subtitleWidth: 55, subtitleY: 0 });
    }
    settings = validateSettings(stored);
  } catch { settings = { ...defaults }; }
  cloudSession = session.fromPartition('persist:plana-cloud');
  installDisplayProtocol();
  cloudSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  const displays = [screen.getPrimaryDisplay(), ...screen.getAllDisplays().filter(d => d.id !== screen.getPrimaryDisplay().id)];
  display = new BrowserWindow({ ...visibleBounds(settings, displays), title: '普拉娜', frame: false, transparent: true, backgroundColor: '#00000000',
    hasShadow: false, resizable: true, maximizable: false, fullscreenable: false, skipTaskbar: true,
    minWidth: 240, minHeight: 320, icon: path.join(__dirname, 'assets/app.ico'),
    webPreferences: { session: cloudSession, preload: path.join(__dirname, 'preload-display.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false } });
  display.setMenu(null);
  display.setAlwaysOnTop(settings.alwaysOnTop, 'screen-saver');
  display.setIgnoreMouseEvents(settings.clickThrough, { forward: true });
  // Alpha 1 keeps transparent pixels draggable on Windows while looking transparent.
  display.setBackgroundColor(settings.clickThrough ? '#00000000' : '#00000001');
  display.setMovable(!settings.windowLocked);
  display.on('will-move', event => { if (settings.windowLocked) event.preventDefault(); });
  display.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  display.webContents.on('will-navigate', (event, url) => { if (url !== DISPLAY) event.preventDefault(); });
  display.webContents.on('did-finish-load', notifySettings);
  display.webContents.on('will-redirect', event => event.preventDefault());
  display.webContents.on('context-menu', () => { if (!settings.clickThrough) Menu.buildFromTemplate(menuTemplate()).popup({ window: display }); });
  display.webContents.on('did-fail-load', (_event, code, description) => log(`display load error: ${code} ${description}`));
  display.webContents.on('render-process-gone', (_event, details) => log(`display crashed: ${details.reason}`));
  display.on('move', () => { const bounds = display.getBounds(); settings.windowX = bounds.x; settings.windowY = bounds.y; save(); });
  display.on('resize', () => { const bounds = display.getBounds(); settings.width = bounds.width; settings.height = bounds.height; save(); notifySettings(); });
  display.on('closed', () => { display = null; if (!quitting) app.quit(); });
  tray = new Tray(nativeImage.createFromPath(path.join(__dirname, 'assets/tray.png')));
  tray.on('double-click', () => { display.show(); openPanel(); }); updateTray();
  shortcuts.clickThrough = registerShortcut(['Ctrl+Alt+P', 'Ctrl+Alt+Shift+P', 'Ctrl+Alt+Shift+F10'], () => configure({ clickThrough: !settings.clickThrough }).catch(report));
  shortcuts.messages = registerShortcut(['Ctrl+Alt+M', 'Ctrl+Alt+Shift+M', 'Ctrl+Alt+Shift+F9'], () => openPanel());
  updateTray();
  ipcMain.on('display:drag', (event, action) => {
    if (event.sender !== display?.webContents || event.senderFrame?.url !== DISPLAY || settings.clickThrough || settings.windowLocked) { drag = null; return; }
    if (action === 'start') drag = { cursor: screen.getCursorScreenPoint(), bounds: display.getBounds(), moved: false };
    if (action === 'end') drag = null;
  });
  const trustedDisplay = event => event.sender === display?.webContents && event.senderFrame?.url === DISPLAY;
  ipcMain.on('display:subtitle', (event, value) => {
    if (!trustedDisplay(event) || !value || typeof value.text !== 'string' || value.text.length > 4000 || typeof value.visible !== 'boolean') return;
    bubbleText = value.visible ? value.text : ''; clearTimeout(bubbleTimer); updateBubble();
    if (!bubbleText) bubbleTimer = setTimeout(() => { if (!bubbleText) bubble?.hide(); }, 350);
  });
  ipcMain.on('bubble:resized', (event, height) => {
    if (event.sender !== bubble?.webContents || event.senderFrame?.url !== bubbleURL || !Number.isFinite(height)) return;
    bubbleHeight = Math.max(60, Math.min(2000, Math.ceil(height))); updateBubble();
  });
  ipcMain.on('panel:activity', (event, value) => {
    if (!trusted(event) || !value) return;
    if (value.phase === 'status' && typeof value.text === 'string') activityText = value.text.slice(0, 200);
    if (value.phase === 'begin') {
      quickBusy = true; quickFinishedAt = 0;
      quickMode = true; quickCollapsed = true; quickAway = false; compactPanel();
    }
    if (value.phase === 'end') { quickBusy = false; quickFinishedAt = Date.now(); }
  });
  ipcMain.on('display:geometry', (event, value) => { if (trustedDisplay(event) && validGeometry(value)) modelGeometry = value; });
  ipcMain.on('display:tap', event => {
    if (!trustedDisplay(event) || settings.clickThrough || drag?.moved || !settings.touchVoice || Date.now() - lastTap < 4000) return;
    lastTap = Date.now(); createPanel(); panel.webContents.send('panel:touch');
  });
  ipcMain.handle('panel:initialize', event => { requirePanel(event); return { ...settings, shortcuts, cloud: CLOUD }; });
  ipcMain.handle('panel:configure', (event, patch) => { requirePanel(event); return configure(patch); });
  ipcMain.on('panel:hide', event => { if (trusted(event)) panel.hide(); });
  ipcMain.on('panel:cancel', (event, id) => { if (trusted(event)) requests.get(id)?.abort(); });
  ipcMain.handle('panel:request', async (event, { route, body, id }) => {
    requirePanel(event);
    const gets = ['/api/state', '/api/inference/config', '/api/inference/health'];
    const posts = ['/api/control', '/api/action', '/api/chat', '/api/tts'];
    if (!(body === undefined ? gets : posts).includes(route) || typeof id !== 'string' || id.length > 100 || requests.has(id)) throw new Error('请求格式错误');
    if (body !== undefined && JSON.stringify(body).length > 100000) throw new Error('请求过大');
    const controller = new AbortController(); requests.set(id, controller);
    try { return await cloudRequest(route, body, controller.signal); } finally { requests.delete(id); }
  });
  // Establish the cookie before the display starts its EventSource connection.
  await cloudRequest('/api/control', { zoom: settings.zoom, x: settings.x, y: settings.y }, AbortSignal.timeout(12000)).catch(e => log(e.message));
  createPanel();
  createBubble();
  connectDisplay();
  pointerTimer = setInterval(trackDesktop, 33);
  uploadHardware({ app, cloudSession, origin: CLOUD, signal: AbortSignal.timeout(12000) }).catch(e => log(e.message));
  log(`ready; shortcuts=${JSON.stringify(shortcuts)}`);
}
app.on('before-quit', () => { quitting = true; for (const controller of requests.values()) controller.abort(); clearTimeout(saveTimer); if (settingsFile && settings) { try { fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2)); } catch {} } });
app.on('will-quit', () => { clearInterval(pointerTimer); clearTimeout(bubbleTimer); globalShortcut.unregisterAll(); tray?.destroy(); });
app.on('window-all-closed', () => { if (!quitting) app.quit(); });
