const poseKeys = ['character', 'emotion', 'expression', 'intensity', 'halo', 'headTilt', 'bodyLean', 'gazeX', 'gazeY', 'haloLift', 'haloRotation', 'blush', 'sweat', 'tears'];
const signature = state => JSON.stringify(poseKeys.map(key => state?.[key]));

// Only the studio owning playback runs these timers; OBS receives the resulting state.
export class ReplyLifetime {
  constructor({ readState, pose, onError = () => {}, schedule = (fn, delay) => setTimeout(fn, delay), unschedule = timer => clearTimeout(timer) }) {
    Object.assign(this, { readState, pose, onError, schedule, unschedule });
    this.waiting = false; this.playing = false; this.epoch = 0;
  }
  cancel() {
    this.epoch++;
    this.unschedule(this.expressionTimer); this.unschedule(this.subtitleTimer);
    this.waiting = false; this.playing = false;
  }
  expectAudio() { this.waiting = true; this.unschedule(this.subtitleTimer); }
  observe(previous, next) {
    if (previous && previous.character !== next.character) this.cancel();
    if (previous?.subtitle === next.subtitle) {
      // A new manual/external pose takes precedence over an old reply's recovery.
      if (signature(previous) !== signature(next)) this.unschedule(this.expressionTimer);
      return;
    }
    // Subtitle expiry must not cancel the independent expression recovery.
    if (!next.subtitle) { this.unschedule(this.subtitleTimer); return; }
    this.epoch++;
    this.unschedule(this.expressionTimer); this.unschedule(this.subtitleTimer);
    const epoch = this.epoch, expected = signature(next);
    this.expressionTimer = this.schedule(() => {
      if (epoch !== this.epoch || signature(this.readState()) !== expected) return;
      this.apply({ emotion: 'neutral', intensity: 0.3, gazeX: 0, gazeY: 0 });
    }, 15000);
    if (!this.waiting && !this.playing) this.expireSubtitle(15000, next);
  }
  audioStarted() {
    this.waiting = false; this.playing = true;
    this.unschedule(this.subtitleTimer);
  }
  audioEnded() {
    this.waiting = false; this.playing = false;
    this.expireSubtitle(3000);
  }
  expireSubtitle(delay, current = this.readState()) {
    this.unschedule(this.subtitleTimer);
    const epoch = this.epoch;
    if (!current?.subtitle) return;
    const { character, subtitle } = current;
    this.subtitleTimer = this.schedule(() => {
      const next = this.readState();
      if (epoch === this.epoch && next.character === character && next.subtitle === subtitle) this.apply({ subtitle: '' });
    }, delay);
  }
  apply(value) { Promise.resolve(this.pose(value)).catch(this.onError); }
}
