/* =========================================================
   捏捏跑酷 · headless 自测脚本（node tools/selftest.js）
   用 mock 的 canvas / DOM / localStorage 跑完整游戏循环，
   用于在没有浏览器的环境下发现运行时错误与逻辑异常。
   ========================================================= */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
/* 加载顺序与 index.html 保持一致（不含 vendor/three.min.js：
   无头环境没有 WebGL，游戏会自动走 Canvas 2D 回退路径） */
const FILES = ['js/config.js', 'js/audio.js', 'js/world.js', 'js/artwork.js', 'js/chars.js', 'js/draw.js',
  'js/pinchchars.js', 'js/pinch3d.js', 'js/ui.js', 'js/panels.js', 'js/game.js'];

/* ---------------- mock 2D 上下文 ---------------- */
let ops = 0;
const grad = () => ({ addColorStop() {} });
const ctx = new Proxy({
  canvas: { width: 1280, height: 720 },
  measureText: () => ({ width: 20 }),
  createLinearGradient: grad, createRadialGradient: grad, createPattern: () => ({}),
  getImageData: () => ({ data: new Uint8ClampedArray(4) }),
}, {
  get(t, k) {
    if (k in t) return t[k];
    // 检测非法数值参数（浏览器里会静默不画，必须及早暴露）
    const fn = (...a) => {
      ops++;
      for (const v of a) {
        if (typeof v === 'number' && !isFinite(v)) {
          throw new Error('绘制参数非法 (' + String(k) + '): ' + a.map(x => typeof x === 'number' ? x : typeof x).join(','));
        }
      }
      return undefined;
    };
    return fn;
  },
  set(t, k, v) { t[k] = v; return true; },
});

/* ---------------- mock DOM ---------------- */
function makeEl(tag) {
  const classes = new Set();
  const el = {
    tagName: tag, style: {}, dataset: {}, children: [], _html: '', _text: '',
    clientWidth: 120, clientHeight: 118, offsetWidth: 120, width: 0, height: 0,
    classList: {
      add: (...c) => c.forEach(x => classes.add(x)),
      remove: (...c) => c.forEach(x => classes.delete(x)),
      contains: (c) => classes.has(c),
      toggle: (c, f) => { const on = f === undefined ? !classes.has(c) : !!f; on ? classes.add(c) : classes.delete(c); return on; },
    },
    addEventListener() {}, removeEventListener() {},
    appendChild(c) { this.children.push(c); return c; },
    querySelector() { return makeEl('div'); },
    querySelectorAll() { return []; },
    closest() { return null; },
    getContext() { return ctx; },
    getBoundingClientRect() { return { left: 0, top: 0, width: 120, height: 118 }; },
    set innerHTML(v) { this._html = String(v); },
    get innerHTML() { return this._html; },
    set textContent(v) { this._text = String(v); },
    get textContent() { return this._text; },
  };
  return el;
}
const els = {};
const documentMock = {
  readyState: 'complete', hidden: false,
  getElementById(id) { return els[id] || (els[id] = makeEl('div')); },
  createElement(tag) { return makeEl(tag); },
  querySelector(sel) { return els['q:' + sel] || (els['q:' + sel] = makeEl('div')); },
  querySelectorAll() { return []; },
  addEventListener() {}, removeEventListener() {}, body: makeEl('body'),
};

const store = new Map();
const localStorageMock = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

