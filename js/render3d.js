/* =========================================================
   奶蛙跑酷 · 3D 渲染器（替换 Canvas 2D 渲染层，游戏逻辑完全复用）
   —— 真正的三维赛道/列车/障碍/角色，实时方向光 + 雾
   ========================================================= */
'use strict';

const CITY_COLS = [
  [0.94, 0.90, 0.79], [0.88, 0.68, 0.54], [0.80, 0.83, 0.89], [0.93, 0.82, 0.64],
  [0.71, 0.81, 0.77], [0.91, 0.75, 0.77], [0.97, 0.94, 0.88], [0.77, 0.73, 0.83],
];

const Render3D = {
  ready: false, travel: 0, camX: 0, camY: CFG.CAM_Y,
  th: null, skyKey: '', billboards: [], texCache2: null,
  quality: 'mid', shadowAlpha: 1,

  init(canvas) {
    if (!GL3D.init(canvas)) { this.ready = false; return false; }
    this.ready = true;
    this.tex = {};
    // 墙面：主用干净的混凝土墙，旧涂鸦墙作为稀疏点缀
    this.tex.graffiti = GL3D.texture('art/tex-wall.png');
    this.tex.graffiti2 = GL3D.texture('art/tex-graffiti.png');
    this.tex.gravel = GL3D.textureFromCanvas(this.makeGravel());
    this.tex.facade = GL3D.textureFromCanvas(this.makeFacade());
    this.tex.shadow = GL3D.textureFromCanvas(this.makeShadow());
    this.tex.sky = GL3D.textureFromCanvas(this.makeSky(THEMES.day, THEMES.day));
    this.tex.steel = null;
    this.cubeM = GL3D.cube();
    this.planeM = GL3D.plane();
    this.cylM = GL3D.cylinder(14);
    this.coneM = GL3D.cone(14);
    this.cyl8 = GL3D.cylinder(8);
    this.canvas3d = canvas;
    this.texMap = {};
    return true;
  },

  /* ---------------- 程序化贴图 ---------------- */
  makeGravel() {
    const cv = document.createElement('canvas');
    cv.width = 256; cv.height = 256;
    const x = cv.getContext('2d');
    x.fillStyle = '#8b8781'; x.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 1800; i++) {
      const g = 70 + Math.random() * 120;
      const col = 'rgba(' + (g | 0) + ',' + ((g * 0.96) | 0) + ',' + ((g * 0.84) | 0) + ',' + (0.3 + Math.random() * 0.55).toFixed(2) + ')';
      const px = Math.random() * 256, py = Math.random() * 256, r = 0.9 + Math.random() * 2.6;
      x.fillStyle = col;
      for (const ox of [-256, 0, 256]) for (const oy of [-256, 0, 256]) {
        x.beginPath(); x.arc(px + ox, py + oy, r, 0, 6.283); x.fill();
      }
    }
    for (let i = 0; i < 10; i++) {
      x.fillStyle = 'rgba(28,26,24,.18)';
      x.beginPath();
      x.ellipse(Math.random() * 256, Math.random() * 256, 12 + Math.random() * 26, 7 + Math.random() * 14, Math.random() * 3, 0, 6.283);
      x.fill();
    }
    return cv;
  },
  /* 楼房外墙：白底 + 窗格（绘制时用 color 染色出不同色楼房） */
  makeFacade() {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 256;
    const x = cv.getContext('2d');
    x.fillStyle = '#ffffff'; x.fillRect(0, 0, 256, 256);
    // 每层窗
    for (let ry = 0; ry < 8; ry++) {
      // 楼层线
      x.fillStyle = 'rgba(0,0,0,.10)';
      x.fillRect(0, ry * 32 + 29, 256, 3);
      for (let rx = 0; rx < 4; rx++) {
        const wx = rx * 64 + 12, wy = ry * 32 + 7;
        const lit = Math.random() < 0.22;
        x.fillStyle = lit ? 'rgba(255,226,150,.95)' : 'rgba(52,68,92,.88)';
        x.fillRect(wx, wy, 40, 20);
        x.fillStyle = 'rgba(255,255,255,.35)';
        x.fillRect(wx, wy, 40, 4);
        x.fillStyle = 'rgba(0,0,0,.22)';
        x.fillRect(wx + 18, wy, 3, 20);
      }
    }
    // 轻微污渍
    for (let i = 0; i < 60; i++) {
      x.fillStyle = 'rgba(0,0,0,' + (0.02 + Math.random() * 0.05).toFixed(2) + ')';
      x.fillRect(Math.random() * 256, Math.random() * 256, 6 + Math.random() * 30, 3 + Math.random() * 10);
    }
    return cv;
  },

  makeShadow() {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 128;
    const x = cv.getContext('2d');
    const g = x.createRadialGradient(64, 64, 2, 64, 64, 62);
    g.addColorStop(0, 'rgba(0,0,0,.62)');
    g.addColorStop(0.6, 'rgba(0,0,0,.30)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = g; x.fillRect(0, 0, 128, 128);
    return cv;
  },
  makeSky(th, th2) {
    const cv = document.createElement('canvas');
    cv.width = 4; cv.height = 256;
    const x = cv.getContext('2d');
    const a = hex2rgb(th.skyTop), b = hex2rgb(th.skyBot);
    const g = x.createLinearGradient(0, 0, 0, 256);
    const toCss = (c, k) => 'rgb(' + Math.round(c[0] * 255 * (k || 1)) + ',' + Math.round(c[1] * 255 * (k || 1)) + ',' + Math.round(c[2] * 255 * (k || 1)) + ')';
    g.addColorStop(0, toCss(a, 0.86));
    g.addColorStop(0.52, toCss(mixRgb(a, b, 0.6)));
    g.addColorStop(0.84, toCss(b));
    g.addColorStop(1, toCss(b, 1.06));
    x.fillStyle = g; x.fillRect(0, 0, 4, 256);
    return cv;
  },
  themeRgb(th) {
    const out = Object.assign({}, th);
    out.light = [0.42, 0.86, 0.30];
    out.skyBot = hex2rgb(th.skyBot);
    out.fog = hex2rgb(th.fog);
    out.ballastRgb = hex2rgb(th.ballast);
    out.wallRgb = hex2rgb(th.wall);
    out.railRgb = hex2rgb(th.rail);
    out.sleeperRgb = hex2rgb(th.sleeper);
    out.groundRgb = hex2rgb(th.ground);
    out.wallDarkRgb = hex2rgb(th.wallDark);
    out.wallTopRgb = hex2rgb(th.wallTop);
    out.lampRgb = hex2rgb(th.lamp);
    out.fogAmount = 0.96;
    return out;
  },

  /* ---------------- Renderer 兼容 API ---------------- */
  api: {
    setCamera(camX, camY) { Render3D.camX = camX; Render3D.camY = camY; },
    proj(x, y, zr) {
      if (!Render3D.ready) return null;
      return GL3D.project(x, y, Render3D.wz(zr));
    },

    drawSky(th, travel, time) {
      if (!Render3D.ready) return;
      // 清空 2D 叠加层（3D 世界里只在上面画特效）
      const c2 = Renderer.c;
      if (c2) {
        c2.setTransform(Renderer.dpr, 0, 0, Renderer.dpr, 0, 0);
        c2.clearRect(0, 0, Renderer.W / Renderer.dpr, Renderer.H / Renderer.dpr);
        c2.globalAlpha = 1;
      }
      Render3D.travel = travel;
      // 首次进游戏：用场上同款真 3D 模型渲染菜单/商店缩略图（避免封面与角色不一致）
      if (!Render3D._thumbTried && typeof Chars3D !== 'undefined') {
        Render3D._thumbTried = true;
        try {
          const skins = (typeof CHARS !== 'undefined' ? CHARS.map(c => c.skin) : [])
            .concat(['inspector', 'dog', 'bull']);
          if (Chars3D.buildThumbs(Render3D.canvas3d, skins)) Chars3D.thumbsReady = true;
        } catch (e) { Render3D._thumbTried = false; }
      }
      const T = Render3D.themeRgb(th);
      Render3D.th = T;
      // 相机在角色后方 CAM_BACK 处；角色世界 z = travel（前方为 -Z）
      const camZ = travel + CFG.CAM_BACK;
      const cam = [Render3D.camX, Render3D.camY, camZ];
      // 俯视前方赛道（地铁跑酷视角）：看得远、角色落在画面下半部
      const target = [Render3D.camX * 0.5, 0.35, camZ - 18];
      const dtReal = Math.max(0.001, Math.min(0.2, (time || 0) - (Render3D._lastT || time || 0)));
      Render3D._lastT = time || 0;
      Render3D.tickPerf(dtReal);
      GL3D.frame(cam, target, T, Renderer.W * Render3D.resScale, Renderer.H * Render3D.resScale, Renderer.dpr);
      Render3D.billboards.length = 0;
      // 天空：贴渐变的大平面（不受光照/雾影响）
      const key = th.skyTop + th.skyBot + (th.night > 0.5 ? 'n' : 'd');
      if (Render3D.skyKey !== key) {
        Render3D.tex.sky = GL3D.textureFromCanvas(Render3D.makeSky(th));
        Render3D.skyKey = key;
      }
      GL3D.draw(Render3D.planeM, M4.compose(Render3D.camX * 0.3, 26, camZ - 150, 0, 420, 190, 1), { tex: Render3D.tex.sky, unlit: true, noDepth: true, doubleSide: true, alpha: 1 });
      // 太阳/月亮光晕
      const sun = GL3D.textureFromCanvas(Render3D._sun || (Render3D._sun = Render3D.makeShadow()));
      GL3D.draw(Render3D.planeM, M4.compose(Render3D.camX * 0.3 + 40, 46, camZ - 148, 0, 46, 46, 1),
        { tex: sun, unlit: true, noDepth: true, blend: true, alpha: (th.night > 0.5 ? 0.35 : 0.55), color: [1, 0.98, 0.82] });
    },

    drawGround(th, travel) {
      if (!Render3D.ready) return;
      const T = Render3D.th || Render3D.themeRgb(th);
      const camZ = travel + CFG.CAM_BACK;
      const FARZ = Math.max(180, CFG.FAR * 1.15);
      // 大地
      GL3D.draw(Render3D.cubeM, M4.compose(0, -0.6, camZ - FARZ * 0.45, 0, 90, 1.2, FARZ * 1.1), { color: T.groundRgb });
      // 道砟（贴碎石）
      GL3D.draw(Render3D.cubeM, M4.compose(0, -0.16, camZ - FARZ * 0.42, 0, CFG.WALL_X * 2 + 0.5, 0.36, FARZ * 0.95),
        { tex: Render3D.tex.gravel, color: [0.86, 0.85, 0.82], uvScale: [FARZ / 9, 3] });
      // 枕木
      const GAP = CFG.SLEEPER_GAP, off = travel % GAP;
      const Q = Render3D.quality === 'low' ? 0.6 : 1;
      const nSlp = Math.round(34 * Q);
      for (let i = 0; i < nSlp; i++) {
        const z = camZ - 2 - i * GAP + (GAP - off);
        if (z < camZ - FARZ * 0.5) break;
        GL3D.draw(Render3D.cubeM, M4.compose(0, 0.04, z, 0, CFG.ROAD_HALF * 2 + 0.5, 0.14, 0.52), { color: T.sleeperRgb });
      }
      // 铁轨
      for (let ln = 0; ln < CFG.LANES; ln++) {
        const lx = Utils.laneX(ln);
        for (const s of [-1, 1]) {
          const rx = lx + s * CFG.RAIL_HALF;
          GL3D.draw(Render3D.cubeM, M4.compose(rx, 0.17, camZ - FARZ * 0.45, 0, 0.13, 0.14, FARZ * 0.9), { color: [T.railRgb[0] * 0.62, T.railRgb[1] * 0.62, T.railRgb[2] * 0.66] });
          GL3D.draw(Render3D.cubeM, M4.compose(rx, 0.245, camZ - FARZ * 0.45, 0, 0.10, 0.03, FARZ * 0.9),
            { color: [T.railRgb[0] * 0.92, T.railRgb[1] * 0.92, T.railRgb[2] * 0.98] });
        }
      }
      // 两侧矮护墙（路肩矮墙，不再挡视线）+ 墙顶压条
      const SEGL = 13, SEGN = Render3D.quality === 'low' ? 10 : 16;
      const map = (typeof World !== 'undefined' && Store && Store.data) ? World.map(Store.data.map) : null;
      for (const sgn of [-1, 1]) {
        for (let i = 0; i < SEGN; i++) {
          const z = camZ - 3 - i * SEGL + (travel % SEGL);
          if (z < camZ - CFG.FAR * 0.72) break;
          const cx = sgn * CFG.WALL_X;
          // 矮墙墙体（混凝土）
          GL3D.draw(Render3D.planeM, M4.compose(cx, 0.50, z - SEGL / 2, sgn * Math.PI / 2, SEGL, 1.0, 1),
            { tex: Render3D.tex.graffiti, color: [0.94 * T.wallRgb[0] + 0.22, 0.94 * T.wallRgb[1] + 0.22, 0.94 * T.wallRgb[2] + 0.22], doubleSide: true, uvScale: [SEGL / 6, 1] });
          // 稀疏涂鸦点缀
          if ((i + Math.floor(travel / SEGL)) % 3 === 1) {
            GL3D.draw(Render3D.planeM, M4.compose(cx - sgn * 0.03, 0.46, z - SEGL / 2, sgn * Math.PI / 2, SEGL, 0.82, 1),
              { tex: Render3D.tex.graffiti2, color: [0.95, 0.95, 0.97], doubleSide: true, uvScale: [SEGL / 5, 1], blend: true, alpha: 0.9 });
          }
          GL3D.draw(Render3D.cubeM, M4.compose(cx, 1.06, z - SEGL / 2, 0, 0.44, 0.16, SEGL), { color: T.wallTopRgb });
        }
      }
      // 墙外：草地 / 人行道 / 城市楼房 / 行道树
      Render3D.api.drawCity(T, camZ, travel);
      // 接触网支架（地铁感）
      const ng = Render3D.quality === 'low' ? 5 : 7, gp = 26;
      for (let i = 0; i < ng; i++) {
        const z = camZ - 14 - i * gp + (travel % gp);
        if (z < camZ - CFG.FAR * 0.6) break;
        GL3D.draw(Render3D.cubeM, M4.compose(0, 5.30, z, 0, (CFG.WALL_X) * 2, 0.14, 0.14), { color: [0.40, 0.43, 0.48] });
        for (const sgn of [-1, 1]) {
          GL3D.draw(Render3D.cubeM, M4.compose(sgn * (CFG.WALL_X - 0.10), 2.65, z, 0, 0.18, 5.3, 0.18), { color: [0.36, 0.39, 0.44] });
        }
      }
      // 地图专属路边道具
      if (map) Render3D.drawMapProps(T, camZ, travel, map.prop);
    },

    /* 行道树 */
    drawTree(x, z, seed) {
      GL3D.draw(Render3D.cyl8, M4.compose(x, 1.05, z, 0, 0.30, 2.1, 0.30), { color: [0.44, 0.31, 0.20] });
      const g = [0.20 + seed * 0.14, 0.52 + seed * 0.22, 0.21 + seed * 0.12];
      GL3D.draw(Render3D.cylM, M4.compose(x, 2.75, z, 0, 2.5, 1.9, 2.5), { color: g });
      GL3D.draw(Render3D.cylM, M4.compose(x + 0.2, 3.6, z - 0.15, 0, 1.6, 1.4, 1.6),
        { color: [Math.min(1, g[0] * 1.16), Math.min(1, g[1] * 1.08), Math.min(1, g[2] * 1.14)] });
    },

    /* 墙外城市：草地 + 人行道 + 楼房 + 行道树 + 路灯 */
    drawCity(T, camZ, travel) {
      const Q = Render3D.quality === 'low' ? 0.55 : 1;
      const STEP = 12, n = Math.round(16 * Q);
      const FARZ = Math.min(CFG.FAR * 0.85, 165);
      const cols = CITY_COLS;
      const rnd = (idx, k, sgn) => {
        const s = Math.sin((idx * 37.31 + k * 11.7 + (sgn > 0 ? 0.37 : 0)) * 12.9898) * 43758.5453;
        return s - Math.floor(s);
      };
      for (const sgn of [-1, 1]) {
        // 草地 + 人行道（整条长条，一次画完）
        GL3D.draw(Render3D.cubeM, M4.compose(sgn * (CFG.WALL_X + 2.0), 0.05, camZ - FARZ * 0.45, 0, 4.2, 0.14, FARZ * 0.95),
          { color: [0.36, 0.64, 0.29] });
        GL3D.draw(Render3D.cubeM, M4.compose(sgn * (CFG.WALL_X + 4.7), 0.06, camZ - FARZ * 0.45, 0, 1.5, 0.16, FARZ * 0.95),
          { color: [0.66, 0.66, 0.63] });
        const base = Math.floor(travel / STEP) * STEP;
        for (let i = 0; i < n; i++) {
          const z = camZ - 4 - i * STEP + (travel % STEP);
          if (z < camZ - FARZ) break;
          const idx = Math.floor(base / STEP) + i;
          const h = 5 + rnd(idx, 1, sgn) * 15;
          const w = 5.4 + rnd(idx, 2, sgn) * 3.6;
          const bx = sgn * (CFG.WALL_X + 7.6 + rnd(idx, 3, sgn) * 2.4);
          const col = cols[(idx + (sgn > 0 ? 3 : 0)) % cols.length];
          GL3D.draw(Render3D.cubeM, M4.compose(bx, h / 2, z, 0, w, h, w * 0.82),
            { tex: Render3D.tex.facade, color: col, uvScale: [w / 3.4, h / 3.4] });
          GL3D.draw(Render3D.cubeM, M4.compose(bx, h + 0.28, z, 0, w + 0.8, 0.56, w * 0.82 + 0.8),
            { color: [col[0] * 0.66, col[1] * 0.66, col[2] * 0.68] });
          // 第二排更高的楼，增加纵深
          if (rnd(idx, 4, sgn) > 0.34) {
            const h2 = h + 6 + rnd(idx, 5, sgn) * 11;
            GL3D.draw(Render3D.cubeM, M4.compose(bx + sgn * 8.0, h2 / 2, z + 3.2, 0, w * 1.15, h2, w * 0.95),
              { tex: Render3D.tex.facade, color: [Math.min(1, col[0] * 0.88 + 0.10), Math.min(1, col[1] * 0.88 + 0.10), Math.min(1, col[2] * 0.88 + 0.14)], uvScale: [w / 3.4, h2 / 3.4] });
          }
          // 行道树
          if (rnd(idx, 6, sgn) > 0.42) Render3D.api.drawTree(sgn * (CFG.WALL_X + 2.3), z + 5.2, rnd(idx, 7, sgn));
        }
        // 路灯
        for (let i = 0; i < Math.round(6 * Q); i++) {
          const z = camZ - 16 - i * 30 + (travel % 30);
          if (z < camZ - FARZ) break;
          const lx = sgn * (CFG.WALL_X + 1.4);
          GL3D.draw(Render3D.cyl8, M4.compose(lx, 2.1, z, 0, 0.16, 4.2, 0.16), { color: [0.44, 0.47, 0.52] });
          GL3D.draw(Render3D.cubeM, M4.compose(lx - sgn * 0.45, 4.16, z, 0, 0.9, 0.14, 0.3), { color: [0.44, 0.47, 0.52] });
          GL3D.draw(Render3D.cubeM, M4.compose(lx - sgn * 0.82, 4.02, z, 0, 0.56, 0.2, 0.34),
            { color: T.lampRgb, unlit: (T.night > 0.3) });
        }
      }
    },

    __unusedPalette: [
      [0.94, 0.90, 0.79], [0.88, 0.68, 0.54], [0.80, 0.83, 0.89], [0.93, 0.82, 0.64],
      [0.71, 0.81, 0.77], [0.91, 0.75, 0.77], [0.97, 0.94, 0.88], [0.77, 0.73, 0.83],
    ],

    drawMapProps(T, camZ, travel, propType) {
      const gap = 34;
      for (let i = 0; i < 6; i++) {
        const z = camZ - 10 - i * gap + (travel % gap);
        if (z < camZ - CFG.FAR * 0.6) break;
        for (const sgn of [-1, 1]) {
          const bx = sgn * (CFG.WALL_X + 3.6);
          switch (propType) {
            case 'lantern':
              GL3D.draw(Render3D.cyl8, M4.compose(bx, 1.5, z, 0, 0.12, 3.0, 0.12), { color: [0.32, 0.22, 0.16] });
              GL3D.draw(Render3D.cubeM, M4.compose(bx, 3.05, z, 0, 0.5, 0.62, 0.5), { color: [0.88, 0.23, 0.18], unlit: true });
              GL3D.draw(Render3D.cubeM, M4.compose(bx, 3.42, z, 0, 0.62, 0.08, 0.62), { color: [0.96, 0.77, 0.32] });
              break;
            case 'sakura':
              GL3D.draw(Render3D.cyl8, M4.compose(bx, 0.8, z, 0, 0.2, 1.6, 0.2), { color: [0.42, 0.30, 0.24] });
              GL3D.draw(Render3D.cylM, M4.compose(bx, 2.0, z, 0, 1.5, 1.1, 1.5), { color: [0.96, 0.72, 0.82] });
              GL3D.draw(Render3D.cylM, M4.compose(bx + 0.3, 2.5, z + 0.2, 0, 0.9, 0.8, 0.9), { color: [0.99, 0.82, 0.90] });
              break;
            case 'palm':
              GL3D.draw(Render3D.cyl8, M4.compose(bx, 1.5, z, 0, 0.22, 3.0, 0.22), { color: [0.54, 0.42, 0.27] });
              for (let k = 0; k < 4; k++) {
                const a = k / 4 * Math.PI * 2;
                GL3D.draw(Render3D.cubeM, M4.compose(bx + Math.cos(a) * 0.55, 3.05, z + Math.sin(a) * 0.55, a, 1.3, 0.08, 0.34), { color: [0.25, 0.62, 0.35] });
              }
              break;
            case 'obelisk':
              GL3D.draw(GL3D.cone(4), M4.compose(bx, 2.1, z, 0.3, 1.0, 4.2, 1.0), { color: [0.78, 0.64, 0.39] });
              break;
            case 'dome':
              GL3D.draw(Render3D.cylM, M4.compose(bx, 1.2, z, 0, 1.0, 2.4, 1.0), { color: [0.88, 0.57, 0.62] });
              GL3D.draw(Render3D.cubeM, M4.compose(bx, 2.55, z, 0, 0.7, 0.3, 0.7), { color: [0.85, 0.63, 0.25] });
              break;
            case 'flagpole':
              GL3D.draw(Render3D.cyl8, M4.compose(bx, 1.6, z, 0, 0.12, 3.2, 0.12), { color: [0.48, 0.42, 0.36] });
              for (let k = 0; k < 4; k++) {
                const cols = [[0.90, 0.26, 0.24], [0.96, 0.77, 0.32], [0.29, 0.72, 1.0], [0.49, 0.83, 0.29]];
                GL3D.draw(Render3D.planeM, M4.compose(bx + sgn * 0.35, 2.9 - k * 0.36, z, sgn * Math.PI / 2, 0.6, 0.3, 1),
                  { color: cols[k % 4], doubleSide: true });
              }
              break;
            case 'neon':
              GL3D.draw(Render3D.cyl8, M4.compose(bx, 1.9, z, 0, 0.14, 3.8, 0.14), { color: [0.20, 0.22, 0.30] });
              GL3D.draw(Render3D.cyl8, M4.compose(bx, 3.0, z, 0, 1.1, 0.1, 1.1), { color: [0.18, 0.90, 0.84], unlit: true });
              GL3D.draw(Render3D.cyl8, M4.compose(bx, 3.4, z, 0, 0.7, 0.08, 0.7), { color: [1.0, 0.24, 0.78], unlit: true });
              break;
            default:
              GL3D.draw(Render3D.cyl8, M4.compose(bx, 1.7, z, 0, 0.18, 3.4, 0.18), { color: T.wallDarkRgb });
              GL3D.draw(Render3D.cubeM, M4.compose(bx, 3.5, z, 0, 0.44, 0.2, 0.44), { color: T.lampRgb, unlit: true });
          }
        }
      }
    },

    drawShadow(x, zr, scale, alpha) {
      if (!Render3D.ready) return;
      const wz = Render3D.wz(zr);
      GL3D.draw(Render3D.planeM, M4.compose(x, 0.03, wz, 0, 2.1 * (scale || 1), 2.1 * (scale || 1), 1, -Math.PI / 2),
        { tex: Render3D.tex.shadow, unlit: true, blend: true, alpha: Math.min(1, (alpha == null ? 0.3 : alpha) * 1.5), doubleSide: true });
    },

    /* 车厢：真 3D 箱体 + 车窗带 + 车顶 + 前灯 */
    drawTrain(o) {
      if (!Render3D.ready) return;
      const T = Render3D.th;
      const z0 = Render3D.wz(o.z0), z1 = Render3D.wz(o.z1);
      const cz = (z0 + z1) / 2, len = Math.abs(z1 - z0);
      const w = o.x1 - o.x0, cx = (o.x0 + o.x1) / 2, h = o.y1 - o.y0;
      const col = hex2rgb(o.color || '#3f7fd9');
      const dark = [col[0] * 0.72, col[1] * 0.72, col[2] * 0.72];
      GL3D.draw(Render3D.cubeM, M4.compose(cx, o.y0 + h / 2, cz, 0, w, h, len), { color: col });
      // 裙板
      GL3D.draw(Render3D.cubeM, M4.compose(cx, o.y0 + 0.12, cz, 0, w + 0.04, 0.24, len), { color: dark });
      // 车窗：按节分成一扇扇窗户，而不是一条长带
      if (h > 1.0) {
        const winCol = (T && T.night > 0.4) ? [1.0, 0.92, 0.66] : [0.14, 0.18, 0.26];
        const segs = Math.max(3, Math.min(8, Math.round(len / 2.4)));
        const winH = h * 0.26, wy = o.y0 + h * 0.64;
        for (let k = 0; k < segs; k++) {
          const wz2 = z0 + (k + 0.5) / segs * (z1 - z0);
          GL3D.draw(Render3D.cubeM, M4.compose(cx, wy, wz2, 0, w + 0.06, winH, (len / segs) * 0.58),
            { color: winCol, unlit: (T && T.night > 0.4) });
        }
      }
      // 车顶压条
      GL3D.draw(Render3D.cubeM, M4.compose(cx, o.y0 + h + 0.05, cz, 0, w * 0.92, 0.1, len * 0.94),
        { color: [Math.min(1, col[0] * 1.25), Math.min(1, col[1] * 1.25), Math.min(1, col[2] * 1.25)] });
      // 前灯（迎面的车头才有）
      if (o.headlight) {
        for (const s of [-1, 1]) {
          GL3D.draw(Render3D.cubeM, M4.compose(cx + s * w * 0.3, o.y0 + 0.5, cz + len / 2 + 0.03, 0, 0.3, 0.22, 0.06),
            { color: [1, 0.97, 0.8], unlit: true });
        }
      }
    },

    /* 障碍物：全部真 3D 几何 */
    drawObstacle(o) {
      if (!Render3D.ready) return;
      const x = o.x, z = Render3D.wz(o.z);
      const type = o.type;
      switch (type) {
        case 'barrier':
          for (const s of [-1, 1]) GL3D.draw(Render3D.cubeM, M4.compose(x + s * 0.85, 0.55, z, 0, 0.12, 1.1, 0.12), { color: [0.72, 0.70, 0.65] });
          for (let i = 0; i < 5; i++) {
            GL3D.draw(Render3D.cubeM, M4.compose(x - 0.8 + i * 0.4, 1.05, z, 0, 0.4, 0.22, 0.1),
              { color: i % 2 ? [0.90, 0.26, 0.24] : [0.95, 0.94, 0.90] });
          }
          break;
        case 'cone':
          GL3D.draw(Render3D.coneM, M4.compose(x, 0.33, z, 0, 0.62, 0.66, 0.62), { color: [1.0, 0.45, 0.10] });
          GL3D.draw(Render3D.cubeM, M4.compose(x, 0.03, z, 0, 0.72, 0.06, 0.72), { color: [0.85, 0.34, 0.06] });
          GL3D.draw(Render3D.cubeM, M4.compose(x, 0.42, z, 0, 0.4, 0.1, 0.4), { color: [0.97, 0.97, 0.95] });
          break;
        case 'dumpster':
          GL3D.draw(Render3D.cubeM, M4.compose(x, 0.62, z, 0, 1.5, 1.24, 1.3), { color: [0.31, 0.54, 0.29] });
          GL3D.draw(Render3D.cubeM, M4.compose(x, 1.3, z, 0, 1.58, 0.14, 1.38), { color: [0.24, 0.42, 0.24] });
          break;
        case 'highbar':
          for (const s of [-1, 1]) GL3D.draw(Render3D.cubeM, M4.compose(x + s * 1.05, 0.9, z, 0, 0.16, 1.8, 0.16), { color: [0.52, 0.55, 0.60] });
          GL3D.draw(Render3D.cubeM, M4.compose(x, 1.72, z, 0, 2.3, 0.3, 0.3), { color: [0.80, 0.30, 0.24] });
          GL3D.draw(Render3D.cubeM, M4.compose(x, 1.72, z, 0, 2.34, 0.16, 0.34), { color: [0.95, 0.94, 0.90] });
          break;
        case 'spring':
        case 'ramp':
          GL3D.draw(Render3D.cubeM, M4.compose(x, 0.16, z, 0, 1.5, 0.22, 1.1, -0.34), { color: type === 'spring' ? [0.63, 0.42, 1.0] : [0.60, 0.63, 0.68] });
          GL3D.draw(Render3D.cubeM, M4.compose(x, 0.34, z + 0.3, 0, 1.2, 0.06, 0.24), { color: [1.0, 0.83, 0.30], unlit: true });
          break;
        case 'tunnel':
          for (const s of [-1, 1]) GL3D.draw(Render3D.cubeM, M4.compose(x + s * 1.3, 1.3, z, 0, 0.34, 2.6, 0.9), { color: [0.42, 0.45, 0.50] });
          GL3D.draw(Render3D.cubeM, M4.compose(x, 2.75, z, 0, 3.0, 0.4, 0.9), { color: [0.48, 0.51, 0.56] });
          break;
        case 'signal':
          GL3D.draw(Render3D.cyl8, M4.compose(x, 1.2, z, 0, 0.14, 2.4, 0.14), { color: [0.45, 0.48, 0.53] });
          GL3D.draw(Render3D.cubeM, M4.compose(x, 2.55, z, 0, 0.42, 0.7, 0.3), { color: [0.18, 0.20, 0.24] });
          GL3D.draw(Render3D.cubeM, M4.compose(x, 2.72, z - 0.16, 0, 0.2, 0.2, 0.04), { color: [1, 0.3, 0.25], unlit: true });
          break;
        case 'puddle':
          GL3D.draw(Render3D.cubeM, M4.compose(x, 0.015, z, 0, 1.8, 0.03, 1.4), { color: [0.30, 0.44, 0.58] });
          break;
        case 'gantry':
          for (const s of [-1, 1]) GL3D.draw(Render3D.cubeM, M4.compose(x + s * 1.6, 2.0, z, 0, 0.24, 4.0, 0.24), { color: [0.42, 0.45, 0.50] });
          GL3D.draw(Render3D.cubeM, M4.compose(x, 4.0, z, 0, 3.6, 0.3, 0.3), { color: [0.46, 0.49, 0.54] });
          break;
        default:
          GL3D.draw(Render3D.cubeM, M4.compose(x, 0.5, z, 0, 1.6, 1.0, 0.4), { color: [0.80, 0.42, 0.30] });
      }
    },

    /* 金币：3D 里用旋转圆片（贴金币精灵，横向压扁模拟旋转） */
    drawCoin(o) {
      if (!Render3D.ready) return;
      const wz = Render3D.wz(o.z);
      Render3D.billboards.push({ z: wz, kind: 'coin', o: o, wz: wz });
    },

    drawPower(o) {
      if (!Render3D.ready) return;
      const wz = Render3D.wz(o.z);
      Render3D.billboards.push({ z: wz, kind: 'power', o: o, wz: wz });
    },

    drawParticle(p) {
      if (!Render3D.ready) return;
      const wz = Render3D.wz(p.z);
      Render3D.billboards.push({ z: wz, kind: 'particle', o: p, wz: wz });
    },

    drawChar(skin, x, y, zr, pose, worldH, opts) {
      if (!Render3D.ready) return;
      const wz = Render3D.wz(zr);
      // 真 3D 角色模型（不透明，直接画进深度缓冲即可）
      if (typeof Chars3D !== 'undefined') {
        Chars3D.draw(skin, x, y, wz, pose, worldH || CFG.PLAYER_H, Chars3D.outfitTint(skin));
        return;
      }
      Render3D.billboards.push({ z: wz, kind: 'char', skin: skin, x: x, y: y, wz: wz, pose: pose, h: worldH || CFG.PLAYER_H });
      if (opts && opts.after) { /* 2D 叠加由 game.js 自行处理 */ }
    },

    drawHoverboard(x, y, zr, worldW, t, color) {
      if (!Render3D.ready) return;
      const wz = Render3D.wz(zr);
      const c = hex2rgb((color && color[0]) || '#ff5fa2');
      GL3D.draw(Render3D.cubeM, M4.compose(x, y + 0.1, wz, 0, worldW, 0.1, 0.5, -0.12), { color: c });
      GL3D.draw(Render3D.cubeM, M4.compose(x, y + 0.02, wz, 0, worldW * 0.8, 0.05, 0.36),
        { color: [1, 0.72, 0.9], unlit: true, blend: true, alpha: 0.85 });
    },

    /* 所有透明公告牌在这里按远→近排序绘制 */
    drawFog(th) {
      if (!Render3D.ready) return;
      const list = Render3D.billboards;
      list.sort((a, b) => b.z - a.z);
      const gl = GL3D.gl;
      gl.enable(gl.BLEND);
      gl.depthMask(false);
      for (const it of list) {
        if (it.kind === 'char') Render3D.drawCharBillboard(it);
        else if (it.kind === 'coin') Render3D.drawCoinBillboard(it);
        else if (it.kind === 'power') Render3D.drawPowerBillboard(it);
        else if (it.kind === 'particle') Render3D.drawParticleBillboard(it);
      }
      gl.depthMask(true);
      gl.disable(gl.BLEND);
      list.length = 0;
    },

    /* 2D 叠加层（雨/速度线）：直接画在 2D 画布上 */
    drawWeather(th, time, speedRatio) {
      const c = Renderer.c;
      if (!c) return;
      const W = Renderer.W / Renderer.dpr, H = Renderer.H / Renderer.dpr;
      if (th.rain > 0.05) {
        c.save();
        c.strokeStyle = 'rgba(190,215,240,.5)'; c.lineWidth = 1.2;
        const n = Math.floor(70 * th.rain);
        for (let i = 0; i < n; i++) {
          const seed = i * 137.5;
          const x = (seed * 7.3 + time * 60) % W;
          const y = (seed * 13.7 + time * 900) % H;
          c.beginPath(); c.moveTo(x, y); c.lineTo(x - 3, y + 16); c.stroke();
        }
        c.restore();
      }
      if (speedRatio > 0.45) {
        const a = (speedRatio - 0.45) / 0.55 * 0.5;
        c.save();
        c.strokeStyle = 'rgba(255,255,255,' + a.toFixed(2) + ')';
        c.lineWidth = 2;
        const cx = W * 0.5, cy = H * 0.52;
        for (let i = 0; i < 14; i++) {
          const ang = (i / 14) * Math.PI * 2 + time * 0.4;
          const r0 = Math.min(W, H) * (0.30 + (i % 3) * 0.05);
          c.beginPath();
          c.moveTo(cx + Math.cos(ang) * r0, cy + Math.sin(ang) * r0);
          c.lineTo(cx + Math.cos(ang) * (r0 + 70), cy + Math.sin(ang) * (r0 + 70));
          c.stroke();
        }
        c.restore();
      }
    },
  },

  /* ---------------- 公告牌绘制 ---------------- */
  /* 相机相对 z（游戏内坐标系）→ 世界 z */
  wz(zr) { return this.travel + zr - CFG.CAM_BACK; },

  /* 自适应画质：帧率过低时降几何密度与渲染分辨率 */
  quality: 'mid', resScale: 1, _ft: 0, _fn: 0,
  tickPerf(dt) {
    this._ft += dt; this._fn++;
    if (this._ft < 2.2) return;
    const avg = this._ft / Math.max(1, this._fn);
    this._ft = 0; this._fn = 0;
    if (avg > 0.030 && this.quality !== 'low') {
      this.quality = 'low'; this.resScale = 0.75;
    } else if (avg > 0.022 && this.quality === 'mid') {
      this.quality = 'low'; this.resScale = 0.85;
    } else if (avg < 0.017 && this.quality === 'low') {
      this.quality = 'mid'; this.resScale = 1;
    }
  },

  frameTex(skin, pose) {
    const frames = (typeof ART !== 'undefined') ? ART.runFrames(skin) : [];
    if (!frames.length) return null;
    const n = frames.length;
    const t = pose.t || 0;
    let idx = 0;
    const st = pose.state || 'run';
    if (st === 'run') idx = Math.floor(((t % 1) + 1) % 1 * n) % n;
    else if (st === 'idle') idx = 0;
    else if (st === 'fly') idx = Math.floor(t * 3) % n;
    else idx = 0;
    const cv = frames[idx];
    if (!cv) return null;
    if (!cv.__tex) cv.__tex = GL3D.textureFromCanvas(cv);
    return { tex: cv.__tex, w: cv.width, h: cv.height };
  },
  drawCharBillboard(it) {
    const outfit = (typeof World !== 'undefined' && Store && Store.data) ? World.outfit(it.skin) : null;
    const f = this.frameTex(it.skin, it.pose);
    if (!f) return;
    const h = it.h, w = h * (f.w / f.h);
    const st = it.pose.state || 'run';
    let extraRot = 0, sy = 1, sx = 1, dy = 0;
    if (st === 'jump') { sy = 1.07; sx = 0.95; }
    else if (st === 'fall') { sy = 0.95; sx = 1.05; }
    else if (st === 'crash') { extraRot = -0.7; sy = 0.94; }
    else if (st === 'roll') { extraRot = -(it.pose.t || 0) * Math.PI * 2; sy = 0.72; dy = 0.06; }
    else if (st === 'run') { sy = 1 + Math.sin((it.pose.t || 0) * Math.PI * 4) * 0.015; }
    const y = it.y + h / 2 + dy;
    const tex = (outfit && outfit.filter && outfit.filter !== 'none') ? this.outfitTex(it.skin, outfit) : f.tex;
    GL3D.draw(this.planeM, M4.compose(it.x, y, it.wz, extraRot, w * sx, h * sy, 1), {
      tex: tex, color: [1, 1, 1], doubleSide: true, blend: true, alpha: 1,
    });
  },
  /* 服装染色：把帧复制到离屏画布并应用 CSS filter */
  outfitTex(skin, outfit) {
    this._fitTex = this._fitTex || {};
    const key = skin + '|' + outfit.id;
    if (this._fitTex[key]) return this._fitTex[key];
    const frames = ART.runFrames(skin);
    if (!frames.length) return null;
    const last = frames[Math.min(2, frames.length - 1)];
    const cv = document.createElement('canvas');
    cv.width = last.width; cv.height = last.height;
    const c = cv.getContext('2d');
    try { c.filter = outfit.filter; } catch (e) { /* 忽略 */ }
    c.drawImage(last, 0, 0);
    const t = GL3D.textureFromCanvas(cv);
    this._fitTex[key] = t;
    return t;
  },
  drawCoinBillboard(it) {
    const spr = Renderer.sprites && Renderer.sprites.coin;
    if (!spr) return;
    if (!spr.__tex) spr.__tex = GL3D.textureFromCanvas(spr);
    const o = it.o;
    const size = 0.56 * (o.scale || 1);
    const spin = Math.abs(Math.cos(o.spin || 0));
    GL3D.draw(this.planeM, M4.compose(o.x, o.y, it.wz, 0, size * Math.max(0.22, spin), size, 1),
      { tex: spr.__tex, color: [1, 1, 1], doubleSide: true, blend: true, alpha: 1, unlit: true });
  },
  drawPowerBillboard(it) {
    const spr = Renderer.sprites && Renderer.sprites['p_' + it.o.kind];
    if (!spr) return;
    if (!spr.__tex) spr.__tex = GL3D.textureFromCanvas(spr);
    const bob = Math.sin((it.o.t || 0) * 2.4 + (it.o.seed || 0)) * 0.12;
    GL3D.draw(this.planeM, M4.compose(it.o.x, it.o.y + bob, it.wz, 0, 1.3, 1.3, 1),
      { tex: spr.__tex, color: [1, 1, 1], doubleSide: true, blend: true, alpha: 1, unlit: true });
  },
  drawParticleBillboard(it) {
    const p = it.o;
    const a = Math.max(0, Math.min(1, p.life / (p.max || 0.7)));
    const r = p.r || 0.08;
    GL3D.draw(this.planeM, M4.compose(p.x, p.y, it.wz, 0, r * 2.4, r * 2.4, 1),
      { color: hex2rgb(p.color || '#ffffff'), doubleSide: true, blend: true, alpha: a * 0.9, unlit: true });
  },
};

/* 把写在 api 里的地图道具绘制提升到 Render3D 上（内部用 Render3D.xxx，不依赖 this） */
Render3D.drawMapProps = function (T, camZ, travel, propType) {
  return Render3D.api.drawMapProps(T, camZ, travel, propType);
};
