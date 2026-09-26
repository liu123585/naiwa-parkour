/* =========================================================
   奶蛙跑酷 · 伪 3D 渲染引擎（Canvas 2D 透视投影）
   世界坐标：x 横向 / y 高度(向上) / z 前进方向（相对摄像机）
   ========================================================= */
'use strict';

/* ---------------- 场景主题（昼夜/天气） ---------------- */
const THEMES = {
  day: {
    name: '晴日地铁', skyTop: '#4fb8ef', skyBot: '#cdefff', sun: '#fff6c9', sunGlow: 'rgba(255,246,201,.85)',
    fog: '#cdefff', ballast: '#8e8a7e', ballast2: '#7c786d', sleeper: '#6a6152', sleeper2: '#5c5446',
    rail: '#c9ccd2', railTop: '#eef1f5', wall: '#9aa3ae', wallDark: '#7a838f', wallTop: '#cfd6de',
    bldg: ['#b9c6d6', '#9fb0c4', '#cdd8e4'], win: 'rgba(80,110,140,.35)', lamp: '#ffe9a8',
    ground: '#7fae6a', overlay: 'rgba(0,0,0,0)', star: 0, rain: 0, night: 0,
  },
  dusk: {
    name: '黄昏铁道', skyTop: '#4a4a9e', skyBot: '#ffb26b', sun: '#ffd9a0', sunGlow: 'rgba(255,190,120,.9)',
    fog: '#ffc489', ballast: '#7d7166', ballast2: '#6b6057', sleeper: '#5b5145', sleeper2: '#4d4439',
    rail: '#c2a98f', railTop: '#ffe3c0', wall: '#8a7f84', wallDark: '#6d6266', wallTop: '#bcb0b2',
    bldg: ['#8a7d95', '#6f6478', '#a08a8e'], win: 'rgba(255,214,140,.5)', lamp: '#ffd9a0',
    ground: '#6d8455', overlay: 'rgba(255,140,60,.10)', star: 0.25, rain: 0, night: 0.35,
  },
  night: {
    name: '霓虹夜轨', skyTop: '#0b1030', skyBot: '#25336b', sun: '#dff0ff', sunGlow: 'rgba(200,225,255,.55)',
    fog: '#26305e', ballast: '#43464f', ballast2: '#383b43', sleeper: '#33353c', sleeper2: '#2a2c33',
    rail: '#8b93a4', railTop: '#dfe8f6', wall: '#4a4f5e', wallDark: '#383c48', wallTop: '#666c7c',
    bldg: ['#2c3350', '#232a44', '#39415f'], win: 'rgba(255,226,150,.75)', lamp: '#ffe6a0',
    ground: '#2f3a30', overlay: 'rgba(20,30,80,.30)', star: 1, rain: 0, night: 1,
  },
  rain: {
    name: '雨夜车站', skyTop: '#2b3446', skyBot: '#7d8fa3', sun: '#dfe7ee', sunGlow: 'rgba(200,215,230,.35)',
    fog: '#8b9aab', ballast: '#5e6066', ballast2: '#4f5257', sleeper: '#44464b', sleeper2: '#3a3c40',
    rail: '#9aa2ad', railTop: '#dfe8f2', wall: '#666c76', wallDark: '#4f545c', wallTop: '#8b929c',
    bldg: ['#5a6473', '#48515e', '#6b7482'], win: 'rgba(255,235,170,.6)', lamp: '#ffe6a0',
    ground: '#4d5c4a' , overlay: 'rgba(60,80,110,.22)', star: 0, rain: 1, night: 0.5,
  },
};

function hexMix(a, b, t) {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const r = Math.round(((pa >> 16) & 255) * (1 - t) + ((pb >> 16) & 255) * t);
  const g = Math.round(((pa >> 8) & 255) * (1 - t) + ((pb >> 8) & 255) * t);
  const bl = Math.round((pa & 255) * (1 - t) + (pb & 255) * t);
  return 'rgb(' + r + ',' + g + ',' + bl + ')';
}
function mixTheme(a, b, t) {
  if (t <= 0) return a;
  if (t >= 1) return b;
  const out = {};
  for (const k in a) {
    const va = a[k], vb = b[k];
    if (typeof va === 'string' && va[0] === '#') out[k] = hexMix(va, vb, t);
    else if (typeof va === 'number') out[k] = va + (vb - va) * t;
    else if (Array.isArray(va)) out[k] = va.map((c, i) => hexMix(c, vb[i], t));
    else out[k] = va;
  }
  out.name = t > 0.5 ? b.name : a.name;
  return out;
}

/* =========================================================
   渲染器
   ========================================================= */
