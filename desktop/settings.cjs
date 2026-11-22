const defaults = { width: 420, height: 640, alwaysOnTop: true, clickThrough: false, windowLocked: false,
  mouseTracking: true, headpat: true, touchVoice: true, hoverDialog: true,
  dialogWidth: 340, dialogFontSize: 13, dialogX: 0, dialogY: 12,
  subtitleFontSize: 16, subtitleX: 0, subtitleY: 0, subtitleWidth: 55,
  zoom: 1, x: 0, y: 0, windowX: null, windowY: null };
function validateSettings(value, previous = defaults) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('设置格式错误');
  const result = { ...previous };
  for (const [key, entry] of Object.entries(value)) {
    if (!Object.hasOwn(defaults, key)) throw new Error('未知设置');
    if (['alwaysOnTop', 'clickThrough', 'windowLocked', 'mouseTracking', 'headpat', 'touchVoice', 'hoverDialog'].includes(key)) {
      if (typeof entry !== 'boolean') throw new Error('开关设置错误');
    } else if (['windowX', 'windowY'].includes(key)) {
      if (entry !== null && (!Number.isInteger(entry) || Math.abs(entry) > 100000)) throw new Error('窗口位置错误');
    } else {
      const [min, max] = ({ width: [240, 1800], height: [320, 2000], zoom: [.5, 2.5], x: [-1, 1], y: [-1, 1],
        dialogWidth: [240, 650], dialogFontSize: [11, 24], dialogX: [-1000, 1000], dialogY: [-1000, 1000],
        subtitleFontSize: [12, 64], subtitleX: [-40, 40], subtitleY: [-40, 90], subtitleWidth: [30, 95] })[key];
      if (typeof entry !== 'number' || !Number.isFinite(entry) || entry < min || entry > max || (['width', 'height'].includes(key) && !Number.isInteger(entry))) throw new Error('设置超出范围');
    }
    result[key] = entry;
  }
  return result;
}
function visibleBounds(settings, displays) {
  const primary = displays[0].workArea;
  const width = Math.min(settings.width, primary.width), height = Math.min(settings.height, primary.height);
  let x = settings.windowX ?? primary.x + primary.width - width - 32;
  let y = settings.windowY ?? primary.y + primary.height - height - 24;
  if (!displays.some(({ workArea: a }) => x + width > a.x + 48 && x < a.x + a.width - 48 && y + height > a.y + 48 && y < a.y + a.height - 48)) {
    x = primary.x + primary.width - width; y = primary.y + primary.height - height;
  }
  return { x, y, width, height };
}
module.exports = { defaults, validateSettings, visibleBounds };
