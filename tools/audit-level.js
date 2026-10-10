/* 关卡生成审计：不跑画面，只跑 genNext()，然后对生成结果做不变量检查。
   查的是"测试测不到、但玩家一眼就能看出来"的那类 bug：
     1) 同一条道上两个物体 z 区间重叠（火车里套火车、障碍埋在车厢里）
     2) 某个 z 上三条道全被堵死（无解）
     3) 楼梯没有紧贴着它要爬上去的那节车厢，或者高度对不上
     4) 坐标出现 NaN / undefined
     5) 物体数量失控（对象池泄漏）

   检查方式跟真实游戏一致：一段一段生成、边生成边回收（模拟 Game._sweepObjs），
   所以内存和耗时都是常数级，而且能顺带验"回收之后剩下的东西还有没有解"。

   注意：这里的 passable / solid 是独立实现，不去调 Gen.passable ——
   否则就是拿被测对象自己的尺子量它自己。两处口径必须一致，
   不一致就说明有一处写错了（这正是当初隧道/限高门"看着能过实际撞墙"的成因）。

   用法: node tools/audit-level.js [每个难度抽样的段落数]
   前置: npm run serve */
'use strict';
const { chromium } = require('playwright-core');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const N = parseInt(process.argv[2] || '900', 10);

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
  await page.waitForTimeout(3000);

  const out = await page.evaluate((N) => {
    const G = Game;
    const LANE = (l) => Utils.laneX(l);
    const LANE_W = CFG.LANE_W;
    const SOLID_KINDS = { train: 1, obstacle: 1 };

    /* 给每个段落打标：谁生出来的物体，出问题时才好定位。
       pattern 的 fn 只会往 Game.objs 里 push，所以按长度差打标是安全的。 */
    for (const p of Gen.patterns) {
      if (p.__wrapped) continue;
      const orig = p.fn;
      p.fn = function (GG) {
        const n0 = Game.objs.length;
        const r = orig.call(this, GG);
        for (let i = n0; i < Game.objs.length; i++) Game.objs[i]._pat = p.id;
        return r;
      };
      p.__wrapped = true;
    }

    /* ---- 一个物体在某条道上是不是"可通行" ----
       通行手段：跳(顶点 1.68m) / 滑铲(0.86m) / 走楼梯 / 弹跳垫 / 斜坡 / 纯装饰 */
    function passable(o) {
      if (o.decor || o.stair || o.spring || o.ramp) return true;
      if (o.kind === 'coin' || o.kind === 'power') return true;
      if (o.kind === 'train') return o.h <= 1.6;          // 矮车厢能跳上去，其余跳不过
      if (o.sweep) return true;                            // 横扫杆掐时机能跳
      if ((o.y0 || 0) >= 1.2) return true;                 // 上沿封顶型：滑铲能过
      return (o.y1 || 1.05) <= 1.1;                        // 矮障碍：跳过去
    }
    const solid = (o) => !!SOLID_KINDS[o.kind];

    /* 实体 + 预留占位一起看：预留区是"迎面列车要扫过的空走廊"，
       里面出现任何实体都算穿模。 */
    function allSolids() {
      const out = [];
      for (const o of G.objs) if (solid(o)) out.push(o);
      for (const r of Gen.reserved) out.push(r);
      return out;
    }

    const report = {
      overlaps: [],        // 同车道 z 重叠
      deadZones: [],       // 三条道全堵死
      stairIssues: [],     // 楼梯对不上车厢
      nan: [],             // 坐标 NaN
      maxObjs: 0,
      segs: 0,
      retries: 0,          // 重抽次数（太高说明约束把生成器逼死了）
      blanks: 0,           // 八次都抽不出、被迫留空的段落数
      reservedPeak: 0,
      perType: {},
    };

    function reset() {
      G.objs.length = 0;
      G.nextZ = 0;
      G.travel = 0;
      G.speed = 30;
      Gen.reserved.length = 0;
    }

    for (const diff of [0.02, 0.3, 0.6, 0.95]) {
      reset();
      G.travel = diff * 1900;
      G.speed = 30;
      G.diff = diff;
      let z = 0;
      for (let i = 0; i < N; i++) {
        G.nextZ = z;
        G.travel = diff * 1900 + z * 0.05;     // 难度跟着推进一点
        const objsBefore = G.objs.length;
        G.genNext();
        report.segs++;
        const nNew = G.objs.length - objsBefore;
        if (nNew === 0) report.blanks++;
        z = G.nextZ;
        if (G.objs.length > report.maxObjs) report.maxObjs = G.objs.length;
        if (Gen.reserved.length > report.reservedPeak) report.reservedPeak = Gen.reserved.length;

        /* ---------- 增量检查这一段 [segZ0, segZ1] ---------- */
        const segZ0 = Math.max(0, G.nextZ - 90), segZ1 = z;
        const items = allSolids();

        /* 1. 同车道 z 重叠（只报"新物体 vs 别人"，避免同一处反复报） */
        for (const a of items) {
          if (a._seen) continue;
          for (const b of items) {
            if (a === b) continue;
            if (b._seen && a._seen) continue;
            if (Math.abs(a.x - b.x) > 0.35) continue;
            const a0 = a.worldZ, a1 = a.worldZ + (a.len || 0.6);
            const b0 = b.worldZ, b1 = b.worldZ + (b.len || 0.6);
            const ov = Math.min(a1, b1) - Math.max(a0, b0);
            if (ov > 0.05) {
              report.overlaps.push({
                diff: diff,
                a: (a._pat || (a.ghost ? 'reserved' : '?')) + ':' + (a.otype || a.kind),
                b: (b._pat || (b.ghost ? 'reserved' : '?')) + ':' + (b.otype || b.kind),
                lane: Math.round((a.x / LANE_W) + 1), overlap: Math.round(ov * 100) / 100,
                aRange: [Math.round(a0), Math.round(a1)], bRange: [Math.round(b0), Math.round(b1)],
              });
              b._seen = true;
            }
          }
          a._seen = true;
        }

        /* 2. 三条道全堵死：只扫这一段 */
        for (let s = Math.floor(segZ0); s <= Math.ceil(segZ1); s += 1) {
          let blocked = 0;
          const who = [];
          for (let l = 0; l < 3; l++) {
            const lx = LANE(l);
            let ok = false, has = false;
            for (const o of items) {
              if (Math.abs(o.x - lx) > (o.hw || 0.95) + 0.38) continue;
              const a0 = o.worldZ, a1 = o.worldZ + (o.len || 0.6);
              if (s < a0 - 0.4 || s > a1 + 0.4) continue;
              has = true;
              if (passable(o)) ok = true;
              else who.push((o._pat || (o.ghost ? 'reserved' : '?')) + ':' + (o.otype || o.kind) + '@L' + l);
            }
            if (has && !ok) blocked++;
          }
          if (blocked >= 3) report.deadZones.push({ diff: diff, z: s, who: who.join(' + ') });
        }

        /* 3. 楼梯：必须紧跟着一节同高度的车厢 */
        for (const st of G.objs) {
          if (!st.stair || st._chk) continue;
          st._chk = true;
          const want = st.worldZ + st.len;
          const tr = G.objs.find(o => o.kind === 'train' && Math.abs(o.x - st.x) < 0.35 &&
            Math.abs(o.worldZ - want) < 1.2);
          if (!tr) {
            report.stairIssues.push({ diff: diff, why: '楼梯后面没有接车厢', z: Math.round(st.worldZ), climb: st.climb });
          } else if (Math.abs(tr.h - st.climb) > 0.01) {
            report.stairIssues.push({ diff: diff, why: '楼梯高度和车厢对不上', climb: st.climb, trainH: tr.h, z: Math.round(st.worldZ) });
          }
        }

        /* 4. NaN */
        for (const o of G.objs) {
          if (o._nanchk) continue;
          o._nanchk = true;
          const bad = [o.x, o.worldZ, o.y, o.h, o.len, o.hw, o.climb, o.base].some(v => v !== undefined && (typeof v !== 'number' || !isFinite(v)));
          if (bad) report.nan.push({ diff: diff, otype: o.otype || o.kind, x: o.x, worldZ: o.worldZ, y: o.y, h: o.h, len: o.len });
        }

        /* 5. 各类型计数 + 模拟回收（跟真实游戏同一条线） */
        for (const o of G.objs) {
          if (o._cnt) continue;
          o._cnt = true;
          const k = o.otype || o.kind;
          report.perType[k] = (report.perType[k] || 0) + 1;
        }
        const cut = G.travel - CFG.CAM_BACK - 14;
        G._sweepObjs(cut);
        Gen.pruneReserved(G.travel);
      }
    }
    return report;
  }, N);

  console.log('抽样段落数 ' + out.segs + '（4 个难度档）');
  console.log('单次生成后场上物体数峰值 ' + out.maxObjs + '，预留区峰值 ' + out.reservedPeak);
  console.log('空段落 ' + out.blanks + ' 段');
  console.log('\n各类型出现次数：');
  const pt = Object.entries(out.perType).sort((a, b) => b[1] - a[1]);
  console.log('  ' + pt.map(([k, v]) => k + '=' + v).join('  '));

  const show = (name, arr, fmt, limit) => {
    console.log('\n=== ' + name + '：' + arr.length + ' 处 ===');
    const by = {};
    for (const x of arr) { const k = fmt(x).key; by[k] = (by[k] || 0) + 1; }
    Object.entries(by).sort((a, b) => b[1] - a[1]).slice(0, limit || 12).forEach(([k, v]) => console.log('   ' + v + ' × ' + k));
    if (arr.length) console.log('   样例: ' + JSON.stringify(arr.slice(0, 3)));
  };
  show('同车道 z 重叠', out.overlaps, (x) => ({ key: x.a + ' × ' + x.b + '（重叠 ' + x.overlap + 'm，道 ' + x.lane + '）' }));
  show('三道全堵死', out.deadZones, (x) => ({ key: x.who }));
  show('楼梯问题', out.stairIssues, (x) => ({ key: x.why + (x.climb !== undefined ? '（climb ' + x.climb + ' / h ' + x.trainH + '）' : '') }));
  show('坐标 NaN', out.nan, (x) => ({ key: x.otype }));

  if (errs.length) console.log('\n=== 页面报错 ===\n' + errs.slice(0, 6).join('\n'));
  const fatal = out.deadZones.length + out.nan.length + out.stairIssues.length;
  console.log('\n' + (fatal ? '⚠ 有 ' + fatal + ' 处硬伤 + ' + out.overlaps.length + ' 处重叠' : '✓ 未发现结构性问题'));
  await browser.close();
  /* 作为回归用例跑的时候要有非零退出码，不然 CI 里红不了。
     重叠也算失败：不致命，但一定穿模，玩家一眼就看出来。 */
  if (fatal || out.overlaps.length || errs.length) process.exit(1);
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
