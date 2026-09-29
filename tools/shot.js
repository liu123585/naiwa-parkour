/* =========================================================
   竖屏截图验收：用系统 Edge 无头模式跑一遍，顺便回收控制台报错
   用法: node tools/shot.js "<url>" "<输出png>" [等待毫秒]
   例:   node tools/shot.js "http://localhost:8899/?dev=run&warp=900" shots/run.png 3500
   ========================================================= */
'use strict';
const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

(async () => {
  const url = process.argv[2] || 'http://localhost:8899/';
  const out = process.argv[3] || 'shots/shot.png';
  const wait = parseInt(process.argv[4] || '3200', 10);
  /* 可选的第 5 个参数：截图前在页面里跑一段 JS（做对照实验用） */
  const before = process.argv[5] || '';

  fs.mkdirSync(path.dirname(out), { recursive: true });

  const browser = await chromium.launch({
    executablePath: EDGE, headless: true,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
      '--disable-gpu-sandbox', '--no-sandbox', '--hide-scrollbars'],
  });

  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
  });
  const page = await ctx.newPage();

  const logs = [];
  page.on('console', (m) => { if (!/AudioContext/.test(m.text())) logs.push('[' + m.type() + '] ' + m.text()); });
  page.on('pageerror', (e) => logs.push('[pageerror] ' + (e && e.stack ? e.stack.split('\n')[0] : e)));
  page.on('requestfailed', (r) => logs.push('[404] ' + r.url()));

  await page.goto(url, { waitUntil: 'load', timeout: 30000 });
  await page.waitForTimeout(wait);
  if (before) {
    const r = await page.evaluate(before).catch((e) => 'eval error: ' + e.message);
    console.log('=== before 脚本返回 ===');
    console.log(JSON.stringify(r));
    await page.waitForTimeout(400);
  }
  await page.screenshot({ path: out });

  // 这些对象都是 const 声明，不挂在 window 上，只能 eval
  const info = await page.evaluate(() => {
    const has = (n) => { try { return typeof eval(n) !== 'undefined'; } catch (e) { return false; } };
    const cv = document.getElementById('gl3d');
    return {
      three: has('THREE') ? eval('THREE.REVISION') : 'missing',
      ready: has('Pinch3D') ? eval('Pinch3D.ready') : 'missing',
      use3D: has('Renderer') ? eval('!!Renderer.use3D') : 'missing',
      state: has('Game') ? eval('Game.state') : 'missing',
      travel: has('Game') ? Math.round(eval('Game.travel')) : -1,
      objs: has('Game') ? eval('Game.objs.length') : -1,
      pool: has('Pinch3D') ? eval('Pinch3D.pool ? Pinch3D.pool.used : -1') : -1,
      thumbs: has('Chars3D') ? eval('Object.keys(Chars3D.thumbs).length') : -1,
      canvas: cv ? cv.width + 'x' + cv.height : 'none',
      fps: has('Game') ? Math.round(eval('Game.fps.avg')) : -1,
      diag: (typeof window !== 'undefined' && window.__diag) ? window.__diag : null,
      fs: has('Pinch3D') ? eval('JSON.stringify(Pinch3D.__fs||null)') : null,
      shadow: has('Pinch3D') ? eval(`(function(){
        var R = Pinch3D; if (!R.renderer) return 'no renderer';
        var n = 0, cast = 0, recv = 0;
        R.pool.all.forEach(function(m){ if (m.visible) { n++; if (m.castShadow) cast++; if (m.receiveShadow) recv++; } });
        var sh = R.key && R.key.shadow;
        return {
          enabled: R.renderer.shadowMap.enabled, type: R.renderer.shadowMap.type,
          PCF: THREE.PCFShadowMap, keyCast: R.key.castShadow, on: R.shadowsOn,
          map: sh && sh.map ? sh.map.width + 'x' + sh.map.height : 'none',
          box: sh ? [sh.camera.left, sh.camera.right, sh.camera.top, sh.camera.bottom, sh.camera.near, sh.camera.far] : null,
          visMeshes: n, castMeshes: cast, recvMeshes: recv,
          keyPos: R.key.position.toArray().map(function(v){return Math.round(v*10)/10;}),
          tgt: R.key.target.position.toArray().map(function(v){return Math.round(v*10)/10;}),
          camPos: R.camera.position.toArray().map(function(v){return Math.round(v*10)/10;}),
        };
      })()`) : 'missing',
    };
  }).catch((e) => ({ err: String(e) }));

  console.log('=== 状态 ===');
  console.log(JSON.stringify(info, null, 2));
  console.log('=== 控制台 ===');
  console.log(logs.slice(0, 30).join('\n') || '(无输出)');
  console.log('=== 截图 ===', out);

  await browser.close();
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
