import { PresenterRenderer } from './renderer.js';
import { AudioDriver } from './audio.js';
import { emotionProfiles, haloLabels } from './emotions.js';
import { wireConversation } from './conversation.js';
import { ReplyLifetime } from './reply-lifetime.js';
import { SpeechMouth } from './speech-performance.js';
import { fetchJSON, loadDisplaySession, validateDisplayState } from './display-session.js';

const $ = id => document.getElementById(id);
const obs = ['/obs', '/display'].includes(location.pathname);
if (obs) document.body.classList.add('obs');
if (location.pathname === '/display') document.title = 'PLANA ALIVE · 角色展示';
let state, catalog, currentCharacter, image, fileURL;
let latestRevision = -1, pendingPatch = {}, patchTimer, sending = false, toastTimer;
let displayedState, heldSpace = false;
let conversation;
const speechMouth = new SpeechMouth();
const replyLifetime = new ReplyLifetime({ readState: () => state,
  pose: async value => applyState(await post('/api/control', value)), onError: error => toast(error.message) });

function toast(message) {
  if (obs) return;
  $('toast').textContent = message; $('toast').hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').hidden = true, 4500);
}
async function post(route, body) {
  return fetchJSON(route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}
// Serialize/coalesce slider, gaze and audio updates: a slow request cannot reorder poses.
function patch(value, immediate = false) {
  Object.assign(pendingPatch, value);
  clearTimeout(patchTimer);
  if (immediate) flush(); else patchTimer = setTimeout(flush, 30);
}
async function flush() {
  if (sending || !Object.keys(pendingPatch).length) return;
  sending = true; const payload = pendingPatch; pendingPatch = {};
  try { applyState(await post('/api/control', payload)); } catch (e) { toast(e.message); }
  finally { sending = false; if (Object.keys(pendingPatch).length) flush(); }
}
async function action(action) {
  try { await post('/api/action', { action }); } catch (e) { toast(e.message); }
}
const renderer = new PresenterRenderer($('canvas'), (message, error) => {
  $('loading').textContent = message; $('loading').hidden = !message;
  if (error) toast(message);
});
document.addEventListener('plana:desktop-config', event => renderer.desktop.configure(event.detail));
document.addEventListener('plana:desktop-pointer', event => { renderer.desktop.pointer = event.detail; });
document.addEventListener('plana:desktop-pet', event => renderer.desktop.pet(event.detail.phase, event.detail.x, renderer.regions?.head));
const audio = new AudioDriver({
  mouth: (amount, features) => { if (!obs && state?.mouthMode === 'auto') patch(speechMouth.sample(state, amount, features, performance.now())); },
  meter: amount => { $('level').style.width = amount * 100 + '%'; $('level-value').textContent = Math.round(amount * 100) + '%'; },
  status: message => { $('audio-status').textContent = message; $('activity').textContent = message === '未接入音频' ? '待机中' : message;
    $('mic').textContent = message === '麦克风已连接' ? '关闭麦克风' : '启用麦克风'; $('mic').classList.toggle('active', message === '麦克风已连接'); },
});

function fillSelect(element, values) { element.replaceChildren(...values.map(value => new Option(value, value))); }
function modelUI() {
  const meta = catalog[state.character];
  currentCharacter = state.character;
  $('presenter-name').replaceChildren(document.createTextNode(meta.name), Object.assign(document.createElement('span'), { textContent: '，正在待命。' }));
  $('model-version').textContent = 'SPINE ' + meta.version;
  fillSelect($('expression'), meta.expressions);
  for (const option of $('expression').options) option.textContent=option.value+' · '+meta.expressionLabels[option.value];
  $('emotion').replaceChildren(new Option('手动 / 原编号','custom'),...Object.entries(emotionProfiles).map(([key,p])=>new Option(p.label,key)));
  $('halo').replaceChildren(...Object.entries(haloLabels).map(([key,label])=>new Option(label,key)));
  $('effect-controls').replaceChildren(...Object.entries({blush:'脸红',sweat:'汗滴',tears:'眼泪'}).map(([key,label])=>{
    const field=document.createElement('label'); field.className='field-line'; field.append(document.createTextNode(label));
    const select=document.createElement('select');select.id=key;select.disabled=!meta.effects[key];
    select.append(...[[-1,'随表情'],[0,'隐藏'],[.4,'淡'],[1,'显示']].map(([v,t])=>new Option(t,String(v))));
    select.onchange=()=>patch({[key]:Number(select.value)},true);field.append(select);return field;
  }));
  fillSelect($('closed-mouth'), meta.mouths); fillSelect($('open-mouth'), meta.mouths);
  const ids = state.character === 'plana' ? ['00', '02', '03', '12', '13', '20'] : ['00', '12', '13', '18', '25', '29'];
  // Numbered expressions retain their original IDs rather than inventing labels.
  $('expressions').replaceChildren(...ids.map((id, i) => {
    const b = document.createElement('button'); b.dataset.expression = id;
    b.textContent = meta.expressionLabels[id]+' '+id;
    const small=document.createElement('small');small.textContent=`快捷键 ${i+1}`;b.append(small);
    b.onclick = () => patch({ expression: id }, true); return b;
  }));
  const character = state.character;
  image = new Image();
  image.onload = () => { if (state.character === character) mouthGallery(meta, image); };
  image.src = `/assets/${meta.file}.png`;
}
function mouthGallery(meta, texture) {
  $('mouth-gallery').replaceChildren(...meta.mouths.map(name => {
    const b = document.createElement('button'); b.title = '点击预览：' + name; b.dataset.mouth = name;
    const canvas = document.createElement('canvas'); canvas.width = 90; canvas.height = 50;
    const ctx = canvas.getContext('2d'); ctx.imageSmoothingEnabled = false;
    const r = meta.mouthRegions[name], scale = Math.min(76 / r.width, 34 / r.height, 4);
    if (!r.rotate) ctx.drawImage(texture, r.x, r.y, r.width, r.height, (90 - r.width * scale) / 2, (50 - r.height * scale) / 2, r.width * scale, r.height * scale);
    b.append(canvas, document.createTextNode(name.replace(/Mouth_|Mouse_/, '#')));
    b.onclick = () => patch({ openMouth: name, mouth: 1, mouthMode: 'manual' }, true);
    return b;
  }));
}
function applyState(next) {
  validateDisplayState(next, catalog);
  if (next.revision < latestRevision) return;
  if (!obs && state && next.character !== state.character) stopLocal();
  if (!obs) replyLifetime.observe(state, next);
  latestRevision = next.revision; state = next;
  renderer.update(state, catalog);
  if (state.subtitle) $('subtitle').textContent = state.subtitle;
  $('subtitle').classList.toggle('visible', Boolean(state.subtitle));
  $('subtitle').setAttribute('aria-hidden', String(!state.subtitle));
  if (obs) return;
  if (currentCharacter !== state.character) modelUI();
  // Audio updates must not steal an in-progress edit or rebuild controls.
  const sameSettings = displayedState && Object.keys(state).every(k => ['mouth', 'revision', 'connectedViews'].includes(k) || state[k] === displayedState[k]);
  $('mouth-value').textContent = Math.round(state.mouth * 100) + '%';
  if (document.activeElement !== $('mouth')) $('mouth').value = state.mouth;
  if (sameSettings) { displayedState = state; return; }
  displayedState = state;
  $('emotion').value=state.emotion;
  $('halo').value=state.halo;
  $('intensity-value').textContent=Math.round(state.intensity*100)+'%';
  for(const key of ['intensity','headTilt','bodyLean','haloLift','haloRotation','blush','sweat','tears']) if(document.activeElement!==$(key)) {
    if (['blush','sweat','tears'].includes(key) && ![...$(key).options].some(o=>+o.value===state[key])) $(key).add(new Option(String(state[key]),String(state[key])));
    $(key).value=state[key];
  }
  $('stage').dataset.background = state.background;
  $('expression').value = state.expression; $('expression-label').textContent = state.expression;
  for (const button of document.querySelectorAll('[data-character]')) button.classList.toggle('active', button.dataset.character === state.character);
  for (const button of document.querySelectorAll('[data-expression]')) button.classList.toggle('active', button.dataset.expression === state.expression);
  const mapping = { 'mouth-mode': 'mouthMode', 'closed-mouth': 'closedMouth', 'open-mouth': 'openMouth', 'gaze-x': 'gazeX', 'gaze-y': 'gazeY', zoom: 'zoom', 'position-x': 'x', 'position-y': 'y', background: 'background' };
  for (const [id, key] of Object.entries(mapping)) if (document.activeElement !== $(id)) $(id).value = state[key];
  $('follow-mouse').checked = state.followMouse; $('flip').checked = state.flip;
  $('zoom-value').textContent = Math.round(state.zoom * 100) + '%';
  if (document.activeElement !== $('subtitle-input')) $('subtitle-input').value = state.subtitle;
}

async function boot() {
  const initial = await loadDisplaySession();
  catalog = initial.catalog;
  applyState(initial.state);
  const events = new EventSource('/api/events');
  events.addEventListener('state', event => {
    try { applyState(JSON.parse(event.data)); }
    catch (error) { toast(error.message); }
  });
  events.addEventListener('action', event => {
    const { action: name } = JSON.parse(event.data);
    renderer.action(name);
    if (name === 'stop' || name === 'reset') stopLocal();
  });
  events.onopen = () => { latestRevision = -1; $('connection').textContent = '控制已连接'; $('connection').classList.remove('offline'); };
  events.onerror = () => { $('connection').textContent = '服务断开 · 正在重连'; $('connection').classList.add('offline'); };
  if (obs) return;
  wireControls();
  conversation = wireConversation({ audio, player: $('audio-player'), stop: stopLocal, character: () => state.character, toast, replyLifetime, performance: renderer.performance,
    pose: async (value, signal) => {
      const response = await fetch('/api/control', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value), signal });
      const result = await response.json(); if (!response.ok) throw new Error(result.error); applyState(result);
    } });
}
function stopLocal() { renderer.performance.reset(state); speechMouth.reset(); replyLifetime.cancel(); conversation?.cancel(); audio.stop(); $('audio-player').pause(); }
function wireControls() {
  $('emotion').onchange=()=>patch({emotion:$('emotion').value,intensity:Number($('intensity').value)},true);
  $('halo').onchange=()=>patch({halo:$('halo').value},true);
  for(const key of ['intensity','headTilt','bodyLean','haloLift','haloRotation']) $(key).oninput=()=>patch({[key]:Number($(key).value)});
  $('api-address').textContent = location.origin + '/api/control';
  document.querySelectorAll('[data-character]').forEach(b => b.onclick = () => { stopLocal(); patch({ character: b.dataset.character }, true); });
  for (const name of ['blink', 'pat', 'reset']) $(name).onclick = () => action(name);
  $('stop').onclick = () => { stopLocal(); action('stop'); };
  $('demo').onclick = () => { stopLocal(); patch({ mouthMode: 'auto' }, true); audio.demo(); };
  const mapping = { expression: 'expression', 'mouth-mode': 'mouthMode', 'closed-mouth': 'closedMouth', 'open-mouth': 'openMouth', background: 'background' };
  for (const [id, key] of Object.entries(mapping)) $(id).onchange = () => patch({ [key]: $(id).value }, true);
  for (const [id, key] of [['gaze-x', 'gazeX'], ['gaze-y', 'gazeY'], ['zoom', 'zoom'], ['position-x', 'x'], ['position-y', 'y']]) $(id).oninput = () => patch({ [key]: Number($(id).value) });
  $('mouth').oninput = () => { const amount = Number($('mouth').value); stopLocal(); patch({ mouthMode: 'manual', mouth: amount }); };
  for (const [id, key] of [['follow-mouse', 'followMouse'], ['flip', 'flip']]) $(id).onchange = () => patch({ [key]: $(id).checked }, true);
  $('gain').oninput = () => { audio.gain = Number($('gain').value); $('gain-value').textContent = audio.gain.toFixed(1) + '×'; };
  $('show-subtitle').onclick = () => patch({ subtitle: $('subtitle-input').value }, true);
  $('speak').onclick = () => {
    const text = $('subtitle-input').value.trim();
    if (!text) return toast('先填写要朗读的内容。');
    stopLocal(); replyLifetime.expectAudio(); patch({ subtitle: '', mouthMode: 'auto' }, true);
    try { audio.speak(text, {
      start: () => { renderer.performance.start(); replyLifetime.audioStarted(); patch({ subtitle: text }, true); },
      end: () => { renderer.performance.end(); replyLifetime.audioEnded(); }
    }); } catch (error) { replyLifetime.audioEnded(); toast(error.message); }
  };
  $('mic').onclick = async () => {
    conversation?.cancel();
    if (audio.stream) { audio.stop(); return; }
    $('audio-player').pause(); patch({ mouthMode: 'auto' }, true);
    try { await audio.microphone(); } catch (error) { toast(error.name === 'NotAllowedError' ? '麦克风权限未开启，可改用音频文件。' : '无法打开麦克风：' + error.message); }
  };
  $('audio-file').onchange = async () => {
    const file = $('audio-file').files[0]; if (!file) return;
    stopLocal(); if (fileURL) URL.revokeObjectURL(fileURL);
    fileURL = URL.createObjectURL(file); const player = $('audio-player'); player.src = fileURL; player.hidden = false;
    patch({ mouthMode: 'auto' }, true);
    try { await audio.file(player); await player.play(); toast('音频已载入：' + file.name); } catch (e) { toast('音频播放失败：' + e.message); }
  };
  $('audio-player').onplaying = async () => {
    renderer.performance.start();
    replyLifetime.audioStarted();
    if (!audio.active || audio.source !== audio.mediaSource) { patch({ mouthMode: 'auto' }, true); try { await audio.file($('audio-player')); } catch (e) { toast(e.message); } }
  };
  $('audio-player').onpause = () => { if (audio.source === audio.mediaSource) audio.stop(); };
  $('audio-player').onended = () => { audio.stop(); renderer.performance.end(); replyLifetime.audioEnded(); };
  $('audio-player').onerror = () => { audio.stop(); renderer.performance.end(); replyLifetime.audioEnded(); toast('此音频格式无法播放，请换用 WAV、MP3 或 OGG。'); };
  $('copy-obs').onclick = async () => { try { await navigator.clipboard.writeText(location.origin + '/obs'); toast('OBS 透明输出地址已复制'); } catch { toast(location.origin + '/obs'); } };
  $('canvas').onpointermove = event => {
    if (!state.followMouse) return;
    const rect = $('canvas').getBoundingClientRect();
    patch({ gazeX: Math.max(-1, Math.min(1, ((event.clientX - rect.left) / rect.width * 2 - 1) * (state.flip ? -1 : 1))),
      gazeY: Math.max(-1, Math.min(1, 1 - (event.clientY - rect.top) / rect.height * 2)) });
  };
  $('canvas').onpointerleave = () => { if (state.followMouse) patch({ gazeX: 0, gazeY: 0 }); };
  document.addEventListener('keydown', event => {
    if (event.code === 'Escape') { stopLocal(); action('stop'); return; }
    if (event.target.matches('input,textarea,select,button') || event.ctrlKey || event.altKey || event.metaKey || event.repeat) return;
    const keys = [...document.querySelectorAll('[data-expression]')];
    if (/^[1-6]$/.test(event.key)) keys[Number(event.key) - 1]?.click();
    if (event.code === 'KeyB') action('blink');
    if (event.code === 'Space') { event.preventDefault(); heldSpace = true; patch({ mouthMode: 'manual', mouth: 1 }, true); }
  });
  document.addEventListener('keyup', event => { if (event.code === 'Space' && heldSpace) { heldSpace = false; patch({ mouth: 0 }, true); } });
  window.addEventListener('blur', () => { if (heldSpace) { heldSpace = false; patch({ mouth: 0 }, true); } });
  window.addEventListener('pagehide', () => {
    replyLifetime.cancel();
    if (audio.active || audio.simulation) navigator.sendBeacon('/api/control', new Blob([JSON.stringify({ mouth: 0 })], { type: 'application/json' }));
  });
}

// Read-only diagnostics for local rendering verification and integrations.
window.presenterDiagnostics = () => ({ ...renderer.diagnostics(), state, audio: { active: audio.active, context: audio.context?.state } });
boot().catch(error => { $('loading').textContent = '启动失败：' + error.message; toast(error.message); });
