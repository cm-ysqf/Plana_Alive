import { normalizeControl } from './chat-protocol.js';
import { splitSpeech, speechSegments, speechPause, waitForSpeech } from './speech-segments.js';
export { splitSpeech } from './speech-segments.js';

// Stop/replacement invalidates every awaited generation result.
export class Conversation {
  constructor({ request, prepare, stop, pose, play, status, reply, begin, failed, pause = waitForSpeech }) {
    Object.assign(this, { request, prepare, stop, pose, play, status, reply, begin, failed, pause });
    this.histories = { plana: [], arona: [] }; this.controller = null;
  }
  cancel() { this.controller?.abort(); this.controller = null; this.status('已停止'); }
  clear() { this.cancel(); this.histories = { plana: [], arona: [] }; }
  async run(text, character, chat = false, voice = true) {
    this.stop();
    this.begin?.(voice);
    const controller = new AbortController(); this.controller = controller;
    const { signal } = controller;
    const current = () => { if (signal.aborted || this.controller !== controller) throw new DOMException('已取消', 'AbortError'); };
    let answered = false;
    try {
      if (voice) { await this.prepare(); current(); }
      let answer = { reply: text, speech: text };
      if (chat) {
        this.status('正在思考…');
        answer = await this.request('/api/chat', { text, character, history: this.histories[character].slice(-20) }, signal);
        current(); answered = true;
        this.histories[character].push({ role: 'user', content: text }, { role: 'assistant', content: answer.reply });
        this.histories[character] = this.histories[character].slice(-20);
        this.reply(text, answer.reply);
      }
      current();
      const control = chat ? normalizeControl(answer.control ?? { emotion: answer.emotion ?? 'neutral', intensity: answer.intensity ?? 0.5 }, character) : { actions: [] };
      const { actions, ...pose } = control;
      await this.pose({ ...pose, subtitle: voice ? '' : answer.reply, mouthMode: 'auto', mouth: 0 }, signal);
      current();
      for (const action of actions) {
        await this.request('/api/action', { action }, signal);
        current();
      }
      if (voice) {
        this.status('正在合成语音…');
        const chunks = chat ? speechSegments(answer) : splitSpeech(answer.speech).map(text => ({ reply: text, speech: text }));
        // A prefetched error is handled when its turn arrives, never as an unhandled rejection.
        const synthesize = part => this.request('/api/tts', { text: part }, signal, true).then(value => ({ value }), error => ({ error }));
        let pending = synthesize(chunks[0].speech);
        for (let i = 0; i < chunks.length; i++) {
          if (i > 0) this.begin?.(true);
          const gapStarted = performance.now();
          const result = await pending;
          current(); if (result.error) throw result.error;
          if (i > 0) {
            const remaining = speechPause(chunks[i - 1].reply) - (performance.now() - gapStarted);
            if (remaining > 0) await this.pause(remaining, signal);
            current();
          }
          const more = i + 1 < chunks.length;
          await this.play(result.value, signal, async () => {
            current();
            await this.pose({ subtitle: chunks[i].reply }, signal);
            current();
            this.status(chunks.length > 1 ? `正在说话 · ${i + 1}/${chunks.length}` : '正在说话…');
            if (more) pending = synthesize(chunks[i + 1].speech);
          }, true);
          current();
        }
        current(); this.status('语音已就绪 · 播放口型随音量变化');
      } else this.status('回复已显示');
    } catch (e) {
      if (e.name !== 'AbortError' && !signal.aborted) { this.failed?.(); this.status((answered ? '回复已保留，后续处理失败：' : '请求失败：') + e.message); }
    } finally { if (this.controller === controller) this.controller = null; }
  }
}

// A play request can wait for buffering or fail autoplay; publish only on actual playback.
export async function startPlayback(player, signal, onStarted, waitForEnd = false) {
  let playing, aborted, failed, ended, rejectFinished;
  const finished = waitForEnd ? new Promise((resolve, reject) => { ended = resolve; rejectFinished = reject; player.addEventListener('ended', ended, { once: true }); }) : Promise.resolve();
  const started = new Promise((resolve, reject) => {
    playing = () => { Promise.resolve().then(() => {
      signal.throwIfAborted(); return onStarted();
    }).then(resolve, reject); };
    aborted = () => { player.pause(); const error = new DOMException('已取消', 'AbortError'); reject(error); rejectFinished?.(error); };
    failed = () => { const error = new Error('音频播放失败'); reject(error); rejectFinished?.(error); };
    player.addEventListener('playing', playing, { once: true });
    player.addEventListener('error', failed, { once: true });
    signal.addEventListener('abort', aborted, { once: true });
  });
  try {
    signal.throwIfAborted();
    await Promise.all([started, player.play(), finished]);
  } finally {
    player.removeEventListener('playing', playing);
    player.removeEventListener('error', failed);
    if (ended) player.removeEventListener('ended', ended);
    signal.removeEventListener('abort', aborted);
  }
}

