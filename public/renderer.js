/* Uses the wallpaper's matching Spine 3.8 runtime. Controls apply AFTER animation
 * state and BEFORE world transforms, so expression timelines cannot overwrite them. */
import { SemanticRig } from './emotions.js';
import { ExpressivePose } from './expressive-pose.js';
import { SpeechPerformance, closedMouthFor } from './speech-performance.js';
import { DesktopInteraction } from './desktop-interaction.js';
export class PresenterRenderer {
  constructor(canvas, report) {
    this.canvas = canvas;
    this.report = report;
    this.gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: true, preserveDrawingBuffer: true });
    if (!this.gl) throw new Error('WebGL 不可用，请在支持硬件加速的浏览器打开。');
    const s = window.spine, gl = this.gl;
    this.shader = s.webgl.Shader.newTwoColoredTextured(gl);
    this.batcher = new s.webgl.PolygonBatcher(gl);
    this.renderer = new s.webgl.SkeletonRenderer(gl);
    this.matrix = new s.webgl.Matrix4();
    this.cache = new Map();
    this.state = null;
    this.active = null;
    this.generation = 0;
    this.expressivePose = new ExpressivePose();
    this.desktop = new DesktopInteraction();
    this.performance = new SpeechPerformance();
    this.nextBlink = performance.now() + 3000;
    this.blinkUntil = 0;
    this.patUntil = 0;
    this.lastFrame = performance.now();
    this.frame = this.frame.bind(this);
    requestAnimationFrame(this.frame);
    canvas.addEventListener('webglcontextlost', event => { event.preventDefault(); this.report('显卡上下文丢失，请刷新页面', true); });
  }

  async load(character, meta) {
    if (!meta || typeof meta.name !== 'string') throw new Error('角色资料不完整，请重新连接云端');
    const generation = ++this.generation;
    this.active = null;
    this.report('正在载入' + meta.name + '…');
    if (!this.cache.has(character)) {
      const s = window.spine;
      const manager = new s.webgl.AssetManager(this.gl);
      const atlasPath = `/assets/${meta.file}.atlas`;
      const binaryPath = `/assets/${meta.file}.skel`;
      manager.loadBinary(binaryPath);
      manager.loadTextureAtlas(atlasPath);
      const started = performance.now();
      await new Promise((resolve, reject) => {
        const poll = () => {
          if (manager.hasErrors()) return reject(new Error('资源加载失败：' + JSON.stringify(manager.getErrors())));
          if (manager.isLoadingComplete()) return resolve();
          if (performance.now() - started > 20000) return reject(new Error('资源加载超时，请检查本地服务。'));
          setTimeout(poll, 30);
        };
        poll();
      });
      const data = new s.SkeletonBinary(new s.AtlasAttachmentLoader(manager.get(atlasPath))).readSkeletonData(manager.get(binaryPath));
      this.cache.set(character, { manager, data });
    }
    if (generation !== this.generation) return;
    const s = window.spine, data = this.cache.get(character).data;
    const skeleton = new s.Skeleton(data);
    const animationData = new s.AnimationStateData(data);
    animationData.defaultMix = .18;
    const animation = new s.AnimationState(animationData);
    animation.setAnimation(0, 'Idle_01', true);
    animation.setAnimation(1, this.state.expression, true);
    animation.update(.05); animation.apply(skeleton); skeleton.updateWorldTransform();
    const offset = new s.Vector2(), size = new s.Vector2();
    skeleton.getBounds(offset, size, []);
    const eye = skeleton.findBone('Touch_Eye');
    this.active = { character, meta, skeleton, animation,
      offset: { x: offset.x, y: offset.y }, size: { x: size.x, y: size.y },
      eye, eyeBase: eye ? { x: eye.data.x, y: eye.data.y } : null,
      expression: this.state.expression, mouthSlot: skeleton.findSlot(meta.mouthSlot),
      head: skeleton.findBone('Head_Rot'), touch: skeleton.findBone('Touch_Point'), semantic: new SemanticRig(s,data,character), frameCount: 0,
      speechMouths: new Set(), speechPhases: [], lastSpeechPhase: 'idle' };
    this.report('');
  }

  update(state, catalog) {
    const previous = this.state;
    this.state = state;
    if (!previous || previous.character !== state.character) {
      this.load(state.character, catalog[state.character]).catch(error => this.report(error.message, true));
    }
  }

  action(action) {
    if (action === 'blink') this.blink();
    if (action === 'pat' && this.active) {
      const a = this.active;
      if (a.skeleton.data.findAnimation('Pat_01_M')) a.animation.setAnimation(3, 'Pat_01_M', false);
      if (a.skeleton.data.findAnimation('Pat_01_A')) a.animation.setAnimation(4, 'Pat_01_A', false);
      this.patUntil = performance.now() + 1600;
    }
    if (action === 'reset' && this.active) {
      this.performance.reset();
      this.expressivePose.reset();
      this.active.animation.clearTrack(3); this.active.animation.clearTrack(4);
      this.patUntil = 0;
    }
  }

  blink() {
    if (!this.active) return;
    const a = this.active;
    if (a.skeleton.data.findAnimation('Eye_Close_01')) {
      a.animation.setAnimation(2, 'Eye_Close_01', false);
      this.blinkUntil = performance.now() + 160;
    }
  }

  frame(now) {
    requestAnimationFrame(this.frame);
    const dt = Math.min((now - this.lastFrame) / 1000, .1);
    this.lastFrame = now;
    if (!this.active || !this.state || this.gl.isContextLost()) return;
    const phaseState = this.performance.sample(this.state, now);
    const interactive = this.desktop.sample(phaseState, this.regions, dt);
    const a = this.active, state = { ...this.expressivePose.sample(interactive, dt), desktopPetHeld: interactive.desktopPetHeld, desktopPetOffset: interactive.desktopPetOffset, desktopLooking: interactive.desktopLooking }, gl = this.gl, canvas = this.canvas;
    if (Boolean(state.desktopPetHeld) !== Boolean(a.petHeld)) {
      a.petHeld = Boolean(state.desktopPetHeld);
      if (a.petHeld) { this.action('pat'); this.patUntil = Infinity; } else this.patUntil = now;
    }
    const looking = state.desktopLooking && !a.petHeld && state.speechPhase !== 'speaking';
    if (Boolean(looking) !== Boolean(a.looking)) {
      a.looking = Boolean(looking);
      for (const [track, suffix] of [[5, 'M'], [6, 'A']]) {
        const name = `${looking ? 'Look' : 'LookEnd'}_01_${suffix}`;
        if (a.skeleton.data.findAnimation(name)) { a.animation.setAnimation(track, name, false); if (!looking) a.animation.addEmptyAnimation(track, .25, .2); }
      }
    }
    if (state.speechPhase !== a.lastSpeechPhase) {
      if (state.speechPhase === 'preparing' || state.speechPhase === 'speaking' && a.lastSpeechPhase === 'idle') { a.speechMouths.clear(); a.speechPhases = []; }
      a.speechPhases.push(state.speechPhase); a.speechPhases = a.speechPhases.slice(-8);
      a.lastSpeechPhase = state.speechPhase;
    }
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(canvas.clientWidth * dpr));
    const height = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    gl.viewport(0, 0, width, height);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    if (a.expression !== state.expression) {
      a.animation.setAnimation(1, state.expression, true); a.expression = state.expression;
    }
    if (now >= this.nextBlink) { this.blink(); this.nextBlink = now + 3300 + Math.random() * 3500; }
    if (this.blinkUntil && now > this.blinkUntil) { a.animation.setEmptyAnimation(2, .12); this.blinkUntil = 0; }
    if (this.patUntil && now > this.patUntil) {
      for (const [track, name] of [[3, 'PatEnd_01_M'], [4, 'PatEnd_01_A']]) {
        if (a.skeleton.data.findAnimation(name)) { a.animation.setAnimation(track, name, false); a.animation.addEmptyAnimation(track, .2, .5); }
      }
      this.patUntil = 0;
    }
    a.semantic.restore();
    a.mouthSlot.bone.scaleY = a.mouthSlot.bone.data.scaleY;
    a.animation.update(dt); a.animation.apply(a.skeleton);
    if (a.touch && this.desktop.enabled) a.touch.y = a.touch.data.y + (state.desktopPetOffset || 0);
    a.semantic.apply(a.skeleton,state,dt);
    // Touch_Eye has axis inversion in the original rig too. These are gentle offsets.
    if (a.eye) { a.eye.x = a.eyeBase.x + state.gazeY * 26; a.eye.y = a.eyeBase.y - state.gazeX * 45; }
    if (state.mouthMode !== 'original') {
      const amount = state.mouth;
      const name = amount > .11 ? state.openMouth : state.mouthMode === 'auto' ? closedMouthFor(state) : state.closedMouth;
      const attachment = a.skeleton.getAttachmentByName(a.meta.mouthSlot, name);
      if (attachment) a.mouthSlot.setAttachment(attachment);
      if (amount > .11) a.mouthSlot.bone.scaleY *= .7 + .3 * amount;
    }
    if (state.speechPhase === 'speaking' && a.mouthSlot.attachment) a.speechMouths.add(a.mouthSlot.attachment.name);
    a.skeleton.updateWorldTransform();
    const aspect = width / height;
    // Fit once from the idle pose so the camera does not move with hair/halo animation.
    let worldHeight = Math.max(a.size.y * 1.12, a.size.x / aspect * 1.12) / state.zoom;
    let worldWidth = worldHeight * aspect;
    const cx = a.offset.x + a.size.x / 2 - state.x * worldWidth * .45;
    const cy = a.offset.y + a.size.y / 2 + state.y * worldHeight * .45;
    const cssWidth = canvas.clientWidth, cssHeight = canvas.clientHeight;
    const toScreen = (x, y) => ({ x: (state.flip ? .5 - (x - cx) / worldWidth : .5 + (x - cx) / worldWidth) * cssWidth, y: (.5 - (y - cy) / worldHeight) * cssHeight });
    const top = toScreen(a.offset.x + a.size.x / 2, a.offset.y + a.size.y);
    const modelHeight = a.size.y / worldHeight * cssHeight, modelWidth = a.size.x / worldWidth * cssWidth;
    this.regions = { model: { x: top.x - modelWidth / 2, y: top.y, width: modelWidth, height: modelHeight },
      head: { x: top.x - modelHeight * .12, y: top.y + modelHeight * .12, width: modelHeight * .24, height: modelHeight * .21 } };
    this.matrix.ortho2d(state.flip ? cx + worldWidth / 2 : cx - worldWidth / 2, cy - worldHeight / 2,
      state.flip ? -worldWidth : worldWidth, worldHeight);
    this.shader.bind();
    this.shader.setUniformi(window.spine.webgl.Shader.SAMPLER, 0);
    this.shader.setUniform4x4f(window.spine.webgl.Shader.MVP_MATRIX, this.matrix.values);
    this.batcher.begin(this.shader);
    this.renderer.premultipliedAlpha = false;
    this.renderer.draw(this.batcher, a.skeleton);
    this.batcher.end(); this.shader.unbind();
    a.frameCount++;
    if (a.frameCount % 15 === 0) {
      canvas.dataset.modelRect = JSON.stringify(this.regions.model); canvas.dataset.headRect = JSON.stringify(this.regions.head);
      Object.assign(canvas.dataset, { character: a.character, expression: a.expression,
        desktopPetHeld: String(Boolean(state.desktopPetHeld)), desktopPetOffset: String(state.desktopPetOffset || 0),
        halo:state.halo || 'auto', headTilt:String(state.headTilt || 0), emotion:state.emotion || 'custom',
        mouth: a.mouthSlot.attachment?.name || '', speechPhase:state.speechPhase,
        speechMouths:[...a.speechMouths].join(','), speechPhases:a.speechPhases.join(','), frameCount: String(a.frameCount),
        mouthScale: String(a.mouthSlot.bone.scaleY), gazeX: String(state.gazeX), gazeY: String(state.gazeY) });
    }
  }

  diagnostics() {
    const a = this.active;
    return a ? { character: a.character, expression: a.expression, frameCount: a.frameCount,
      mouth: a.mouthSlot.attachment?.name, speechPhase:this.performance.phase, speechMouths:[...a.speechMouths], speechPhases:a.speechPhases,
      eye: a.eye ? { x: a.eye.x, y: a.eye.y } : null,
      bounds: { offset: a.offset, size: a.size }, glError: this.gl.getError() } : { loading: true };
  }
}
