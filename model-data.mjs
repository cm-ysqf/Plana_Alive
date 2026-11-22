import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { expressionLabels, emotionProfiles, haloLabels } from './public/emotions.js';

export const models = {
  plana: { name: '普拉娜', file: 'NP0035_spr', mouthSlot: 'Mouth_01', closed: 'Mouth_01', open: 'Mouth_04' },
  arona: { name: '阿罗娜', file: 'arona_spr', mouthSlot: 'Mouse_01', closed: 'Mouse_01', open: 'Mouse_04' },
};

export function readModels(publicRoot) {
  const context = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(publicRoot, 'vendor/spine-webgl.js'), 'utf8'), context);
  const spine = context.spine;
  const data = {};
  for (const [key, model] of Object.entries(models)) {
    const atlas = new spine.TextureAtlas(fs.readFileSync(path.join(publicRoot, 'assets', model.file + '.atlas'), 'utf8'), file => {
      const png = fs.readFileSync(path.join(publicRoot, 'assets', file));
      return { getImage: () => ({ width: png.readUInt32BE(16), height: png.readUInt32BE(20) }), setFilters() {}, setWraps() {} };
    });
    data[key] = new spine.SkeletonBinary(new spine.AtlasAttachmentLoader(atlas)).readSkeletonData(
      new Uint8Array(fs.readFileSync(path.join(publicRoot, 'assets', model.file + '.skel'))));
  }
  return { spine, data };
}

export function catalogFor(publicRoot) {
  const { spine, data } = readModels(publicRoot);
  return Object.fromEntries(Object.entries(models).map(([key, model]) => {
    const d = data[key];
    const slotIndex = d.slots.findIndex(x => x.name === model.mouthSlot);
    const skeleton = new spine.Skeleton(d);
    new spine.AnimationState(new spine.AnimationStateData(d)).apply(skeleton);
    const attachments = Object.keys(d.defaultSkin.attachments[slotIndex]);
    return [key, { ...model, version: d.version, bones: d.bones.length,
      expressionLabels: Object.fromEntries(d.animations.filter(a=>/^\d+$/.test(a.name)).map(a=>[a.name,a.name==='99'?'闭眼待机':expressionLabels[key][Number(a.name)]])),
      emotions: emotionProfiles, halos: haloLabels,
      effects: { blush:d.slots.some(s=>/flush/i.test(s.name)), sweat:d.slots.some(s=>/sweat/i.test(s.name)), tears:d.slots.some(s=>/tears/i.test(s.name)) },
      expressions: d.animations.filter(a => /^\d+$/.test(a.name)).map(a => a.name),
      animations: d.animations.map(a => a.name), mouths: attachments,
      mouthRegions: Object.fromEntries(attachments.map(name => {
        const a = d.defaultSkin.getAttachment(slotIndex, name);
        const r = a.region;
        return [name, { x: r.x, y: r.y, width: r.width, height: r.height, rotate: r.rotate }];
      })) }];
  }));
}
