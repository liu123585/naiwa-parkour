/* 碰撞回归测试：直接在页面里驱动 Game.update()，不走渲染。
   重点验三件事：
     1) 高速 / 掉帧下还会不会穿模（旧版 travel±0.42 窗口一定会漏）
     2) 跳跃过栏杆、滑铲过高栏、跳上车顶是否还成立
     3) 不该过的（站着撞栏杆、站着过高栏、侧撞车厢）是否照样撞
   用法: node tools/_collide.js
   用完即删。 */
'use strict';
const { chromium } = require('playwright-core');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

(async () => {
  const browser = await chromium.launch({
    executablePath: EDGE, headless: true,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
      '--disable-gpu-sandbox', '--no-sandbox'],
  });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e && e.message || e)));

  await page.goto('http://localhost:8899/?dev=run&q=low&noperf=1', { waitUntil: 'load', timeout: 30000 });
  await page.waitForTimeout(3500);

  const res = await page.evaluate(() => {
    const LANE = (l) => Utils.laneX(l);

    /* 每个用例都从同一套干净状态起步 */
    function setup(o) {
      const G = Game;
      G.god = false;
      G.state = 'run';
      G.devFreeze = false;
      G.objs.length = 0;
      G.parts.length = 0;
      G.travel = 1000;
      G.speed = o.speed;
      G.elapsed = 0;
      G.intro = 0;
      G.dying = 0;
      G.invuln = 0;
      G.shake = 0;
      G.powers = { magnet: 0, jet: 0, x2: 0, shoe: 0, board: 0, shield: 0 };
      G.chase = { hits: 0, grace: 0, active: false };
      G.chaser = { on: false, dist: 9, mode: 'idle', t: 0 };
      G.diff = { id: 'normal', speedStart: o.speed, speedMax: o.speed, accel: 0, scoreMul: 1, name: 't' };
      G.runStats = { coins: 0, jumps: 0, rolls: 0, roofs: 0, boardDist: 0, magnet: 0, jet: 0, boards: 0, best: 0, near: 0, powers: 0, hits: 0 };
      G.nextZ = 1e9;                 // 关掉生成，场上只有我摆的东西
      G.themeTimer = 1e9;
      G.timeLeft = 0;
      G.nearMissCd = 0; G.coinSndCd = 0;
      const p = G.player;
      p.x = o.px; p.lane = Utils.nearestLane(o.px);
      p.y = 0; p.vy = 0; p.rollT = 0; p.grounded = true; p.state = 'run'; p.boardT = 0; p.supportY = 0;
      for (const it of (o.obs || [])) {
        if (it.kind === 'train') {
          const t = G.addTrain(1000 + it.z, it.lane, it.len, it.h, it.opts || {});
          if (it.opts && it.opts.oncoming) t.oncoming = true;
        } else if (it.kind === 'coin') {
          G.addCoin(1000 + it.z, LANE(it.lane), it.y == null ? 0.85 : it.y);
        } else {
          G.addObstacle(it.type, it.lane, { worldZ: 1000 + it.z });
        }
      }
    }

    function run(o) {
      setup(o);
      const G = Game;
      let jumped = false, rolled = false, hitAt = -1;
      const n = o.frames || 120;
      for (let i = 0; i < n; i++) {
        if (o.jumpAt != null && !jumped && G.travel >= o.jumpAt) { G.jump(); jumped = true; }
        if (o.rollAt != null && !rolled && G.travel >= o.rollAt) { G.roll(); rolled = true; }
        G.update(o.dt);
        if (G.dying > 0 || G.chase.hits > 0) { hitAt = i; break; }
      }
      const p = G.player;
      return {
        hit: G.dying > 0 || G.chase.hits > 0,
        hitAt: hitAt,
        travel: Math.round(G.travel),
        y: Math.round(p.y * 100) / 100,
        onRoof: p.supportY > 0.25,
        roofs: G.runStats.roofs,
        near: G.runStats.near,
        coins: G.runStats.coins,
      };
    }

    const T = [];
    const add = (name, expect, got) => T.push({ name, expect, got, pass: got === expect });

    /* ---- 1. 掉帧 + 最高速直冲栏杆：旧版必穿模 ---- */
    let r = run({ speed: 47, dt: 1 / 30, px: 0, frames: 60, obs: [{ type: 'barrier', lane: 1, z: 12 }] });
    add('掉帧(1/30)+47m/s 撞栏杆', 'hit', r.hit ? 'hit' : 'pass');

    /* ---- 2. 同样的条件下跳到 1.05 以上就能过 ---- */
    r = run({ speed: 47, dt: 1 / 30, px: 0, frames: 60, jumpAt: 1004.4, obs: [{ type: 'barrier', lane: 1, z: 12 }] });
    add('掉帧下跳栏杆', 'pass', r.hit ? 'hit' : 'pass');

    /* ---- 3. 迎面列车（相对 78m/s）——旧版一定穿模 ---- */
    r = run({
      speed: 47, dt: 1 / 30, px: 0, frames: 90,
      obs: [{ kind: 'train', lane: 1, z: 105, len: 22, h: 3.3, opts: { vz: 31, headlight: true, oncoming: true } }],
    });
    add('迎面列车 78m/s 对撞', 'hit', r.hit ? 'hit' : 'pass');

    /* ---- 4. 站着过高栏：应该撞（1.72m 高 > 1.35m 下沿） ---- */
    r = run({ speed: 40, dt: 1 / 60, px: 0, frames: 120, obs: [{ type: 'highbar', lane: 1, z: 14 }] });
    add('站着撞高栏', 'hit', r.hit ? 'hit' : 'pass');

    /* ---- 5. 滑铲过高栏：应该过（0.86m 高 < 1.35m 下沿） ---- */
    r = run({ speed: 40, dt: 1 / 60, px: 0, frames: 120, rollAt: 992, obs: [{ type: 'highbar', lane: 1, z: 14 }] });
    add('滑铲过高栏', 'pass', r.hit ? 'hit' : 'pass');

    /* ---- 6. 跳上车顶 ---- */
    r = run({ speed: 40, dt: 1 / 60, px: 0, frames: 150, jumpAt: 1000, obs: [{ kind: 'train', lane: 1, z: 10, len: 24, h: 1.35 }] });
    add('跳上低车厢顶', 'pass', r.hit ? 'hit' : 'pass');
    add('车顶被识别', 'yes', r.onRoof || r.roofs > 0 ? 'yes' : 'no');

    /* ---- 7. 不跳，侧撞低车厢 ---- */
    r = run({ speed: 40, dt: 1 / 60, px: 0, frames: 150, obs: [{ kind: 'train', lane: 1, z: 10, len: 24, h: 1.35 }] });
    add('侧撞车厢', 'hit', r.hit ? 'hit' : 'pass');

    /* ---- 8. 相邻车道的障碍不该误伤 ---- */
    r = run({ speed: 47, dt: 1 / 30, px: LANE(1), frames: 60, obs: [{ type: 'barrier', lane: 0, z: 12 }, { type: 'dumpster', lane: 2, z: 18 }] });
    add('相邻车道不误伤', 'pass', r.hit ? 'hit' : 'pass');

    /* ---- 9. 掉帧时金币还能捡到 ---- */
    r = run({ speed: 47, dt: 1 / 30, px: 0, frames: 60, obs: [{ kind: 'coin', lane: 1, z: 12 }] });
    add('掉帧时捡金币', 'yes', r.coins > 0 ? 'yes' : 'no');

    /* ---- 10. 擦身而过要计数（跨过栏杆给奖励） ---- */
    r = run({ speed: 40, dt: 1 / 60, px: 0, frames: 120, jumpAt: 1001, obs: [{ type: 'barrier', lane: 1, z: 14 }] });
    add('跨越后记擦身', 'yes', r.near > 0 ? 'yes' : 'no');

    return T;
  });

  /* 额外证据：把用例 1 / 3 的 travel 序列抓出来，算一下旧版那个
     travel±0.42 的瞬时窗口到底盖不盖得住。盖不住 = 旧版真的会穿模。 */
  const legacy = await page.evaluate(() => {
    const LANE = (l) => Utils.laneX(l);
    function trace(o) {
      const G = Game;
      G.god = false; G.state = 'run'; G.devFreeze = false;
      G.objs.length = 0; G.parts.length = 0;
      G.travel = 1000; G.speed = o.speed; G.elapsed = 0; G.intro = 0;
      G.dying = 0; G.invuln = 0; G.powers = { magnet: 0, jet: 0, x2: 0, shoe: 0, board: 0, shield: 0 };
      G.chase = { hits: 0, grace: 0, active: false };
      G.chaser = { on: false, dist: 9, mode: 'idle', t: 0 };
      G.diff = { id: 'normal', speedStart: o.speed, speedMax: o.speed, accel: 0, scoreMul: 1, name: 't' };
      G.runStats = { coins: 0, jumps: 0, rolls: 0, roofs: 0, boardDist: 0, magnet: 0, jet: 0, boards: 0, best: 0, near: 0, powers: 0, hits: 0 };
      G.nextZ = 1e9; G.themeTimer = 1e9; G.timeLeft = 0; G.nearMissCd = 0; G.coinSndCd = 0;
      const p = G.player;
      p.x = 0; p.lane = 1; p.y = 0; p.vy = 0; p.rollT = 0; p.grounded = true; p.state = 'run';
      let oz0, oz1;
      if (o.kind === 'train') {
        const t = G.addTrain(1000 + o.z, 1, o.len, o.h, o.vz ? { vz: o.vz } : {});
        oz0 = t.worldZ; oz1 = t.worldZ + t.len;
      } else {
        const b = G.addObstacle('barrier', 1, { worldZ: 1000 + o.z });
        oz0 = b.worldZ; oz1 = b.worldZ + b.len;
      }
      const trav = [];
      let framesInsideLegacy = 0;
      for (let i = 0; i < 90; i++) {
        trav.push(G.travel);
        G.update(o.dt);
        // 旧版窗口：travel+0.42 >= oz0 && travel-0.42 <= oz1
        if (G.travel + 0.42 >= oz0 && G.travel - 0.42 <= oz1) framesInsideLegacy++;
      }
      // 旧版窗口宽 0.84m；统计 travel 步长，看单帧位移有没有超过窗口
      const steps = [];
      for (let i = 1; i < trav.length; i++) steps.push(trav[i] - trav[i - 1]);
      const maxStep = Math.max.apply(null, steps);
      const obst = oz0 - 1000;
      return {
        obstacleZ: obst, len: oz1 - oz0,
        stepMin: Math.round(Math.min.apply(null, steps) * 100) / 100,
        stepMax: Math.round(maxStep * 100) / 100,
        legacyWindow: 0.84,
        covers: maxStep <= 0.84 ? '够' : '不够（一帧能跨过整个窗口）',
      };
    }
    return {
      barrier: trace({ speed: 47, dt: 1 / 30, z: 12 }),
      oncoming: trace({ speed: 47, dt: 1 / 30, z: 105, kind: 'train', len: 22, h: 3.3, vz: 31 }),
    };
  });
  console.log('\n=== 旧版瞬时窗口是否够用 ===');
  for (const k in legacy) {
    const L = legacy[k];
    console.log(k + ': 障碍在 +' + L.obstacleZ + 'm, 深 ' + L.len + 'm; 单帧位移 ' +
      L.stepMin + '~' + L.stepMax + 'm, 旧窗口宽 ' + L.legacyWindow + 'm → ' + L.covers);
  }

  let bad = 0;
  console.log('用例'.padEnd(26) + '期望   实际   结果');
  for (const t of res) {
    if (!t.pass) bad++;
    console.log(t.name.padEnd(24) + String(t.expect).padEnd(7) + String(t.got).padEnd(7) + (t.pass ? 'PASS' : 'FAIL'));
  }
  console.log('\n' + (bad ? bad + ' 项未通过' : '全部通过'));
  if (errs.length) console.log('=== 报错 ===\n' + errs.slice(0, 10).join('\n'));
  await browser.close();
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
