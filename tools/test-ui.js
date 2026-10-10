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

  /* ---------- 5. 输入：滑屏 / 鼠标拖动 / 键盘 ----------
     这一节是"用户说操作不跟手、铲跳分不清"之后补的回归。
     测法：在页面里给 jump / roll / moveLane 挂钩子记录调用，
     然后用真实触摸事件（CDP Input.dispatchTouchEvent，走浏览器原生链路，
     不是 JS 手动 new 一个事件）划屏，看钩子有没有被叫到。
     关键不是"能不能触发"，而是"多少距离才触发"——
     阈值调大了就不跟手，调小了就误触，两头都要钉住。 */
  await page.evaluate(() => {
    UI.hideAllScreens(); UI.showHUD(); Game.start();
    /* 把 update 停掉：测试期间角色不能动、不能死，否则撞一下状态就乱了 */
    Game.update = function () {};
    window.__calls = [];
    ['jump', 'roll', 'moveLane', 'useBoard'].forEach((m) => {
      const o = Game[m];
      Game[m] = function () {
        window.__calls.push(m + ':' + Array.prototype.join.call(arguments, ','));
        return o.apply(this, arguments);
      };
    });
  });
  await page.waitForTimeout(300);

  const cdp = await ctx.newCDPSession(page);
  const reset = () => page.evaluate(() => {
    window.__calls.length = 0;
    const p = Game.player;
    p.lane = 1; p.x = 0; p.y = 0; p.vy = 0; p.rollT = 0; p.grounded = true; p.state = 'run';
    Game.state = 'run'; Game.dying = 0; Game.invuln = 999;
  });
  const calls = () => page.evaluate(() => window.__calls.slice());
  const hit = (arr, re) => arr.some((s) => re.test(s));
  let c = [];

  const swipe = async (x0, y0, x1, y1, steps) => {
    steps = steps || 8;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: y0 }] });
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: x0 + (x1 - x0) * t, y: y0 + (y1 - y0) * t }],
      });
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(70);
  };
  const drag = async (x0, y0, x1, y1) => {
    await page.mouse.move(x0, y0);
    await page.mouse.down();
    await page.mouse.move(x1, y1, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(70);
  };

  /* 5.1 上滑 = 跳，而且恰好一次 */
  await reset();
  await swipe(195, 560, 195, 500);
  c = await calls();
  R.push({ name: '滑屏：上滑 = 跳（恰好一次）', expect: '1', got: String(c.filter((s) => /^jump/.test(s)).length), extra: c.join(' ') });

  /* 5.2 下滑 = 滑铲，而且恰好一次 */
  await reset();
  await swipe(195, 500, 195, 560);
  c = await calls();
  R.push({ name: '滑屏：下滑 = 滑铲（恰好一次）', expect: '1', got: String(c.filter((s) => /^roll/.test(s)).length), extra: c.join(' ') });

  /* 5.3 左滑 / 右滑 = 变道 */
  await reset();
  await swipe(150, 560, 250, 560);
  c = await calls();
  R.push({ name: '滑屏：右滑 = 右移一条道', expect: 'moveLane:1', got: (c[0] || '(无)'), extra: '' });
  await reset();
  await swipe(250, 560, 150, 560);
  c = await calls();
  R.push({ name: '滑屏：左滑 = 左移一条道', expect: 'moveLane:-1', got: (c[0] || '(无)'), extra: '' });

  /* 5.4 灵敏度：16 像素就该出动作（"跟手"的量化标准） */
  await reset();
  await swipe(195, 560, 195, 544, 4);
  c = await calls();
  R.push({ name: '灵敏度：滑动 16px 就触发', expect: 'yes', got: hit(c, /^jump/) ? 'yes' : 'no', extra: c.join(' ') });

  /* 5.5 微动 8px 够不到阈值，抬指时算"点按" → 跳。
         要点是：绝不能误判成变道或滑铲（那才是真的会害死玩家）。 */
  await reset();
  await swipe(195, 560, 195, 552, 4);
  c = await calls();
  R.push({
    name: '微动 8px 只算点按，不误判成变道/滑铲', expect: 'yes',
    got: (c.filter((s) => /^(moveLane|roll)/.test(s)).length === 0 && hit(c, /^jump/)) ? 'yes' : 'no',
    extra: c.join(' '),
  });

  /* 5.6 斜滑只出一个动作：不许又变道又跳，也不许一次窜两条道 */
  await reset();
  await swipe(195, 560, 245, 510);
  c = await calls();
  const acts = c.filter((s) => /^(jump|roll|moveLane)/.test(s));
  R.push({ name: '斜滑只出一个动作', expect: '1', got: String(acts.length), extra: c.join(' ') });

  /* 5.7 点按（不移动）= 跳 */
  await reset();
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 195, y: 560 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(80);
  c = await calls();
  R.push({ name: '点按 = 跳', expect: 'yes', got: hit(c, /^jump/) ? 'yes' : 'no', extra: c.join(' ') });

  /* 5.8 鼠标拖动：上 / 下 / 左右 */
  await reset();
  await drag(195, 560, 195, 500);
  c = await calls();
  R.push({ name: '鼠标：向上拖动 = 跳', expect: 'yes', got: hit(c, /^jump/) ? 'yes' : 'no', extra: c.join(' ') });
  await reset();
  await drag(195, 500, 195, 560);
  c = await calls();
  R.push({ name: '鼠标：向下拖动 = 滑铲', expect: 'yes', got: hit(c, /^roll/) ? 'yes' : 'no', extra: c.join(' ') });
  await reset();
  await drag(150, 560, 250, 560);
  c = await calls();
  R.push({ name: '鼠标：向右拖动 = 变道', expect: 'moveLane:1', got: (c[0] || '(无)'), extra: '' });

  /* 5.9 键盘：方向键 / WASD / 空格 */
  const keyCase = async (key, label, re) => {
    await reset();
    await page.keyboard.press(key);
    await page.waitForTimeout(60);
    const cc = await calls();
    return { name: '键盘：' + label, expect: 'yes', got: hit(cc, re) ? 'yes' : 'no', extra: cc.join(' ') };
  };
  R.push(await keyCase('ArrowUp', '↑ = 跳', /^jump/));
  R.push(await keyCase('ArrowDown', '↓ = 滑铲', /^roll/));
  R.push(await keyCase('ArrowLeft', '← = 左移', /^moveLane:-1$/));
  R.push(await keyCase('ArrowRight', '→ = 右移', /^moveLane:1$/));
  R.push(await keyCase('w', 'W = 跳', /^jump/));
  R.push(await keyCase('s', 'S = 滑铲', /^roll/));
  R.push(await keyCase('a', 'A = 左移', /^moveLane:-1$/));
  R.push(await keyCase('d', 'D = 右移', /^moveLane:1$/));
  R.push(await keyCase(' ', '空格 = 跳', /^jump/));

  /* 5.10 屏幕按钮必须已经拆掉（用户明确要求"不要按钮，直接滑屏幕"） */
  const pads = await page.evaluate(() => ['padLeft', 'padRight', 'padJump', 'padRoll']
    .filter((id) => !!document.getElementById(id)));
  R.push({ name: '屏上方向按钮已移除', expect: '0', got: String(pads.length), extra: pads.join(' ') });

  /* 5.11 滑屏时指尖要有方向箭头反馈 */
  await reset();
  await swipe(195, 500, 195, 440);
  const gfx = await page.evaluate(() => document.querySelectorAll('#gfx .gfx-item').length);
  R.push({ name: '滑屏有方向箭头反馈', expect: '4', got: String(gfx), extra: '' });

  /* 5.12 操作示意卡是图形，不是文字。
         W/A/S/D 是键帽印字（标准图示），所以允许 4 个字符。 */
  const howto = await page.evaluate(() => {
    const h = document.getElementById('howto');
    h.innerHTML = (typeof HOWTO_SVG !== 'undefined') ? HOWTO_SVG : '';
    return {
      svg: h.querySelectorAll('svg').length,
      shapes: h.querySelectorAll('path,rect,circle').length,
      text: h.textContent.replace(/\s+/g, '').length,
    };
  });
  R.push({
    name: '操作示意卡是纯图形', expect: 'yes',
    got: (howto.svg === 1 && howto.shapes > 20 && howto.text <= 4) ? 'yes' : 'no',
    extra: 'svg ' + howto.svg + ' / 图形 ' + howto.shapes + ' / 文字 ' + howto.text + ' 字',
  });

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
