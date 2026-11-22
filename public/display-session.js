// Reject gateway errors before they can be mistaken for model/state data.
export async function fetchJSON(route, options) {
  const response = await fetch(route, options);
  let value;
  try { value = await response.json(); }
  catch { throw new Error(`服务返回了无效数据（HTTP ${response.status}）`); }
  if (!response.ok) throw new Error(typeof value?.error === 'string' ? value.error : `服务请求失败（HTTP ${response.status}）`);
  return value;
}

export function validateDisplayState(state, catalog) {
  if (!state || typeof state !== 'object' || !Number.isFinite(state.revision) ||
      typeof state.character !== 'string' || !catalog ||
      !Object.hasOwn(catalog, state.character) || typeof catalog[state.character]?.name !== 'string') {
    throw new Error('角色数据不完整，请重新连接云端');
  }
  return state;
}

export async function loadDisplaySession() {
  const catalog = await fetchJSON('/api/catalog');
  const state = validateDisplayState(await fetchJSON('/api/state'), catalog);
  return { catalog, state };
}
