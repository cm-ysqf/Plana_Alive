import test from 'node:test';
import assert from 'node:assert/strict';
import { ReplyLifetime } from '../public/reply-lifetime.js';

function fixture() {
  let now = 0, id = 0, state = { character: 'plana', emotion: 'neutral', intensity: .3, subtitle: '' };
  const timers = new Map(), patches = [];
  const update = value => { const next = { ...state, ...value }; lifetime.observe(state, next); state = next; };
  const lifetime = new ReplyLifetime({ readState: () => state, pose: value => { patches.push(value); update(value); },
    schedule: (fn, delay) => { timers.set(++id, { at: now + delay, fn }); return id; }, unschedule: id => timers.delete(id) });
  const tick = ms => {
    const end = now + ms;
    for (;;) {
      const due = [...timers].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      now = due[1].at; timers.delete(due[0]); due[1].fn();
    }
    now = end;
  };
  return { lifetime, update, tick, patches, state: () => state };
}

test('subtitle clears three seconds after audio ends; expression independently recovers at 15 seconds', () => {
  const f = fixture();
  f.lifetime.expectAudio(); f.update({ emotion: 'happy', subtitle: '你好' });
  f.tick(1000); f.lifetime.audioStarted(); f.tick(4000); f.lifetime.audioEnded();
  f.tick(2999); assert.equal(f.state().subtitle, '你好');
  f.tick(1); assert.equal(f.state().subtitle, ''); assert.equal(f.state().emotion, 'happy');
  f.tick(7000); assert.equal(f.state().emotion, 'neutral');
});

test('long audio keeps its subtitle while expression returns; silent replies have a finite lifetime', () => {
  const f = fixture();
  f.lifetime.expectAudio(); f.update({ emotion: 'happy', subtitle: '长语音' }); f.lifetime.audioStarted();
  f.tick(20000); assert.equal(f.state().emotion, 'neutral'); assert.equal(f.state().subtitle, '长语音');
  f.lifetime.audioEnded(); f.tick(3000); assert.equal(f.state().subtitle, '');
  f.update({ emotion: 'happy', subtitle: '无语音' }); f.tick(15000);
  assert.equal(f.state().emotion, 'neutral'); assert.equal(f.state().subtitle, '');
});

test('new replies, manual poses, and cancellation prevent stale timers overwriting current state', () => {
  const f = fixture();
  f.update({ emotion: 'happy', subtitle: '旧回复' }); f.tick(10000);
  f.lifetime.cancel(); f.lifetime.expectAudio(); f.update({ emotion: 'sad', subtitle: '新回复' });
  f.tick(5000); assert.equal(f.state().subtitle, '新回复'); assert.equal(f.state().emotion, 'sad');
  f.update({ emotion: 'surprised' }); f.tick(10000); assert.equal(f.state().emotion, 'surprised');
  f.lifetime.audioEnded(); f.tick(1000); f.lifetime.cancel();
  f.tick(20000); assert.equal(f.state().subtitle, '新回复');
});

test('audio failure clears pending subtitles and a character switch cancels recovery', () => {
  const f = fixture();
  f.lifetime.expectAudio(); f.update({ emotion: 'happy', subtitle: '语音失败' });
  f.lifetime.audioEnded(); f.tick(3000); assert.equal(f.state().subtitle, '');
  f.update({ character: 'arona', emotion: 'sad', subtitle: '' });
  f.tick(20000); assert.equal(f.state().emotion, 'sad');
});
