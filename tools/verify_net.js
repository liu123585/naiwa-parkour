/* 验收：跑一遍 3D 模式，报告所有网络请求，确认 art/ 下的贴图不再被下载 */
'use strict';
const { chromium } = require('playwright-core');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

(async () => {
  const url = process.argv[2] || 'http://localhost:8899/?dev=run&god=1&warp=1100&q=high&noperf=1';
  const out = process.argv[3] || 'shots/60-accept-run.png';
  const browser = await chromium.launch({
    executablePath: EDGE, headless: true,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
      '--disable-gpu-sandbox', '--no-sandbox', '--hide-scrollbars'],
  });
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
  });
  const page = await ctx.newPage();
  const reqs = [];
  const fails = [];
  page.on('request', (r) => reqs.push(r.url()));
  page.on('requestfailed', (r) => fails.push(r.url()));
  page.on('pageerror', (e) => fails.push('PAGEERROR ' + (e && e.message)));
  await page.goto(url, { waitUntil: 'load', timeout: 30000 });
  await page.waitForTimeout(5000);
  await page.screenshot({ path: out });

  const local = reqs.filter((u) => u.indexOf('localhost:8899') >= 0).map((u) => u.split('8899')[1]);
  console.log('=== 本地请求 ' + local.length + ' 条 ===');
  console.log(local.join('\n'));
  console.log('=== art/ 相关 ===');
  console.log(local.filter((u) => u.indexOf('/art/') >= 0).join('\n') || '(无 —— 正确)');
  console.log('=== 失败/报错 ===');
  console.log(fails.join('\n') || '(无)');
  await browser.close();
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
