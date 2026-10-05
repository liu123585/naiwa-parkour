/* 交互回归测试：真浏览器里把"需要确认的按钮"全点一遍。
   背景：这些按钮以前用原生 confirm()，而 confirm 在 iframe / 微信内置浏览器里
   会被静默拦掉、直接返回 false —— 玩家点一下什么反馈都没有。
   "皮肤商城买不了"这个反馈就是这么来的。
   所以这里做两件事：
     1) 把 dialog 事件全拦下来，任何一个被触发都算失败（说明还依赖原生弹窗）；
     2) 每个按钮点两下，验证"第一下只提示、第二下才生效"。
   前置：npm run serve（默认 8899 端口）
   用法: node tools/test-ui.js
   退出码非 0 = 有用例没过。 */
'use strict';
const { chromium } = require('playwright-core');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

(async () => {
  const browser = await chromium.launch({
    executablePath: EDGE, headless: true,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
      '--disable-gpu-sandbox', '--no-sandbox'],
  });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e && e.message || e)));
  /* 把原生弹窗全部拦下来：任何一个被调用到，都说明还有地方依赖它 */
  let nativeDialog = 0;
  page.on('dialog', async (d) => { nativeDialog++; await d.dismiss().catch(() => {}); });

  await page.goto('http://localhost:8899/?dev=run&q=high&noperf=1', { waitUntil: 'load', timeout: 30000 });
  await page.waitForTimeout(2600);

  const R = [];

  /* ---------- 1. 八音盒换曲 ---------- */
  await page.evaluate(() => { UI.openPanel('settings'); });
  await page.waitForTimeout(200);
  const before = await page.evaluate(() => Sound.trackName());
  await page.click('#btnBgmNext');
  await page.waitForTimeout(120);
  const after1 = await page.evaluate(() => Sound.trackName());
  await page.click('#btnBgmNext');
  await page.waitForTimeout(120);
  const after2 = await page.evaluate(() => ({ name: Sound.trackName(), label: document.getElementById('bgmNow').textContent }));
  R.push({ name: '换一首换掉了曲目', expect: 'yes', got: (before !== after1 && after1 !== after2) ? 'yes' : 'no', extra: before + ' → ' + after1 + ' → ' + after2 });
  R.push({ name: '面板曲名跟着更新', expect: 'yes', got: after2.label === after2.name ? 'yes' : 'no', extra: after2.label });

  /* ---------- 2. 一键解锁全部（两次点击） ---------- */
  const coins0 = await page.evaluate(() => Store.data.coins);
  const charsTotal = await page.evaluate(() => CHARS.length);
  await page.click('#btnUnlockAll');
  await page.waitForTimeout(120);
  const mid = await page.evaluate(() => ({
    coins: Store.data.coins, chars: Store.data.chars.length,
    label: document.getElementById('btnUnlockAll').textContent,
  }));
  R.push({ name: '一键解锁：第一下不生效', expect: 'yes', got: (mid.coins === coins0 && mid.chars < charsTotal) ? 'yes' : 'no', extra: JSON.stringify(mid) });
  await page.click('#btnUnlockAll');
  await page.waitForTimeout(200);
  const full = await page.evaluate(() => ({
    coins: Store.data.coins, chars: Store.data.chars.length, total: CHARS.length,
    maps: Store.data.mapsUnlocked.length, mapsTotal: MAPS.length,
    ach: Store.data.achClaimed.length, achTotal: ACHIEVEMENTS.length,
    codex: Store.data.codexSeen.length, codexTotal: CODEX.length,
    ch: Store.data.challenges.length, chTotal: CHALLENGES.length,
    skills: SKILLS.map(s => Store.data.skills[s.id] + '/' + s.max).join(' '),
  }));
  const allOn = full.coins >= 999999 && full.chars === full.total && full.maps === full.mapsTotal &&
    full.ach === full.achTotal && full.codex === full.codexTotal && full.ch === full.chTotal;
  R.push({ name: '一键解锁：第二下全开', expect: 'yes', got: allOn ? 'yes' : 'no', extra: JSON.stringify(full) });

  /* ---------- 3. 清空存档（两次点击） ---------- */
  await page.click('#btnWipe');
  await page.waitForTimeout(120);
  const w1 = await page.evaluate(() => ({ coins: Store.data.coins, label: document.getElementById('btnWipe').textContent }));
  R.push({ name: '清档：第一下不清', expect: 'yes', got: w1.coins >= 999999 ? 'yes' : 'no', extra: w1.label });
  await page.click('#btnWipe');
  await page.waitForTimeout(300);
  const w2 = await page.evaluate(() => ({ coins: Store.data.coins, chars: Store.data.chars.length }));
  R.push({ name: '清档：第二下清干净', expect: 'yes', got: (w2.coins === 0 && w2.chars <= 1) ? 'yes' : 'no', extra: JSON.stringify(w2) });

  /* ---------- 4. 皮肤商城两次点击购买 ---------- */
  await page.evaluate(() => { Store.data.coins = 99999; Store.save(); UI.buildChars(); UI.openPanel('chars'); });
  await page.waitForTimeout(250);
  const pick = await page.evaluate(() => {
    const c = CHARS.filter(x => x.price > 0 && Store.data.chars.indexOf(x.id) < 0)[0];
    return c ? { id: c.id, name: c.name, price: c.price } : null;
  });
  if (pick) {
    await page.click('.char-card[data-id="' + pick.id + '"]');
    await page.waitForTimeout(150);
    const s1 = await page.evaluate((id) => ({
      owned: Store.data.chars.indexOf(id) >= 0, coins: Store.data.coins,
      cls: (document.querySelector('.char-card[data-id="' + id + '"]') || {}).className || '',
    }), pick.id);
    R.push({ name: '商城：第一下只亮确认', expect: 'yes', got: (!s1.owned && s1.coins === 99999 && /confirming/.test(s1.cls)) ? 'yes' : 'no', extra: s1.cls });
    await page.click('.char-card[data-id="' + pick.id + '"]');
    await page.waitForTimeout(200);
    const s2 = await page.evaluate((id) => ({ owned: Store.data.chars.indexOf(id) >= 0, coins: Store.data.coins, ch: Store.data.char }), pick.id);
    R.push({ name: '商城：第二下扣钱并装备', expect: 'yes', got: (s2.owned && s2.coins === 99999 - pick.price && s2.ch === pick.id) ? 'yes' : 'no', extra: pick.name + ' ' + pick.price + ' → ' + s2.coins });
  } else {
    R.push({ name: '商城购买', expect: 'yes', got: 'skip', extra: '没有可买的付费角色' });
  }

  R.push({ name: '全程零原生弹窗', expect: '0', got: String(nativeDialog), extra: '' });

  let bad = 0;
  console.log('用例'.padEnd(28) + '期望   实际   结果');
  for (const t of R) {
    const pass = t.got === t.expect;
    if (!pass) bad++;
    console.log(t.name.padEnd(26) + String(t.expect).padEnd(7) + String(t.got).padEnd(7) + (pass ? 'PASS' : 'FAIL') + (t.extra ? '   ' + t.extra : ''));
  }
  console.log('\n' + (bad ? bad + ' 项未通过' : '全部通过'));
  if (errs.length) console.log('=== 报错 ===\n' + errs.slice(0, 6).join('\n'));
  await browser.close();
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
