import { Conversation, startPlayback } from './shared/conversation.js';
import { AudioDriver } from './shared/audio.js';
import { ReplyLifetime } from './shared/reply-lifetime.js';
import { SpeechMouth } from './shared/speech-performance.js';
const $ = id => document.getElementById(id);
const bridge = window.plana, player = $('audio');
const switches = ['alwaysOnTop', 'clickThrough', 'windowLocked', 'hoverDialog', 'mouseTracking', 'headpat', 'touchVoice'];
const layoutKeys = ['dialogWidth', 'dialogFontSize', 'dialogX', 'dialogY', 'subtitleFontSize', 'subtitleWidth', 'subtitleX', 'subtitleY'];
let state, config, objectURL, sequence = 0, patchTimer, pendingPatch = {}, sending = false, ready = false, inputEpoch = 0, touchController, statusError = false;
const say = text => {
  $('status').textContent = text; $('message').title = text; $('send').title = text;
  $('quick-status').textContent = text;
  statusError = /失败|未配置|无法|超时|连接失败/.test(text);
  $('quick-status').classList.toggle('error', statusError);
  bridge.activity({ phase: 'status', text });
};
const request = async (route, body, signal) => {
  const id = `request-${++sequence}`;
  const cancel = () => bridge.cancel(id);
  signal?.throwIfAborted(); signal?.addEventListener('abort', cancel, { once: true });
  try { const value = await bridge.request(route, body, id); signal?.throwIfAborted(); return value; }
  finally { signal?.removeEventListener('abort', cancel); }
};
const applyState = next => {
  if (state && next.revision < state.revision) return;
  lifetime.observe(state, next); state = next;
};
const pose = async (value, signal) => { applyState(await request('/api/control', value, signal)); };
const lifetime = new ReplyLifetime({ readState: () => state, pose, onError: error => say(error.message) });
const mouth = new SpeechMouth();
const audio = new AudioDriver({
  mouth: (amount, features) => { if (state?.mouthMode === 'auto') queuePose(mouth.sample(state, amount, features, performance.now())); },
  meter: () => {}, status: () => {}
});
function queuePose(value) { Object.assign(pendingPatch, value); clearTimeout(patchTimer); patchTimer = setTimeout(flush, 30); }
async function flush() {
  if (sending || !Object.keys(pendingPatch).length) return;
  sending = true; const patch = pendingPatch; pendingPatch = {};
  try { await pose(patch); } catch (e) { say(e.message); }
  finally { sending = false; if (Object.keys(pendingPatch).length) flush(); }
}
function stopLocal() {
  touchController?.abort(); touchController = null;
  conversation?.cancel(); lifetime.cancel(); mouth.reset(); player.pause(); audio.stop();
}
function addEntry(user, reply) {
  const welcome = $('chat-log').querySelector('.welcome'); welcome?.remove();
  const entry = document.createElement('div'); entry.className = 'chat-entry';
  for (const [label, text] of [['老师', user], ['普拉娜', reply]]) {
    const paragraph = document.createElement('p'), name = document.createElement('strong'); name.textContent = label + '：';
    paragraph.append(name, document.createTextNode(text)); entry.append(paragraph);
  }
  $('chat-log').append(entry);
  while ($('chat-log').children.length > 30) $('chat-log').firstElementChild.remove();
  $('chat-log').scrollTop = $('chat-log').scrollHeight;
}
const conversation = new Conversation({ request, pose, prepare: () => audio.ensureContext(), stop: stopLocal,
  begin: voice => { if (voice) lifetime.expectAudio(); },
  failed: () => { statusError = true; lifetime.audioEnded(); }, status: say, reply: addEntry,
  play: async (value, signal, onStarted, waitForEnd) => {
    if (objectURL) URL.revokeObjectURL(objectURL);
    const bytes = Uint8Array.from(atob(value.audio), c => c.charCodeAt(0));
    objectURL = URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' })); player.src = objectURL;
    await audio.file(player); signal.throwIfAborted();
    await startPlayback(player, signal, onStarted, waitForEnd);
  }
});
player.onplaying = () => lifetime.audioStarted();
player.onended = () => { audio.stop(); lifetime.audioEnded(); say('播放结束'); };
player.onerror = () => { audio.stop(); lifetime.audioEnded(); say('语音播放失败，请重试'); };
async function stop() { inputEpoch++; stopLocal(); try { await request('/api/action', { action: 'stop' }); } catch (e) { say(e.message); } }
async function send() {
  const text = $('message').value.trim(); if (!text) return;
  if (!ready) return say('尚未连接云端，请右键选择重新连接');
  if ($('send').disabled) return;
  if ($('mode').value === 'chat' && !config?.chatReady) return say('服务器尚未配置聊天接口，请先使用台词语音或字幕。');
  const epoch = ++inputEpoch;
  statusError = false;
  $('send').disabled = true;
  bridge.activity({ phase: 'begin' });
  $('message').setAttribute('aria-busy', 'true');
  say('正在发送…');
  try {
    // Refresh revisions after settings or other views have changed this session.
    applyState(await request('/api/state'));
    if (epoch !== inputEpoch) return;
    if ($('mode').value === 'subtitle') { stopLocal(); await pose({ subtitle: text }); say('字幕已显示'); }
    else await conversation.run(text, 'plana', $('mode').value === 'chat', $('mode').value === 'voice' || $('voice-enabled').checked);
  } catch (e) { say(e.message); statusError = true; }
  finally {
    if (epoch === inputEpoch && !statusError && $('message').value.trim() === text) { $('message').value = ''; $('count').textContent = '0 / 200'; }
    $('send').disabled = !ready; $('message').setAttribute('aria-busy', 'false');
    bridge.activity({ phase: 'end' });
  }
}
$('send').onclick = send; $('stop').onclick = stop;
$('message').oninput = () => { $('count').textContent = `${$('message').value.length} / 200`; };
$('message').onkeydown = event => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); send(); } };
$('clear').onclick = () => { stop(); conversation.clear(); $('chat-log').replaceChildren(); };
function modeHint() {
  $('message').placeholder = $('mode').value === 'subtitle' ? '想显示些什么？' : '想对我说些什么？';
  $('chat-hint').textContent = $('mode').value === 'chat' ? '发送后会请求云端聊天模型，回复可自动播放语音。' : $('mode').value === 'voice' ? '当前声音模型使用日语。语音准备好后，角色才会显示字幕并开口。' : '只显示文字，不生成语音。';
  $('voice-enabled').disabled = $('mode').value !== 'chat';
}
$('mode').onchange = modeHint;
function tab(name) {
  for (const page of ['chat', 'settings']) { $(`${page}-page`).hidden = page !== name; $(`tab-${page}`).classList.toggle('selected', page === name); $(`tab-${page}`).setAttribute('aria-selected', String(page === name)); }
  if (name === 'chat' && document.hasFocus()) $('message').focus();
}
$('tab-chat').onclick = () => tab('chat'); $('tab-settings').onclick = () => tab('settings');
bridge.onTab(tab); bridge.onStop(() => { inputEpoch++; stopLocal(); });
bridge.onMode(value => {
  document.body.classList.toggle('quick', value.quick);
  document.documentElement.classList.toggle('quick', value.quick);
  document.body.classList.toggle('compact', Boolean(value.quick && value.compact));
  if (value.fontSize) document.documentElement.style.setProperty('--quick-font', value.fontSize + 'px');
});
$('hide-panel').onclick = () => bridge.hide();
const touchLines = [
  ['老师可以在这里处理各种各样的工作。', '03'], ['老师，请选择您需要执行的工作。', '03'],
  ['这些是需要解决的工作。那就拜托您了。', '03'], ['混乱，该行动无法理解。请不要戳我，会出现故障。', '13'],
  ['我明白了。老师现在无事可做，很无聊。', '12']
];
let touchIndex = 0, touchPlaying = false;
bridge.onTouch(async () => {
  if (!ready || touchPlaying || conversation.controller || !player.paused) return;
  touchPlaying = true;
  const index = touchIndex++ % touchLines.length;
  try {
    inputEpoch++; stopLocal();
    touchController = new AbortController(); const signal = touchController.signal;
    applyState(await request('/api/state', undefined, signal));
    if (state.character !== 'plana') return;
    await audio.ensureContext(); signal.throwIfAborted(); lifetime.expectAudio();
    player.src = `voices/np0035_work_talk_${index + 1}.ogg`;
    await audio.file(player);
    await startPlayback(player, signal, async () => { await pose({ mouthMode: 'auto', expression: touchLines[index][1], subtitle: touchLines[index][0] }, signal); });
    say('正在播放原壁纸互动台词');
  } catch (e) { if (e.name !== 'AbortError') { lifetime.audioEnded(); say(e.message); } }
  finally { touchPlaying = false; }
});
function renderSettings(value) {
  for (const key of switches) $(key).checked = value[key];
  for (const key of ['width', 'height', 'zoom', 'x', 'y', ...layoutKeys]) if (document.activeElement !== $(key)) $(key).value = value[key];
  document.documentElement.style.setProperty('--dialog-font', value.dialogFontSize + 'px');
  values();
  $('shortcut-hint').textContent = value.shortcuts?.clickThrough ? `${value.shortcuts.clickThrough} 切换穿透；${value.shortcuts.messages ? value.shortcuts.messages + ' 打开发送消息。' : '托盘菜单可打开发送消息。'}托盘菜单也可恢复点击。` : '穿透快捷键被其他软件占用，请使用任务栏托盘菜单恢复点击。';
}
bridge.onSettings(renderSettings);
function values() { $('zoom-value').textContent = Math.round(Number($('zoom').value) * 100) + '%'; for (const key of ['x', 'y']) $(`${key}-value`).textContent = Number($(key).value).toFixed(2); }
const configure = async patch => {
  try { renderSettings(await bridge.configure(patch)); $('settings-status').textContent = '设置已保存'; }
  catch (e) { $('settings-status').textContent = e.message; }
};
for (const key of switches) $(key).onchange = () => configure({ [key]: $(key).checked });
$('apply-layout').onclick = () => configure(Object.fromEntries(layoutKeys.map(key => [key, Number($(key).value)])));
$('reset-layout').onclick = () => configure({ dialogWidth: 340, dialogFontSize: 13, dialogX: 0, dialogY: 12, subtitleFontSize: 16, subtitleWidth: 55, subtitleX: 0, subtitleY: 0 });
$('resize').onclick = () => configure({ width: Number($('width').value), height: Number($('height').value) });
for (const button of document.querySelectorAll('[data-size]')) button.onclick = () => { const [width, height] = button.dataset.size.split(',').map(Number); configure({ width, height }); };
let adjustmentTimer, adjustment = {};
for (const key of ['zoom', 'x', 'y']) $(key).oninput = () => { values(); adjustment[key] = Number($(key).value); clearTimeout(adjustmentTimer); adjustmentTimer = setTimeout(() => { const patch = adjustment; adjustment = {}; configure(patch); }, 140); };
$('reset-pose').onclick = () => { clearTimeout(adjustmentTimer); adjustment = {}; configure({ zoom: 1, x: 0, y: 0 }); };
async function initialize() {
  stopLocal(); state = undefined;
  ready = false; $('send').disabled = true;
  const settings = await bridge.initialize(); renderSettings(settings); $('cloud-address').textContent = '云端服务 · ' + settings.cloud;
  const [next, configuration] = await Promise.all([request('/api/state'), request('/api/inference/config')]);
  applyState(next); config = configuration; ready = true; $('send').disabled = false; $('online').textContent = '云端已连接';
  $('mode').querySelector('[value=chat]').disabled = !config.chatReady;
  if (!config.chatReady) { $('mode').value = 'chat'; say('聊天接口尚未配置，请先连接聊天服务'); }
  else say('等待输入');
  modeHint();
}
function initializeWithStatus() { initialize().catch(error => { $('online').textContent = '连接失败'; say(error.message + '；请右键角色选择重新连接云端。'); }); }
bridge.onReconnect(initializeWithStatus); initializeWithStatus();
window.addEventListener('keydown', event => { if (event.key === 'Escape') bridge.hide(); });
window.addEventListener('pagehide', () => { audio.dispose(); lifetime.cancel(); conversation.cancel(); if (objectURL) URL.revokeObjectURL(objectURL); });
