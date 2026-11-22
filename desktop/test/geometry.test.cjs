const test = require('node:test');
const assert = require('node:assert/strict');
const { contains, quickBounds, validGeometry, statusBounds, bubbleBounds } = require('../geometry.cjs');
const { defaults } = require('../settings.cjs');
test('hover dialog follows the model and stays visible on negative-coordinate monitors', () => {
  const area = { x: -1280, y: 0, width: 1280, height: 1024 };
  const bounds = quickBounds({ x: -600, y: 50, height: 640 }, { x: 50, y: 40, width: 300, height: 450 }, defaults, area);
  assert.equal(bounds.y, 552);
  assert.equal(bounds.x, -550);
  const edge = quickBounds({ x: -200, y: 900, height: 640 }, { x: 0, y: 0, width: 300, height: 600 }, { ...defaults, dialogX: 1000, dialogY: 1000, dialogFontSize: 24 }, area);
  assert.ok(edge.x >= area.x && edge.x + edge.width <= 0);
  assert.ok(edge.y >= 0 && edge.y + edge.height <= 1024);
  assert.ok(contains({ x: 45, y: 40 }, { x: 50, y: 50, width: 10, height: 10 }, 12));
});
test('the borderless input scales with the rendered model', () => {
  const area = { x: 0, y: 0, width: 1920, height: 1080 }, window = { x: 100, y: 100, height: 640 };
  const small = quickBounds(window, { x: 0, y: 0, width: 200, height: 400 }, defaults, area);
  const large = quickBounds(window, { x: 0, y: 0, width: 400, height: 800 }, defaults, area);
  assert.equal(large.width, 2 * small.width); assert.ok(large.height > small.height);
});
test('invalid renderer geometry cannot reposition desktop windows', () => {
  for (const model of [{ x: 0, y: 0, width: -1, height: 1 }, { x: Infinity, y: 0, width: 1, height: 1 }]) assert.ok(!validGeometry({ model, head: model }));
});

test('compact status remains small and inside monitor edges', () => {
  const area = { x: -1280, y: -900, width: 1280, height: 900 };
  const pill = statusBounds({ x: -150, y: -100, width: 420, height: 640 }, { x: 0, y: 0, width: 300, height: 560 }, defaults, area, '正在思考…');
  assert.equal(pill.height, 24); assert.ok(pill.width <= 220);
  assert.ok(pill.x >= area.x && pill.x + pill.width <= 0);
  assert.ok(pill.y >= area.y && pill.y + pill.height <= 0);
});

test('speech bubble chooses the free side of the head and respects screen edges and offsets', () => {
  const area = { x: -1280, y: -900, width: 1280, height: 900 };
  const head = { x: 60, y: 70, width: 100, height: 120 };
  for (const x of [-1250, -220]) {
    const window = { x, y: -700, width: 420, height: 640 };
    const bubble = bubbleBounds(window, head, { width: 240, height: 150 }, area, defaults);
    assert.equal(bubble.side, x === -1250 ? 'right' : 'left');
    assert.ok(bubble.x >= area.x && bubble.x + bubble.width <= 0);
    assert.ok(bubble.y >= area.y && bubble.y + bubble.height <= 0);
    const shifted = bubbleBounds(window, head, { width: 240, height: 150 }, area, { ...defaults, subtitleY: -40 });
    assert.ok(shifted.y >= area.y && shifted.y < bubble.y);
  }
});
