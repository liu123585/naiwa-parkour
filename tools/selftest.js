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
    UI.buyChar(paid.id);
    if (Store.data.chars.indexOf(paid.id) < 0) {
      throw new Error('buy failed :: id=' + paid.id + ' before=' + before + ' after=' + Store.data.chars.join('|') +
        ' coins=' + Store.data.coins + ' price=' + paid.price);
    }
    if (Store.data.char !== paid.id) throw new Error('equip failed');
    UI.buySkill('magnet'); UI.buySkill('magnet');
    if (Store.data.skills.magnet !== 2) throw new Error('skill failed');
    CHARS.forEach(function (c) { UI.buyChar(c.id); });
    if (Store.data.chars.length !== CHARS.length) throw new Error('all unlock failed: ' + Store.data.chars.length);
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
        frequency: null, gain: null, Q: null, detune: null,
        type: 'sine', buffer: null, loop: false,
        setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {},
      };
      node.frequency = node; node.gain = node; node.Q = node; node.detune = node;
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
      this.createBuffer = function (ch, len, rate) { return { getChannelData: function () { return new Float32Array(Math.min(64, len)); } }; };
    };
    Sound.ctx = null; Sound.musicTimer = null;
    Sound.resume();
    if (!Sound.ctx) throw new Error('AudioContext 未初始化');
    Sound.setSfx(true); Sound.setMusic(true);
    Sound.coin(3); Sound.jump(); Sound.land(); Sound.roll(); Sound.whoosh(); Sound.power();
    Sound.board(); Sound.boardBreak(); Sound.crash(); Sound.laugh(); Sound.ui(); Sound.deny();
    Sound.buy(); Sound.mission(); Sound.countdown(true); Sound.revive();
    for (let s = 0; s < 128; s++) Sound.scheduleStep(s, s * 0.1, 0.1);
    Sound.stopMusic();
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
