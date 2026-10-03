/**
 * Gentle generated sound: a low drone that breathes with the disk, wind-like dust,
 * and soft bell tones for events. No audio files needed.
 */
export class Sound {
  private ctx: AudioContext | null = null;
  private music!: GainNode;
  private sfx!: GainNode;
  private drone: OscillatorNode[] = [];
  private filter!: BiquadFilterNode;
  musicVol = 0.6;
  sfxVol = 0.7;

  /** Must be called from a user gesture. */
  start() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.music = ctx.createGain();
    this.music.gain.value = this.musicVol * 0.5;
    this.music.connect(ctx.destination);
    this.sfx = ctx.createGain();
    this.sfx.gain.value = this.sfxVol * 0.6;
    this.sfx.connect(ctx.destination);

    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = 420;
    this.filter.Q.value = 0.7;
    this.filter.connect(this.music);
    // Drone: a soft open fifth with slow beating.
    const notes = [55, 82.4, 110.2, 164.6];
    notes.forEach((f, i) => {
      const o = ctx.createOscillator();
      o.type = i < 2 ? 'sine' : 'triangle';
      o.frequency.value = f;
      o.detune.value = (i - 1.5) * 4;
      const g = ctx.createGain();
      g.gain.value = [0.22, 0.12, 0.06, 0.03][i];
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.05 + i * 0.03;
      const lg = ctx.createGain();
      lg.gain.value = g.gain.value * 0.6;
      lfo.connect(lg).connect(g.gain);
      o.connect(g).connect(this.filter);
      o.start();
      lfo.start();
      this.drone.push(o);
    });
    // Dust wind: filtered noise that swells slowly.
    const len = ctx.sampleRate * 3;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      d[i] = last * 3.5;
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buf;
    noise.loop = true;
    const nf = ctx.createBiquadFilter();
    nf.type = 'bandpass';
    nf.frequency.value = 300;
    nf.Q.value = 0.6;
    const ng = ctx.createGain();
    ng.gain.value = 0.05;
    const nl = ctx.createOscillator();
    nl.frequency.value = 0.07;
    const nlg = ctx.createGain();
    nlg.gain.value = 0.04;
    nl.connect(nlg).connect(ng.gain);
    noise.connect(nf).connect(ng).connect(this.music);
    noise.start();
    nl.start();
  }

  setVolumes(music: number, sfx: number) {
    this.musicVol = music;
    this.sfxVol = sfx;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.music.gain.setTargetAtTime(music * 0.5, t, 0.2);
    this.sfx.gain.setTargetAtTime(sfx * 0.6, t, 0.1);
  }

  /** The drone opens up as the system comes alive (0..1). */
  mood(v: number) {
    if (!this.ctx) return;
    this.filter.frequency.setTargetAtTime(380 + v * 900, this.ctx.currentTime, 2);
  }

  private tone(freq: number, dur: number, type: OscillatorType, vol: number, when = 0, glide = 0) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + when;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (glide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * glide), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.sfx);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private noiseBurst(dur: number, freq: number, vol: number) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const len = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(freq, t);
    f.frequency.exponentialRampToValueAtTime(60, t + dur);
    const g = ctx.createGain();
    g.gain.value = vol;
    src.connect(f).connect(g).connect(this.sfx);
    src.start();
  }

  click() {
    this.tone(660, 0.08, 'triangle', 0.08);
  }
  /** Bell chime; `kind` picks the mood. */
  chime(kind: 'good' | 'life' | 'warn' | 'alien' | 'info' | 'fact') {
    const P = [392, 440, 523.3, 587.3, 659.3, 784];
    if (kind === 'life') [0, 2, 4].forEach((n, i) => this.tone(P[n], 2.2, 'sine', 0.09, i * 0.14));
    else if (kind === 'good') [1, 3, 5].forEach((n, i) => this.tone(P[n], 1.8, 'sine', 0.08, i * 0.1));
    else if (kind === 'warn') [3, 1].forEach((n, i) => this.tone(P[n] / 2, 1.6, 'triangle', 0.08, i * 0.22));
    else if (kind === 'alien') [0, 1].forEach((n, i) => this.tone(P[n] * 0.75 + i * 13, 2.4, 'sawtooth', 0.025, i * 0.3, 0.97));
    else this.tone(P[4], 1.2, 'sine', 0.045);
  }
  thud(size = 1) {
    this.noiseBurst(0.5 + size * 0.4, 500 + size * 300, 0.25 * Math.min(1.5, size));
    this.tone(70, 0.6, 'sine', 0.12 * Math.min(1.5, size), 0, 0.5);
  }
  whoosh() {
    this.noiseBurst(1.1, 2400, 0.16);
  }
  flare() {
    this.noiseBurst(1.4, 3200, 0.18);
    this.tone(220, 1.2, 'sawtooth', 0.03, 0, 2);
  }
  sizzle() {
    this.noiseBurst(0.25, 5000, 0.05);
  }
}

export const sound = new Sound();
