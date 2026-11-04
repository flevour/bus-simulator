// Audio sintetizzato con WebAudio (nessun file esterno)
export class Audio {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.voice = true;
  }
  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.gain.value = 0.7;
    const comp = ctx.createDynamicsCompressor();
    this.master.connect(comp).connect(ctx.destination);
    // buffer di rumore
    const len = ctx.sampleRate * 2;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    // motore diesel
    this.engGain = ctx.createGain();
    this.engGain.gain.value = 0;
    this.engFilter = ctx.createBiquadFilter();
    this.engFilter.type = 'lowpass';
    this.engFilter.frequency.value = 400;
    this.engFilter.Q.value = 2;
    this.engFilter.connect(this.engGain).connect(this.master);
    this.oscs = [];
    for (const [type, mul, g] of [['sawtooth', 1, 0.5], ['square', 0.5, 0.35], ['sawtooth', 2.01, 0.2], ['triangle', 3, 0.15]]) {
      const o = ctx.createOscillator();
      o.type = type;
      const gg = ctx.createGain();
      gg.gain.value = g;
      o.connect(gg).connect(this.engFilter);
      o.start();
      this.oscs.push({ o, mul });
    }
    // battito irregolare del diesel (modulazione d'ampiezza)
    this.lfo = ctx.createOscillator();
    this.lfo.type = 'square';
    const lfoG = ctx.createGain();
    lfoG.gain.value = 0.12;
    this.lfoG = lfoG;
    this.lfo.connect(lfoG).connect(this.engGain.gain);
    // motore elettrico: fischio dell'inverter che sale con la velocità
    this.elecG = ctx.createGain();
    this.elecG.gain.value = 0;
    const ef = ctx.createBiquadFilter();
    ef.type = 'bandpass';
    ef.frequency.value = 900;
    ef.Q.value = 0.7;
    ef.connect(this.elecG).connect(this.master);
    this.elecF = ef;
    this.elecOscs = [];
    for (const [type, mul, g] of [['sine', 1, 0.6], ['triangle', 2.0, 0.25], ['sine', 3.02, 0.12]]) {
      const o = ctx.createOscillator();
      o.type = type;
      const gg = ctx.createGain();
      gg.gain.value = g;
      o.connect(gg).connect(ef);
      o.start();
      this.elecOscs.push({ o, mul });
    }
    this.lfo.start();
    // turbo
    this.turbo = ctx.createOscillator();
    this.turbo.type = 'sine';
    this.turboG = ctx.createGain();
    this.turboG.gain.value = 0;
    this.turbo.connect(this.turboG).connect(this.master);
    this.turbo.start();
    // rotolamento / vento
    this.road = this.loopNoise();
    this.roadF = ctx.createBiquadFilter();
    this.roadF.type = 'lowpass';
    this.roadF.frequency.value = 300;
    this.roadG = ctx.createGain();
    this.roadG.gain.value = 0;
    this.road.connect(this.roadF).connect(this.roadG).connect(this.master);
    // pioggia
    this.rain = this.loopNoise();
    const rf = ctx.createBiquadFilter();
    rf.type = 'highpass';
    rf.frequency.value = 1800;
    this.rainG = ctx.createGain();
    this.rainG.gain.value = 0;
    this.rain.connect(rf).connect(this.rainG).connect(this.master);
    // clacson (continuo, a gate)
    this.hornG = ctx.createGain();
    this.hornG.gain.value = 0;
    const hf = ctx.createBiquadFilter();
    hf.type = 'lowpass';
    hf.frequency.value = 1800;
    hf.connect(this.hornG).connect(this.master);
    for (const f of [311, 392]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      o.connect(hf);
      o.start();
    }
    // cicalino retromarcia
    this.revG = ctx.createGain();
    this.revG.gain.value = 0;
    const ro = ctx.createOscillator();
    ro.type = 'square';
    ro.frequency.value = 1150;
    ro.connect(this.revG).connect(this.master);
    ro.start();
    this.revT = 0;
  }
  loopNoise() {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noiseBuf;
    s.loop = true;
    s.start();
    return s;
  }
  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }
  setMuted(m) { if (this.master) this.master.gain.value = m ? 0 : 0.7; }

  update(dt, bus, { interior, rain }) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const rpm = bus.rpm;
    const sp0 = Math.abs(bus.v);
    if (bus.electric) {
      // niente diesel: solo inverter, ventole e rotolamento
      this.engGain.gain.setTargetAtTime(0, t, 0.05);
      this.lfoG.gain.setTargetAtTime(0, t, 0.05);
      this.turboG.gain.setTargetAtTime(0, t, 0.05);
      const fw = 140 + sp0 * 62;
      for (const { o, mul } of this.elecOscs) o.frequency.setTargetAtTime(fw * mul, t, 0.05);
      this.elecF.frequency.setTargetAtTime(fw * 1.6, t, 0.08);
      const load = Math.max(bus.throttle, (bus.brake || 0) * Math.min(1, sp0 / 3) * 0.6);
      const g = (interior ? 0.05 : 0.035) * (0.25 + load * 0.75) * Math.min(1, 0.15 + sp0 / 4);
      this.elecG.gain.setTargetAtTime(g, t, 0.08);
    } else {
      this.elecG.gain.setTargetAtTime(0, t, 0.05);
      this.lfoG.gain.setTargetAtTime(0.12, t, 0.05);
    }
    if (!bus.electric) {
    const f = (rpm / 60) * 3;
    for (const { o, mul } of this.oscs) o.frequency.setTargetAtTime(f * mul, t, 0.05);
    this.lfo.frequency.setTargetAtTime(f / 2, t, 0.05);
    const load = bus.throttle;
    this.engFilter.frequency.setTargetAtTime((interior ? 180 : 260) + load * (interior ? 500 : 900) + rpm * 0.15, t, 0.08);
    this.engGain.gain.setTargetAtTime((interior ? 0.22 : 0.32) * (0.45 + load * 0.55 + rpm / 4000), t, 0.08);
    this.turbo.frequency.setTargetAtTime(1800 + rpm * 1.4, t, 0.2);
    this.turboG.gain.setTargetAtTime(load * Math.max(0, rpm - 1100) / 1200 * 0.012, t, 0.2);
    }
    const sp = Math.abs(bus.v);
    this.roadF.frequency.setTargetAtTime(200 + sp * 40, t, 0.1);
    this.roadG.gain.setTargetAtTime(Math.min(0.35, sp * 0.02) * (interior ? 0.7 : 1), t, 0.1);
    this.rainG.gain.setTargetAtTime((+rain || 0) * (interior ? 0.05 : 0.09), t, 0.3);
    // il tram non ha il clacson: campanello a rintocchi finché si tiene premuto H
    this.hornG.gain.setTargetAtTime(bus.horn && !bus.isTram ? 0.22 : 0, t, 0.015);
    if (bus.isTram && bus.horn) { this.bellT = (this.bellT || 0) - dt; if (this.bellT <= 0) { this.tramBell(); this.bellT = 0.3; } }
    else this.bellT = 0;
    // retromarcia
    if (bus.dir < 0) {
      this.revT += dt;
      this.revG.gain.setTargetAtTime(this.revT % 1 < 0.5 ? 0.05 : 0, t, 0.01);
    } else this.revG.gain.setTargetAtTime(0, t, 0.01);
  }

  // ---------- effetti singoli ----------
  noiseBurst({ dur = 0.5, type = 'bandpass', freq = 2500, q = 1, gain = 0.3, attack = 0.01, delay = 0 }) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime + delay;
    const s = ctx.createBufferSource();
    s.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(f).connect(g).connect(this.master);
    s.start(t, Math.random());
    s.stop(t + dur + 0.05);
  }
  tone(freq, dur, { type = 'sine', gain = 0.2, delay = 0, slide = 0 } = {}) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.linearRampToValueAtTime(freq + slide, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }
  doorOpen() {
    this.noiseBurst({ dur: 0.9, freq: 3200, q: 0.7, gain: 0.35, attack: 0.02 });
    this.tone(180, 0.25, { type: 'square', gain: 0.05, delay: 0.7 });
  }
  doorClose() {
    for (let i = 0; i < 3; i++) this.tone(1050, 0.12, { type: 'square', gain: 0.06, delay: i * 0.3 });
    this.noiseBurst({ dur: 1.0, freq: 2600, q: 0.8, gain: 0.3, delay: 0.9 });
    this.noiseBurst({ dur: 0.15, type: 'lowpass', freq: 300, gain: 0.5, delay: 2.0 });
  }
  // campanello del tram: colpo metallico con parziali inarmoniche che si smorzano
  tramBell() {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    for (const [f, g, d] of [[1185, 0.15, 0.9], [2650, 0.07, 0.55], [3920, 0.035, 0.35], [600, 0.05, 0.7]]) {
      const o = ctx.createOscillator();
      o.type = 'sine'; o.frequency.value = f;
      const gg = ctx.createGain();
      gg.gain.setValueAtTime(0.0001, t);
      gg.gain.exponentialRampToValueAtTime(g, t + 0.004);
      gg.gain.exponentialRampToValueAtTime(0.0001, t + d);
      o.connect(gg).connect(this.master);
      o.start(t); o.stop(t + d + 0.05);
    }
  }
  bell() {
    this.tone(1320, 0.7, { gain: 0.2 });
    this.tone(990, 0.9, { gain: 0.18, delay: 0.32 });
  }
  chime() {
    this.tone(784, 0.5, { gain: 0.12 });
    this.tone(659, 0.5, { gain: 0.12, delay: 0.25 });
    this.tone(523, 0.8, { gain: 0.12, delay: 0.5 });
  }
  tick(on) { this.noiseBurst({ dur: 0.04, type: 'highpass', freq: on ? 3000 : 2200, gain: 0.25 }); }
  airBrake() { this.noiseBurst({ dur: 0.7, freq: 4200, q: 0.5, gain: 0.22, attack: 0.005 }); }
  crash(power = 1) {
    this.noiseBurst({ dur: 0.6, type: 'lowpass', freq: 900, gain: Math.min(0.9, 0.4 * power) });
    this.noiseBurst({ dur: 0.35, type: 'bandpass', freq: 2500, q: 2, gain: Math.min(0.5, 0.2 * power), delay: 0.03 });
    this.tone(70, 0.3, { type: 'sine', gain: Math.min(0.8, 0.5 * power), slide: -30 });
  }
  carHorn(dist) {
    const g = Math.max(0, 0.18 - dist * 0.004);
    if (g <= 0.005) return;
    this.tone(420 + Math.random() * 80, 0.35, { type: 'square', gain: g });
    this.tone(520 + Math.random() * 60, 0.35, { type: 'square', gain: g * 0.7 });
  }
  shift() { this.noiseBurst({ dur: 0.18, type: 'lowpass', freq: 500, gain: 0.08 }); }
  good() { this.tone(880, 0.12, { gain: 0.1 }); this.tone(1320, 0.2, { gain: 0.1, delay: 0.1 }); }
  bad() { this.tone(300, 0.25, { type: 'square', gain: 0.07 }); this.tone(220, 0.35, { type: 'square', gain: 0.07, delay: 0.18 }); }
  camera() { this.noiseBurst({ dur: 0.12, type: 'highpass', freq: 5000, gain: 0.3 }); this.tone(2000, 0.08, { gain: 0.06 }); }

  say(text) {
    if (!this.voice || !('speechSynthesis' in window)) return;
    try {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'it-IT';
      u.rate = 0.95;
      const v = speechSynthesis.getVoices().find((v) => v.lang && v.lang.startsWith('it'));
      if (v) u.voice = v;
      speechSynthesis.cancel();
      setTimeout(() => speechSynthesis.speak(u), 900);
      this.chime();
    } catch (e) { /* ignorato */ }
  }
}
