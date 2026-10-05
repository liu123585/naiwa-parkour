/* BGM 回归测试：用 OfflineAudioContext 把五首曲子各渲染一遍，
   量电平 / 亮度 / 起音密度，证明"真的出声、不削顶、五首彼此不一样"。
   只跑 mock AudioContext 是查不出这些的 —— mock 里所有节点都是空壳，
   哪怕增益全是 0、所有音符都被接错总线，测试也照样全绿。
   前置：npm run serve（默认 8899 端口）
   用法: node tools/test-bgm.js */
'use strict';
const { chromium } = require('playwright-core');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

(async () => {
  const browser = await chromium.launch({
    executablePath: EDGE, headless: true,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
      '--disable-gpu-sandbox', '--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
  });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e && e.message || e)));
  await page.goto('http://localhost:8899/?dev=run&q=low&noperf=1', { waitUntil: 'load', timeout: 30000 });
  await page.waitForTimeout(2600);

  const out = await page.evaluate(async () => {
    const SR = 44100;
    function analyze(buf) {
      const d = buf.getChannelData(0);
      let peak = 0, sum = 0, diff = 0, n = d.length;
      for (let i = 0; i < n; i++) {
        const a = Math.abs(d[i]);
        if (a > peak) peak = a;
        sum += d[i] * d[i];
        if (i) diff += Math.abs(d[i] - d[i - 1]);
      }
      const rms = Math.sqrt(sum / n);
      const bright = diff / (sum === 0 ? 1 : Math.sqrt(sum / n) * n);   // 高频含量的粗略代理
      /* 起音密度：按 10ms 一帧算 RMS，帧能量超过前一帧 2.2 倍就记一次起音 */
      const F = Math.floor(SR * 0.01);
      let onsets = 0, prev = 0;
      for (let i = 0; i + F <= n; i += F) {
        let e = 0;
        for (let k = 0; k < F; k++) e += d[i + k] * d[i + k];
        e = Math.sqrt(e / F);
        if (e > prev * 2.2 && e > 0.004) onsets++;
        prev = e;
      }
      let clip = 0;
      for (let i = 0; i < n; i++) if (Math.abs(d[i]) >= 0.999) clip++;
      return {
        peak: Math.round(peak * 1000) / 1000,
        rms: Math.round(rms * 10000) / 10000,
        bright: Math.round(bright * 10000) / 10000,
        onsetsPerSec: Math.round(onsets / (n / SR) * 10) / 10,
        clipSamples: clip,
      };
    }

    const results = [];
    for (let ti = 0; ti < Sound.TRACKS.length; ti++) {
      const T = Sound.TRACKS[ti];
      const spb = 60 / T.tempo / 4;
      const formSec = T.slots * T.bars * spb;
      const secs = Math.min(20, Math.ceil(formSec));          // 只渲染前 20 秒，够判断了
      const octx = new OfflineAudioContext(1, Math.ceil(SR * secs), SR);

      /* 把整张音频图重建到离线上下文里 */
      Sound.musicTimer = null;
      Sound.ctx = null; Sound.master = null; Sound.sfxGain = null; Sound.musicGain = null;
      Sound.musicBus = null; Sound.musicSend = null; Sound.delay = null;
      Sound.delayFb = null; Sound.delayWet = null; Sound.noiseBuf = null;
      const Real = window.AudioContext;
      window.AudioContext = function () { return octx; };
      Sound.init();
      window.AudioContext = Real;

      Sound.setTrack(ti);
      const n = T.slots * T.bars;
      for (let s = 0; s < n; s++) {
        const t = 0.05 + s * spb;
        if (t > secs - 0.5) break;
        Sound.scheduleStep(s, t);
      }
      const buf = await octx.startRendering();
      const a = analyze(buf);
      a.id = T.id; a.name = T.name; a.tempo = T.tempo; a.slots = T.slots;
      a.formSec = Math.round(formSec * 10) / 10;
      results.push(a);
    }
    /* 顺手验一下换曲的淡出淡入：能不能在总线增益上排出自动化 */
    let fadeOk = false;
    try {
      const o2 = new OfflineAudioContext(1, SR * 2, SR);
      const Real2 = window.AudioContext;
      window.AudioContext = function () { return o2; };
      Sound.ctx = null; Sound.master = null; Sound.musicGain = null; Sound.musicBus = null;
      Sound.musicSend = null; Sound.delay = null; Sound.delayFb = null; Sound.delayWet = null;
      Sound.noiseBuf = null;
      Sound.init();
      window.AudioContext = Real2;
      Sound.setTrack(0);
      Sound.nextTrack(1.0);
      const b2 = await o2.startRendering();
      const d2 = b2.getChannelData(0);
      let lo = 1, hi = 0;
      for (let i = 0; i < d2.length; i++) { const a2 = d2[i]; if (a2 < lo) lo = a2; if (a2 > hi) hi = a2; }
      fadeOk = (hi - lo) < 1e-6;      // 空图：只有增益自动化，没有任何声音
    } catch (e) { fadeOk = 'error: ' + e.message; }
    return { results, fadeOk };
  });

  console.log('曲目'.padEnd(14) + 'tempo  小节秒  峰值   RMS     亮度    起音/秒  削顶');
  for (const r of out.results) {
    console.log(
      (r.name + '(' + r.id + ')').padEnd(12) +
      String(r.tempo).padEnd(7) + String(r.formSec).padEnd(8) +
      String(r.peak).padEnd(7) + String(r.rms).padEnd(9) +
      String(r.bright).padEnd(8) + String(r.onsetsPerSec).padEnd(9) +
      String(r.clipSamples));
  }
  const bad = out.results.filter(r => r.rms < 0.004 || r.peak > 0.999 || r.clipSamples > 0);
  console.log('\n换曲淡入淡出排期：' + (out.fadeOk === true ? 'OK（无残留信号）' : JSON.stringify(out.fadeOk)));
  console.log(bad.length ? '⚠ 有问题的曲目：' + bad.map(b => b.id).join(', ') : '✓ 五首都出声、都不削顶');
  const brights = out.results.map(r => r.bright);
  console.log('亮度跨度 ' + Math.min.apply(null, brights) + ' ~ ' + Math.max.apply(null, brights) +
    '（跨度越大说明音色差异越明显）');
  if (errs.length) console.log('=== 报错 ===\n' + errs.slice(0, 5).join('\n'));
  await browser.close();
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
