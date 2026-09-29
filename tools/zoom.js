/* 放大看截图局部（排查文字/图形渲染问题用）
   用法: node tools/zoom.js <png> <x> <y> <w> <h> <倍数> <out.png> */
'use strict';
const { chromium } = require('playwright-core');
const path = require('path');
const fs = require('fs');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

(async () => {
  const [src, x, y, w, h, z, out] = process.argv.slice(2);
  const X = +x, Y = +y, W = +w, H = +h, Z = +(z || 3);

  const tmp = path.join(path.dirname(path.resolve(src)), '_zoom_tmp.html');
  fs.writeFileSync(tmp,
    `<style>html,body{margin:0;background:#111;overflow:hidden}
     img{position:absolute;left:${-X * Z}px;top:${-Y * Z}px;
     transform:scale(${Z});transform-origin:0 0;image-rendering:pixelated}</style>
     <img src="${path.basename(src)}">`, 'utf8');

  const browser = await chromium.launch({ executablePath: EDGE, headless: true, args: ['--no-sandbox', '--hide-scrollbars'] });
  const ctx = await browser.newContext({ viewport: { width: W * Z, height: H * Z }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.goto('file:///' + tmp.replace(/\\/g, '/'));
  await page.waitForTimeout(600);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  await page.screenshot({ path: out });
  await browser.close();
  fs.unlinkSync(tmp);
  console.log('ok', out);
})().catch((e) => { console.error(e); process.exit(1); });
