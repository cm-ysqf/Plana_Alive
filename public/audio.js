export class AudioDriver {
  constructor({ mouth, status, meter }) {
    this.onMouth = mouth; this.onStatus = status; this.onMeter = meter;
    this.context = null; this.stream = null; this.source = null; this.analyser = null;
    this.gain = 3; this.smooth = 0; this.lastSend = 0; this.lastAmount = -1;
    this.active = false; this.simulation = null; this.utterance = null; this.serial = 0;
    this.timer = setInterval(() => this.tick(performance.now()), 33);
  }

  async ensureContext() {
    if (!this.context) this.context = new AudioContext();
    await this.context.resume();
    if (!this.analyser) { this.analyser = this.context.createAnalyser(); this.analyser.fftSize = 1024; this.samples = new Float32Array(1024); this.spectrum = new Float32Array(512); }
  }

  stop() {
    this.serial++;
    if (this.stream) this.stream.getTracks().forEach(track => track.stop());
    this.stream = null;
    if (this.source) this.source.disconnect();
    this.source = null; this.active = false; this.simulation = null;
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    this.utterance = null; this.smooth = 0; this.lastAmount = -1;
    this.onMouth(0); this.onMeter(0); this.onStatus('未接入音频');
  }

  async microphone() {
    this.stop(); const serial = this.serial;
    try {
      await this.ensureContext();
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: false } });
      if (serial !== this.serial) { stream.getTracks().forEach(t => t.stop()); return; }
      this.stream = stream;
      this.source = this.context.createMediaStreamSource(stream);
      this.source.connect(this.analyser); // Mic never connects to speakers.
      this.active = true; this.onStatus('麦克风已连接');
    } catch (error) { this.stop(); throw error; }
  }

  async file(element) {
    this.stop(); const serial = this.serial; await this.ensureContext();
    if (serial !== this.serial) return;
    if (!this.mediaSource) {
      this.mediaSource = this.context.createMediaElementSource(element);
    }
    this.source = this.mediaSource;
    this.source.connect(this.context.destination); this.source.connect(this.analyser);
    this.active = true; this.onStatus('音频驱动中');
  }

  demo() {
    this.stop(); this.simulation = { start: performance.now(), end: performance.now() + 5000 };
    this.onStatus('口型演示 · 无声音');
  }

  speak(text, { start = () => {}, end = () => {} } = {}) {
    if (!('speechSynthesis' in window)) throw new Error('当前浏览器没有系统朗读功能，请使用音频文件。');
    this.stop();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'zh-CN'; utterance.rate = .95;
    const voices = speechSynthesis.getVoices();
    const voice = voices.find(v => /^zh[-_]CN/i.test(v.lang)) || voices.find(v => /^zh/i.test(v.lang));
    if (voice) utterance.voice = voice;
    utterance.onstart = () => { if (this.utterance !== utterance) return; this.simulation = { start: performance.now(), end: Infinity }; this.onStatus('系统朗读 · 模拟口型'); start(); };
    utterance.onend = () => { if (this.utterance === utterance) { this.stop(); end(); } };
    utterance.onerror = event => { if (this.utterance !== utterance) return; if (event.error !== 'interrupted' && event.error !== 'canceled') this.onStatus('朗读不可用，请选择音频'); this.simulation = null; this.onMouth(0); end(); };
    this.utterance = utterance; speechSynthesis.speak(utterance);
  }

  tick(now) {
    let amount = 0;
    let articulation = {};
    if (this.active && this.analyser) {
      this.analyser.getFloatTimeDomainData(this.samples);
      const rms = Math.sqrt(this.samples.reduce((sum, x) => sum + x * x, 0) / this.samples.length);
      // Compress rather than clip: ordinary speech must retain quiet/loud detail.
      const level = Math.max(0, rms - .009) * this.gain;
      amount = Math.min(.96, 1 - Math.exp(-level * 4));
      if (this.analyser.getFloatFrequencyData) {
        this.analyser.getFloatFrequencyData(this.spectrum);
        let low = 0, middle = 0, high = 0;
        const binWidth = (this.context.sampleRate || 48000) / 1024;
        for (let i = 1; i < this.spectrum.length; i++) {
          const hz = i * binWidth;
          if (hz < 180 || hz > 7500) continue;
          const energy = 10 ** (this.spectrum[i] / 10);
          if (hz < 1100) low += energy; else if (hz < 3000) middle += energy; else high += energy;
        }
        const total = low + middle + high + 1e-12;
        articulation = { roundness: low / total, brightness: high / total };
      }
    } else if (this.simulation) {
      if (now > this.simulation.end) { this.stop(); return; }
      amount = Math.max(0, Math.sin((now - this.simulation.start) / 82)) * .85;
    } else return;
    this.smooth += (amount - this.smooth) * (amount > this.smooth ? .65 : .3);
    if (this.smooth < .015) this.smooth = 0;
    this.onMeter(this.smooth);
    if (now - this.lastSend >= 65 && (Math.abs(this.smooth - this.lastAmount) > .025 || this.smooth > .03 || this.smooth === 0 && this.lastAmount !== 0)) {
      this.lastSend = now; this.lastAmount = this.smooth; this.onMouth(Number(this.smooth.toFixed(3)), articulation);
    }
  }

  dispose() { clearInterval(this.timer); this.stop(); }
}
