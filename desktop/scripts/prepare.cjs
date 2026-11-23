const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
fs.mkdirSync(path.join(root, 'ui/shared'), { recursive: true });
for (const file of ['conversation.js', 'speech-segments.js', 'chat-protocol.js', 'emotions.js', 'audio.js', 'reply-lifetime.js', 'speech-performance.js']) {
  fs.copyFileSync(path.join(root, '../public', file), path.join(root, 'ui/shared', file));
}
// Model/runtime files are supplied locally and are not published in this repository.
const wallpaper = process.env.PLANA_WALLPAPER_DIR;
const resources = [['lib/spine-webgl.js', 'vendor/spine-webgl.js']];
for (const model of ['NP0035_spr', 'arona_spr']) for (const ext of ['skel', 'atlas', 'png']) resources.push([`assets/${model}.${ext}`, `assets/${model}.${ext}`]);
for (const [sourceName, targetName] of resources) {
  const target = path.join(root, '../public', targetName);
  if (fs.existsSync(target)) continue;
  if (!wallpaper || !fs.existsSync(path.join(wallpaper, sourceName))) throw new Error(`Missing resource: ${targetName}. Set PLANA_WALLPAPER_DIR to your local wallpaper directory.`);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(path.join(wallpaper, sourceName), target);
}
const webRoot = path.join(root, 'display');
fs.mkdirSync(webRoot, { recursive: true });
for (const item of fs.readdirSync(path.join(root, '../public'), { withFileTypes: true })) {
  if (item.isFile() || ['assets', 'vendor'].includes(item.name)) fs.cpSync(path.join(root, '../public', item.name), path.join(webRoot, item.name), { recursive: true });
}
const voiceDir = path.join(root, 'ui/voices'); fs.mkdirSync(voiceDir, { recursive: true });
for (let i = 1; i <= 5; i++) {
  const name = `np0035_work_talk_${i}.ogg`;
  const source = wallpaper ? path.join(wallpaper, 'assets/audio/NP0035', name) : '';
  if (fs.existsSync(source)) fs.copyFileSync(source, path.join(voiceDir, name));
  else if (!fs.existsSync(path.join(voiceDir, name))) throw new Error(`缺少互动语音：${source}`);
}
