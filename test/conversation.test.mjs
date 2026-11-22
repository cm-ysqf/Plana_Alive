import test from 'node:test';
import assert from 'node:assert/strict';
import { Conversation, startPlayback, splitSpeech } from '../public/conversation.js';

function setup(request) {
  const poses = [], played = [], statuses = [], replies = [];
  let conversation;
  conversation = new Conversation({ request, prepare: async () => {}, stop: () => conversation.cancel(),
    pose: async v => poses.push(v), play: async (v, signal, onStarted) => { played.push(v); await onStarted(); }, status: v => statuses.push(v), reply: (...v) => replies.push(v) });
  return { conversation, poses, played, statuses, replies };
}
test('chat uses speech separately, applies emotion and keeps character histories separate', async () => {
  const requests = [];
  const fixture = setup(async (route, value) => { requests.push({ route, value }); return route === '/api/chat' ? { reply: '中文', speech: '日本語', emotion: 'happy', intensity: .8 } : 'wav'; });
  await fixture.conversation.run('你好', 'plana', true);
  assert.equal(requests[1].value.text, '日本語'); assert.equal(fixture.poses[0].subtitle, '');
  assert.equal(fixture.poses.at(-1).subtitle, '中文');
  assert.equal(fixture.poses[0].emotion, 'happy'); assert.deepEqual(fixture.played, ['wav']);
  assert.equal(fixture.conversation.histories.plana.length, 2); assert.equal(fixture.conversation.histories.arona.length, 0);
});

test('nested controls go only to pose/action; chat, subtitle, voice and history contain only their text', async () => {
  const requests = [];
  const fixture = setup(async (route, value) => {
    requests.push({ route, value });
    return route === '/api/chat' ? { reply: '谢谢老师。', speech: 'ありがとうございます、先生。', control: { emotion: 'embarrassed', intensity: .4, blush: .3, headTilt: 2, actions: ['pat', 'blink'] } } : 'wav';
  });
  await fixture.conversation.run('摸摸头', 'plana', true);
  assert.deepEqual(fixture.replies, [['摸摸头', '谢谢老师。']]);
  assert.equal(fixture.poses[0].subtitle, '');
  assert.equal(fixture.poses.at(-1).subtitle, '谢谢老师。');
  assert.equal(fixture.poses[0].headTilt, 2); assert.equal(fixture.poses[0].blush, .3);
  assert.equal('actions' in fixture.poses[0], false); assert.equal('speech' in fixture.poses[0], false);
  assert.deepEqual(requests.slice(1), [
    { route: '/api/action', value: { action: 'pat' } },
    { route: '/api/action', value: { action: 'blink' } },
    { route: '/api/tts', value: { text: 'ありがとうございます、先生。' } }
  ]);
  assert.deepEqual(fixture.conversation.histories.plana, [{ role: 'user', content: '摸摸头' }, { role: 'assistant', content: '谢谢老师。' }]);
});
test('stop discards delayed chat response and never synthesizes or changes the pose', async () => {
  let resolve;
  const fixture = setup(() => new Promise(r => { resolve = r; }));
  const running = fixture.conversation.run('你好', 'plana', true, false);
  fixture.conversation.cancel(); resolve({ reply: 'late', speech: 'late' }); await running;
  assert.equal(fixture.poses.length, 0); assert.equal(fixture.played.length, 0); assert.equal(fixture.replies.length, 0);
});
test('stop discards delayed TTS; synthesis failure preserves chat reply', async () => {
  let resolve; const waiting = new Promise(r => { resolve = r; });
  const fixture = setup(async route => route === '/api/chat' ? { reply: '已回复', speech: '语音' } : waiting);
  const running = fixture.conversation.run('你好', 'plana', true);
  while (!fixture.statuses.includes('正在合成语音…')) await new Promise(r => setImmediate(r));
  fixture.conversation.cancel(); resolve('late-wav'); await running;
  assert.equal(fixture.played.length, 0); assert.equal(fixture.replies.length, 1);
  assert.ok(fixture.poses.every(p => !p.subtitle));
  const broken = setup(async route => { if (route === '/api/tts') throw new Error('离线'); return { reply: '已回复', speech: '语音' }; });
  await broken.conversation.run('你好', 'plana', true);
  assert.equal(broken.replies.length, 1); assert.match(broken.statuses.at(-1), /回复已保留/);
  assert.ok(broken.poses.every(p => !p.subtitle));
});

