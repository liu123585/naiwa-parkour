/* =========================================================
   捏捏跑酷 · 音频（全部由 Web Audio 实时合成，无外部素材）
   ========================================================= */
'use strict';

const Sound = {
  ctx: null,
  master: null, sfxGain: null, musicGain: null,
  noiseBuf: null,
  started: false,
  musicTimer: null,
  step: 0,
  nextTime: 0,
  tempo: 138,
  mutedSfx: false, mutedMusic: false,

  init() {
    if (this.ctx) return this.ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.9;
    this.master.connect(this.ctx.destination);
    this.sfxGain = this.ctx.createGain();
    this.sfxGain.gain.value = 0.55;
    this.sfxGain.connect(this.master);
    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.value = 0.22;
    this.musicGain.connect(this.master);

    // 噪声缓冲（撞击 / 鼓 / 滑铲）
    const len = Math.floor(this.ctx.sampleRate * 0.6);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;
    return this.ctx;
  },

  resume() {
    this.init();
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  },

  setSfx(on) { this.mutedSfx = !on; if (this.sfxGain) this.sfxGain.gain.value = on ? 0.55 : 0; },
  setMusic(on) {
    this.mutedMusic = !on;
    if (this.musicGain) this.musicGain.gain.value = on ? 0.22 : 0;
    if (on) this.startMusic(); else this.stopMusic();
  },

  /* ---------- 基础发声单元 ---------- */
  tone({ freq = 440, freq2 = null, type = 'sine', dur = 0.14, vol = 0.5, delay = 0, attack = 0.005, dest = null }) {
    if (!this.ctx || this.mutedSfx) return;
    const t0 = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (freq2) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq2), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(dest || this.sfxGain);
    o.start(t0); o.stop(t0 + dur + 0.03);
  },

  noise({ dur = 0.2, vol = 0.4, delay = 0, hp = 200, lp = 6000, sweep = 1 }) {
    if (!this.ctx || this.mutedSfx) return;
    const t0 = this.ctx.currentTime + delay;
    const s = this.ctx.createBufferSource();
    s.buffer = this.noiseBuf;
    const g = this.ctx.createGain();
    const f1 = this.ctx.createBiquadFilter();
    f1.type = 'highpass'; f1.frequency.value = hp;
    const f2 = this.ctx.createBiquadFilter();
    f2.type = 'lowpass'; f2.frequency.setValueAtTime(lp, t0);
    f2.frequency.exponentialRampToValueAtTime(Math.max(120, lp * sweep), t0 + dur);
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    s.connect(f1); f1.connect(f2); f2.connect(g); g.connect(this.sfxGain);
    s.start(t0); s.stop(t0 + dur + 0.03);
  },

  /* ---------- 具体音效 ---------- */
  coin(streak = 0) {
    const base = 988 + Math.min(10, streak) * 62;
    this.tone({ freq: base, freq2: base, type: 'triangle', dur: 0.07, vol: 0.34 });
    this.tone({ freq: base * 1.5, type: 'square', dur: 0.09, vol: 0.14, delay: 0.035 });
  },
  jump() { this.tone({ freq: 300, freq2: 760, type: 'sine', dur: 0.16, vol: 0.4 }); },
  land() { this.noise({ dur: 0.09, vol: 0.2, lp: 1400, sweep: 0.4 }); },
  roll() { this.noise({ dur: 0.26, vol: 0.26, hp: 400, lp: 3600, sweep: 0.35 }); },
  whoosh() { this.noise({ dur: 0.16, vol: 0.16, hp: 900, lp: 5200, sweep: 0.5 }); },
  power() {
    [0, .06, .12, .19].forEach((d, i) => this.tone({ freq: 523 * Math.pow(1.26, i), type: 'triangle', dur: 0.16, vol: 0.34, delay: d }));
  },
  board() {
    this.tone({ freq: 220, freq2: 900, type: 'sawtooth', dur: 0.3, vol: 0.24 });
    this.noise({ dur: 0.35, vol: 0.2, hp: 300, lp: 4200, sweep: 0.3 });
  },
  boardBreak() {
    this.noise({ dur: 0.3, vol: 0.4, hp: 200, lp: 5000, sweep: 0.2 });
    this.tone({ freq: 420, freq2: 90, type: 'square', dur: 0.28, vol: 0.3 });
  },
  crash() {
    this.noise({ dur: 0.5, vol: 0.5, hp: 80, lp: 4200, sweep: 0.25 });
    this.tone({ freq: 160, freq2: 55, type: 'sawtooth', dur: 0.45, vol: 0.34 });
  },
  /* 泥泥招牌「卡痰音」大笑 */
  laugh() {
    if (!this.ctx || this.mutedSfx) return;
    for (let i = 0; i < 6; i++) {
      const d = i * 0.135;
      this.tone({ freq: 190 - i * 9, freq2: 150 - i * 8, type: 'sawtooth', dur: 0.11, vol: 0.26, delay: d, attack: 0.012 });
    }
  },
  ui() { this.tone({ freq: 660, freq2: 880, type: 'triangle', dur: 0.08, vol: 0.22 }); },
  /* 兼容旧调用名：panels.js 等处在用 Sound.click()，缺失会导致点击处理器抛错、面板打不开 */
  click() { this.ui(); },
  deny() { this.tone({ freq: 220, freq2: 150, type: 'square', dur: 0.16, vol: 0.2 }); },
  buy() {
    [523, 659, 784, 1046].forEach((f, i) => this.tone({ freq: f, type: 'triangle', dur: 0.2, vol: 0.3, delay: i * 0.07 }));
  },
  mission() {
    [659, 784, 1046, 1318].forEach((f, i) => this.tone({ freq: f, type: 'square', dur: 0.22, vol: 0.22, delay: i * 0.08 }));
  },
  countdown(hi) { this.tone({ freq: hi ? 880 : 587, type: 'triangle', dur: 0.2, vol: 0.3 }); },
  revive() {
    this.tone({ freq: 300, freq2: 1200, type: 'triangle', dur: 0.5, vol: 0.34 });
    this.tone({ freq: 600, freq2: 1800, type: 'sine', dur: 0.45, vol: 0.2, delay: 0.06 });
  },

  /* ---------- 背景音乐：8-bit 循环 ---------- */
  midiFreq(m) { return 440 * Math.pow(2, (m - 69) / 12); },

  /* 4 个和弦：Am - F - C - G；旋律使用固定音型 */
  chords: [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]],
  melodyA: [69, null, 72, 74, null, 72, 69, null, 64, null, 67, 69, null, 67, 64, null,
            72, null, 76, 79, null, 76, 72, null, 67, null, 71, 74, null, 71, 67, null],
  melodyB: [81, null, 79, null, 76, null, 74, null, 72, null, 74, 76, null, 72, 69, null,
            79, null, 76, null, 72, null, 69, null, 74, null, 76, 79, null, 76, 74, null],

  startMusic() {
    this.init();
    if (!this.ctx || this.musicTimer || this.mutedMusic) return;
    this.step = 0;
    this.nextTime = this.ctx.currentTime + 0.1;
    const spb = 60 / this.tempo / 4; // 16 分音符
    const tick = () => {
      if (!this.ctx) return;
      const now = this.ctx.currentTime;
      while (this.nextTime < now + 0.24) {
        this.scheduleStep(this.step, this.nextTime, spb);
        this.step = (this.step + 1) % 128;
        this.nextTime += spb;
      }
    };
    tick();
    this.musicTimer = setInterval(tick, 60);
  },
  stopMusic() {
    if (this.musicTimer) { clearInterval(this.musicTimer); this.musicTimer = null; }
  },

  scheduleStep(step, t, spb) {
    const ctx = this.ctx, out = this.musicGain;
    const bar = Math.floor(step / 16) % 2;            // 32 步一个循环（2 小节）
    const mel = bar === 0 ? this.melodyA : this.melodyB;
    const chord = this.chords[Math.floor(step / 32) % 4];

    // 贝斯
    if (step % 4 === 0) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'triangle';
      o.frequency.value = this.midiFreq(chord[0] - 12);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.5, t + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t + spb * 3.2);
      o.connect(g); g.connect(out); o.start(t); o.stop(t + spb * 3.4);
    }
    // 和弦垫（每 8 步）
    if (step % 8 === 0) {
      chord.forEach((m, i) => {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.type = 'square';
        o.frequency.value = this.midiFreq(m);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(0.075 - i * 0.012, t + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, t + spb * 6);
        o.connect(g); g.connect(out); o.start(t); o.stop(t + spb * 6.2);
      });
    }
    // 主旋律
    const n = mel[step % 32];
    if (n) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'square';
      o.frequency.value = this.midiFreq(n);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.12, t + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, t + spb * 1.6);
      o.connect(g); g.connect(out); o.start(t); o.stop(t + spb * 1.8);
    }
    // 鼓
    const noiseHit = (vol, dur, lp) => {
      const s = ctx.createBufferSource(); s.buffer = this.noiseBuf;
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lp;
      const g = ctx.createGain();
      g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      s.connect(f); f.connect(g); g.connect(out); s.start(t); s.stop(t + dur + 0.02);
    };
    if (step % 8 === 0 || step % 8 === 5) {           // 底鼓
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine'; o.frequency.setValueAtTime(140, t);
      o.frequency.exponentialRampToValueAtTime(45, t + 0.09);
      g.gain.setValueAtTime(0.55, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
      o.connect(g); g.connect(out); o.start(t); o.stop(t + 0.16);
    }
    if (step % 8 === 4) noiseHit(0.22, 0.12, 3200);   // 军鼓
    if (step % 2 === 1) noiseHit(0.055, 0.03, 7200);  // 踩镲
  },
};
