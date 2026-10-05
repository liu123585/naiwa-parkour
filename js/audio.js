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

    /* 换曲用的总线：所有音符先汇到这里，再进 musicGain。
       曲目切换时在总线上做一次 0.3 秒的淡出淡入，
       不然上一首的尾音会和下一首的开头撞在一起。 */
    this.musicBus = this.ctx.createGain();
    this.musicBus.gain.value = 1;
    this.musicBus.connect(this.musicGain);

    /* 音乐的延迟（回声）总线。
       八音盒的余韵全靠它——干声拨一下是"哒"，带一点回声才有"盒子里"的空间感。
       延迟时间是附点八分，回授 0.32、湿声 0.30，并且低通到 2.6k，
       免得回声一层层叠上去变成刺耳的高频糊。 */
    this.musicSend = this.ctx.createGain();
    this.musicSend.gain.value = 1;
    this.delay = this.ctx.createDelay(1.0);
    this.delay.delayTime.value = this.slotDur() * 3;   // 附点八分：跟着当前曲目的速度走
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
     背景音乐：一整本「八音盒曲库」
     ---------------------------------------------------------
     原来只有一首 Am-F-C-G 的死循环，跑久了耳朵会麻（反馈原话："BGM 太单调"）。
     现在拆成「曲目表 + 播放列表」两层：

       一首曲子 = { tempo, slots, bars, lead, bass, pad, drums, melA/melB, chordsA/chordsB }
       startMusic() 只负责按槽推进 step，scheduleStep() 按当前曲目发声；
       一首曲子完整跑 formsPerTrack 遍（默认 2 遍）之后自动换下一首，
       换曲点落在 A/B 段的收束小节上，接得住。

     五首曲子各有明确的性格，不是把同一段换个速度：
       toybox  玩具厂夜班  Am 八音盒，慢板叙事 —— 原来的那首，留着当签名曲
       march   发条进行曲  C 大调，快板方波贝斯 + 军鼓，齿轮咬合的劲儿
       waltz   纸箱圆舞曲  3/4 拍 F 大调，slots=12，摇摇晃晃的怀旧感
       tunnel  检修通道    D 小调极慢板，钟琴音色，空旷、发凉
       sprint  冲刺时刻    E 小调急板，锯齿贝斯 + 密集鼓点，冲速度时听

     五首连播约 5 分钟才回到第一首，比原来 34 秒一轮强得多。
     ========================================================= */
  tempo: 112,                       // 兼容旧引用；实际速度以当前曲目为准
  midiFreq(m) { return 440 * Math.pow(2, (m - 69) / 12); },

  /* 主音音色：分音比 / 分音音量 / 衰减倍率。
     2.76 是金属棒的非谐比（八音盒那根齿）；3.47 更接近钟；2.0 就是普通拨弦。 */
  LEADS: {
    box:   { p2: 2.76, p2v: 0.30, p2d: 0.35, dur: 5.5 },
    bell:  { p2: 3.47, p2v: 0.20, p2d: 0.55, dur: 8.0 },
    pluck: { p2: 2.00, p2v: 0.36, p2d: 0.18, dur: 2.6 },
  },

  /* 打击字符：k=闷鼓 s=军鼓 X=实木嗒 x=轻嗒 .=无 */
  DRUM_KINDS: 'ksXx',

  TRACKS: [
    /* ---------- 1. 玩具厂夜班（八音盒，Am） ---------- */
    {
      id: 'toybox', name: '玩具厂夜班', tempo: 112, slots: 16, bars: 16,
      lead: 'box', bass: { type: 'triangle', cut: 420 }, pad: { vol: 0.05, cut: 1400 },
      drums: 'X..x..x.X..x..x.',
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
    },

    /* ---------- 2. 发条进行曲（C 大调，军鼓 + 方波贝斯） ---------- */
    {
      id: 'march', name: '发条进行曲', tempo: 132, slots: 16, bars: 16,
      lead: 'pluck', bass: { type: 'square', cut: 540 }, pad: { vol: 0.042, cut: 1700 },
      drums: 'k..sX..xk..sX..x',
      melA: [
        [72, 0, 72, 0, 76, 0, 76, 0, 79, 0, 0, 0, 76, 0, 72, 0],   // C
        [71, 0, 71, 0, 74, 0, 74, 0, 79, 0, 0, 0, 74, 0, 0, 0],   // G
        [69, 0, 72, 0, 76, 0, 72, 0, 69, 0, 0, 0, 64, 0, 69, 0],   // Am
        [65, 0, 69, 0, 72, 0, 69, 0, 65, 0, 0, 0, 0, 0, 0, 0],   // F
        [72, 0, 72, 0, 76, 0, 76, 0, 79, 0, 0, 0, 81, 0, 79, 0],   // C
        [78, 0, 74, 0, 71, 0, 74, 0, 79, 0, 0, 0, 74, 0, 0, 0],   // G
        [76, 0, 72, 0, 69, 0, 72, 0, 76, 0, 0, 0, 81, 0, 0, 0],   // Am
        [77, 0, 76, 0, 72, 0, 69, 0, 65, 0, 0, 0, 0, 0, 0, 0],   // F
      ],
      melB: [
        [69, 0, 72, 0, 77, 0, 0, 0, 76, 0, 72, 0, 69, 0, 0, 0],   // F
        [72, 0, 76, 0, 79, 0, 0, 0, 76, 0, 72, 0, 67, 0, 0, 0],   // C
        [74, 0, 71, 0, 67, 0, 71, 0, 74, 0, 0, 0, 79, 0, 0, 0],   // G
        [76, 0, 72, 0, 69, 0, 72, 0, 76, 0, 0, 0, 81, 0, 0, 0],   // Am
        [77, 0, 76, 0, 72, 0, 69, 0, 65, 0, 69, 0, 72, 0, 0, 0],   // F
        [74, 0, 77, 0, 81, 0, 0, 0, 77, 0, 74, 0, 69, 0, 0, 0],   // Dm
        [79, 0, 76, 0, 74, 0, 71, 0, 74, 0, 0, 0, 79, 0, 0, 0],   // G
        [76, 0, 74, 0, 71, 0, 67, 0, 71, 0, 0, 0, 0, 0, 0, 0],   // G
      ],
      chordsA: [
        [48, 60, 64, 67], [55, 59, 62, 67], [57, 60, 64, 69], [53, 57, 60, 65],
        [48, 60, 64, 67], [55, 59, 62, 67], [57, 60, 64, 69], [53, 57, 60, 65],
      ],
      chordsB: [
        [53, 57, 60, 65], [48, 60, 64, 67], [55, 59, 62, 67], [57, 60, 64, 69],
        [53, 57, 60, 65], [50, 53, 57, 62], [55, 59, 62, 67], [55, 59, 62, 67],
      ],
    },

    /* ---------- 3. 纸箱圆舞曲（3/4，F 大调，slots=12） ---------- */
    {
      id: 'waltz', name: '纸箱圆舞曲', tempo: 138, slots: 12, bars: 16,
      lead: 'bell', bass: { type: 'triangle', cut: 380 }, pad: { vol: 0.055, cut: 1500 },
      /* 圆舞曲的重音落在第 1 拍：X..x..x..x.. */
      drums: 'X..x..x..x..',
      melA: [
        [72, 0, 0, 0, 69, 0, 0, 0, 65, 0, 0, 0],   // F
        [74, 0, 0, 0, 69, 0, 0, 0, 65, 0, 0, 0],   // Dm
        [70, 0, 0, 0, 67, 0, 0, 0, 62, 0, 0, 0],   // Gm
        [72, 0, 0, 0, 67, 0, 0, 0, 64, 0, 0, 0],   // C
        [72, 0, 0, 0, 77, 0, 0, 0, 81, 0, 0, 0],   // F
        [79, 0, 0, 0, 74, 0, 0, 0, 69, 0, 0, 0],   // Dm
        [74, 0, 0, 0, 70, 0, 0, 0, 65, 0, 0, 0],   // Bb
        [72, 0, 0, 0, 71, 0, 0, 0, 67, 0, 0, 0],   // C
      ],
      melB: [
        [69, 0, 0, 0, 74, 0, 0, 0, 77, 0, 0, 0],   // Dm
        [76, 0, 0, 0, 72, 0, 0, 0, 69, 0, 0, 0],   // Am
        [74, 0, 0, 0, 70, 0, 0, 0, 77, 0, 0, 0],   // Bb
        [72, 0, 0, 0, 69, 0, 0, 0, 65, 0, 0, 0],   // F
        [67, 0, 0, 0, 70, 0, 0, 0, 74, 0, 0, 0],   // Gm
        [76, 0, 0, 0, 72, 0, 0, 0, 67, 0, 0, 0],   // C
        [72, 0, 0, 0, 77, 0, 0, 0, 81, 0, 0, 0],   // F
        [79, 0, 0, 0, 76, 0, 0, 0, 71, 0, 0, 0],   // C
      ],
      chordsA: [
        [53, 57, 60, 65], [50, 53, 57, 62], [55, 58, 62, 67], [48, 55, 60, 64],
        [53, 57, 60, 65], [50, 53, 57, 62], [58, 62, 65, 70], [48, 55, 60, 64],
      ],
      chordsB: [
        [50, 53, 57, 62], [57, 60, 64, 69], [58, 62, 65, 70], [53, 57, 60, 65],
        [55, 58, 62, 67], [48, 55, 60, 64], [53, 57, 60, 65], [48, 55, 60, 64],
      ],
    },

    /* ---------- 4. 检修通道（D 小调极慢板，钟琴） ---------- */
    {
      id: 'tunnel', name: '检修通道', tempo: 84, slots: 16, bars: 16,
      lead: 'bell', bass: { type: 'sine', cut: 300 }, pad: { vol: 0.062, cut: 1100 },
      drums: 'X.......x.......',
      melA: [
        [74, 0, 0, 0, 0, 0, 0, 0, 72, 0, 0, 0, 69, 0, 0, 0],   // Dm
        [70, 0, 0, 0, 0, 0, 0, 0, 69, 0, 0, 0, 65, 0, 0, 0],   // Bb
        [67, 0, 0, 0, 0, 0, 0, 0, 62, 0, 0, 0, 67, 0, 0, 0],   // Gm
        [69, 0, 0, 0, 0, 0, 0, 0, 73, 0, 0, 0, 76, 0, 0, 0],   // A
        [74, 0, 0, 0, 0, 0, 0, 0, 77, 0, 0, 0, 81, 0, 0, 0],   // Dm
        [79, 0, 0, 0, 0, 0, 0, 0, 74, 0, 0, 0, 70, 0, 0, 0],   // Bb
        [72, 0, 0, 0, 0, 0, 0, 0, 76, 0, 0, 0, 79, 0, 0, 0],   // C
        [77, 0, 0, 0, 0, 0, 0, 0, 73, 0, 0, 0, 69, 0, 0, 0],   // A
      ],
      melB: [
        [70, 0, 0, 0, 0, 0, 0, 0, 74, 0, 0, 0, 77, 0, 0, 0],   // Bb
        [75, 0, 0, 0, 0, 0, 0, 0, 70, 0, 0, 0, 67, 0, 0, 0],   // Gm
        [69, 0, 0, 0, 0, 0, 0, 0, 73, 0, 0, 0, 76, 0, 0, 0],   // A
        [74, 0, 0, 0, 0, 0, 0, 0, 72, 0, 0, 0, 69, 0, 0, 0],   // Dm
        [65, 0, 0, 0, 0, 0, 0, 0, 70, 0, 0, 0, 74, 0, 0, 0],   // Bb
        [72, 0, 0, 0, 0, 0, 0, 0, 71, 0, 0, 0, 67, 0, 0, 0],   // C
        [69, 0, 0, 0, 0, 0, 0, 0, 73, 0, 0, 0, 76, 0, 0, 0],   // A
        [81, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],   // A
      ],
      chordsA: [
        [50, 53, 57, 62], [58, 62, 65, 70], [55, 58, 62, 67], [57, 61, 64, 69],
        [50, 53, 57, 62], [58, 62, 65, 70], [48, 55, 60, 64], [57, 61, 64, 69],
      ],
      chordsB: [
        [58, 62, 65, 70], [55, 58, 62, 67], [57, 61, 64, 69], [50, 53, 57, 62],
        [58, 62, 65, 70], [48, 55, 60, 64], [57, 61, 64, 69], [57, 61, 64, 69],
      ],
    },

    /* ---------- 5. 冲刺时刻（E 小调急板，锯齿贝斯） ---------- */
    {
      id: 'sprint', name: '冲刺时刻', tempo: 152, slots: 16, bars: 16,
      lead: 'pluck', bass: { type: 'sawtooth', cut: 640 }, pad: { vol: 0.038, cut: 1900 },
      drums: 'k.sxk.sxk.sxx.sx',
      melA: [
        [76, 0, 76, 0, 79, 0, 76, 0, 71, 0, 0, 0, 76, 0, 0, 0],   // Em
        [72, 0, 76, 0, 79, 0, 76, 0, 72, 0, 0, 0, 76, 0, 0, 0],   // C
        [74, 0, 79, 0, 83, 0, 79, 0, 74, 0, 0, 0, 79, 0, 0, 0],   // G
        [78, 0, 74, 0, 69, 0, 74, 0, 78, 0, 0, 0, 81, 0, 0, 0],   // D
        [76, 0, 79, 0, 83, 0, 79, 0, 88, 0, 0, 0, 83, 0, 0, 0],   // Em
        [84, 0, 79, 0, 76, 0, 72, 0, 76, 0, 0, 0, 79, 0, 0, 0],   // C
        [81, 0, 76, 0, 72, 0, 76, 0, 81, 0, 0, 0, 84, 0, 0, 0],   // Am
        [83, 0, 79, 0, 76, 0, 71, 0, 74, 0, 0, 0, 71, 0, 0, 0],   // B
      ],
      melB: [
        [72, 0, 76, 0, 79, 0, 0, 0, 76, 0, 79, 0, 84, 0, 0, 0],   // C
        [81, 0, 78, 0, 74, 0, 0, 0, 78, 0, 81, 0, 86, 0, 0, 0],   // D
        [83, 0, 79, 0, 76, 0, 79, 0, 83, 0, 0, 0, 88, 0, 0, 0],   // Em
        [86, 0, 83, 0, 79, 0, 76, 0, 79, 0, 0, 0, 83, 0, 0, 0],   // Em
        [84, 0, 81, 0, 76, 0, 72, 0, 76, 0, 0, 0, 79, 0, 0, 0],   // C
        [81, 0, 84, 0, 88, 0, 0, 0, 84, 0, 81, 0, 76, 0, 0, 0],   // Am
        [83, 0, 86, 0, 90, 0, 0, 0, 86, 0, 83, 0, 79, 0, 0, 0],   // B
        [83, 0, 79, 0, 74, 0, 71, 0, 74, 0, 0, 0, 0, 0, 0, 0],   // B
      ],
      chordsA: [
        [52, 59, 64, 67], [48, 60, 64, 67], [55, 59, 62, 67], [50, 57, 62, 66],
        [52, 59, 64, 67], [48, 60, 64, 67], [57, 60, 64, 69], [59, 62, 66, 71],
      ],
      chordsB: [
        [48, 60, 64, 67], [50, 57, 62, 66], [52, 59, 64, 67], [52, 59, 64, 67],
        [48, 60, 64, 67], [57, 60, 64, 69], [59, 62, 66, 71], [59, 62, 66, 71],
      ],
    },
  ],

  /* 播放列表状态 */
  trackIdx: 0,
  bgmAuto: true,          // 自动轮播；玩家点"换一首"会立刻跳并重新计数
  formsPerTrack: 2,       // 一首曲子完整跑两遍再换
  formsPlayed: 0,

  trackDef() { return this.TRACKS[this.trackIdx] || this.TRACKS[0]; },
  trackName() { return this.trackDef().name; },
  /* 一个十六分槽有多长（秒）—— 所有时长都按它换算，换曲速度才跟得上 */
  slotDur() { return 60 / this.trackDef().tempo / 4; },

  /* 切到下一首。at 给了就顺带排一次淡出淡入；手动切换时 at 传 undefined，
     走"立刻换 + 当前 bus 不动"的路子。 */
  nextTrack(at) {
    if (this.TRACKS.length < 2) return;
    this.trackIdx = (this.trackIdx + 1) % this.TRACKS.length;
    this.formsPlayed = 0;
    if (this.delay) this.delay.delayTime.value = this.slotDur() * 3;
    if (at != null && this.musicBus) {
      const g = this.musicBus.gain;
      /* 换曲点可能只提前了十几毫秒被排到（tick 每 60ms 跑一次、只看前 280ms），
         所以淡出窗口要按"距离换曲点还剩多久"夹一下，
         否则会变成一次瞬切，耳机里就是"啪"的一声。 */
      const lead = Math.max(0.02, Math.min(0.30, at - (this.ctx ? this.ctx.currentTime : at)));
      try {
        g.cancelScheduledValues(at - lead);
        g.setValueAtTime(1, at - lead);
        g.linearRampToValueAtTime(0.0001, at);
        g.setValueAtTime(0.0001, at + 0.02);
        g.linearRampToValueAtTime(1, at + 0.34);
      } catch (e) { /* 老浏览器不支持链式自动化就跳过淡入淡出 */ }
    }
    return this.trackDef();
  },
  setTrack(i) {
    if (!this.TRACKS.length) return;
    this.trackIdx = ((i | 0) % this.TRACKS.length + this.TRACKS.length) % this.TRACKS.length;
    this.formsPlayed = 0;
    if (this.delay) this.delay.delayTime.value = this.slotDur() * 3;
  },

  /* 兼容旧引用：melA/melB/chordsA/chordsB 现在指向"当前曲目"的段落 */
  get melA() { return this.trackDef().melA; },
  get melB() { return this.trackDef().melB; },
  get chordsA() { return this.trackDef().chordsA; },
  get chordsB() { return this.trackDef().chordsB; },

  startMusic() {
    this.init();
    if (!this.ctx || this.musicTimer || this.mutedMusic) return;
    this.step = 0;
    this.formsPlayed = 0;
    if (this.musicBus) this.musicBus.gain.value = 1;
    if (this.delay) this.delay.delayTime.value = this.slotDur() * 3;
    this.nextTime = this.ctx.currentTime + 0.12;
    const tick = () => {
      if (!this.ctx) return;
      const now = this.ctx.currentTime;
      let guard = 0;
      while (this.nextTime < now + 0.28 && guard++ < 64) {
        const formSlots = this.trackDef().slots * this.trackDef().bars;
        const spb = this.slotDur();
        this.scheduleStep(this.step, this.nextTime);
        this.step++;
        /* 先把时钟推到下一个槽，再判断要不要换曲 ——
           换曲点就是下一个槽的时间，淡出淡入正好卡在小节线上。 */
        const boundary = this.nextTime + spb;
        this.nextTime = boundary;
        if (this.step >= formSlots) {
          this.step = 0;
          this.formsPlayed++;
          /* 一首曲子播够 formsPerTrack 遍，就在这个小节线上换下一首 */
          if (this.bgmAuto && this.formsPlayed >= this.formsPerTrack) this.nextTrack(boundary);
        }
      }
    };
    tick();
    this.musicTimer = setInterval(tick, 60);
  },
  stopMusic() {
    if (this.musicTimer) { clearInterval(this.musicTimer); this.musicTimer = null; }
    /* 停的时候把总线拉回 1，免得正好卡在淡出中间，下次开起来是哑的 */
    if (this.musicBus) { try { this.musicBus.gain.cancelScheduledValues(0); } catch (e) { /* 忽略 */ } this.musicBus.gain.value = 1; }
  },

  /* ---- 主音：基音 + 一个非谐分音 ----
     分音比、分音音量、衰减快慢都由曲目选的音色决定（见 LEADS）。 */
  leadNote(freq, t, dur, vol, echo) {
    const ctx = this.ctx;
    if (!ctx) return;
    const L = this.LEADS[this.trackDef().lead] || this.LEADS.box;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    g.connect(this.musicBus || this.musicGain);
    if (echo && this.musicSend) g.connect(this.musicSend);

    const o1 = ctx.createOscillator();
    o1.type = 'sine';
    o1.frequency.setValueAtTime(freq, t);
    o1.connect(g);

    const o2 = ctx.createOscillator();
    o2.type = 'sine';
    o2.frequency.setValueAtTime(freq * L.p2, t);
    const g2 = ctx.createGain();
    g2.gain.setValueAtTime(0.0001, t);
    g2.gain.linearRampToValueAtTime(vol * L.p2v, t + 0.002);
    g2.gain.exponentialRampToValueAtTime(0.0001, t + dur * L.p2d);
    o2.connect(g2); g2.connect(g);

    o1.start(t); o2.start(t);
    o1.stop(t + dur + 0.02); o2.stop(t + dur + 0.02);
  },
  /* 旧名字，外部可能还有引用 */
  boxNote(freq, t, dur, vol, echo) { return this.leadNote(freq, t, dur, vol, echo); },

  /* 贝斯：波形和低通截止由曲目决定 —— 慢板要闷，急板要有齿 */
  bassNote(freq, t, dur, vol, type, cut) {
    const ctx = this.ctx;
    if (!ctx) return;
    const B = this.trackDef().bass || { type: 'triangle', cut: 420 };
    const o = ctx.createOscillator();
    o.type = type || B.type || 'triangle';
    o.frequency.setValueAtTime(freq, t);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.setValueAtTime(cut || B.cut || 420, t);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(f); f.connect(g); g.connect(this.musicBus || this.musicGain);
    o.start(t); o.stop(t + dur + 0.02);
  },

  /* 和弦垫：很轻的一层三角波，把和声铺住，别让它空 */
  padNote(freq, t, dur, vol, cut) {
    const ctx = this.ctx;
    if (!ctx) return;
    const P = this.trackDef().pad || { vol: 0.05, cut: 1400 };
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(freq, t);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.setValueAtTime(cut || P.cut || 1400, t);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.06);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(f); f.connect(g); g.connect(this.musicBus || this.musicGain);
    o.start(t); o.stop(t + dur + 0.02);
  },

  /* 打击：四种木头味。k 是有音高的闷鼓（正弦下滑），其余是滤波噪声。
     不用电子鼓——"手工玩具厂"里不该有 808。 */
  percHit(t, kind, vol) {
    const ctx = this.ctx;
    if (!ctx || !this.noiseBuf || !kind || kind === '.') return;
    if (kind === 'k') {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(118, t);
      o.frequency.exponentialRampToValueAtTime(52, t + 0.09);
      const g = ctx.createGain();
      g.gain.setValueAtTime(vol * 1.15, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.11);
      o.connect(g); g.connect(this.musicBus || this.musicGain);
      o.start(t); o.stop(t + 0.13);
      return;
    }
    const s = ctx.createBufferSource();
    s.buffer = this.noiseBuf;
    const hp = ctx.createBiquadFilter();
    const lp = ctx.createBiquadFilter();
    let dur = 0.035, v = vol;
    if (kind === 'X') { hp.type = 'highpass'; hp.frequency.value = 1700; lp.type = 'lowpass'; lp.frequency.value = 6200; }
    else if (kind === 's') { hp.type = 'highpass'; hp.frequency.value = 1100; lp.type = 'lowpass'; lp.frequency.value = 5200; dur = 0.075; v = vol * 1.2; }
    else { hp.type = 'highpass'; hp.frequency.value = 2900; lp.type = 'lowpass'; lp.frequency.value = 7600; v = vol * 0.55; }
    const g = ctx.createGain();
    g.gain.setValueAtTime(v, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(hp); hp.connect(lp); lp.connect(g); g.connect(this.musicBus || this.musicGain);
    s.start(t); s.stop(t + dur + 0.02);
  },
  /* 旧名字，外部可能还有引用 */
  tick(t, vol) { this.percHit(t, 'x', vol); },

  scheduleStep(step, t) {
    const T = this.trackDef();
    const formSlots = T.slots * T.bars;
    const spb = this.slotDur();
    const fs = step % formSlots;
    const bar = Math.floor(fs / T.slots);
    const slot = fs % T.slots;
    const half = T.bars / 2;
    const A = bar < half;
    const chord = (A ? T.chordsA : T.chordsB)[bar % half];
    const mel = (A ? T.melA : T.melB)[bar % half];
    const lead = this.LEADS[T.lead] || this.LEADS.box;
    const beat = slot % (T.slots / 4);              // 3/4 拍时每拍 4 槽，同样成立

    /* 旋律：留白多、回声开着，是"拨片一下一下拨过去"的感觉 */
    const n = mel[slot];
    if (n) this.leadNote(this.midiFreq(n), t, spb * lead.dur, 0.26, true);

    /* 贝斯：小节头一下实的，中间一下轻的 */
    const mid = T.slots / 2;
    if (slot === 0) this.bassNote(this.midiFreq(chord[0] - 12), t, spb * (mid - 1), 0.30);
    else if (slot === mid) this.bassNote(this.midiFreq(chord[0] - 12), t, spb * (mid - 3), 0.19);

    /* 和弦垫：小节头铺一层 */
    if (slot === 0) {
      const pv = (T.pad && T.pad.vol) || 0.05;
      for (let i = 1; i < chord.length; i++) this.padNote(this.midiFreq(chord[i]), t, spb * (T.slots - 1), pv);
    }

    /* 反拍上补一个很轻的和弦音，八音盒的"拨片感"主要来自这里 */
    if (slot === 6 || slot === 14) {
      const cn = chord[slot === 6 ? 1 : 2] + 12;
      this.leadNote(this.midiFreq(cn), t, spb * 3, 0.065, true);
    }

    /* 打击：每首曲子一张 16（或 12）槽的谱子 */
    const drum = T.drums || '';
    const ch = drum.charAt(slot);
    if (ch && ch !== '.') this.percHit(t, ch, ch === 'X' ? 0.085 : ch === 's' ? 0.07 : 0.045);
  },
};
