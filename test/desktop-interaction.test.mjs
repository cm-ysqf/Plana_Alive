import test from 'node:test';
import assert from 'node:assert/strict';
import { DesktopInteraction } from '../public/desktop-interaction.js';
const state = { gazeX: 0, gazeY: 0, headTilt: 0, bodyLean: 0 };
const regions = { model: { x: 0, y: 0, width: 300, height: 600 }, head: { x: 100, y: 100, width: 100, height: 100 } };
test('desktop gaze mirrors, returns to center outside the model and preserves explicit gaze when disabled', () => {
  const rig = new DesktopInteraction(); rig.configure({ mouseTracking: true, headpat: true }); rig.pointer = { x: 280, y: 150 };
  const normal = rig.sample(state, regions, .1); assert.ok(normal.gazeX > 0);
  assert.equal(rig.sample({ ...state, flip: true }, regions, .1).gazeX, -normal.gazeX);
  rig.pointer = { x: 5000, y: 5000 }; assert.equal(rig.sample(state, regions, .1).gazeX, 0);
  rig.configure({ mouseTracking: false }); assert.equal(rig.sample({ ...state, gazeX: .8 }, regions, .1).gazeX, .8);
});
test('headpat is bounded, releases smoothly and is canceled by click-through', () => {
  const rig = new DesktopInteraction(); rig.configure({ headpat: true });
  rig.pet('start', 150, regions.head); rig.pet('move', 10000, regions.head);
  const held = rig.sample(state, regions, .1); assert.ok(held.desktopPetHeld && held.desktopPetOffset > 0 && held.desktopPetOffset <= 30);
  rig.configure({ headpat: true, clickThrough: true });
  const released = rig.sample(state, regions, .1); assert.equal(released.desktopPetHeld, false); assert.ok(released.desktopPetOffset < held.desktopPetOffset);
  for (let i = 0; i < 100; i++) rig.sample(state, regions, .1);
  assert.ok(rig.petValue < .001);
});
