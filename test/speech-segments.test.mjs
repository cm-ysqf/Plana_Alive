import test from 'node:test';
import assert from 'node:assert/strict';
import { splitSpeech, speechSegments, speechPause, waitForSpeech } from '../public/speech-segments.js';
import { decodeChatResponse } from '../public/chat-protocol.js';
import { Conversation } from '../public/conversation.js';

const segments = [
  { reply: '我知道了，老师。', speech: 'わかりました、先生。' },
  { reply: '接下来需要我做什么呢？', speech: '次は何をすればよいでしょうか？' }
];
const answer = { reply: segments.map(s => s.reply).join(''), speech: segments.map(s => s.speech).join(''), segments, control: { emotion: 'neutral' } };

test('sentence boundaries preserve commas, decimals, closing quotes and final fragments', () => {
  assert.deepEqual(splitSpeech('我知道了，老师。所以您需要我接下来做什么呢？'), ['我知道了，老师。', '所以您需要我接下来做什么呢？']);
  assert.deepEqual(splitSpeech('值为3.14。老师说：“好了！” Next. 最后'), ['值为3.14。', '老师说：“好了！”', 'Next.', '最后']);
  assert.deepEqual(splitSpeech('先生、わかりました。次はどうしますか？'), ['先生、わかりました。', '次はどうしますか？']);
  assert.deepEqual(splitSpeech('你好！！再见。'), ['你好！！', '再见。']);
  const long = '很长的内容'.repeat(30);
  assert.equal(splitSpeech(long).join(''), long);
  assert.ok(splitSpeech(long).every(s => Array.from(s).length <= 60));
});

test('paired translations are validated; legacy unequal sentences stay together', () => {
  assert.deepEqual(decodeChatResponse(JSON.stringify(answer), 'plana').segments, segments);
  assert.throws(() => decodeChatResponse(JSON.stringify({ ...answer, reply: '被替换' }), 'plana'), /一致/);
  assert.throws(() => decodeChatResponse(JSON.stringify({ ...answer, segments: [segments[0]] }), 'plana'), /2–4/);
  assert.throws(() => decodeChatResponse(JSON.stringify({ ...answer, segments: [{ ...segments[0], control: {} }, segments[1]] }), 'plana'), /仅允许/);
  assert.deepEqual(speechSegments({ reply: '一句。', speech: '二つ。文です。' }), [{ reply: '一句。', speech: '二つ。文です。' }]);
});

test('one chat generation uses paired subtitles, prefetch and an interruptible breath between audio', async () => {
  const events = [];
  const conversation = new Conversation({
    request: async (route, body) => { events.push([route, body.text]); return route === '/api/chat' ? answer : body.text; },
    prepare: async () => {}, stop: () => {}, begin: () => {}, status: () => {}, reply: () => {},
    pose: async value => { if (value.subtitle) events.push(['subtitle', value.subtitle]); },
    play: async (value, signal, onStarted, wait) => { assert.equal(wait, true); events.push(['play', value]); await onStarted(); events.push(['end', value]); },
    pause: async (ms, signal) => { signal.throwIfAborted(); assert.ok(ms > 250 && ms <= 320); events.push(['breath']); }
  });
  await conversation.run('接下来呢？', 'plana', true);
  assert.equal(events.filter(e => e[0] === '/api/chat').length, 1);
  assert.deepEqual(events.filter(e => e[0] === 'subtitle').map(e => e[1]), segments.map(s => s.reply));
  assert.ok(events.findIndex(e => e[0] === '/api/tts' && e[1] === segments[1].speech) < events.findIndex(e => e[0] === 'end'));
  const gap = events.findIndex(e => e[0] === 'breath');
  assert.ok(gap > events.findIndex(e => e[0] === 'end'));
  assert.ok(gap < events.findLastIndex(e => e[0] === 'play'));
  conversation.pause = async () => { conversation.cancel(); };
  events.length = 0;
  await conversation.run('接下来呢？', 'plana', true);
  assert.equal(events.filter(e => e[0] === 'play').length, 1);
});

test('breathing timeout aborts immediately and punctuation selects bounded pauses', async () => {
  assert.equal(speechPause('好了。'), 320); assert.equal(speechPause('是吗？'), 480); assert.equal(speechPause('我……'), 600);
  const controller = new AbortController();
  const pending = waitForSpeech(10000, controller.signal); controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
});
