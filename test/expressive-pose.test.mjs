import test from 'node:test';
import assert from 'node:assert/strict';
import { ExpressivePose } from '../public/expressive-pose.js';

const base = { character: 'plana', emotion: 'happy', intensity: .5, headTilt: 0, bodyLean: 0, gazeX: 0, gazeY: 0, mouthMode: 'auto', mouth: 0 };
test('speech accents follow actual mouth energy and settle in silence without mutating source state', () => {
  const motion = new ExpressivePose();
  assert.equal(motion.sample(base, .016).headTilt, 0);
  const speech = { ...base, mouth: .65 }, output = motion.sample(speech, .033);
  assert.ok(output.headTilt > .1 && output.headTilt < 1);
  assert.equal(speech.headTilt, 0);
  let rest; for (let n = 0; n < 100; n++) rest = motion.sample(base, .033);
  assert.ok(Math.abs(rest.headTilt) < .001); assert.ok(Math.abs(rest.bodyLean) < .001);
});
test('pose recovery is gradual, character changes reset it, and manual mouth does not generate speech motion', () => {
  const motion = new ExpressivePose(); motion.sample({ ...base, headTilt: 5, gazeX: .3 }, .033);
  const first = motion.sample(base, .033);
  assert.ok(first.headTilt > 0 && first.headTilt < 5); assert.ok(first.gazeX > 0 && first.gazeX < .3);
  const other = motion.sample({ ...base, character: 'arona', mouthMode: 'manual', mouth: 1 }, .033);
  assert.equal(other.headTilt, 0); assert.equal(other.bodyLean, 0);
});
