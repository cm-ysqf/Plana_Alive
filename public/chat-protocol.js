import { emotionProfiles, haloLabels } from './emotions.js';

export function normalizeControl(value = {}, character = 'plana') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('control 必须为对象');
  const control = { emotion: 'neutral', intensity: 0.5, gazeX: 0, gazeY: 0, actions: [] };
  const ranges = { intensity: [0, 1], headTilt: [-15, 15], bodyLean: [-8, 8], gazeX: [-1, 1], gazeY: [-1, 1], haloLift: [-60, 60], haloRotation: [-30, 30], blush: [-1, 1], sweat: [-1, 1], tears: [-1, 1] };
  for (const [key, entry] of Object.entries(value)) {
    if (key === 'emotion') {
      if (typeof entry !== 'string' || !Object.hasOwn(emotionProfiles, entry)) throw new Error('control.emotion 无效');
    } else if (key === 'halo') {
      if (typeof entry !== 'string' || !Object.hasOwn(haloLabels, entry)) throw new Error('control.halo 无效');
    } else if (key === 'actions') {
      if (!Array.isArray(entry) || entry.length > 2 || new Set(entry).size !== entry.length || entry.some(a => !['blink', 'pat'].includes(a))) throw new Error('control.actions 仅允许不重复的 blink / pat');
    } else if (Object.hasOwn(ranges, key)) {
      const [min, max] = ranges[key];
      if (typeof entry !== 'number' || !Number.isFinite(entry) || entry < min || entry > max) throw new Error(`control.${key} 超出范围`);
      if (['blush', 'sweat', 'tears'].includes(key) && entry < 0 && entry !== -1) throw new Error(`control.${key} 负数仅允许 -1`);
      if (key === 'tears' && character === 'plana' && entry > 0) throw new Error('普拉娜没有独立眼泪素材');
    } else throw new Error(`不允许的角色控制字段：${key}`);
    control[key] = entry;
  }
  return control;
}

export function decodeChatResponse(content, character) {
  let data;
  try { data = JSON.parse(content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')); }
  catch { throw new Error('聊天模型未返回有效协议 JSON，请检查系统提示词'); }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('聊天回复必须为 JSON 对象');
  const allowed = ['reply', 'speech', 'control', 'emotion', 'intensity', 'segments'];
  if (Object.keys(data).some(key => !allowed.includes(key))) throw new Error('聊天回复包含未知顶层字段');
  for (const key of ['reply', 'speech']) if (typeof data[key] !== 'string' || !data[key].trim() || data[key].length > 2000) throw new Error(`${key} 须为 1–2000 字的纯文本`);
  // Accept the previous two-field control format while always returning the new envelope.
  if (Object.hasOwn(data, 'control') && (Object.hasOwn(data, 'emotion') || Object.hasOwn(data, 'intensity'))) throw new Error('控制字段不能同时位于顶层和 control 内');
  const legacy = {};
  if (Object.hasOwn(data, 'emotion')) legacy.emotion = data.emotion;
  if (Object.hasOwn(data, 'intensity')) legacy.intensity = data.intensity;
  const answer = { reply: data.reply.trim(), speech: data.speech.trim(), control: normalizeControl(Object.hasOwn(data, 'control') ? data.control : legacy, character) };
  if (Object.hasOwn(data, 'segments')) {
    if (!Array.isArray(data.segments) || data.segments.length < 2 || data.segments.length > 4) throw new Error('segments 须含 2–4 组对应短句');
    answer.segments = data.segments.map(part => {
      if (!part || typeof part !== 'object' || Array.isArray(part) || Object.keys(part).some(key => !['reply', 'speech'].includes(key))) throw new Error('语句分段仅允许 reply 和 speech');
      for (const key of ['reply', 'speech']) if (typeof part[key] !== 'string' || !part[key].trim() || part[key].length > 240) throw new Error('每段文本须为 1–240 字');
      return { reply: part.reply.trim(), speech: part.speech.trim() };
    });
    const compact = text => text.replace(/\s+/gu, '');
    for (const key of ['reply', 'speech']) if (compact(answer.segments.map(part => part[key]).join('')) !== compact(answer[key])) throw new Error('分段内容须与完整回复一致');
  }
  return answer;
}
