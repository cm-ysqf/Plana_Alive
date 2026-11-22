import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeChatResponse, normalizeControl } from '../public/chat-protocol.js';

const envelope = control => JSON.stringify({ reply: '老师，我在。', speech: '先生、ここにいます。', control });
test('protocol accepts a structured answer and supported legacy answers without mixing channels', () => {
  const answer = decodeChatResponse('```json\n' + envelope({ emotion: 'happy', intensity: .4, halo: 'love', actions: ['blink'] }) + '\n```', 'plana');
  assert.equal(answer.reply, '老师，我在。'); assert.equal(answer.speech, '先生、ここにいます。');
  assert.deepEqual(answer.control, { emotion: 'happy', intensity: .4, halo: 'love', gazeX: 0, gazeY: 0, actions: ['blink'] });
  assert.equal(decodeChatResponse(JSON.stringify({ reply: '中文', speech: '日本語', emotion: 'neutral', intensity: .3 }), 'plana').control.intensity, .3);
});
test('malformed or incomplete replies never fall back to reading raw JSON or control instructions', () => {
  for (const content of ['普通文本', '{"reply":"不完整"', 'null', '[]', '{"speech":"先生"}', '{"reply":"老师","speech":""}', envelope({}) + '\n解释', JSON.stringify({ reply: '老师', speech: '先生', execute: 'bad' })]) {
    assert.throws(() => decodeChatResponse(content, 'plana'), Error, content);
  }
});
test('remote controls cannot switch characters, control mouths, change scene, reset or run arbitrary actions', () => {
  for (const control of [null, [], { character: 'arona' }, { mouth: 1 }, { zoom: 2 }, { subtitle: 'override' }, { actions: ['stop'] }, { actions: ['reset'] }, { actions: ['blink', 'blink'] }, { actions: ['wave'] }, { emotion: '__proto__' }, { headTilt: 16 }, { intensity: '0.5' }, { gazeY: Infinity }, { blush: -.5 }, { tears: .2 }]) {
    assert.throws(() => normalizeControl(control, 'plana'), Error, JSON.stringify(control));
  }
  assert.equal(normalizeControl({ tears: .4 }, 'arona').tears, .4);
  assert.throws(() => decodeChatResponse(JSON.stringify({ reply: '老师', speech: '先生', control: {}, emotion: 'happy' }), 'plana'), /同时/);
});
