import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { AudioDriver } from '../public/audio.js';
globalThis.window = { speechSynthesis: { cancel() {}, getVoices() { return []; }, speak() {} } };
globalThis.speechSynthesis = window.speechSynthesis;
globalThis.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
let signal = .08;
class Source {
  connections = new Set();
  connect(target) { this.connections.add(target); }
  disconnect() { this.connections.clear(); }
}
globalThis.AudioContext = class {
  destination = {};
  async resume() {}
  createAnalyser() { return { getFloatTimeDomainData(samples) { samples.fill(signal); } }; }
  createMediaElementSource() { return new Source(); }
};
const drivers = [];
function driver() {
  const amounts = [];
  const audio = new AudioDriver({ mouth: n => amounts.push(n), status() {}, meter() {} });
  drivers.push(audio); clearInterval(audio.timer); return { audio, amounts };
}
after(() => drivers.forEach(d => d.dispose()));

test('audio file pause/resume reconnects both analyser and speakers', async () => {
  const { audio } = driver(), element = {};
  await audio.file(element);
  assert.ok(audio.source.connections.has(audio.context.destination));
  assert.ok(audio.source.connections.has(audio.analyser));
  const original = audio.source; audio.stop(); assert.equal(original.connections.size, 0);
  await audio.file(element); assert.equal(audio.source, original);
  assert.ok(audio.source.connections.has(audio.context.destination));
  assert.ok(audio.source.connections.has(audio.analyser));
});

test('audio amplitude opens the mouth, silence releases it, stop closes immediately', async () => {
  const { audio, amounts } = driver(); await audio.file({});
  signal = .08; audio.tick(100); assert.ok(amounts.at(-1) > .12);
  signal = 0; for (let n = 200; n <= 3000; n += 100) audio.tick(n);
  assert.equal(amounts.at(-1), 0);
  signal = .2; audio.tick(4000); assert.ok(amounts.at(-1) > .12);
  audio.stop(); assert.equal(amounts.at(-1), 0); assert.equal(audio.active, false);
});

test('old canceled speech callbacks cannot stop a replacement utterance', () => {
  const { audio } = driver(); audio.speak('第一句'); const first = audio.utterance;
  audio.speak('第二句'); const second = audio.utterance; second.onstart();
  first.onend(); first.onerror({ error: 'interrupted' });
  assert.equal(audio.utterance, second); assert.ok(audio.simulation);
  second.onend(); assert.equal(audio.utterance, null); assert.equal(audio.simulation, null);
});

test('system speech announces playback only after start and ignores callbacks from replaced speech', () => {
  const { audio } = driver(); const events = [];
  audio.speak('旧句', { start: () => events.push('old start'), end: () => events.push('old end') });
  const first = audio.utterance;
  audio.speak('新句', { start: () => events.push('start'), end: () => events.push('end') });
  assert.deepEqual(events, []);
  first.onstart(); first.onend(); assert.deepEqual(events, []);
  audio.utterance.onstart(); assert.deepEqual(events, ['start']);
  audio.utterance.onend(); assert.deepEqual(events, ['start', 'end']);
});

test('ordinary and loud speech retain different mouth openings instead of both clipping fully open', async () => {
  const { audio, amounts } = driver(); await audio.file({});
  signal = .08; for (let now = 100; now <= 1000; now += 100) audio.tick(now);
  const ordinary = amounts.at(-1);
  signal = .2; for (let now = 1100; now <= 2000; now += 100) audio.tick(now);
  const loud = amounts.at(-1);
  assert.ok(ordinary > .3 && ordinary < .75);
  assert.ok(loud > ordinary + .2 && loud < .97);
  signal = .02; for (let now = 2100; now <= 4000; now += 100) audio.tick(now);
  assert.ok(amounts.at(-1) < .15);
});
