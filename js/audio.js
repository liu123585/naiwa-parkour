/* =========================================================
   捏捏跑酷 · 音频
   ---------------------------------------------------------
   音效全部由 Web Audio 实时合成；BGM 有两条路——
   默认「八音盒」是实时合成，可切的「原声」是外部 CC0 音频文件。
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
  /* tempo 定义在下面的「背景音乐」段里（112 BPM），这里不要再写一份——
     对象字面量里重复的键是后者胜出，看着能跑，实际是个定时炸弹。 */
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
    this.musicGain.gain.value = 0.30;
    this.musicGain.connect(this.master);

    /* 音乐的延迟（回声）总线。
       八音盒的余韵全靠它——干声拨一下是"哒"，带一点回声才有"盒子里"的空间感。
       延迟时间是附点八分，回授 0.32、湿声 0.30，并且低通到 2.6k，
       免得回声一层层叠上去变成刺耳的高频糊。 */
    this.musicSend = this.ctx.createGain();
    this.musicSend.gain.value = 1;
    this.delay = this.ctx.createDelay(1.0);
    this.delay.delayTime.value = (60 / this.tempo) * 0.75;
    this.delayFb = this.ctx.createGain();
    this.delayFb.gain.value = 0.32;
    this.delayWet = this.ctx.createGain();
    this.delayWet.gain.value = 0.30;
    const dlp = this.ctx.createBiquadFilter();
    dlp.type = 'lowpass'; dlp.frequency.value = 2600;
    this.musicSend.connect(this.delay);
    this.delay.connect(this.delayFb);
    this.delayFb.connect(dlp);
    dlp.connect(this.delay);
    this.delay.connect(this.delayWet);
    this.delayWet.connect(this.musicGain);

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
    /* 原声走的是 <audio>，不受 Web Audio 的 suspended 影响，
       但会被自动播放策略拦下。每次手势都补一次 applyMusic，
       玩家第一次点屏幕时它就能起来。 */
    if (!this.mutedMusic && this.activeSrc() === 'file') {
      const a = this.bgmEl;
      if (!a || a.paused) this.applyMusic();
    }
  },

  setSfx(on) { this.mutedSfx = !on; if (this.sfxGain) this.sfxGain.gain.value = on ? 0.55 : 0; },
  setMusic(on) {
    this.mutedMusic = !on;
    this.applyMusic();
  },

  /* =========================================================
     BGM 有两个音源，玩家在设置里选：
       'synth' —— 上面那套实时合成的八音盒（默认，零下载、永远能响）
       'file'  —— 一段 CC0 原声 MP3（更饱满，但要等文件加载）
     两条路互斥，applyMusic() 是唯一的开关入口，别在别处直接
     调 startMusic/playBgm，否则切换时会两个一起响。
     ========================================================= */
  musicSrc: 'synth',
  bgmEl: null,
  bgmUrl: 'audio/bgm-sport.mp3',
  bgmVol: 0.34,

  /* 浏览器支不支持 MP3 解码。老 Safari 之外的都支持，但代码里
     还是判一下，免得在不支持的环境里静音了玩家还以为坏了。 */
  bgmSupported() {
    if (this._bgmOk !== undefined) return this._bgmOk;
    try {
      const a = new Audio();
      this._bgmOk = !!(a.canPlayType && a.canPlayType('audio/mpeg') !== '');
    } catch (e) { this._bgmOk = false; }
    return this._bgmOk;
  },

  loadBgm() {
    if (this.bgmEl || typeof Audio === 'undefined') return this.bgmEl;
    try {
      const a = new Audio(this.bgmUrl);
      a.loop = true;
      a.preload = 'auto';
      a.volume = this.bgmVol;
      this.bgmEl = a;
    } catch (e) { this.bgmEl = null; }
    return this.bgmEl;
  },

  playBgm() {
    const a = this.loadBgm();
    if (!a) return;
    a.volume = this.bgmVol;
    /* play() 返回 Promise，自动播放策略拦截时会 reject。
       静默吞掉就行——玩家下一次点屏幕会再调一次 applyMusic。 */
    const pr = a.play();
    if (pr && pr.catch) pr.catch(() => {});
  },

  stopBgm() {
    if (!this.bgmEl) return;
    try { this.bgmEl.pause(); } catch (e) { /* 忽略 */ }
  },

  /* 当前实际会响的音源。文件不可用时回落到合成，别把 BGM 整个哑掉。 */
  activeSrc() {
    return (this.musicSrc === 'file' && this.bgmSupported()) ? 'file' : 'synth';
  },

  setMusicSrc(src) {
    this.musicSrc = (src === 'file') ? 'file' : 'synth';
    this.applyMusic();
  },

  applyMusic() {
    const on = !this.mutedMusic;
    const useFile = on && this.activeSrc() === 'file';
    if (this.musicGain) this.musicGain.gain.value = on ? 0.30 : 0;
    if (on && !useFile) this.startMusic(); else this.stopMusic();
    if (useFile) this.playBgm(); else this.stopBgm();
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

  /* =========================================================
     背景音乐：玩具八音盒
     ---------------------------------------------------------
     原来那套是 8-bit 方波 + Am-F-C-G 死循环，问题有三个：
       1) 音色刺——方波谐波全是奇次，听久了耳朵累；
       2) 和声原地打转，4 个和弦从头到尾，一点起伏都没有；
       3) 鼓是 808 那套电子底鼓，跟"手工玩具厂"的世界观完全不搭。
     现在换成八音盒：正弦基音 + 一个非谐分音（就是盒子里那根"齿"的金属味），
     配一个低通三角波贝斯、一层很轻的和弦垫、还有一下一下的机械节拍。
     和声走 A 段（i-VI-III-VII-i-VI-iv-V）+ B 段（VI-VII-v-i-VI-iv-V-V），
     16 小节一循环，A/B 之间有对比，循环点上 E7 → Am7 是正经的收束。
     ========================================================= */
  tempo: 112,
  midiFreq(m) { return 440 * Math.pow(2, (m - 69) / 12); },

  /* 每小节 16 个十六分槽，0 = 留白。数字是 MIDI 音高。 */
  melA: [
    [76, 0, 0, 0, 72, 0, 0, 0, 69, 0, 0, 0, 72, 0, 74, 0],   // Am7
    [72, 0, 0, 0, 69, 0, 0, 0, 65, 0, 0, 0, 69, 0, 0, 0],   // Fmaj7
    [76, 0, 0, 0, 79, 0, 0, 0, 76, 0, 0, 0, 72, 0, 76, 0],   // Cmaj7
    [74, 0, 0, 0, 71, 0, 0, 0, 67, 0, 0, 0, 71, 0, 74, 0],   // G6
    [69, 0, 0, 0, 72, 0, 0, 0, 76, 0, 0, 0, 81, 0, 0, 0],   // Am7
    [79, 0, 0, 0, 76, 0, 0, 0, 72, 0, 0, 0, 69, 0, 0, 0],   // Fmaj7
    [65, 0, 0, 0, 69, 0, 0, 0, 74, 0, 0, 0, 77, 0, 0, 0],   // Dm7
    [76, 0, 0, 0, 74, 0, 0, 0, 71, 0, 0, 0, 68, 0, 0, 0],   // E7
  ],
  melB: [
    [69, 0, 72, 0, 76, 0, 0, 0, 77, 0, 76, 0, 72, 0, 0, 0],   // Fmaj7
    [71, 0, 74, 0, 79, 0, 0, 0, 74, 0, 71, 0, 67, 0, 0, 0],   // G6
    [67, 0, 71, 0, 76, 0, 0, 0, 71, 0, 67, 0, 64, 0, 0, 0],   // Em7
    [69, 0, 72, 0, 76, 0, 0, 0, 81, 0, 0, 0, 79, 0, 76, 0],   // Am7
    [77, 0, 76, 0, 72, 0, 69, 0, 65, 0, 69, 0, 72, 0, 0, 0],   // Fmaj7
    [74, 0, 77, 0, 81, 0, 0, 0, 77, 0, 74, 0, 69, 0, 0, 0],   // Dm7
    [76, 0, 80, 0, 83, 0, 0, 0, 80, 0, 76, 0, 74, 0, 71, 0],   // E7
    [76, 0, 0, 0, 71, 0, 0, 0, 74, 0, 0, 0, 76, 0, 0, 0],   // E7
  ],
  chordsA: [
    [57, 60, 64, 67], [53, 57, 60, 64], [48, 52, 55, 59], [55, 59, 62, 64],
    [57, 60, 64, 67], [53, 57, 60, 64], [50, 53, 57, 60], [52, 56, 59, 62],
  ],
  chordsB: [
    [53, 57, 60, 64], [55, 59, 62, 64], [52, 55, 59, 62], [57, 60, 64, 67],
    [53, 57, 60, 64], [50, 53, 57, 60], [52, 56, 59, 62], [52, 56, 59, 62],
  ],

  startMusic() {
    this.init();
    if (!this.ctx || this.musicTimer || this.mutedMusic) return;
    this.step = 0;
    this.nextTime = this.ctx.currentTime + 0.12;
    const spb = 60 / this.tempo / 4; // 16 分音符
    const tick = () => {
      if (!this.ctx) return;
      const now = this.ctx.currentTime;
      while (this.nextTime < now + 0.28) {
        this.scheduleStep(this.step, this.nextTime, spb);
        this.step = (this.step + 1) % 256;      // A/B 两段 × 8 小节 × 16 槽
        this.nextTime += spb;
      }
    };
    tick();
    this.musicTimer = setInterval(tick, 60);
  },
  stopMusic() {
    if (this.musicTimer) { clearInterval(this.musicTimer); this.musicTimer = null; }
  },

  /* ---- 八音盒音色：正弦基音 + 一个非谐分音 ----
     2.76 倍频不是随便取的，这是金属棒/音叉类振动的典型非谐比，
     出来的就是"盒子里那根齿"的味道；分音衰减比基音快得多，
     所以听感是"叮"的一下然后留下干净的基音。 */
  boxNote(freq, t, dur, vol, echo) {
    const ctx = this.ctx;
    if (!ctx) return;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    g.connect(this.musicGain);
    if (echo && this.musicSend) g.connect(this.musicSend);

    const o1 = ctx.createOscillator();
    o1.type = 'sine';
    o1.frequency.setValueAtTime(freq, t);
    o1.connect(g);

    const o2 = ctx.createOscillator();
    o2.type = 'sine';
    o2.frequency.setValueAtTime(freq * 2.76, t);
    const g2 = ctx.createGain();
    g2.gain.setValueAtTime(0.0001, t);
    g2.gain.linearRampToValueAtTime(vol * 0.30, t + 0.002);
    g2.gain.exponentialRampToValueAtTime(0.0001, t + dur * 0.35);
    o2.connect(g2); g2.connect(g);

    o1.start(t); o2.start(t);
    o1.stop(t + dur + 0.02); o2.stop(t + dur + 0.02);
  },

  /* 贝斯：三角波过低通，闷、不抢戏 */
  bassNote(freq, t, dur, vol) {
    const ctx = this.ctx;
    if (!ctx) return;
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(freq, t);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.setValueAtTime(420, t);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(f); f.connect(g); g.connect(this.musicGain);
    o.start(t); o.stop(t + dur + 0.02);
  },

  /* 和弦垫：很轻的一层三角波，把和声铺住，别让它空 */
  padNote(freq, t, dur, vol) {
    const ctx = this.ctx;
    if (!ctx) return;
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(freq, t);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.setValueAtTime(1400, t);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.06);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(f); f.connect(g); g.connect(this.musicGain);
    o.start(t); o.stop(t + dur + 0.02);
  },

  /* 机械节拍：一下很轻的木质"嗒"，像盒子里齿轮咬合的声音。
     比电子底鼓轻得多——八音盒不该有鼓。 */
  tick(t, vol) {
    const ctx = this.ctx;
    if (!ctx || !this.noiseBuf) return;
    const s = ctx.createBufferSource();
    s.buffer = this.noiseBuf;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 2200;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 6500;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.035);
    s.connect(hp); hp.connect(lp); lp.connect(g); g.connect(this.musicGain);
    s.start(t); s.stop(t + 0.05);
  },

  scheduleStep(step, t, spb) {
    const bar = Math.floor(step / 16);          // 0..15，8 小节一段
    const bi = bar % 8;                         // 段内小节号
    const A = bar < 8;
    const slot = step % 16;
    const chord = (A ? this.chordsA : this.chordsB)[bi];
    const mel = (A ? this.melA : this.melB)[bi];

    /* 旋律：留白多、回声开着，是"拨片一下一下拨过去"的感觉 */
    const n = mel[slot];
    if (n) this.boxNote(this.midiFreq(n), t, spb * 5.5, 0.26, true);

    /* 贝斯：小节头一下实的，第 9 槽一下轻的 */
    if (slot === 0) this.bassNote(this.midiFreq(chord[0] - 12), t, spb * 7, 0.30);
    else if (slot === 8) this.bassNote(this.midiFreq(chord[0] - 12), t, spb * 5, 0.19);

    /* 和弦垫：小节头铺一层 */
    if (slot === 0) {
      for (let i = 1; i < chord.length; i++) this.padNote(this.midiFreq(chord[i]), t, spb * 15, 0.05);
    }

    /* 反拍上补一个很轻的和弦音，八音盒的"拨片感"主要来自这里 */
    if (slot === 6 || slot === 14) {
      const cn = chord[slot === 6 ? 1 : 2] + 12;
      this.boxNote(this.midiFreq(cn), t, spb * 3, 0.065, true);
    }

    /* 机械节拍：四分音符一下 */
    if (slot % 4 === 0) this.tick(t, slot === 0 ? 0.085 : 0.045);
  },
};
