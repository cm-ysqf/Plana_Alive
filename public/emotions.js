// Labels are visual interpretations of this asset set, editable independently of the rig.
export const expressionLabels = {
  plana: ['平静','平静·半睁眼','轻声回应','认真','为难·汗滴','不满','低落','惊讶','注意到','兴奋·星星眼','生气喊话','冷淡不满','尴尬','眩晕·螺旋眼','害羞惊呼','微笑','闭眼笑','喜爱·爱心','脸红微笑','阴沉不满','苦笑'],
  arona: ['平静','平静','回应','闭眼微笑','惊讶','不满','委屈含泪','消沉','紧张','苦恼','叹气','喜爱·爱心','大笑','闭眼微笑','嫌弃','为难','惊呼','难过含泪','哭泣','慌张','开心','喜爱·星星眼','期待·星星眼','无奈笑','闭眼说话','兴奋·星星眼','疲倦','沮丧','震惊·空白眼','眩晕含泪','眩晕冒汗','微笑回应','闭眼开心'],
};
export const haloSources = {
  plana: { normal:'00', happy:'09', love:'17', surprised:'07', depressed:'06', angry:'05' },
  arona: { normal:'00', happy:'12', love:'11', surprised:'04', depressed:'07', angry:'05' },
};
export const haloLabels = { auto:'随表情', normal:'普通', happy:'开心', love:'爱心', surprised:'惊讶', depressed:'低落', angry:'生气', hidden:'隐藏' };
export const emotionProfiles = {
  neutral: { label:'平静', plana:['00','00'], arona:['00','00'], halo:'normal', tilt:0, lean:0 },
  happy: { label:'开心', plana:['15','16'], arona:['20','12'], halo:'happy', tilt:3, lean:1 },
  excited: { label:'兴奋', plana:['08','09'], arona:['22','25'], halo:'happy', tilt:-4, lean:2 },
  affection: { label:'喜爱', plana:['18','17'], arona:['11','21'], halo:'love', tilt:5, lean:1 },
  surprised: { label:'惊讶', plana:['07','14'], arona:['04','28'], halo:'surprised', tilt:-3, lean:-2 },
  angry: { label:'生气', plana:['11','10'], arona:['14','05'], halo:'angry', tilt:-3, lean:2 },
  sad: { label:'低落', plana:['06','12'], arona:['07','17'], halo:'depressed', tilt:4, lean:-2 },
  embarrassed: { label:'为难', plana:['04','12'], arona:['15','19'], halo:'depressed', tilt:5, lean:-1 },
  dizzy: { label:'眩晕', plana:['13','13'], arona:['30','29'], halo:'depressed', tilt:7, lean:-3 },
};
export function emotionPatch(character, emotion, intensity = .7) {
  const p = emotionProfiles[emotion];
  if (!Object.hasOwn(emotionProfiles, emotion) || !p) throw new Error('未知情绪');
  if (typeof intensity !== 'number' || !Number.isFinite(intensity) || intensity < 0 || intensity > 1) throw new Error('intensity 范围为 0 到 1');
  return { emotion, intensity, expression:p[character][intensity < .6 ? 0 : 1], halo:p.halo,
    headTilt:p.tilt*intensity, bodyLean:p.lean*intensity, haloLift:0, haloRotation:0,
    blush:-1, sweat:-1, tears:-1 };
}

// A second skeleton supplies ONLY halo local transforms/slots. Face and pose stay on the live skeleton.
export class SemanticRig {
  constructor(spine, data, character) {
    this.character = character;
    this.source = new spine.Skeleton(data);
    this.animation = new spine.AnimationState(new spine.AnimationStateData(data));
    this.animation.setAnimation(0,'Idle_01',true);
    this.haloBones = data.bones.filter(b => /halo/i.test(b.name)).map(b => b.index);
    this.haloSlots = data.slots.filter(s => /halo/i.test(s.name)).map(s => s.index);
    this.effects = Object.fromEntries(['blush','sweat','tears'].map((key,i) => [key,data.slots.filter(s => [/flush/i,/sweat/i,/tears/i][i].test(s.name)).map(s=>s.index)]));
    this.haloRoot = character === 'plana' ? 'Halo_root' : 'Halo_Root';
    this.body = character === 'plana' ? 'Hip_Root_ani' : 'Troso';
    this.undo = [];
    this.attachments = [];
  }
  restore() {
    for (const [slot,attachment] of this.attachments) slot.setAttachment(attachment);
    this.attachments = [];
    for (const [object,key,value] of this.undo) object[key] = value;
    this.undo = [];
  }
  set(object,key,value) { if (object) { this.undo.push([object,key,object[key]]); object[key]=value; } }
  apply(skeleton, state, dt) {
    const halo = state.halo ?? 'auto';
    if (halo !== 'auto' && halo !== 'hidden') {
      if (this.halo !== halo) {
        this.halo=halo; this.source.setToSetupPose(); this.animation.clearTrack(1);
        this.animation.setAnimation(1,haloSources[this.character][halo],true);
      }
      this.source.setToSetupPose(); this.animation.update(dt); this.animation.apply(this.source);
      for (const i of this.haloBones) for (const key of ['x','y','rotation','scaleX','scaleY','shearX','shearY']) this.set(skeleton.bones[i],key,this.source.bones[i][key]);
      for (const i of this.haloSlots) {
        const dst=skeleton.slots[i], src=this.source.slots[i];
        // Halo slots contain region attachments in these exports; copy all tint channels too.
        this.attachments.push([dst,dst.attachment]); dst.setAttachment(src.attachment);
        for (const key of ['r','g','b','a']) this.set(dst.color,key,src.color[key]);
      }
    }
    if (halo === 'hidden') for (const i of this.haloSlots) this.set(skeleton.slots[i].color,'a',0);
    for (const [name,indices] of Object.entries(this.effects)) {
      const value=state[name] ?? -1;
      if (value < 0) continue;
      for (const i of indices) {
        const slot=skeleton.slots[i];
        if (!slot.attachment && value > 0) {
          const name=Object.keys(skeleton.data.defaultSkin.attachments[i] || {})[0];
          if (name) { this.attachments.push([slot,slot.attachment]); slot.setAttachment(skeleton.getAttachment(i,name)); }
        }
        this.set(slot.color,'a',value);
      }
    }
    for (const [name,amount] of [['Head_Rot',state.headTilt], [this.body,state.bodyLean], [this.haloRoot,state.haloRotation]]) {
      const bone=skeleton.findBone(name); if (bone) this.set(bone,'rotation',bone.rotation+(amount || 0));
    }
    const root=skeleton.findBone(this.haloRoot); if(root) this.set(root,'y',root.y+(state.haloLift || 0));
  }
}