let rafCount = 0;
let rafQueue = [];
const sandbox = {
  console,
  document: documentMock,
  localStorage: localStorageMock,
  navigator: { userAgent: 'selftest', maxTouchPoints: 0 },
  performance: { now: () => Date.now() },
  requestAnimationFrame: (cb) => { rafQueue.push(cb); return ++rafCount; },
  cancelAnimationFrame: () => {},
  setTimeout, clearTimeout, setInterval, clearInterval,
  confirm: () => true,
  alert: () => {},
  devicePixelRatio: 2,
  innerWidth: 1280, innerHeight: 720,
  addEventListener() {}, removeEventListener() {},
  Math, JSON, Date, Object, Array, String, Number, Boolean, Error, Set, Map, isNaN, parseInt, parseFloat, Uint8ClampedArray,
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
sandbox.self = sandbox;
const context = vm.createContext(sandbox);

/* ---------------- 载入游戏代码 ---------------- */
for (const f of FILES) {
  const code = fs.readFileSync(path.join(ROOT, f), 'utf8');
  vm.runInContext(code, context, { filename: f });
}

/* ---------------- 测试主体 ---------------- */
const test = `
(function () {
  const report = { errors: [], notes: [] };
  function T(name, fn) {
    try { fn(); report.notes.push('  PASS  ' + name); }
    catch (e) { report.errors.push(name + ' -> ' + (e && e.stack ? e.stack.split('\\n').slice(0,3).join(' | ') : e)); }
  }
  const G = Game;

  T('init', function () {
    G.init(document.getElementById('gl'));
    if (G.state !== 'menu') throw new Error('state=' + G.state);
  });

  T('menu render', function () {
    for (let i = 0; i < 30; i++) { G.loop(i * 16.7); UI.animateMenu(i * 0.016); }
  });

  // 全部角色：缩略图 + 实战渲染（直接调用，暴露被 try/catch 吞掉的错误）
  T('all skins draw', function () {
    const t0 = performance.now();
    const errs = [];
    const skins = Object.keys(CHARDRAW);
    skins.forEach(function (skin) {
      const cv = document.createElement('canvas');
      cv.clientWidth = 120; cv.clientHeight = 118;
      const ctx2 = cv.getContext('2d');
      ['idle', 'run', 'jump', 'fall', 'roll', 'fly', 'crash'].forEach(function (st) {
        const pose = { state: st, t: 0.3, lean: 0.4, squash: 0.3, front: st === 'idle' || st === 'crash' };
        try {
          CHARDRAW[skin](ctx2, pose);
          if (st === 'idle') CHARDRAW[skin](ctx2, Object.assign({}, pose, { front: false }));
        } catch (e) { errs.push(skin + '/' + st + ': ' + e.message); }
      });
      try { CharArtAPI.thumb(cv, skin, 1.2); } catch (e) { errs.push(skin + '/thumb: ' + e.message); }
    });
    report.notes.push('  note  全部角色绘制耗时 ' + (performance.now() - t0).toFixed(1) + 'ms，角色数 ' + skins.length);
    if (errs.length) throw new Error(errs.slice(0, 6).join(' || '));
  });

  // 面板
  T('panels', function () {
    UI._tab = 'chars'; UI.buildChars();
    UI._tab = 'skills'; UI.buildChars();
    UI._mtab = 'daily'; UI.buildMissions();
    UI._mtab = 'ach'; UI.buildMissions();
    UI._mtab = 'log'; UI.buildMissions();
    UI.buildSettings();
    UI.openPanel('chars'); UI.openPanel('missions'); UI.openPanel('settings');
  });

  // 商店逻辑
  T('shop buy', function () {
    Store.data.coins = 999999;
    const paid = CHARS.filter(c => c.price > 0)[0] || CHARS[0];
    const before = Store.data.chars.join('|');
    const coins0 = Store.data.coins;
    /* 防误触改成了"点两下确认"：第一下只该亮提示，绝不能扣钱解锁。
       以前这里用的是原生 confirm()，在 iframe / 微信内置浏览器里会被静默拦截，
       玩家点一下毫无反应 —— 反馈里"皮肤商城买不了"就是这么来的。 */
    UI.buyChar(paid.id);
    if (Store.data.chars.indexOf(paid.id) >= 0) throw new Error('first click must not unlock :: id=' + paid.id);
    if (Store.data.coins !== coins0) throw new Error('first click must not charge :: ' + coins0 + ' -> ' + Store.data.coins);
    UI.buyChar(paid.id);
    if (Store.data.chars.indexOf(paid.id) < 0) {
      throw new Error('buy failed :: id=' + paid.id + ' before=' + before + ' after=' + Store.data.chars.join('|') +
        ' coins=' + Store.data.coins + ' price=' + paid.price);
    }
    if (Store.data.coins !== coins0 - paid.price) throw new Error('charge mismatch :: ' + coins0 + ' -> ' + Store.data.coins);
    if (Store.data.char !== paid.id) throw new Error('equip failed');
    UI.buySkill('magnet'); UI.buySkill('magnet');
    if (Store.data.skills.magnet !== 2) throw new Error('skill failed');
    /* 每个角色都要点两下；第一下只是进入确认态 */
    CHARS.forEach(function (c) { UI.buyChar(c.id); UI.buyChar(c.id); });
    if (Store.data.chars.length !== CHARS.length) throw new Error('all unlock failed: ' + Store.data.chars.length);
  });

  // 一键解锁（破解模式）：一次性把角色/地图/技能/成就/图鉴/挑战/装扮全开
  T('unlock everything', function () {
    const d = Store.unlockEverything();
    if (d.chars.length !== CHARS.length) throw new Error('chars ' + d.chars.length + '/' + CHARS.length);
    if (d.coins < 999999) throw new Error('coins ' + d.coins);
    if (typeof MAPS !== 'undefined' && d.mapsUnlocked.length !== MAPS.length) {
      throw new Error('maps ' + d.mapsUnlocked.length + '/' + MAPS.length);
    }
    SKILLS.forEach(function (s) {
      if ((d.skills[s.id] || 0) !== s.max) throw new Error('skill ' + s.id + ' = ' + d.skills[s.id]);
    });
    if (d.achClaimed.length !== ACHIEVEMENTS.length) throw new Error('ach ' + d.achClaimed.length + '/' + ACHIEVEMENTS.length);
    if (typeof CODEX !== 'undefined' && d.codexSeen.length !== CODEX.length) {
      throw new Error('codex ' + d.codexSeen.length + '/' + CODEX.length);
    }
    if (typeof CHALLENGES !== 'undefined' && d.challenges.length !== CHALLENGES.length) {
      throw new Error('challenges ' + d.challenges.length + '/' + CHALLENGES.length);
    }
    CHARS.forEach(function (c) {
      if (!d.outfitOwned[c.skin] || !d.outfitOwned[c.skin].length) throw new Error('outfit missing ' + c.skin);
    });
  });

  // 长时间对局 + 随机输入
  let crashes = 0, runs = 0, renders = 0;
  const origCrash = G.crash.bind(G);
  G.crash = function (o) { crashes++; return origCrash(o); };
  const origFinish = G.finishRun.bind(G);
  G.finishRun = function () { runs++; const r = origFinish(); G.restart(); return r; };

  T('long run loop', function () {
    const dt = 1 / 60;
    G.start();
    for (let i = 0; i < 60 * 240; i++) {           // 4 分钟游戏时间
      if (i % 7 === 0) {
        const r = Math.random();
        if (r < 0.22) G.moveLane(-1);
        else if (r < 0.44) G.moveLane(1);
        else if (r < 0.62) G.jump();
        else if (r < 0.78) G.roll();
        else if (r < 0.86) G.useBoard();
        else if (r < 0.9) G.pause(), G.resume();
        else if (r < 0.94) { Store.data.coins += 500; G.revive(); }
      }
      G.loop(i * dt * 1000);
      G.render(); renders++;
      if (G.objs.length > 500) throw new Error('物体堆积 ' + G.objs.length);
      if (G.parts.length > 400) throw new Error('粒子堆积 ' + G.parts.length);
      if (!isFinite(G.travel) || !isFinite(G.score) || !isFinite(G.player.x)) throw new Error('数值异常 NaN');
    }
    report.notes.push('  note  模拟 ' + renders + ' 帧 / 死亡 ' + crashes + ' 次 / 完成 ' + runs + ' 局');
    report.notes.push('  note  最终距离 ' + Math.floor(G.travel) + 'm 分数 ' + Math.floor(G.score) + ' 物体 ' + G.objs.length + ' 粒子 ' + G.parts.length);
  });

  // 智能 bot：验证关卡「有解」——不会出现三车道全封死的情况
  T('smart bot survival', function () {
    const laneOf = (x) => Utils.clamp(Math.round(x / CFG.LANE_W + 1), 0, 2);
    function laneDanger(lane, from, to) {
      let best = null;
      for (const o of Game.objs) {
        if (o.kind === 'coin' || o.kind === 'power') continue;
        if (laneOf(o.x) !== lane) continue;
        if (o.worldZ + (o.len || 0) < from || o.worldZ > to) continue;
        let danger = 2;
        if (o.kind === 'train') danger = o.h > 2.0 ? 3 : 2;
        else if (o.spring) danger = 0;
        else if ((o.y1 || 1) <= 1.1) danger = 1;
        else if ((o.y0 || 0) >= 1.2) danger = 1;
        if (!best || o.worldZ < best.z) best = { z: o.worldZ, danger: danger, o: o };
      }
      return best;
    }
    Game.state = 'run'; Game.reset(); Game.start();
    let maxDist = 0, deaths = 0, frames = 0;
    const origCrash = Game.crash.bind(Game);
    Game.crash = function (o) { deaths++; return origCrash(o); };
    const origFinish = Game.finishRun.bind(Game);
    Game.finishRun = function () {
      maxDist = Math.max(maxDist, Game.travel);
      const r = origFinish();
      Game.restart();
      maxDist = Math.max(maxDist, Game.travel);
      return r;
    };
    const dt = 1 / 60;
    for (let i = 0; i < 60 * 300; i++) {           // 5 分钟
      if (Game.state === 'run' && Game.dying <= 0) {
        const p = Game.player, sp = Math.max(12, Game.speed);
        const cur = laneOf(p.x);
        const near = laneDanger(cur, Game.travel - 1, Game.travel + 34);
        // 危险避让：换到更安全的车道
        if (near && near.danger >= 2) {
          const d = near.z - Game.travel;
          let bestLane = cur, bestScore = -1e9;
          for (let l = 0; l < 3; l++) {
            if (l === cur) continue;
            const info = laneDanger(l, Game.travel, Game.travel + 38);
            let sc = 0;
            if (!info) sc = 60;
            else if (info.danger === 0) sc = 80;
            else if (info.danger === 1) sc = 34 - (info.z - Game.travel) * 0.3;
            else if (info.danger === 2) sc = 8 - (info.z - Game.travel) * 0.4;
            else sc = -40;
            if (sc > bestScore) { bestScore = sc; bestLane = l; }
          }
          if (bestLane !== cur && bestScore > 0 && (cur !== bestLane)) {
            if (d < 40) Game.moveLane(bestLane > cur ? 1 : -1);
          }
        }
        // 跳 / 滑铲
        if (near && near.danger === 1) {
          const d = near.z - Game.travel;
          if (d > 0 && d < sp * 0.42) {
            if ((near.o.y0 || 0) >= 1.2) Game.roll(); else if (p.grounded) Game.jump();
          }
        } else if (near && near.danger === 2 && (near.o.kind === 'train') && near.o.h <= 1.4 && p.grounded) {
          const d = near.z - Game.travel;
          if (d > 0 && d < sp * 0.35) Game.jump();
        }
        if (Game.powers.jet <= 0 && p.grounded && Math.random() < 0.02) Game.roll();
      }
      Game.loop(i * dt * 1000);
      frames++;
    }
    Game.crash = origCrash; Game.finishRun = origFinish;
    report.notes.push('  note  bot 最远 ' + Math.floor(maxDist) + 'm / 死亡 ' + deaths + ' 次 / ' + frames + ' 帧');
    if (maxDist < 700) throw new Error('关卡可能无解，bot 最远仅 ' + Math.floor(maxDist) + 'm');
  });

  T('missions & achievements', function () {
    const list = Missions.ensure();
    list.forEach(function (m, i) { m.progress = m.target; m.done = true; Missions.claim(i); });
    const n = ACHIEVEMENTS.length;
    const got = Achievements.check(Store.data);
    if (!Array.isArray(got)) throw new Error('achievements check failed');
    report.notes.push('  note  成就已解锁 ' + Store.data.achClaimed.length + '/' + n);
  });

  T('over screen', function () {
    UI.showOver({ score: 12345, coins: 66, dist: 900, best: 20000, isBest: false, mult: 2.5,
      missions: Missions.snapshot(), achievements: [{ name: '测试成就', reward: 100 }],
      canRevive: true, reviveCost: 200 });
    UI.showPause(G);
  });

  T('pause / resume / quit', function () {
    G.start(); G.pause(); G.resume(); G.quitToMenu(); G.start();
    G.state = 'run'; G.crash({ x: 0, y0: 0, y1: 1 });
    for (let i = 0; i < 200; i++) G.loop(i * 16.7);
    if (G.state !== 'over' && G.state !== 'run') throw new Error('state=' + G.state);
  });

  T('renderer resize & quality', function () {
    ['high','mid','low'].forEach(function (q) { Renderer.quality = q; Renderer.resize(); });
    Renderer.dprScale = 0.66; Renderer.fxLow = true; Renderer.resize();
    Renderer.dprScale = 1; Renderer.fxLow = false;
  });

  T('audio (mock AudioContext)', function () {
    let param = null;
    const mkNode = () => {
      const node = {
        connect() {}, disconnect() {}, start() {}, stop() {},
        frequency: null, gain: null, Q: null, detune: null, delayTime: null,
        type: 'sine', buffer: null, loop: false,
        setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {},
        cancelScheduledValues() {}, setTargetAtTime() {},
      };
      node.frequency = node; node.gain = node; node.Q = node; node.detune = node; node.delayTime = node;
      return node;
    };
    window.AudioContext = function () {
      this.currentTime = 0;
      this.sampleRate = 48000;
      this.state = 'running';
      this.destination = mkNode();
      this.resume = function () {};
      this.createGain = mkNode;
      this.createOscillator = mkNode;
      this.createBiquadFilter = mkNode;
      this.createBufferSource = mkNode;
      this.createDelay = mkNode;
      this.createBuffer = function (ch, len, rate) { return { getChannelData: function () { return new Float32Array(Math.min(64, len)); } }; };
    };
    Sound.ctx = null; Sound.musicTimer = null;
    Sound.resume();
    if (!Sound.ctx) throw new Error('AudioContext 未初始化');
    Sound.setSfx(true); Sound.setMusic(true);
    Sound.coin(3); Sound.jump(); Sound.land(); Sound.roll(); Sound.whoosh(); Sound.power();
    Sound.board(); Sound.boardBreak(); Sound.crash(); Sound.laugh(); Sound.ui(); Sound.deny();
    Sound.buy(); Sound.mission(); Sound.countdown(true); Sound.revive();
    /* 每首曲子的每一槽都排一遍，等于把整本曲库过一遍发声代码 */
    for (let ti = 0; ti < Sound.TRACKS.length; ti++) {
      Sound.setTrack(ti);
      const n = Sound.TRACKS[ti].slots * Sound.TRACKS[ti].bars;
      for (let s = 0; s < n; s++) Sound.scheduleStep(s, s * 0.1);
    }
    Sound.setTrack(0);
    Sound.stopMusic();
    Sound.setMusic(false);
  });

  /* 乐谱自检：曲库里的谱子全是手写的，很容易手滑少写一格或写出调外的音。
     这里把结构性错误钉死——每小节的槽数必须和 slots 对齐、A/B 段各占一半小节、
     旋律音落在合理音域内、鼓谱长度对齐、第一首的循环点上必须是 E7 接回 Am7。 */
  T('bgm score', function () {
    const tracks = Sound.TRACKS;
    if (!tracks || tracks.length < 4) throw new Error('曲库不足 4 首：' + (tracks ? tracks.length : 0));
    const seen = {};
    for (const T2 of tracks) {
      const tag = T2.id || '?';
      if (!T2.id) throw new Error('曲目缺 id');
      if (seen[tag]) throw new Error('曲目 id 重复：' + tag);
      seen[tag] = 1;
      if (!T2.name) throw new Error(tag + ' 缺曲名');
      if (!(T2.tempo >= 60 && T2.tempo <= 200)) throw new Error(tag + ' tempo 不合理 ' + T2.tempo);
      const slots = T2.slots, bars = T2.bars;
      if (slots !== 16 && slots !== 12) throw new Error(tag + ' slots 只能是 16 或 12，现在是 ' + slots);
      if (bars % 2 !== 0) throw new Error(tag + ' bars 必须是偶数（A/B 段各一半）');
      if (!Sound.LEADS[T2.lead]) throw new Error(tag + ' 未知主音音色 ' + T2.lead);
      if (!T2.bass || !T2.bass.type) throw new Error(tag + ' 缺贝斯定义');
      if (!T2.pad || !(T2.pad.vol > 0)) throw new Error(tag + ' 缺和弦垫定义');
      const drum = T2.drums || '';
      if (drum.length !== slots) throw new Error(tag + ' 鼓谱长度 ' + drum.length + ' ≠ slots ' + slots);
      for (const c of drum) if ('ksXx.'.indexOf(c) < 0) throw new Error(tag + ' 鼓谱有非法字符 "' + c + '"');

      const secs = [T2.melA, T2.melB];
      const chords = [T2.chordsA, T2.chordsB];
      for (let s = 0; s < 2; s++) {
        if (!secs[s] || secs[s].length !== bars / 2) {
          throw new Error(tag + ' 旋律段 ' + s + ' 小节数 ' + (secs[s] ? secs[s].length : '缺失') + '，应为 ' + bars / 2);
        }
        if (!chords[s] || chords[s].length !== bars / 2) {
          throw new Error(tag + ' 和弦段 ' + s + ' 小节数 ' + (chords[s] ? chords[s].length : '缺失') + '，应为 ' + bars / 2);
        }
        for (let b = 0; b < bars / 2; b++) {
          if (secs[s][b].length !== slots) throw new Error(tag + ' 旋律 ' + s + '/' + b + ' 槽数 ' + secs[s][b].length + ' ≠ ' + slots);
          for (const n of secs[s][b]) {
            if (n === 0) continue;
            if (n < 55 || n > 92) throw new Error(tag + ' 旋律音越界 MIDI ' + n);
          }
          const ch = chords[s][b];
          if (ch.length < 3) throw new Error(tag + ' 和弦 ' + s + '/' + b + ' 音数不足');
          for (const n of ch) if (n < 40 || n > 72) throw new Error(tag + ' 和弦音越界 MIDI ' + n);
        }
      }
      /* 旋律留白率：太满会吵，太空会散 */
      let noteCount = 0, slotN = 0;
      for (const sec of secs) for (const bar of sec) for (const n of bar) { slotN++; if (n) noteCount++; }
      const density = noteCount / slotN;
      if (density < 0.08 || density > 0.42) throw new Error(tag + ' 旋律密度 ' + density.toFixed(2) + ' 不在 0.08~0.42');
    }
    /* 签名曲（第一首）的循环点：B 段最后是 E7（根音 52，含 G#=56），收束回 A 段的 Am7 */
    const t0 = tracks[0];
    if (t0.chordsA[0][0] !== 57) throw new Error('第一首开头不是 Am');
    const lastB = t0.chordsB[t0.bars / 2 - 1];
    if (lastB[0] !== 52 || lastB.indexOf(56) < 0) throw new Error('第一首 B 段结尾不是 E7，循环接不上');
  });

  /* 播放列表：轮播顺序、换曲后计数归零、每首的速度各走各的 */
  T('bgm playlist', function () {
    const n = Sound.TRACKS.length;
    if (n < 4) throw new Error('曲库太少：' + n);
    Sound.setTrack(0);
    const seen = [];
    for (let i = 0; i < n; i++) { seen.push(Sound.trackIdx); Sound.nextTrack(); }
    if (seen[0] !== 0) throw new Error('setTrack(0) 没生效');
    for (let i = 1; i < n; i++) if (seen[i] !== i) throw new Error('轮播顺序乱了：' + seen.join(','));
    if (Sound.trackIdx !== 0) throw new Error('轮了一圈没回到第一首：' + Sound.trackIdx);
    if (Sound.formsPlayed !== 0) throw new Error('换曲后 formsPlayed 没归零');
    if (Sound.nextTrack() === Sound.nextTrack()) throw new Error('连续换两次居然还是同一首');
    /* 槽时长必须跟着各首自己的 tempo 走，不能五首都用同一个速度 */
    const durs = Sound.TRACKS.map((t, i) => { Sound.setTrack(i); return Sound.slotDur(); });
    if (Math.max.apply(null, durs) - Math.min.apply(null, durs) < 0.01) {
      throw new Error('五首曲子的速度几乎一样，那就还是单调：' + durs.map(d => d.toFixed(3)).join('/'));
    }
    Sound.setTrack(0);
  });

  /* BGM 音源回落：这个测试环境里没有 Audio 构造器（也就是"浏览器不支持
     MP3 解码"的情形），选了原声也必须回落到八音盒，绝不能静音。 */
  T('bgm source fallback', function () {
    Sound.setMusic(true);          // 上一个用例结束时把音乐关了，这里先开回来
    Sound.setMusicSrc('file');
    if (Sound.bgmSupported()) throw new Error('测试环境不该支持 MP3');
    if (Sound.activeSrc() !== 'synth') throw new Error('不支持 MP3 时没有回落到 synth');
    if (!Sound.musicTimer) throw new Error('回落后八音盒没在放');
    Sound.setMusicSrc('nonsense');
    if (Sound.musicSrc !== 'synth') throw new Error('非法音源名没有归一到 synth');
    Sound.setMusicSrc('synth');
    if (!Sound.musicTimer) throw new Error('切回 synth 后音乐停了');
    Sound.setMusic(false);
  });

  T('wipe save', function () {
    Store.wipe(); Store.save();
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) throw new Error('save missing');
    Store.load();
    if (Store.data.coins !== 0) throw new Error('wipe failed');
  });

  report.renders = renders;
  report.crashes = crashes;
  report.runs = runs;
  return report;
})();
`;

const result = vm.runInContext(test, context, { filename: 'selftest-body.js' });
console.log('======= 捏捏跑酷 自测报告 =======');
result.notes.forEach(n => console.log(n));
if (result.errors.length) {
  console.log('\n!!! 失败 ' + result.errors.length + ' 项：');
  result.errors.forEach(e => console.log('  FAIL  ' + e));
  process.exitCode = 1;
} else {
  console.log('\n全部通过 ✔  绘制调用 ' + ops + ' 次');
}
