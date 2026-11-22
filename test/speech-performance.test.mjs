import test from 'node:test';
import assert from 'node:assert/strict';
import { readModels, models } from '../model-data.mjs';
import { SpeechMouth, SpeechPerformance, speechFaces } from '../public/speech-performance.js';
const { data } = readModels(new URL('../public/', import.meta.url).pathname.replace(/^\/(?=[A-Z]:)/i, ''));
const base = { character: 'plana', emotion: 'affection', expression: '18', intensity: .45, headTilt: 3, bodyLean: 1, gazeY: 0, subtitle: '你好', mouthMode: 'auto', mouth: 0, closedMouth: 'Mouth_01', openMouth: 'Mouth_04' };

test('audio articulation selects distinct small, rounded, wide, dental and emotional closed attachments', () => {
  const mouth = new SpeechMouth();
  const shapes = [mouth.sample(base, .2, {}, 0), mouth.sample(base, .5, { roundness: .8 }, 120), mouth.sample(base, .5, {}, 240), mouth.sample(base, .5, { brightness: .8 }, 360)];
  assert.deepEqual(shapes.map(s => s.openMouth), ['Mouth_06', 'Mouth_04', 'Mouth_12', 'Mouth_07']);
  assert.equal(mouth.sample(base, 0, {}, 380).openMouth, 'Mouth_03');
  assert.equal(mouth.sample({ ...base, emotion: 'sad' }, 0, {}, 390).closedMouth, 'Mouth_09');
});
test('mouth changes have hysteresis but a real silent pause closes immediately', () => {
  const mouth = new SpeechMouth();
  assert.equal(mouth.sample(base, .5, {}, 0).openMouth, 'Mouth_12');
  assert.equal(mouth.sample(base, .5, { roundness: .9 }, 60).openMouth, 'Mouth_12');
  assert.equal(mouth.sample(base, 0, {}, 70).openMouth, 'Mouth_03');
  assert.equal(mouth.sample(base, .5, { roundness: .9 }, 80).openMouth, 'Mouth_04');
});
test('every selected expression and mouth is present in both actual rigs', () => {
  for (const [character, d] of Object.entries(data)) {
    const meta = models[character], index = d.slots.findIndex(slot => slot.name === meta.mouthSlot);
    for (const phase of Object.values(speechFaces[character])) for (const [emotion, expression] of Object.entries(phase)) {
      assert.ok(d.findAnimation(expression));
      const mouth = new SpeechMouth(), state = { ...base, character, emotion, intensity: .9 };
      for (const [n, [amount, features]] of [[0, {}], [.2, {}], [.6, {}], [.6, { roundness: .9 }], [.6, { brightness: .9 }], [.95, {}]].entries()) {
        const result = mouth.sample(state, amount, features, n * 120);
        assert.ok(d.defaultSkin.getAttachment(index, result.openMouth), `${character} ${result.openMouth}`);
        assert.ok(d.defaultSkin.getAttachment(index, result.closedMouth));
      }
    }
  }
});
test('preparing, speaking and settling have different faces and restore to neutral without modifying semantic state', () => {
  const performance = new SpeechPerformance();
  performance.prepare(); const before = performance.sample(base, 0);
  assert.equal(before.expression, '02'); assert.equal(before.mouth, 0);
  performance.start(); const during = performance.sample({ ...base, mouth: .5 }, 1000);
  assert.equal(during.expression, '18'); assert.equal(during.mouth, .5);
  // Replacing the subtitle with its translation cannot restart preparation mid-playback.
  assert.equal(performance.sample({ ...base, mouth: .4, subtitle: '翻译' }, 1100).speechPhase, 'speaking');
  performance.end(); const after = performance.sample(base, 2000);
  assert.equal(after.expression, '15'); assert.equal(after.mouth, 0); assert.ok(after.bodyLean < during.bodyLean);
  const rest = performance.sample({ ...base, emotion: 'neutral', expression: '00', subtitle: '' }, 15000);
  assert.equal(rest.speechPhase, 'idle'); assert.equal(rest.expression, '00'); assert.equal(base.expression, '18');
});
test('automatic views infer phases; manual controls and cancellation bypass performance', () => {
  const performance = new SpeechPerformance();
  assert.equal(performance.sample(base, 0).speechPhase, 'preparing');
  assert.equal(performance.sample({ ...base, mouth: .4 }, 500).speechPhase, 'speaking');
  assert.equal(performance.sample(base, 1200).speechPhase, 'settling');
  performance.reset(base); assert.equal(performance.sample(base, 1300).speechPhase, 'idle');
  const manual = performance.sample({ ...base, mouthMode: 'manual', mouth: 1 }, 1400);
  assert.equal(manual.mouth, 1); assert.equal(manual.expression, '18'); assert.equal(manual.speechPhase, 'idle');
});