const Renderer = {
  canvas: null, c: null, W: 0, H: 0, dpr: 1,
  f: 800, horizon: 300, camX: 0, camY: CFG.CAM_Y, cx: 0,
  skyGrad: null, theme: THEMES.day,
  sprites: {},
  quality: 'mid',
  dprScale: 1, fxLow: false,

  init(canvas) {
    this.canvas = canvas;
    this.c = canvas.getContext('2d', { alpha: false });
    this.buildSprites();
    this.resize();
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('orientationchange', () => setTimeout(() => this.resize(), 250));
  },

  resize() {
    const q = this.quality || 'mid';
    const maxDpr = (CFG.DPR_MAX[q] || 1.25) * (this.dprScale || 1);
    this.dpr = Math.min(maxDpr, window.devicePixelRatio || 1);
    this.W = window.innerWidth;
    this.H = window.innerHeight;
    this.canvas.width = Math.floor(this.W * this.dpr);
    this.canvas.height = Math.floor(this.H * this.dpr);
    this.canvas.style.width = this.W + 'px';
    this.canvas.style.height = this.H + 'px';
    this.c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    // 焦距：竖屏时按宽度限制，保证三条道不越界
    const fv = (this.H / 2) / Math.tan((CFG.FOV_Y * Math.PI / 180) / 2);
    this.f = Math.min(fv, this.W * 0.80);
    this.horizon = this.H * 0.5;
    this.cx = this.W / 2;
    this.skyGrad = null;
  },

  /* ---------------- 预渲染精灵（金币/道具） ---------------- */
  buildSprites() {
    const mk = (size, fn) => {
      const cv = document.createElement('canvas');
      cv.width = cv.height = size;
      const c = cv.getContext('2d');
      c.translate(size / 2, size / 2);
      fn(c, size);
      return cv;
    };
    this.sprites.coin = mk(96, (c) => {
      const g = c.createRadialGradient(-8, -10, 4, 0, 0, 44);
      g.addColorStop(0, '#fff8c9'); g.addColorStop(.45, '#ffd33d'); g.addColorStop(1, '#e09700');
      c.fillStyle = g; c.beginPath(); c.arc(0, 0, 40, 0, Math.PI * 2); c.fill();
      c.strokeStyle = 'rgba(255,255,255,.85)'; c.lineWidth = 4; c.beginPath(); c.arc(0, 0, 32, 0, Math.PI * 2); c.stroke();
      c.fillStyle = '#e8a200'; c.beginPath(); c.arc(0, 0, 22, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#8a5b00'; c.font = 'bold 30px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText('奶', 0, 2);
    });
    const powers = {
      magnet: { col: '#ff5b5b', col2: '#ff9c9c' }, jet: { col: '#4f9dff', col2: '#a9d1ff' },
      x2: { col: '#ffd34d', col2: '#fff3c0', txt: 'x2' }, shoe: { col: '#ff8b2b', col2: '#ffc389' },
      board: { col: '#ff4fb0', col2: '#ffb1dd' },
    };
    for (const k in powers) {
      const p = powers[k];
      this.sprites['p_' + k] = mk(112, (c, size) => {
        c.fillStyle = 'rgba(255,255,255,.95)';
        c.beginPath(); c.arc(0, 0, 46, 0, Math.PI * 2); c.fill();
        const g = c.createLinearGradient(0, -44, 0, 44);
        g.addColorStop(0, p.col2); g.addColorStop(1, p.col);
        c.fillStyle = g; c.beginPath(); c.arc(0, 0, 40, 0, Math.PI * 2); c.fill();
        c.fillStyle = 'rgba(255,255,255,.35)'; c.beginPath(); c.arc(-12, -16, 14, 0, Math.PI * 2); c.fill();
        c.fillStyle = '#20232a'; c.strokeStyle = '#20232a';
        if (k === 'magnet') {
          c.lineWidth = 11; c.lineCap = 'round';
          c.beginPath(); c.arc(0, 4, 17, Math.PI, 0); c.stroke();
          c.lineWidth = 11; c.beginPath(); c.moveTo(-17, 4); c.lineTo(-17, 18); c.moveTo(17, 4); c.lineTo(17, 18); c.stroke();
          c.fillStyle = '#fff'; c.fillRect(-23, 15, 12, 9); c.fillRect(11, 15, 12, 9);
        } else if (k === 'jet') {
          c.fillStyle = '#20232a';
          c.beginPath(); c.moveTo(-13, -14); c.quadraticCurveTo(0, -30, 13, -14);
          c.lineTo(13, 12); c.quadraticCurveTo(0, 20, -13, 12); c.closePath(); c.fill();
          c.fillStyle = '#ffd34d';
          c.beginPath(); c.moveTo(-12, 14); c.lineTo(-5, 34); c.lineTo(0, 16); c.closePath(); c.fill();
          c.beginPath(); c.moveTo(12, 14); c.lineTo(5, 34); c.lineTo(0, 16); c.closePath(); c.fill();
        } else if (k === 'shoe') {
          c.fillStyle = '#20232a';
          c.beginPath(); c.moveTo(-22, 10); c.lineTo(-14, -8); c.quadraticCurveTo(0, -16, 14, -2);
          c.lineTo(22, 8); c.quadraticCurveTo(22, 16, 10, 16); c.lineTo(-14, 16); c.quadraticCurveTo(-22, 16, -22, 10); c.closePath(); c.fill();
          c.fillStyle = '#ffd34d'; c.fillRect(-20, 10, 40, 5);
        } else if (k === 'board') {
          c.fillStyle = '#20232a'; c.save(); c.rotate(-0.28);
          c.beginPath(); c.ellipse(0, 0, 26, 9, 0, 0, Math.PI * 2); c.fill(); c.restore();
          c.fillStyle = '#fff'; c.fillRect(-18, -4, 6, 8); c.fillRect(-6, -4, 6, 8); c.fillRect(6, -4, 6, 8);
        } else {
          c.font = 'bold 38px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
          c.fillStyle = '#5a3d00'; c.fillText('x2', 0, 2);
        }
      });
    }
    // 检票员与狗不需要精灵
  },

  /* ---------------- 投影 ---------------- */
  proj(x, y, z) {
    if (z < CFG.NEAR) return null;
    const s = this.f / z;
    return { sx: this.cx + (x - this.camX) * s, sy: this.horizon + (this.camY - y) * s, s: s };
  },
  setCamera(camX, camY) { this.camX = camX; this.camY = camY; },

  /* ---------------- 天空 ---------------- */
  drawSky(theme, travel, t) {
    const c = this.c, W = this.W, H = this.H;
    if (!this.skyGrad || this._skyKey !== theme.skyTop + theme.skyBot) {
      const g = c.createLinearGradient(0, 0, 0, this.horizon + 10);
      g.addColorStop(0, theme.skyTop); g.addColorStop(1, theme.skyBot);
      this.skyGrad = g; this._skyKey = theme.skyTop + theme.skyBot;
    }
    c.fillStyle = this.skyGrad;
    c.fillRect(0, 0, W, this.horizon + 12);

    // 星星
    if (theme.star > 0.02) {
      c.globalAlpha = theme.star * 0.9;
      for (let i = 0; i < 60; i++) {
        const sx = ((i * 937) % 1000) / 1000 * W;
        const sy = (((i * 577) % 1000) / 1000) * this.horizon * 0.85;
        const r = (i % 3) * 0.4 + 0.7;
        c.fillStyle = i % 7 === 0 ? '#ffe9b0' : '#ffffff';
        c.fillRect(sx, sy, r, r);
      }
      c.globalAlpha = 1;
    }

    // 太阳 / 月亮
    const sunX = W * 0.74, sunY = this.horizon * 0.34;
    const rg = c.createRadialGradient(sunX, sunY, 4, sunX, sunY, 84);
    rg.addColorStop(0, theme.sunGlow); rg.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = rg; c.beginPath(); c.arc(sunX, sunY, 84, 0, Math.PI * 2); c.fill();
    c.fillStyle = theme.sun; c.beginPath(); c.arc(sunX, sunY, 26, 0, Math.PI * 2); c.fill();

    // 云
    const cloudCol = theme.night > .5 ? 'rgba(210,225,255,' + (0.16 + 0.14 * theme.night) + ')' : 'rgba(255,255,255,.75)';
    c.fillStyle = cloudCol;
    const coff = (travel * 0.9) % 1400;
    for (let i = 0; i < 5; i++) {
      const bx = ((i * 320 + i * i * 60) - coff) % (W + 420);
      const x = bx < -200 ? bx + W + 420 : bx;
      const y = this.horizon * (0.22 + (i % 3) * 0.14);
      const sc = 0.7 + (i % 4) * 0.22;
      c.beginPath();
      c.arc(x, y, 26 * sc, 0, Math.PI * 2); c.arc(x + 30 * sc, y + 6 * sc, 20 * sc, 0, Math.PI * 2);
      c.arc(x - 28 * sc, y + 8 * sc, 17 * sc, 0, Math.PI * 2); c.arc(x + 6 * sc, y - 14 * sc, 19 * sc, 0, Math.PI * 2);
      c.fill();
    }

    // 远景城市剪影（两层视差）
    const layers = [
      { off: travel * 0.25, col: theme.bldg[0], base: 0.98, hmin: 40, hmax: 130, gap: 54, alpha: .55 },
      { off: travel * 0.55, col: theme.bldg[1], base: 1.0, hmin: 26, hmax: 88, gap: 42, alpha: .75 },
    ];
    layers.forEach((L, li) => {
      c.globalAlpha = L.alpha;
      c.fillStyle = L.col;
      const total = W + 600;
      const start = -((L.off % L.gap) + L.gap);
      for (let x = start; x < total; x += L.gap) {
        const seed = Math.floor((x + L.off) / L.gap);
        const h = L.hmin + ((seed * 7919) % 1000) / 1000 * (L.hmax - L.hmin);
        const w = L.gap - 6 - ((seed * 131) % 8);
        c.fillRect(x, this.horizon - h, w, h + 6);
        if (theme.night > .3 && li === 1) {
          c.globalAlpha = L.alpha * theme.night * 0.7;
          c.fillStyle = theme.win;
          for (let wy = this.horizon - h + 8; wy < this.horizon - 8; wy += 12) {
            for (let wx = x + 5; wx < x + w - 6; wx += 11) {
              if (((wx * 31 + wy * 17 + seed * 7) % 5) < 2) c.fillRect(wx, wy, 5, 6);
            }
          }
          c.globalAlpha = L.alpha; c.fillStyle = L.col;
        }
      }
      c.globalAlpha = 1;
    });
  },

  /* ---------------- 地面 / 铁轨 / 侧墙 ---------------- */
  drawGround(theme, travel, nightLight) {
    const c = this.c, W = this.W, H = this.H;
    const g = c.createLinearGradient(0, this.horizon, 0, H);
    g.addColorStop(0, theme.ballast2); g.addColorStop(0.35, theme.ballast); g.addColorStop(1, theme.ballast2);
    c.fillStyle = g;
    c.fillRect(0, this.horizon - 1, W, H - this.horizon + 1);

    // 枕木
    const gap = CFG.SLEEPER_GAP, off = travel % gap;
    c.fillStyle = theme.sleeper;
    const RH = CFG.ROAD_HALF + 0.55;
    for (let i = Math.floor(CFG.FAR / gap); i >= 0; i--) {
      const z = i * gap - off;
      if (z < CFG.NEAR + 0.2 || z > CFG.FAR) continue;
      const p1 = this.proj(-RH, 0, z), p2 = this.proj(RH, 0, z);
      const p3 = this.proj(RH, 0, z + 0.62), p4 = this.proj(-RH, 0, z + 0.62);
      if (!p1 || !p2 || !p3 || !p4) continue;
      c.fillStyle = (i % 2 === 0) ? theme.sleeper : theme.sleeper2;
      c.beginPath(); c.moveTo(p1.sx, p1.sy); c.lineTo(p2.sx, p2.sy); c.lineTo(p3.sx, p3.sy); c.lineTo(p4.sx, p4.sy);
      c.closePath(); c.fill();
    }

    // 铁轨（每条车道两根）
    const railBase = this.shadeCol(theme.rail, 0.62), railLight = this.shadeCol(theme.rail, 0.86);
    for (let ln = 0; ln < CFG.LANES; ln++) {
      const lx = Utils.laneX(ln);
      for (const sgn of [-1, 1]) {
        const rx = lx + sgn * CFG.RAIL_HALF;
        const quad = (x0, x1, y, col) => {
          const a = this.proj(x0, y, CFG.NEAR + 0.1), b = this.proj(x1, y, CFG.NEAR + 0.1);
          const d = this.proj(x1, y, CFG.FAR), e = this.proj(x0, y, CFG.FAR);
          if (!a || !b || !d || !e) return;
          c.fillStyle = col;
          c.beginPath(); c.moveTo(a.sx, a.sy); c.lineTo(b.sx, b.sy); c.lineTo(d.sx, d.sy); c.lineTo(e.sx, e.sy); c.closePath(); c.fill();
        };
        quad(rx - 0.075, rx + 0.075, 0.02, 'rgba(0,0,0,.28)');   // 轨枕阴影
        quad(rx - 0.055, rx + 0.055, 0.06, railBase);            // 轨身
        quad(rx - 0.02, rx + 0.02, 0.10, railLight);             // 轨面
      }
    }

    // 侧墙
    const wallH = 2.7;
    for (const sgn of [-1, 1]) {
      const x = sgn * CFG.WALL_X;
      const zn = CFG.NEAR + 0.2, zf = CFG.FAR;
      const b1 = this.proj(x, 0, zn), t1 = this.proj(x, wallH, zn);
      const t2 = this.proj(x, wallH, zf), b2 = this.proj(x, 0, zf);
      if (b1 && t1 && t2 && b2) {
        const wg = c.createLinearGradient(0, t2.sy, 0, b1.sy);
        wg.addColorStop(0, theme.wallTop); wg.addColorStop(0.25, theme.wall); wg.addColorStop(1, theme.wallDark);
        c.fillStyle = wg;
        c.beginPath(); c.moveTo(b1.sx, b1.sy); c.lineTo(t1.sx, t1.sy); c.lineTo(t2.sx, t2.sy); c.lineTo(b2.sx, b2.sy);
        c.closePath(); c.fill();
      }
      // 墙面彩色涂鸦板 + 立柱
      const pgap = 9;
      for (let i = Math.floor(CFG.FAR / pgap); i >= 0; i--) {
        const z = i * pgap - (travel % pgap);
        if (z < CFG.NEAR + 1 || z > CFG.FAR * 0.8) continue;
        const seed = Math.floor((travel - travel % pgap) / pgap) + i;
        const y0 = 0.45 + ((seed * 37) % 10) / 40, y1 = y0 + 1.15;
        const p1 = this.proj(x, y0, z), p2 = this.proj(x, y1, z + 3.4);
        if (!p1 || !p2) continue;
        const alpha = Utils.clamp(1 - z / (CFG.FAR * 0.8), 0.15, 1);
        c.globalAlpha = alpha * 0.75;
        c.fillStyle = ['#e6423c', '#4bb8ff', '#ffd34d', '#7cd44a', '#a06bff'][seed % 5];
        const q3 = this.proj(x, y1, z), q4 = this.proj(x, y0, z + 3.4);
        if (q3 && q4) { c.beginPath(); c.moveTo(p1.sx, p1.sy); c.lineTo(q3.sx, q3.sy); c.lineTo(p2.sx, p2.sy); c.lineTo(q4.sx, q4.sy); c.closePath(); c.fill(); }
        c.globalAlpha = 1;
      }
      // 立柱
      for (let i = Math.floor(CFG.FAR / 12); i >= 0; i--) {
        const z = i * 12 - (travel % 12);
        if (z < CFG.NEAR + 0.5 || z > CFG.FAR * 0.85) continue;
        const a = this.proj(x, 0, z), b = this.proj(x, wallH + 0.35, z);
        if (!a || !b) continue;
        const wdt = 0.28 * a.s;
        c.fillStyle = theme.wallDark;
        c.fillRect(Math.min(a.sx, b.sx) - wdt / 2, b.sy, wdt, a.sy - b.sy);
        c.fillStyle = theme.wallTop;
        c.fillRect(Math.min(a.sx, b.sx) - wdt / 2, b.sy, wdt, Math.max(1, (a.sy - b.sy) * 0.08));
      }
      // 路灯（夜间发光）—— 已由接触网立柱承担，这里只保留灯头
      for (let i = Math.floor(CFG.FAR / 18); i >= 0; i--) {
        const z = i * 18 - (travel % 18) + 4;
        if (z < CFG.NEAR + 1 || z > CFG.FAR * 0.9) continue;
        const lx = sgn * (CFG.WALL_X - 0.35);
        const bp = this.proj(lx, wallH, z), tp = this.proj(lx, wallH + 1.5, z);
        if (!bp || !tp) continue;
        c.strokeStyle = theme.wallDark; c.lineWidth = Math.max(1, 0.1 * bp.s);
        c.beginPath(); c.moveTo(bp.sx, bp.sy); c.lineTo(tp.sx, tp.sy); c.stroke();
        const gr = 0.42 * bp.s;
        const rad = c.createRadialGradient(tp.sx, tp.sy, 1, tp.sx, tp.sy, gr * 3);
        rad.addColorStop(0, 'rgba(255,236,170,' + (0.55 + 0.35 * theme.night) + ')');
        rad.addColorStop(1, 'rgba(255,236,170,0)');
        c.fillStyle = rad; c.beginPath(); c.arc(tp.sx, tp.sy, gr * 3, 0, Math.PI * 2); c.fill();
      }
    }
    this.drawCatenary(theme, travel);
  },

  /* ---------------- 接触网（架空电线 + 支架），增强「地铁/铁道」感 ---------------- */
  drawCatenary(theme, travel) {
    const c = this.c;
    const hy = 4.15;
    // 沿轨道的接触线
    c.strokeStyle = this.shadeCol(theme.rail, 0.8);
    c.lineWidth = 1.4;
    for (let ln = 0; ln < CFG.LANES; ln++) {
      const lx = Utils.laneX(ln);
      for (const sgn of [-1, 1]) {
        const a = this.proj(lx + sgn * 0.75, hy, CFG.NEAR + 0.2);
        const b = this.proj(lx + sgn * 0.75, hy, CFG.FAR * 0.92);
        if (!a || !b) continue;
        c.beginPath(); c.moveTo(a.sx, a.sy); c.lineTo(b.sx, b.sy); c.stroke();
      }
    }
    // 横向吊弦与支架
    const gap = 22;
    for (let i = Math.floor(CFG.FAR / gap); i >= 0; i--) {
      const z = i * gap - (travel % gap);
      if (z < CFG.NEAR + 1.5 || z > CFG.FAR * 0.9) continue;
      const l = this.proj(-CFG.WALL_X + 0.15, hy + 0.25, z), r = this.proj(CFG.WALL_X - 0.15, hy + 0.25, z);
      if (!l || !r) continue;
      c.strokeStyle = this.shadeCol(theme.wallDark, 0.95);
      c.lineWidth = Math.max(1, 0.05 * l.s);
      c.beginPath(); c.moveTo(l.sx, l.sy); c.lineTo(r.sx, r.sy); c.stroke();
      // 立柱延伸到接触网高度
      for (const sgn of [-1, 1]) {
        const x = sgn * (CFG.WALL_X - 0.15);
        const b0 = this.proj(x, 2.6, z), t0 = this.proj(x, hy + 0.3, z);
        if (!b0 || !t0) continue;
        c.fillStyle = this.shadeCol(theme.wallDark, 0.8);
        const wdt = Math.max(1, 0.16 * b0.s);
        c.fillRect(Math.min(b0.sx, t0.sx) - wdt / 2, t0.sy, wdt, Math.max(1, b0.sy - t0.sy));
      }
    }
  },

  /* ---------------- 3D 方盒 ---------------- */
  boxFaces(o, cb) {
    const z0 = Math.max(o.z0, CFG.NEAR + 0.03), z1 = o.z1;
    if (z1 <= CFG.NEAR + 0.05) return null;
    const p = (x, y, z) => this.proj(x, y, z);
    const A = p(o.x0, o.y0, z0), B = p(o.x1, o.y0, z0), C = p(o.x1, o.y1, z0), D = p(o.x0, o.y1, z0);
    const E = p(o.x0, o.y1, z1), F = p(o.x1, o.y1, z1);
    const G = p(o.x0, o.y0, z1), H = p(o.x1, o.y0, z1);
    if (!A || !B || !F || !G) return null;
    const res = { front: null, top: null, side: null, near: o.z0 > CFG.NEAR + 0.05 };
    if (res.near && C && D) res.front = [A, B, C, D];
    if (this.camY > o.y1 && E && F) res.top = [D, C, F, E];
    if (this.camX < o.x0 && E && G) res.side = [A, D, E, G];
    else if (this.camX > o.x1 && F && H) res.side = [B, C, F, H];
    return res;
  },
  fillQuad(pts, fill) {
    const c = this.c;
    c.fillStyle = fill;
    c.beginPath(); c.moveTo(pts[0].sx, pts[0].sy);
    for (let i = 1; i < pts.length; i++) c.lineTo(pts[i].sx, pts[i].sy);
    c.closePath(); c.fill();
  },
  shadeCol(hex, k) {
    const p = parseInt(hex.slice(1), 16);
    const r = Utils.clamp(Math.round(((p >> 16) & 255) * k), 0, 255);
    const g = Utils.clamp(Math.round(((p >> 8) & 255) * k), 0, 255);
    const b = Utils.clamp(Math.round((p & 255) * k), 0, 255);
    return 'rgb(' + r + ',' + g + ',' + b + ')';
  },

  /* 火车车厢 */
  drawTrain(o) {
    const F = this.boxFaces(o);
    if (!F) return;
    const c = this.c, body = o.color;
    c.globalAlpha = o.alpha == null ? 1 : o.alpha;
    if (F.side) this.fillQuad(F.side, this.shadeCol(body, 0.62));
    if (F.top) this.fillQuad(F.top, this.shadeCol(body, 1.22));
    if (F.front) {
      this.fillQuad(F.front, this.shadeCol(body, 0.86));
      // 车窗 + 车门（在前脸上插值绘制）
      const [A, B, C, D] = F.front;
      const mix = (p, q, t) => ({ sx: p.sx + (q.sx - p.sx) * t, sy: p.sy + (q.sy - p.sy) * t });
      const band = (y0, y1, col) => {
        const bl = mix(A, D, y0), br = mix(B, C, y0), tr = mix(B, C, y1), tl = mix(A, D, y1);
        this.fillQuad([bl, br, tr, tl], col);
      };
      band(0.52, 0.92, 'rgba(20,28,42,.75)');      // 挡风玻璃
      band(0.52, 0.92, 'rgba(255,255,255,.10)');
      if (o.h > 2) {
        band(0.10, 0.44, this.shadeCol(body, 0.7));
        band(0.24, 0.34, 'rgba(0,0,0,.18)');
      }
      // 前灯
      if (this.theme.night > 0.35 || o.headlight) {
        const hl = mix(A, B, 0.2), hr = mix(A, B, 0.8);
        const gg = c.createRadialGradient(hl.sx, hl.sy, 1, hl.sx, hl.sy, 16 * A.s * 0.3);
        gg.addColorStop(0, 'rgba(255,240,190,.95)'); gg.addColorStop(1, 'rgba(255,240,190,0)');
        c.fillStyle = gg; c.beginPath(); c.arc(hl.sx, hl.sy, 16 * A.s * 0.3, 0, Math.PI * 2); c.fill();
        const g2 = c.createRadialGradient(hr.sx, hr.sy, 1, hr.sx, hr.sy, 14 * A.s * 0.3);
        g2.addColorStop(0, 'rgba(255,230,170,.9)'); g2.addColorStop(1, 'rgba(255,230,170,0)');
        c.fillStyle = g2; c.beginPath(); c.arc(hr.sx, hr.sy, 14 * A.s * 0.3, 0, Math.PI * 2); c.fill();
      }
      // 编号条
      band(0.94, 1.0, 'rgba(255,255,255,.35)');
    }
    if (F.side && o.windows !== false) {
      // 侧面车窗条纹
      const [A, D, E, G] = F.side;
      const mix = (p, q, t) => ({ sx: p.sx + (q.sx - p.sx) * t, sy: p.sy + (q.sy - p.sy) * t });
      const ra = mix(D, E, 0.28), rb = mix(D, E, 0.72), rc = mix(A, G, 0.72), rd = mix(A, G, 0.28);
      c.fillStyle = 'rgba(25,33,48,.55)';
      c.beginPath(); c.moveTo(ra.sx, ra.sy); c.lineTo(rb.sx, rb.sy); c.lineTo(rc.sx, rc.sy); c.lineTo(rd.sx, rd.sy);
      c.closePath(); c.fill();
    }
    c.globalAlpha = 1;
  },

  /* 装饰障碍物：栏杆 / 垃圾桶 / 限高架 / 交通锥 / 跳台 */
  drawObstacle(o) {
    const c = this.c;
    if (o.type === 'barrier') {
      const F = this.boxFaces({ x0: o.x - 1.0, x1: o.x + 1.0, y0: 0, y1: 1.05, z0: o.z, z1: o.z + 0.5 });
      if (!F) return;
      if (F.side) this.fillQuad(F.side, '#b8462f');
      if (F.top) this.fillQuad(F.top, '#e2664a');
      if (F.front) {
        const [A, B, C, D] = F.front;
        this.fillQuad(F.front, '#f2f2ef');
        const mix = (p, q, t) => ({ sx: p.sx + (q.sx - p.sx) * t, sy: p.sy + (q.sy - p.sy) * t });
        for (let i = 0; i < 4; i++) {
          const t0 = i / 4 + 0.02, t1 = i / 4 + 0.12;
          this.fillQuad([mix(A, B, t0), mix(A, B, t1), mix(C, D, t1 + 0.16), mix(C, D, t0 + 0.16)], '#e6423c');
        }
        // 支腿
        c.fillStyle = '#6b6b6b';
        const legW = Math.max(1.5, 0.09 * A.s);
        c.fillRect(A.sx - legW / 2, A.sy, legW, 0.16 * A.s);
        c.fillRect(B.sx - legW / 2, B.sy, legW, 0.16 * B.s);
      }
    } else if (o.type === 'dumpster') {
      const F = this.boxFaces({ x0: o.x - 0.82, x1: o.x + 0.82, y0: 0, y1: 1.28, z0: o.z, z1: o.z + 1.5 });
      if (!F) return;
      if (F.side) this.fillQuad(F.side, '#2f7a45');
      if (F.top) this.fillQuad(F.top, '#49a35e');
      if (F.front) {
        this.fillQuad(F.front, '#3f9455');
        const [A, B, C, D] = F.front;
        const mix = (p, q, t) => ({ sx: p.sx + (q.sx - p.sx) * t, sy: p.sy + (q.sy - p.sy) * t });
        this.fillQuad([mix(A, D, 0.72), mix(B, C, 0.72), mix(B, C, 0.9), mix(A, D, 0.9)], '#2c6c3d');
        this.fillQuad([mix(A, D, 0.62), mix(B, C, 0.62), mix(B, C, 0.7), mix(A, D, 0.7)], '#67bd79');
      }
    } else if (o.type === 'highbar') {
      // 两侧立柱 + 横梁（需滑铲）
      for (const sgn of [-1, 1]) {
        const px = o.x + sgn * 1.15;
        const F = this.boxFaces({ x0: px - 0.09, x1: px + 0.09, y0: 0, y1: 2.75, z0: o.z, z1: o.z + 0.24 });
        if (F) { if (F.side) this.fillQuad(F.side, '#8a9099'); if (F.front) this.fillQuad(F.front, '#aab1ba'); if (F.top) this.fillQuad(F.top, '#c6ccd4'); }
      }
      const F2 = this.boxFaces({ x0: o.x - 1.2, x1: o.x + 1.2, y0: 1.35, y1: 2.55, z0: o.z, z1: o.z + 0.24 });
      if (!F2) return;
      if (F2.side) this.fillQuad(F2.side, '#c99a1c');
      if (F2.top) this.fillQuad(F2.top, '#e0b23a');
      if (F2.front) {
        const [A, B, C, D] = F2.front;
        this.fillQuad(F2.front, '#ffd34d');
        const mix = (p, q, t) => ({ sx: p.sx + (q.sx - p.sx) * t, sy: p.sy + (q.sy - p.sy) * t });
        for (let i = 0; i < 5; i++) {
          const t0 = i / 5 + 0.03, t1 = i / 5 + 0.11;
          this.fillQuad([mix(A, B, t0), mix(A, B, t1), mix(C, D, t1 + 0.2), mix(C, D, t0 + 0.2)], '#232323');
        }
        this.fillQuad([mix(A, D, 0), mix(B, C, 0), mix(B, C, 0.12), mix(A, D, 0.12)], 'rgba(0,0,0,.25)');
      }
    } else if (o.type === 'cone') {
      const p = this.proj(o.x, 0, o.z);
      if (!p) return;
      const h = 0.62 * p.s, w = 0.42 * p.s;
      c.fillStyle = '#ff7a1a';
      c.beginPath(); c.moveTo(p.sx, p.sy - h); c.lineTo(p.sx + w / 2, p.sy); c.lineTo(p.sx - w / 2, p.sy); c.closePath(); c.fill();
      c.fillStyle = '#fff';
      c.fillRect(p.sx - w * 0.3, p.sy - h * 0.55, w * 0.6, h * 0.16);
      this.fillQuad([{ sx: p.sx - w * 0.6, sy: p.sy }, { sx: p.sx + w * 0.6, sy: p.sy }], 'rgba(0,0,0,0)');
      c.fillStyle = 'rgba(0,0,0,.25)';
      c.beginPath(); c.ellipse(p.sx, p.sy, w * 0.62, w * 0.2, 0, 0, Math.PI * 2); c.fill();
    } else if (o.type === 'spring') {
      const F = this.boxFaces({ x0: o.x - 0.85, x1: o.x + 0.85, y0: 0, y1: 0.42, z0: o.z, z1: o.z + 1.1 });
      if (!F) return;
      if (F.side) this.fillQuad(F.side, '#6f4bd8');
      if (F.top) this.fillQuad(F.top, '#9a7bff');
      if (F.front) {
        this.fillQuad(F.front, '#8a68f0');
        const [A, B, C, D] = F.front;
        const mix = (p, q, t) => ({ sx: p.sx + (q.sx - p.sx) * t, sy: p.sy + (q.sy - p.sy) * t });
        this.fillQuad([mix(A, D, 0.3), mix(B, C, 0.3), mix(B, C, 0.62), mix(A, D, 0.62)], '#ffd34d');
      }
    }
  },

  /* 金币 */
  drawCoin(o) {
    const p = this.proj(o.x, o.y, o.z);
    if (!p) return;
    const size = 0.62 * p.s * (o.scale || 1);
    if (size < 1.2) return;
    const spin = Math.abs(Math.cos(o.spin || 0));
    this.c.save();
    this.c.globalAlpha = o.alpha == null ? 1 : o.alpha;
    this.c.translate(p.sx, p.sy);
    this.c.scale(Math.max(0.25, spin), 1);
    this.c.drawImage(this.sprites.coin, -size / 2, -size / 2, size, size);
    this.c.restore();
    this.c.globalAlpha = 1;
  },

  /* 道具球 */
  drawPower(o) {
    const p = this.proj(o.x, o.y, o.z);
    if (!p) return;
    const size = 1.15 * p.s;
    const spr = this.sprites['p_' + o.kind];
    if (!spr) return;
    const bob = Math.sin((o.t || 0) * 2.4 + (o.seed || 0)) * 0.12;
    const c = this.c;
    const py = p.sy - bob * p.s;
    const rad = size * 0.85;
    const g = c.createRadialGradient(p.sx, py, 1, p.sx, py, rad);
    g.addColorStop(0, 'rgba(255,255,255,.45)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g; c.beginPath(); c.arc(p.sx, py, rad, 0, Math.PI * 2); c.fill();
    c.drawImage(spr, p.sx - size / 2, py - size / 2, size, size);
  },

  /* 角色（广告牌） */
  drawChar(skin, x, y, z, pose, worldH, opts) {
    const p = this.proj(x, y, z);
    if (!p) return;
    const hp = (worldH || CFG.PLAYER_H) * p.s;
    if (hp < 3) return;
    const c = this.c;
    c.save();
    c.translate(p.sx, p.sy);
    c.scale(hp, -hp);
    CharArtAPI.draw(c, skin, pose);
    c.restore();
    if (opts && opts.after) opts.after(c, p, hp);
  },

  /* 悬浮板（画在角色脚下） */
  drawHoverboard(x, y, z, worldW, t, color) {
    const p = this.proj(x, y, z);
    if (!p) return;
    const c = this.c;
    const w = worldW * p.s, h = 0.16 * p.s;
    const tilt = Math.sin(t * 3) * 0.06;
    c.save();
    c.translate(p.sx, p.sy);
    c.rotate(tilt);
    const g = c.createLinearGradient(0, -h, 0, h);
    g.addColorStop(0, color ? color[0] : '#ff8ad0'); g.addColorStop(1, color ? color[1] : '#e0348f');
    c.fillStyle = g;
    this.rr(c, -w / 2, -h * 0.6, w, h * 1.2, h * 0.6);
    c.fillStyle = 'rgba(255,255,255,.5)';
    this.rr(c, -w / 2 + w * 0.08, -h * 0.18, w * 0.84, h * 0.32, h * 0.16);
    // 尾焰
    const fg = c.createLinearGradient(0, h, 0, h + 26);
    fg.addColorStop(0, 'rgba(255,120,220,.85)'); fg.addColorStop(1, 'rgba(255,120,220,0)');
    c.fillStyle = fg;
    c.beginPath(); c.moveTo(-w * 0.3, h); c.lineTo(0, h + 26 + Math.sin(t * 20) * 5); c.lineTo(w * 0.3, h); c.closePath(); c.fill();
    c.restore();
  },

  rr(c, x, y, w, h, r) {
    r = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
    c.beginPath();
    c.moveTo(x + r, y); c.lineTo(x + w - r, y); c.quadraticCurveTo(x + w, y, x + w, y + r);
    c.lineTo(x + w, y + h - r); c.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    c.lineTo(x + r, y + h); c.quadraticCurveTo(x, y + h, x, y + h - r);
    c.lineTo(x, y + r); c.quadraticCurveTo(x, y, x + r, y); c.closePath(); c.fill();
  },

  /* 阴影 */
  drawShadow(x, z, scale, alpha) {
    const p = this.proj(x, 0.02, z);
    if (!p) return;
    const c = this.c;
    const rx = 0.46 * scale * p.s, ry = 0.16 * scale * p.s;
    if (rx < 1) return;
    c.globalAlpha = alpha;
    c.fillStyle = '#000';
    c.beginPath(); c.ellipse(p.sx, p.sy, rx, ry, 0, 0, Math.PI * 2); c.fill();
    c.globalAlpha = 1;
  },

  /* 粒子（世界坐标小方块/圆点） */
  drawParticle(pt) {
    const p = this.proj(pt.x, pt.y, pt.z);
    if (!p) return;
    const c = this.c;
    const s = Math.max(1, pt.r * p.s);
    c.globalAlpha = Utils.clamp(pt.life / pt.max, 0, 1);
    c.fillStyle = pt.color;
    if (pt.shape === 'line') {
      const p2 = this.proj(pt.x, pt.y + pt.len, pt.z);
      if (p2) { c.strokeStyle = pt.color; c.lineWidth = s; c.beginPath(); c.moveTo(p.sx, p.sy); c.lineTo(p2.sx, p2.sy); c.stroke(); }
    } else {
      c.beginPath(); c.arc(p.sx, p.sy, s, 0, Math.PI * 2); c.fill();
    }
    c.globalAlpha = 1;
  },

  /* 全屏特效：雨 / 雾 / 速度线 / 暗角 */
  drawWeather(theme, time, speedRatio) {
    const c = this.c, W = this.W, H = this.H;
    if (theme.rain > 0.05) {
      c.strokeStyle = 'rgba(200,225,255,.45)';
      c.lineWidth = 1.4;
      const n = Math.floor(90 * theme.rain);
      for (let i = 0; i < n; i++) {
        const seed = i * 97.13;
        const x = ((seed * 137 + time * 320) % (W + 200)) - 100;
        const y = ((seed * 311 + time * 1250) % (H + 200)) - 100;
        c.beginPath(); c.moveTo(x, y); c.lineTo(x - 6, y + 22); c.stroke();
      }
    }
    // 速度线
    if (speedRatio > 0.55) {
      const a = (speedRatio - 0.55) * 0.5;
      c.strokeStyle = 'rgba(255,255,255,' + a.toFixed(3) + ')';
      c.lineWidth = 2;
      for (let i = 0; i < 10; i++) {
        const ang = (i / 10) * Math.PI * 2 + time * 0.6;
        const r0 = Math.min(W, H) * 0.30, r1 = r0 + 60 + Math.sin(time * 9 + i) * 26;
        const cxx = W / 2, cyy = this.horizon + H * 0.14;
        c.beginPath();
        c.moveTo(cxx + Math.cos(ang) * r0, cyy + Math.sin(ang) * r0 * 0.75);
        c.lineTo(cxx + Math.cos(ang) * r1, cyy + Math.sin(ang) * r1 * 0.75);
        c.stroke();
      }
    }
    // 暗角
    const vg = c.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.34, W / 2, H / 2, Math.max(W, H) * 0.72);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,' + (0.28 + theme.night * 0.22) + ')');
    c.fillStyle = vg; c.fillRect(0, 0, W, H);
  },

  /* 雾气：掩盖远景突然出现 */
  drawFog(theme) {
    const c = this.c;
    const g = c.createLinearGradient(0, this.horizon - 4, 0, this.horizon + this.H * 0.22);
    g.addColorStop(0, theme.fog); g.addColorStop(1, 'rgba(255,255,255,0)');
    c.globalAlpha = 0.92;
    c.fillStyle = g;
    c.fillRect(0, this.horizon - 4, this.W, this.H * 0.24);
    c.globalAlpha = 1;
  },
};
