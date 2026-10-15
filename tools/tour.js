/* 观感巡检：在若干个里程点各截一张图，顺便打印诊断信息。
   用法：node tools/tour.js [warp点,逗号分隔] [输出前缀]
   例：  node tools/tour.js 400,1200,2400,4000          → .shots/tour-400.png …
         node tools/tour.js 800,1600 .shots/night        → .shots/night-800.png …
   需要先 npm run serve（本脚本不负责起服务）。
   为什么要跑这个：单元测试只保证"不崩、不穿模"，画面好不好看它管不着。
   每轮改动之后扫一遍，比盯着代码想快得多。 */
'use strict';
const { chromium } = require('playwright-core');
const EDGE = 'C://Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const STOPS = (process.argv[2] || '400,1200,2400,4000').split(',');
const PREFIX = process.argv[3] || '.shots/tour';
(async () => {
  const b = await chromium.launch({ executablePath: EDGE, headless: true,
    args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-gpu-sandbox','--no-sandbox','--hide-scrollbars'] });
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  for (const w of STOPS) {
    const p = await ctx.newPage();
    const errs = [];
    p.on('pageerror', e => errs.push(String(e && e.message || e)));
    await p.goto('http://localhost:8899/?dev=run&god=1&q=high&noperf=1&warp=' + w + '&cb=' + Date.now(),
      { waitUntil: 'load', timeout: 40000 });
    await p.waitForTimeout(600);
    /* 开局示意卡会盖住半个屏幕，巡检时要关掉才能看全貌 */
    await p.evaluate(() => { try { UI.hideHowto(); } catch (e) {} });
    await p.waitForTimeout(4200);
    await p.evaluate(() => { try { UI.hideHowto(); } catch (e) {} });
    const info = await p.evaluate(() => {
      const t = Game.travel;
      const near = Game.objs
        .filter(o => o.worldZ !== undefined && Math.abs(o.worldZ - t) < 14)
        .map(o => o.kind + '@' + (o.worldZ - t).toFixed(1));
      return { d: Math.round(t), s: Math.round(Game.speed), st: Game.state,
        objs: Game.objs.length, near: near.slice(0, 5) };
    });
    await p.screenshot({ path: PREFIX + '-' + w + '.png' });
    console.log('warp=' + w + ' → ' + info.d + 'm  速度 ' + info.s + '  物体 ' + info.objs
      + '  近身:' + (info.near.length ? info.near.join(' ') : '无')
      + (errs.length ? '  报错:' + errs[0] : ''));
    await p.close();
  }
  await b.close();
})().catch(e => {
  if (String(e && e.message || e).includes('ERR_CONNECTION_REFUSED')) {
    console.error('连不上 http://localhost:8899 —— 先跑 npm run serve');
  } else console.error('FAILED', e);
  process.exit(1);
});
