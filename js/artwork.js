/* =========================================================
   奶蛙跑酷 · AI 美术素材管线
   —— 把 AI 生成的角色图（纯洋红背景）自动抠图、切片，变成游戏内可用的帧
   支持：立绘（正视图）、跑步精灵图（背视图多帧）
   ========================================================= */
'use strict';

const ART = {
  BASE: 'art/',
  /* 每个角色：p = 立绘，r = 跑步精灵图 */
  manifest: {
    naiwa: { p: 'naiwa-portrait.png', r: 'naiwa-run.png' },
  },
  cache: {},
  loading: {},
  enabled: true,

  /* 抠掉洋红背景：按「洋红程度」软阈值，避免边缘彩边 */
  keyOut(imgData) {
    const d = imgData.data;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i], g = d[i + 1], b = d[i + 2];
      const mag = (r < b ? r : b) - g;         // 洋红程度（黄/橙/白/黑都 <= 0）
      if (mag <= 16) continue;
      if (mag >= 42) { d[i + 3] = 0; continue; }
      d[i + 3] = Math.round(d[i + 3] * (42 - mag) / 26);
    }
    return imgData;
  },

  /* 从整图里切出所有独立角色（按列分组） */
  slice(imgData, W, H) {
    const d = imgData.data;
    const colHit = new Int32Array(W);
    for (let x = 0; x < W; x++) {
      let n = 0;
      for (let y = 0; y < H; y++) if (d[(y * W + x) * 4 + 3] > 40) n++;
      colHit[x] = n;
    }
    const groups = [];
    let cur = null;
    for (let x = 0; x < W; x++) {
      if (colHit[x] >= 4) {
        if (!cur) cur = { x0: x, x1: x };
        else cur.x1 = x;
        cur.gap = 0;
      } else if (cur) {
        cur.gap++;
        if (cur.gap > 14) { groups.push(cur); cur = null; }
      }
    }
    if (cur) groups.push(cur);

    const frames = [];
    const minW = W * 0.035, minH = H * 0.16;
    for (const g of groups) {
      const x0 = g.x0, x1 = g.x1;
      if (x1 - x0 < minW) continue;
      let y0 = H, y1 = -1, px = 0;
      for (let x = x0; x <= x1; x++) {
        for (let y = 0; y < H; y++) {
          if (d[(y * W + x) * 4 + 3] > 40) { if (y < y0) y0 = y; if (y > y1) y1 = y; px++; }
        }
      }
      const w = x1 - x0 + 1, h = y1 - y0 + 1;
      if (h < minH || px < W * H * 0.004) continue;
      // 排除右下角的水印
      if (x1 > W * 0.82 && y0 > H * 0.86) continue;
      const fc = document.createElement('canvas');
      fc.width = w; fc.height = h;
      const fx = fc.getContext('2d');
      const sub = fx.createImageData(w, h);
      for (let y = 0; y < h; y++) {
        const src = ((y0 + y) * W + x0) * 4;
        sub.data.set(d.subarray(src, src + w * 4), y * w * 4);
      }
      fx.putImageData(sub, 0, 0);
      frames.push(fc);
    }
    return frames;
  },

  process(img) {
    const W = img.naturalWidth, H = img.naturalHeight;
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const cx = cv.getContext('2d', { willReadFrequently: true });
    cx.drawImage(img, 0, 0);
    let data;
    try { data = cx.getImageData(0, 0, W, H); }
    catch (e) { return { raw: cv, frames: [cv] }; }   // 跨域等异常时退化为整图
    this.keyOut(data);
    return { raw: cv, frames: this.slice(data, W, H) };
  },

  ensure(skin) {
    const m = this.manifest[skin];
    if (!m || !this.enabled) return Promise.resolve(null);
    if (this.cache[skin]) return Promise.resolve(this.cache[skin]);
    if (this.loading[skin]) return this.loading[skin];
    const load1 = (src) => new Promise((res) => {
      try {
        if (typeof Image === 'undefined') return res(null);
        const im = new Image();
        im.onload = () => res(im);
        im.onerror = () => res(null);
        im.src = this.BASE + src;
      } catch (e) { res(null); }
    });
    const job = Promise.all([m.p ? load1(m.p) : null, m.r ? load1(m.r) : null]).then(([pi, ri]) => {
      const out = { portrait: null, run: [], ready: false };
      if (pi) out.portrait = this.process(pi).frames[0] || null;
      if (ri) out.run = this.process(ri).frames;
      out.ready = !!out.portrait || out.run.length > 0;
      this.cache[skin] = out;
      return out;
    });
    this.loading[skin] = job;
    return job;
  },

  has(skin) { const c = this.cache[skin]; return !!(c && c.ready); },
  get(skin) { return this.cache[skin] || null; },
  portrait(skin) { const c = this.cache[skin]; return c && c.portrait; },
  runFrames(skin) { const c = this.cache[skin]; return (c && c.run) || []; },

  /* 预加载（后台慢慢来） */
  preloadAll(list) {
    let i = 0;
    const next = () => {
      if (i >= list.length) return;
      const s = list[i++];
      this.ensure(s).then(() => setTimeout(next, 220));
    };
    setTimeout(next, 900);
  },
};

/* ---------------- 精灵帧绘制（供渲染器调用） ---------------- */
const ARTDRAW = {
  /* 在「归一化角色空间」里贴一帧精灵：脚底 y=0，身高 1.0 */
  sprite(c, frame, opt) {
    if (!frame) return false;
    const o = opt || {};
    const H = o.h || 1.0;
    const W = H * (frame.width / frame.height) * (o.wScale || 1);
    const alpha = o.alpha == null ? 1 : o.alpha;
    c.save();
    if (alpha < 1) c.globalAlpha = alpha;
    if (o.rot) { c.translate(0, H * 0.45); c.rotate(o.rot); c.translate(0, -H * 0.45); }
    c.translate(o.dx || 0, o.dy || 0);
    if (o.sx || o.sy) c.scale(o.sx || 1, o.sy || 1);
    // 当前坐标系 y 轴向上，图片 y 轴向下，这里翻回来
    c.scale(1, -1);
    c.drawImage(frame, -W / 2, -H, W, H);
    c.restore();
    return true;
  },

  /* 依据动作状态从帧序列里取图并做形变 */
  pose(c, frames, pose) {
    if (!frames || !frames.length) return false;
    const st = pose.state || 'run';
    const n = frames.length;
    const t = pose.t || 0;
    if (st === 'run') {
      const idx = Math.floor(((t % 1) + 1) % 1 * n) % n;
      return this.sprite(c, frames[idx], { sy: 1 + Math.sin(t * Math.PI * 4) * 0.015 });
    }
    if (st === 'idle') {
      return this.sprite(c, frames[0], { sy: 1 + Math.sin(t * Math.PI * 2) * 0.02, dy: 0.008 });
    }
    if (st === 'jump') return this.sprite(c, frames[0], { sy: 1.09, sx: 0.94 });
    if (st === 'fall') return this.sprite(c, frames[0], { sy: 0.95, sx: 1.05 });
    if (st === 'fly') return this.sprite(c, frames[Math.floor(t * 3) % n], { rot: 0.06 });
    if (st === 'roll') return this.sprite(c, frames[0], { rot: -t * Math.PI * 2, h: 0.72, dy: 0.05 });
    if (st === 'crash') return this.sprite(c, frames[0], { rot: -0.8, h: 0.92 });
    return this.sprite(c, frames[Math.floor(t * n) % n], null);
  },
};
