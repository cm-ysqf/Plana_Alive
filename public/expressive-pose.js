const fields = ['headTilt', 'bodyLean', 'gazeX', 'gazeY', 'haloLift', 'haloRotation'];
const speechWeight = { neutral: .45, happy: .85, excited: 1, affection: .6, surprised: .75, angry: .9, sad: .25, embarrassed: .4, dizzy: .2 };

// Local rendering only: never writes motion back into conversation state or timers.
export class ExpressivePose {
  reset() { this.character = null; this.pose = null; this.energy = 0; }
  sample(state, dt) {
    const step = Math.max(0, Math.min(.1, dt));
    if (!this.pose || this.character !== state.character) {
      this.character = state.character;
      this.pose = Object.fromEntries(fields.map(key => [key, state[key] || 0]));
      this.energy = 0;
    }
    const blend = 1 - Math.exp(-step / .22);
    for (const key of fields) this.pose[key] += ((state[key] || 0) - this.pose[key]) * blend;
    const speaking = state.mouthMode === 'auto' ? Math.max(0, Math.min(1, state.mouth || 0)) : 0;
    this.energy += (speaking - this.energy) * (1 - Math.exp(-step / .16));
    const weight = (speechWeight[state.emotion] ?? .45) * (.5 + .5 * (state.intensity ?? .5));
    // A small response to the real vocal envelope, rather than an unrelated idle sway.
    const accent = (speaking - this.energy) * weight;
    return { ...state, ...this.pose,
      headTilt: Math.max(-15, Math.min(15, this.pose.headTilt + accent * 1.8)),
      bodyLean: Math.max(-8, Math.min(8, this.pose.bodyLean + this.energy * weight * .3)) };
  }
}
