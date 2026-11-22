const test = require('node:test');
const assert = require('node:assert/strict');
const { defaults, validateSettings, visibleBounds } = require('../settings.cjs');
test('window and character controls reject invalid settings and preserve partial changes', () => {
  assert.equal(validateSettings({ alwaysOnTop: false }).clickThrough, false);
  assert.equal(validateSettings({ zoom: 1.5 }, { ...defaults, x: .4 }).x, .4);
  for (const value of [{ width: -1 }, { zoom: NaN }, { clickThrough: 'true' }, { width: 420.5 }, { x: 2 }, { url: 'file:///secret' }]) assert.throws(() => validateSettings(value));
});
test('disconnected monitors restore the character to a visible desktop without losing valid negative coordinates', () => {
  const displays = [{ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }, { workArea: { x: -1280, y: 0, width: 1280, height: 1024 } }];
  const recovered = visibleBounds({ ...defaults, windowX: 9000, windowY: 9000 }, displays);
  assert.ok(recovered.x + recovered.width <= 1920); assert.ok(recovered.y + recovered.height <= 1080);
  assert.equal(visibleBounds({ ...defaults, windowX: -800, windowY: 50 }, displays).x, -800);
});
