import test from 'node:test';
import assert from 'node:assert/strict';
import { loadDisplaySession, validateDisplayState } from '../public/display-session.js';

test('startup rejects gateway failures before applying character data and can retry', async t => {
  const catalog = { plana: { name: '普拉娜' } };
  const state = { character: 'plana', revision: 0 };
  let failure, failedRoute;
  t.mock.method(globalThis, 'fetch', async route => route === failedRoute
    ? Response.json({ error: failure.message }, { status: failure.status })
    : Response.json(route === '/api/catalog' ? catalog : state));
  for (const route of ['/api/catalog', '/api/state']) {
    failedRoute = route;
    for (failure of [
      { status: 429, message: '请求达到今日限额，请稍后重试' },
      { status: 403, message: '当前地区暂不提供服务' },
      { status: 502, message: '后台服务暂不可用' }
    ]) await assert.rejects(loadDisplaySession(), { message: failure.message });
  }
  failedRoute = null;
  assert.deepEqual(await loadDisplaySession(), { catalog, state });
});

test('malformed successful responses cannot reach the model renderer', async t => {
  for (const state of [null, {}, { error: 'bad' }, { character: 'missing', revision: 0 }, { character: 'toString', revision: 0 }]) {
    assert.throws(() => validateDisplayState(state, { plana: { name: '普拉娜' } }), /角色数据不完整/);
  }
  t.mock.method(globalThis, 'fetch', async () => new Response('<html>gateway unavailable</html>', { status: 502 }));
  await assert.rejects(loadDisplaySession(), /HTTP 502/);
});
