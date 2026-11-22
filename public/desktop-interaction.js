const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
export class DesktopInteraction {
  constructor() { this.enabled = false; this.settings = {}; this.pointer = null; this.petHeld = false; this.petTarget = 0; this.petValue = 0; }
  configure(settings) { this.enabled = true; this.settings = settings; if (!settings.headpat || settings.clickThrough) { this.petHeld = false; this.petTarget = 0; } }
  pet(phase, x, head) {
    if (!this.enabled || !this.settings.headpat || this.settings.clickThrough) return;
    if (phase === 'start') { this.petHeld = true; this.petStart = x; this.petTarget = 0; }
    if (phase === 'move' && this.petHeld) this.petTarget = clamp((x - this.petStart) / Math.max(head?.width || 100, 30), -1, 1) * 30;
    if (phase === 'end') { this.petHeld = false; this.petTarget = 0; }
  }
  sample(state, regions, dt) {
    if (!this.enabled) return state;
    const head = regions?.head, model = regions?.model, point = this.pointer;
    let gx = 0, gy = 0;
    const near = point && model && point.x > model.x - 150 && point.x < model.x + model.width + 150 && point.y > model.y - 150 && point.y < model.y + model.height + 150;
    if (this.settings.mouseTracking && near && head && !this.petHeld) {
      gx = clamp((point.x - head.x - head.width / 2) / Math.max(model.width * .65, 100), -1, 1) * (state.flip ? -1 : 1);
      gy = clamp((head.y + head.height / 2 - point.y) / Math.max(model.height * .5, 120), -1, 1);
    }
    this.petValue += ((this.petHeld ? this.petTarget : 0) - this.petValue) * (1 - Math.exp(-dt * 12));
    return { ...state, gazeX: this.settings.mouseTracking ? gx : state.gazeX, gazeY: this.settings.mouseTracking ? gy : state.gazeY,
      headTilt: state.headTilt + gx * 1.4, bodyLean: state.bodyLean + gx * .3,
      desktopPetHeld: this.petHeld, desktopPetOffset: this.petValue, desktopLooking: Boolean(this.settings.mouseTracking && near && !this.petHeld) };
  }
}
