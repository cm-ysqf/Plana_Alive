const contains = (point, rect, gap = 0) => point.x >= rect.x - gap && point.x <= rect.x + rect.width + gap && point.y >= rect.y - gap && point.y <= rect.y + rect.height + gap;
function quickBounds(window, model, settings, workArea) {
  const fontSize = Math.max(11, Math.min(24, settings.dialogFontSize * model.height / 560));
  const width = Math.min(workArea.width, Math.max(160, Math.round(model.width * settings.dialogWidth / 340)));
  const height = Math.min(workArea.height, Math.ceil(fontSize * 1.5 + 20));
  const center = window.x + model.x + model.width / 2;
  const bottom = window.y + Math.min(window.height, model.y + model.height);
  const clamp = (n, min, max) => Math.max(min, Math.min(n, max));
  return { x: Math.round(clamp(center - width / 2 + settings.dialogX, workArea.x, workArea.x + workArea.width - width)),
    y: Math.round(clamp(bottom + settings.dialogY, workArea.y, workArea.y + workArea.height - height)), width, height };
}
function validGeometry(value) {
  return value && ['model', 'head'].every(key => value[key] && ['x', 'y', 'width', 'height'].every(axis => typeof value[key][axis] === 'number' && Number.isFinite(value[key][axis]) && Math.abs(value[key][axis]) < 30000) && value[key].width > 0 && value[key].height > 0);
}
function statusBounds(window, model, settings, workArea, text) {
  const input = quickBounds(window, model, settings, workArea);
  const width = Math.min(workArea.width, Math.max(88, Math.min(220, text.length * 10 + 26)));
  return { x: Math.round(Math.max(workArea.x, Math.min(input.x + (input.width - width) / 2, workArea.x + workArea.width - width))),
    y: input.y, width, height: 24 };
}
function bubbleBounds(window, head, size, workArea, settings) {
  const clamp = (n, min, max) => Math.max(min, Math.min(n, max));
  const width = Math.min(size.width, workArea.width - 16), height = Math.min(size.height, workArea.height - 16);
  const headLeft = window.x + head.x, headRight = headLeft + head.width;
  const side = headLeft - workArea.x >= workArea.x + workArea.width - headRight ? 'left' : 'right';
  const x = (side === 'left' ? headLeft - width - 12 : headRight + 12) + settings.subtitleX / 100 * window.width;
  const y = window.y + head.y + head.height / 2 - height / 2 + settings.subtitleY / 100 * window.height;
  return { x: Math.round(clamp(x, workArea.x + 8, workArea.x + workArea.width - width - 8)),
    y: Math.round(clamp(y, workArea.y + 8, workArea.y + workArea.height - height - 8)), width, height, side };
}
module.exports = { contains, quickBounds, validGeometry, statusBounds, bubbleBounds };
