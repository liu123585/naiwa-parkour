/* 开局示意卡观感检查：手机视口下截三张
     ① 刚弹出（应该只有"手指滑动"一格、不糊住赛道）
     ② 0.6 秒后（正在呼吸）
     ③ 碰一下之后（已经淡出）
   前置：npm run serve（默认 8899 端口）
   用法: node tools/shot-howto.js
   产物: .shots/howto-mobile-*.png */
'use strict';
const { chromium } = require('playwright-core');
const fs = require('fs');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const OUT = '.shots';

(async () => {
  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({
    executablePath: EDGE, headless: true,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
      '--disable-gpu-sandbox', '--no-sandbox'],
  });
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
  });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String((e && e.message) || e)));

  await page.goto('http://localhost:8899/?q=high&noperf=1', { waitUntil: 'load', timeout: 30000 });
  await page.waitForTimeout(2600);

  /* 菜单 → 点开跑（跟玩家的路径一致，顺便验证 click 不会当场把卡关掉） */
  await page.click('#btnPlay');
  await page.waitForTimeout(300);
  /* ⚠️ 量尺寸必须在截图之前：软渲染下一次截图要一两秒，
     等截完再量，卡早就按 2.4 秒的计时器自动消失了，量到 0×0。 */
  const box = await page.evaluate(() => {
    const h = document.getElementById('howto');
    const r = h.getBoundingClientRect();
    return {
      visible: !h.classList.contains('hidden'),
      w: Math.round(r.width), h: Math.round(r.height),
      areaPct: Math.round(r.width * r.height / (innerWidth * innerHeight) * 100),
    };
  });
  await page.screenshot({ path: OUT + '/howto-mobile-1-弹出.png' });

  /* 自动消失到底花了多久：以塞进去的那一刻为基准轮询，别再靠"猜着等" */
  const goneMs = await page.evaluate(() => new Promise((res) => {
    const h = document.getElementById('howto');
    if (h.classList.contains('hidden')) { res(0); return; }
    const t0 = performance.now();
    const iv = setInterval(() => {
      if (h.classList.contains('hidden')) { clearInterval(iv); res(Math.round(performance.now() - t0)); }
      else if (performance.now() - t0 > 8000) { clearInterval(iv); res(-1); }
    }, 40);
  }));

  /* 第二遍：重新弹一次，量"碰一下"的响应 */
  await page.evaluate(() => { UI.showHowto(); });
  await page.waitForTimeout(600);
  await page.screenshot({ path: OUT + '/howto-mobile-2-呼吸.png' });
  const tapMs = await page.evaluate(() => new Promise((res) => {
    const h = document.getElementById('howto');
    const t0 = performance.now();
    window.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    const iv = setInterval(() => {
      if (h.classList.contains('hidden')) { clearInterval(iv); res(Math.round(performance.now() - t0)); }
      else if (performance.now() - t0 > 3000) { clearInterval(iv); res(-1); }
    }, 40);
  }));
  await page.screenshot({ path: OUT + '/howto-mobile-3-碰完已消失.png' });

  console.log('弹出时可见       :', box.visible);
  console.log('卡片尺寸         :', box.w + ' x ' + box.h + ' px');
  console.log('占屏面积         :', box.areaPct + '%');
  console.log('自动消失耗时     :', goneMs + ' ms（目标 ≤2660：2400 计时 + 260 淡出）');
  console.log('碰一下消失耗时   :', tapMs + ' ms');
  console.log('页面报错         :', errs.length ? errs.join(' | ') : '无');
  await browser.close();
  process.exit(errs.length ? 1 : 0);
})();
