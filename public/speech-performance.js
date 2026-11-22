const closedShapes = {
  plana: { neutral: 'Mouth_01', happy: 'Mouth_03', excited: 'Mouth_03', affection: 'Mouth_03', surprised: 'Mouth_02', angry: 'Mouth_09', sad: 'Mouth_09', embarrassed: 'Mouth_10', dizzy: 'Mouth_10' },
  arona: { neutral: 'Mouse_01', happy: 'Mouse_01', excited: 'Mouse_01', affection: 'Mouse_01', surprised: 'Mouse_10', angry: 'Mouse_06', sad: 'Mouse_06', embarrassed: 'Mouse_10', dizzy: 'Mouse_10' }
};
const faces = {
  plana: {
    preparing: { neutral: '03', happy: '08', excited: '08', affection: '02', surprised: '08', angry: '11', sad: '06', embarrassed: '04', dizzy: '13' },
    settling: { neutral: '00', happy: '15', excited: '15', affection: '15', surprised: '00', angry: '05', sad: '06', embarrassed: '20', dizzy: '00' }
  },
  arona: {
    preparing: { neutral: '02', happy: '22', excited: '22', affection: '03', surprised: '02', angry: '14', sad: '07', embarrassed: '15', dizzy: '29' },
    settling: { neutral: '00', happy: '03', excited: '03', affection: '03', surprised: '00', angry: '05', sad: '07', embarrassed: '23', dizzy: '00' }
  }
};

export function closedMouthFor(state) {
  return closedShapes[state.character]?.[state.emotion] || state.closedMouth;
}

// Frequency bands suggest broad articulation; these are not recognized phonemes.
export class SpeechMouth {
  reset() { this.shape = null; this.changedAt = -Infinity; this.character = null; }
  sample(state, amount, features = {}, now = 0) {
    if (this.character !== state.character) { this.reset(); this.character = state.character; }
    const closedMouth = closedMouthFor(state);
    let shape = amount < .11 ? 'closed' : amount < .3 ? 'small' : features.brightness > .6 ? 'teeth' : features.roundness > .6 ? 'round' : 'wide';
    // Prevent flicker, while closing immediately at an actual pause.
    if (shape !== 'closed' && this.shape && this.shape !== 'closed' && now - this.changedAt < 95) shape = this.shape;
    if (shape !== this.shape) { this.shape = shape; this.changedAt = now; }
    const warm = ['happy', 'excited', 'affection'].includes(state.emotion);
    let openMouth;
    if (state.character === 'plana') {
      openMouth = { closed: closedMouth, small: 'Mouth_06', round: 'Mouth_04', wide: warm ? 'Mouth_12' : 'Mouth_05', teeth: 'Mouth_07' }[shape];
      if (amount > .85 && state.intensity >= .65 && ['angry', 'excited'].includes(state.emotion)) openMouth = 'Mouth_08';
    } else {
      openMouth = { closed: closedMouth, small: warm ? 'Mouse_13' : 'Mouse_04', round: 'Mouse_04', wide: warm ? 'Mouse_02' : 'Mouse_03', teeth: warm ? 'Mouse_01' : 'Mouse_07' }[shape];
    }
    return { mouth: amount, closedMouth, openMouth };
  }
}

export class SpeechPerformance {
  constructor() { this.reset(); }
  reset(state = null) { this.phase = 'idle'; this.explicit = false; this.lastVoiceAt = -Infinity; this.previous = state ? { ...state } : null; }
  prepare() { this.phase = 'preparing'; this.explicit = true; }
  start() { this.phase = 'speaking'; this.explicit = true; }
  end() { if (this.phase !== 'idle') this.phase = 'settling'; this.explicit = true; }
  sample(state, now) {
    const previous = this.previous;
    if (previous?.character !== state.character && previous) this.reset();
    if (state.mouthMode !== 'auto') { this.reset(); this.previous = { ...state }; return { ...state, speechPhase: 'idle' }; }
    if (!this.explicit && state.subtitle && state.subtitle !== previous?.subtitle && this.phase !== 'speaking') this.phase = 'preparing';
    if (state.mouth > .08) {
      this.lastVoiceAt = now;
      // OBS infers phases from synchronized energy; the studio uses actual player events.
      if (!this.explicit) this.phase = 'speaking';
    } else if (!this.explicit && this.phase === 'speaking' && now - this.lastVoiceAt > 650) this.phase = 'settling';
    if (previous && state.emotion === 'neutral' && previous.emotion !== 'neutral' && this.phase !== 'speaking') this.phase = 'idle';
    if (!state.subtitle && this.phase === 'preparing' && !this.explicit) this.phase = 'idle';
    this.previous = { ...state };
    if (this.phase === 'idle' || state.emotion === 'custom') return { ...state, speechPhase: this.phase };
    const expression = faces[state.character]?.[this.phase]?.[state.emotion] || state.expression;
    const preparing = this.phase === 'preparing', settling = this.phase === 'settling';
    return { ...state, expression, speechPhase: this.phase,
      mouth: preparing || settling ? 0 : state.mouth,
      headTilt: (state.headTilt || 0) * (preparing ? .55 : settling ? .65 : 1) + (preparing ? .7 : 0),
      bodyLean: (state.bodyLean || 0) * (preparing ? .4 : settling ? .45 : 1),
      gazeY: (state.gazeY || 0) + (preparing ? -.07 : 0) };
  }
}

export const speechFaces = faces;