export function wireConversation({ audio, player, stop, pose, character, toast, replyLifetime, performance }) {
  const $ = id => document.getElementById(id);
  let objectURL;
  const request = async (route, body, signal, binary = false) => {
    const response = await fetch(route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal });
    if (!response.ok) { const value = await response.json(); throw new Error(value.error || `HTTP ${response.status}`); }
    return binary ? response.blob() : response.json();
  };
  const conversation = new Conversation({ request, stop, pose,
    begin: voice => { if (voice) { replyLifetime?.expectAudio(); performance?.prepare(); } },
    failed: () => { performance?.end(); replyLifetime?.audioEnded(); },
    prepare: () => audio.ensureContext(),
    status: message => { $('conversation-status').textContent = message; },
    reply: (text, answer) => {
      const entry = document.createElement('div'); entry.className = 'chat-entry';
      for (const [label, content] of [['老师', text], [character() === 'plana' ? '普拉娜' : '阿罗娜', answer]]) {
        const p = document.createElement('p'); const strong = document.createElement('strong'); strong.textContent = label + '：';
        p.append(strong, document.createTextNode(content)); entry.append(p);
      }
      $('chat-log').append(entry);
      while ($('chat-log').children.length > 10) $('chat-log').firstElementChild.remove();
      $('chat-log').scrollTop = $('chat-log').scrollHeight;
    },
    play: async (blob, signal, onStarted, waitForEnd) => {
      player.pause();
      if (objectURL) URL.revokeObjectURL(objectURL);
      objectURL = URL.createObjectURL(blob); const playbackURL = objectURL; player.src = playbackURL; player.hidden = false;
      await audio.file(player);
      if (signal.aborted) return;
      await startPlayback(player, signal, onStarted, waitForEnd);
      if (signal.aborted && player.src === playbackURL) { player.pause(); audio.stop(); }
    }
  });
  let settings;
  const fields = { tts: ['url', 'directory', 'ref_audio_path', 'prompt_text', 'prompt_lang', 'text_lang', 'speed_factor'], chat: ['url', 'model', 'systemPrompt'] };
  const renderConfig = value => {
    settings = value;
    $('inference-settings').hidden = Boolean(value.readOnly);
    for (const [section, names] of Object.entries(fields)) for (const name of names) $(`${section}-${name}`).value = value[section][name];
    $('chat-apiKey').value = ''; $('chat-apiKey').placeholder = value.chat.hasApiKey ? '已保存，留空保留' : '可选，本地服务可留空';
    $('chat-send').disabled = !value.chatReady;
    $('chat-config-status').textContent = value.chatReady ? '聊天接口已配置' : '聊天 API 暂空 · 可直接合成语音';
  };
  const refreshHealth = async () => {
    $('tts-health').textContent = '正在检测…';
    try { const result = await fetch('/api/inference/health').then(r => r.json()); $('tts-health').textContent = result.tts.message; }
    catch (e) { $('tts-health').textContent = '检测失败：' + e.message; }
  };
  $('inference-save').onclick = async () => {
    try {
      const patch = { tts: {}, chat: {} };
      for (const [section, names] of Object.entries(fields)) for (const name of names) patch[section][name] = name === 'speed_factor' ? Number($(`${section}-${name}`).value) : $(`${section}-${name}`).value;
      if ($('chat-apiKey').value) patch.chat.apiKey = $('chat-apiKey').value;
      if ($('chat-clear-key').checked) patch.chat.apiKey = '';
      renderConfig(await request('/api/inference/config', patch));
      $('chat-clear-key').checked = false; toast('接口配置已保存'); refreshHealth();
    } catch (e) { toast(e.message); }
  };
  $('tts-check').onclick = refreshHealth;
  const run = chat => {
    const text = $(chat ? 'chat-input' : 'subtitle-input').value.trim();
    if (!text) return toast(chat ? '先填写聊天内容。' : '先填写要合成的文本。');
    if (chat && !settings?.chatReady) return toast('请先配置聊天接口。');
    conversation.run(text, character(), chat, !chat || $('chat-voice').checked);
  };
  $('tts-speak').onclick = () => run(false);
  $('chat-send').onclick = () => run(true);
  $('chat-stop').onclick = stop;
  $('chat-clear').onclick = () => { stop(); conversation.clear(); $('chat-log').replaceChildren(); };
  $('chat-input').onkeydown = event => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); run(true); } };
  fetch('/api/inference/config').then(r => { if (!r.ok) throw new Error('接口配置加载失败'); return r.json(); }).then(value => { renderConfig(value); refreshHealth(); }).catch(e => toast(e.message));
  window.addEventListener('pagehide', () => { conversation.cancel(); if (objectURL) URL.revokeObjectURL(objectURL); });
  return conversation;
}