test('voice subtitle waits for playback, and a canceled playback cannot publish its text', async () => {
  const f = setup(async () => 'wav');
  let start;
  f.conversation.play = async (blob, signal, onStarted) => { start = onStarted; };
  await f.conversation.run('等待播放', 'plana');
  assert.ok(f.poses.every(p => !p.subtitle));
  f.conversation.cancel();
  await assert.rejects(start(), { name: 'AbortError' });
  const silent = setup(async () => { throw new Error('silent reply must not synthesize'); });
  await silent.conversation.run('无声字幕', 'plana', false, false);
  assert.equal(silent.poses[0].subtitle, '无声字幕');
});

test('buffering, autoplay rejection and cancellation never publish a premature subtitle', async () => {
  class Player extends EventTarget { play() { return Promise.resolve(); } pause() { this.paused = true; } }
  const player = new Player(), controller = new AbortController();
  let published = 0;
  const pending = startPlayback(player, controller.signal, () => { published++; });
  player.dispatchEvent(new Event('play'));
  await new Promise(r => setImmediate(r));
  assert.equal(published, 0);
  player.dispatchEvent(new Event('playing'));
  await pending; assert.equal(published, 1);
  player.dispatchEvent(new Event('playing')); assert.equal(published, 1);
  player.play = () => Promise.reject(new Error('autoplay blocked'));
  await assert.rejects(startPlayback(player, controller.signal, () => { published++; }), /autoplay blocked/);
  player.dispatchEvent(new Event('playing')); assert.equal(published, 1);
  player.play = () => Promise.resolve();
  const canceled = startPlayback(player, controller.signal, () => { published++; });
  controller.abort(); await assert.rejects(canceled, { name: 'AbortError' });
  player.dispatchEvent(new Event('playing')); assert.equal(published, 1); assert.equal(player.paused, true);
});

test('long speech starts the first short segment before later synthesis and never overlaps playback', async () => {
  const text = '先生、まずはここで少し休みましょう。'.repeat(7);
  const chunks = splitSpeech(text);
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every(part => Array.from(part).length <= 60));
  assert.equal(chunks.join(''), text);
  const f = setup(async (route, body) => { assert.equal(route, '/api/tts'); return body.text; });
  let firstStarted, finishFirst;
  const firstIsPlaying = new Promise(resolve => { firstStarted = resolve; });
  const firstFinished = new Promise(resolve => { finishFirst = resolve; });
  const requests = [];
  f.conversation.request = async (_route, body) => { requests.push(body.text); return body.text; };
  f.conversation.play = async (value, signal, onStarted, waitForEnd) => {
    f.played.push(value);
    if (f.played.length === 1) assert.equal(requests.length, 1);
    await onStarted();
    if (f.played.length === 1) { assert.equal(waitForEnd, true); firstStarted(); await firstFinished; }
  };
  const running = f.conversation.run(text, 'plana');
  await firstIsPlaying;
  assert.equal(requests.length, 2); // Next synthesis overlaps current audio, not another audio.
  assert.equal(f.played.length, 1);
  finishFirst(); await running;
  assert.deepEqual(f.played, chunks); assert.deepEqual(requests, chunks);
});

test('segment playback waits for ended and remains cancellable after playing starts', async () => {
  class Player extends EventTarget { play() { queueMicrotask(() => this.dispatchEvent(new Event('playing'))); return Promise.resolve(); } pause() { this.paused = true; } }
  const player = new Player(), controller = new AbortController();
  let completed = false, published = 0;
  const first = startPlayback(player, controller.signal, () => { published++; }, true).then(() => { completed = true; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(published, 1); assert.equal(completed, false);
  player.dispatchEvent(new Event('ended')); await first; assert.equal(completed, true);
  const second = startPlayback(player, controller.signal, () => { published++; }, true);
  await new Promise(resolve => setImmediate(resolve));
  controller.abort(); await assert.rejects(second, { name: 'AbortError' }); assert.equal(player.paused, true);
});

test('cancel during segmented playback discards prefetched audio and later subtitle updates', async () => {
  const f = setup(async () => 'first');
  let resolvePrefetch, started;
  const ready = new Promise(resolve => { started = resolve; });
  let calls = 0;
  f.conversation.request = async () => ++calls === 1 ? 'first' : new Promise(resolve => { resolvePrefetch = resolve; });
  f.conversation.play = async (value, signal, onStarted) => {
    f.played.push(value); await onStarted(); started();
    await new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('cancelled','AbortError')), { once: true }));
  };
  const running = f.conversation.run('先生、まずは少し休みましょう。'.repeat(7), 'plana');
  await ready; assert.equal(calls, 2);
  const before = f.poses.length; f.conversation.cancel(); resolvePrefetch('late'); await running;
  assert.deepEqual(f.played, ['first']); assert.equal(f.poses.length, before);
});
