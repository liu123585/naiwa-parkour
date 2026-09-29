/* =========================================================
   捏捏跑酷 · PINCH RUN —— Three.js 渲染器
   ---------------------------------------------------------
   接替旧的自研 WebGL 引擎，提供与 Renderer 完全一致的 API，
   game.js / ui.js / panels.js 一行都不用改。

   美术方向：手工微缩景观
     · 整个世界是手工搭出来的模型——冰棍棒当枕木、瓦楞纸当道砟、纸盒当楼房
     · 材质一律哑光，顶点有捏痕，不走"干净渲染"那套
     · 暖色台灯打光 + 长投影，模仿定格动画的拍摄台
     · 角色动画 6 帧步进，故意留顿挫

   坐标系沿用旧引擎：
     x 横向 / y 高度 / z 前进方向（+z 是前方）
     摄像机在 travel - CAM_BACK，看向前方
   ========================================================= */
'use strict';

/* ---------------------------------------------------------
   手工车间配色
   刻意不用主题里的城市蓝灰——那套出来就是"通用低多边形"。
   这里定死一组牛皮纸/切割垫/冰棍棒的暖色，昼夜只交给灯光和雾去管。
   --------------------------------------------------------- */
const CRAFT = {
  mat:     '#3f5f4a',   // 切割垫（桌面）
  matLine: '#5c8068',
  bed:     '#d6c4a0',   // 道床
  stick:   '#eddcb6',   // 冰棍棒枕木
  rail:    '#57616f',   // 铁轨
  railTop: '#d3dce6',   // 轨面反光
  wall:    '#cfa877',   // 牛皮纸侧墙
  wallTop: '#e3c79c',
  tape:    '#f0e8d6',   // 胶带
  grass:   '#8aa869',
  path:    '#c6c0b2',
  pole:    '#7b818b',
  paper:   ['#d9b98f', '#c9a9a0', '#a9b7bd', '#dcc49a', '#a3b29b', '#c7a8a4', '#e5d9c0', '#aca6b9'],
  ink:     '#4a3a2c',
};

/* ---------------------------------------------------------
   背景不是"天空"，是拍摄台上那张背景纸。
   冷调顶 + 暖调地平线（台灯烤出来的），中间一层暖雾。
   沿用主题色只会得到通用手游那种发白的蓝，所以这里自己定。
   --------------------------------------------------------- */
const SKY = {
  dayTop:   '#2f4257', dayBot:   '#e9b378',
  nightTop: '#0b1226', nightBot: '#2a3a5e',
};

const Pinch3D = {
  ready: false,
  travel: 0, camX: 0, camY: CFG.CAM_Y,
  quality: 'mid', resScale: 1, shadowAlpha: 1,
  th: null, skyKey: '',
  _lastT: 0, _ft: 0, _fn: 0,

  /* ---------------- 初始化 ---------------- */
  init(canvas) {
    if (typeof THREE === 'undefined') { this.ready = false; return false; }
    try {
      this.renderer = new THREE.WebGLRenderer({
        canvas: canvas, antialias: false, alpha: false,
        powerPreference: 'high-performance', stencil: false,
      });
    } catch (e) {
      console.warn('pinch3d: WebGL 初始化失败', e);
      this.ready = false;
      return false;
    }
    this.renderer.setClearColor(0x2f4257, 1);
    if ('outputColorSpace' in this.renderer) this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0xb98d64, 24, CFG.FAR * 0.92);

    this.camera = new THREE.PerspectiveCamera(CFG.FOV_Y || 62, 1, 0.28, 320);
    this.camTarget = new THREE.Vector3();

    /* 打光：一盏暖台灯 + 一片天光，别用三点布光那套棚拍味 */
    this.amb = new THREE.AmbientLight(0xfff1de, 0.72);
    this.scene.add(this.amb);
    this.hemi = new THREE.HemisphereLight(0xdff0ff, 0x6b5a45, 0.40);
    this.scene.add(this.hemi);
    this.key = new THREE.DirectionalLight(0xfff0d2, 1.90);
    this.key.position.set(11, 7.5, 5);
    this.scene.add(this.key);
    this.fill = new THREE.DirectionalLight(0xa9c8e6, 0.55);
    this.fill.position.set(-8, 6, -6);
    this.scene.add(this.fill);

    /* 静态世界 / 动态物件 / 角色 三个挂载点 */
    this.staticRoot = new THREE.Group();
    this.dynRoot = new THREE.Group();
    this.charRoot = new THREE.Group();
    this.scene.add(this.staticRoot, this.dynRoot, this.charRoot);

    /* 网格池：每帧复用，避免 GC 抖动 */
    this.pool = { all: [], used: 0, root: this.dynRoot };
    this.skyPlane = null;

    this.buildTextures();
    this.buildGeos();

    this.canvas3d = canvas;
    this.ready = true;
    if (typeof Chars3D !== 'undefined' && Chars3D.loadModels) Chars3D.loadModels().catch(() => {});
    return true;
  },

  /* ---------------- 程序化贴图（全部代码生成，无外部素材） ---------------- */
  mkCanvas(w, h, fn) {
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    fn(cv.getContext('2d'), w, h);
    return cv;
  },
  tex(cv) {
    const t = new THREE.CanvasTexture(cv);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 2;
    return t;
  },

  buildTextures() {
    /* 只留两张：天空渐变、脚下影斑。其余全靠几何和配色，不做贴图——
       长条盒子上的贴图 UV 会拉伸成横条纹，而且远距离必然摩尔纹。 */

    /* 影：径向渐变圆斑。
       这里 alpha 必须给足——材质那边还要乘一层 opacity，两头一削就什么都没了。
       剖面按"柔光箱下的一团接触影"来配：中间实、外圈化开得快，
       但衰减半径拉到 90%，不然只剩一个小黑点。 */
    this.shadow = this.tex(this.mkCanvas(128, 128, (c, w, h) => {
      const g = c.createRadialGradient(64, 64, 3, 64, 64, 63);
      g.addColorStop(0, 'rgba(0,0,0,1)');
      g.addColorStop(0.34, 'rgba(0,0,0,.90)');
      g.addColorStop(0.58, 'rgba(0,0,0,.62)');
      g.addColorStop(0.78, 'rgba(0,0,0,.30)');
      g.addColorStop(0.92, 'rgba(0,0,0,.09)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = g; c.fillRect(0, 0, w, h);
    }));
  },

  buildGeos() {
    /* 金币：圆柱先转 90°，让它立起来（轴沿 z），之后只绕 y 转就是旋转效果 */
    const coin = new THREE.CylinderGeometry(0.5, 0.5, 0.5, 20);
    coin.rotateX(Math.PI / 2);
    this.g = {
      cube: new THREE.BoxGeometry(1, 1, 1),
      plane: new THREE.PlaneGeometry(1, 1),
      cyl: new THREE.CylinderGeometry(0.5, 0.5, 1, 16),
      cyl8: new THREE.CylinderGeometry(0.5, 0.5, 1, 8),
      cone: new THREE.ConeGeometry(0.5, 1, 14),
      disc: coin,
      sphere: new THREE.SphereGeometry(0.5, 16, 12),
      torus: new THREE.TorusGeometry(0.5, 0.14, 8, 20),
      horseshoe: new THREE.TorusGeometry(0.5, 0.16, 8, 22, Math.PI * 1.15),
    };
  },

  /* ---------------- 材质 ---------------- */
  matte(color, opts) {
    const key = 'm' + color + (opts && opts.flat ? 'f' : '');
    if (!this._mc) this._mc = {};
    if (this._mc[key]) return this._mc[key];
    return (this._mc[key] = new THREE.MeshLambertMaterial({
      color: new THREE.Color(color), flatShading: !!(opts && opts.flat),
    }));
  },
  unlit(color, opts) {
    const key = 'u' + color + (opts && opts.opacity !== undefined ? opts.opacity : '');
    if (!this._uc) this._uc = {};
    if (this._uc[key]) return this._uc[key];
    return (this._uc[key] = new THREE.MeshBasicMaterial({
      color: new THREE.Color(color),
      transparent: opts && opts.opacity !== undefined,
      opacity: opts && opts.opacity !== undefined ? opts.opacity : 1,
      fog: opts && opts.fog === false ? false : true,
    }));
  },
  textured(t, color, opts) {
    const key = 't' + (t.uuid || '') + color;
    if (!this._tc) this._tc = {};
    if (this._tc[key]) return this._tc[key];
    return (this._tc[key] = new THREE.MeshLambertMaterial({
      map: t, color: new THREE.Color(color || '#ffffff'),
      transparent: !!(opts && opts.transparent),
      opacity: opts && opts.opacity !== undefined ? opts.opacity : 1,
      side: opts && opts.doubleSide ? THREE.DoubleSide : THREE.FrontSide,
    }));
  },

  /* ---------------- 网格池 ---------------- */
  take(geo, mat) {
    const p = this.pool;
    let m = p.all[p.used];
    if (!m) {
      m = new THREE.Mesh(geo, mat);
      m.matrixAutoUpdate = true;
      p.all.push(m);
      p.root.add(m);
    } else {
      m.geometry = geo;
      m.material = mat;
    }
    m.visible = true;
    p.used++;
    return m;
  },
  put(m, x, y, z, sx, sy, sz, rx, ry, rz) {
    m.position.set(x, y, z);
    m.scale.set(sx === undefined ? 1 : sx, sy === undefined ? 1 : sy, sz === undefined ? 1 : sz);
    m.rotation.set(rx || 0, ry || 0, rz || 0);
    return m;
  },
  /* 一个盒子（宽高深 + 可选绕 Y / 绕 X 旋转） */
  box(x, y, z, w, h, d, color, opts) {
    opts = opts || {};
    const m = this.take(this.g.cube, opts.tex ? this.textured(opts.tex, color, opts) : (opts.unlit ? this.unlit(color, opts) : this.matte(color, opts)));
    this.put(m, x, y, z, w, h, d, opts.rx || 0, opts.ry || 0, opts.rz || 0);
    return m;
  },
  tube(x, y, z, r, h, color, seg, opts) {
    opts = opts || {};
    const geo = seg === 8 ? this.g.cyl8 : this.g.cyl;
    const m = this.take(geo, opts.unlit ? this.unlit(color, opts) : this.matte(color, opts));
    this.put(m, x, y, z, r * 2, h, r * 2, opts.rx || 0, opts.ry || 0, opts.rz || 0);
    return m;
  },

  /* ---------------- 地上的软影 ----------------
     不用 shadowMap：手机上每帧重画一遍全场太贵，而且这套美术本来就是
     "柔光箱拍出来的微缩模型"，边缘化开的软影子反而更像。
     关键：影子要抬到枕木之上（y=0.15），压在道床上会被枕木整片盖掉看不见。 */
  SHADOW_Y: 0.15,
  shadowMat(a) {
    /* 步进做细一点（1/40），否则 0.1 一档跳，亮度会一块一块的 */
    const q = Math.round(a * 40) / 40;
    if (!this._smc) this._smc = {};
    const k = 'sh' + q;
    if (this._smc[k]) return this._smc[k];
    return (this._smc[k] = new THREE.MeshBasicMaterial({
      map: this.shadow, transparent: true, depthWrite: false, opacity: q, fog: true,
    }));
  },
  /* 在指定世界坐标摊一块影（cz 已是世界 z） */
  flatShadow(cx, cz, w, d, alpha) {
    const m = this.take(this.g.plane, this.shadowMat(alpha));
    this.put(m, cx, this.SHADOW_Y, cz, w, d, 1, -Math.PI / 2, 0, 0);
    return m;
  },

  /* ---------------- 主渲染入口 ---------------- */
  wz(zr) { return this.travel + zr - CFG.CAM_BACK; },

  api: {
    setCamera(camX, camY) { Pinch3D.camX = camX; Pinch3D.camY = camY; },

    proj(x, y, zr) {
      if (!Pinch3D.ready) return null;
      const p = Pinch3D._v3 || (Pinch3D._v3 = new THREE.Vector3());
      p.set(x, y, Pinch3D.wz(zr)).project(Pinch3D.camera);
      const W = Renderer.W, H = Renderer.H;
      if (p.z > 1) return null;
      const d = Pinch3D._depth || (Pinch3D._depth = new THREE.Vector3());
      d.set(x, y, Pinch3D.wz(zr));
      const dist = d.distanceTo(Pinch3D.camera.position);
      const focal = (H * 0.5) / Math.tan((CFG.FOV_Y || 62) * Math.PI / 360);
      return {
        sx: (p.x * 0.5 + 0.5) * W,
        sy: (0.5 - p.y * 0.5) * H,
        s: focal / Math.max(0.001, dist),
        w: dist,
      };
    },

    /* ---- 每帧开始：清场、摆相机、清 2D 叠加层 ---- */
    drawSky(th, travel, time) {
      if (!Pinch3D.ready) return;
      const R = Pinch3D;

      const c2 = Renderer.c;
      if (c2) {
        c2.setTransform(Renderer.dpr, 0, 0, Renderer.dpr, 0, 0);
        c2.clearRect(0, 0, Renderer.W / Renderer.dpr, Renderer.H / Renderer.dpr);
        c2.globalAlpha = 1;
      }

      R.travel = travel;
      R.th = th;
      const dtReal = Math.max(0.001, Math.min(0.2, (time || 0) - (R._lastT || time || 0)));
      R._lastT = time || 0;
      R.tickPerf(dtReal);

      /* 画布尺寸跟随 2D 层（dpr / 分辨率缩放都由它统一管） */
      const dpr = Renderer.dpr * (R.resScale || 1);
      const W = Math.max(1, Math.floor(Renderer.W * dpr));
      const H = Math.max(1, Math.floor(Renderer.H * dpr));
      const size = R.renderer.getSize(R._sz || (R._sz = new THREE.Vector2()));
      if (size.x !== W || size.y !== H) R.renderer.setSize(W, H, false);
      R.camera.aspect = Renderer.W / Math.max(1, Renderer.H);
      R.camera.updateProjectionMatrix();

      /* 池与角色清空 */
      R.pool.used = 0;
      R.charRoot.clear();

      /* 相机 */
      const camZ = travel - CFG.CAM_BACK;
      R.camera.position.set(R.camX, R.camY, camZ);
      /* 视线跟着相机走（不再乘 0.5）——乘 0.5 的话视角中心滞后于相机，
         角色会被推到画面边上。 */
      R.camTarget.set(R.camX, 0.62, camZ + 18);
      R.camera.lookAt(R.camTarget);
      /* 灯跟着相机走，否则跑远了光照会跑偏。
         台灯压到 35° 左右——之前 65° 太陡，影子短到全藏在物体自己底下，
         等于白开投影；压低之后影子才会横着甩过整条轨道。 */
      R.key.position.set(R.camX + 11, 7.5, camZ + 5);
      R.key.target.position.set(R.camX, 0, camZ + 6);
      R.key.target.updateMatrixWorld();
      R.fill.position.set(R.camX - 8, 6, camZ - 6);
      R.fill.target.position.set(R.camX, 0, camZ + 6);
      R.fill.target.updateMatrixWorld();

      /* 天光：不用主题那套蓝（出来就是发白的通用手游天），
         改用拍摄台背景纸——冷调顶 + 暖地平线，中间一层暖雾。
         地图主题只往上染 14%，各地风味还留得住。 */
      const night = th.night || 0;
      const skyTopC = new THREE.Color(SKY.dayTop).lerp(new THREE.Color(SKY.nightTop), night)
        .lerp(new THREE.Color(th.skyTop), 0.14 * (1 - night));
      const skyBotC = new THREE.Color(SKY.dayBot).lerp(new THREE.Color(SKY.nightBot), night)
        .lerp(new THREE.Color(th.skyBot), 0.12 * (1 - night));
      const fogCol = skyBotC.clone().lerp(skyTopC, 0.30);
      R.scene.fog.color.copy(fogCol);
      R.scene.fog.near = 24;
      R.scene.fog.far = CFG.FAR * 0.92;
      R.renderer.setClearColor(fogCol, 1);
      R.amb.intensity = 0.72 - night * 0.28;
      R.hemi.intensity = 0.40 - night * 0.16;
      R.key.intensity = 1.90 - night * 0.72;
      R.key.color.set(night > 0.5 ? 0xcfe0ff : 0xfff0d2);
      R.fill.intensity = 0.55 + night * 0.22;

      /* 天空：贴一张竖直渐变的远幕 */
      const key = skyTopC.getHexString() + skyBotC.getHexString();
      if (R.skyKey !== key) {
        R.skyKey = key;
        if (R._skyTex) R._skyTex.dispose();
        R._skyTex = R.tex(R.mkCanvas(8, 256, (c, w, h) => {
          const a = skyTopC, b = skyBotC;
          const warm = new THREE.Color('#fff0cf');
          const g = c.createLinearGradient(0, 0, 0, h);
          /* 地平线落在这张幕布 v≈0.50 的位置，暖光带就压在那一条上 */
          g.addColorStop(0, '#' + a.getHexString());
          g.addColorStop(0.26, '#' + a.clone().lerp(b, 0.42).getHexString());
          g.addColorStop(0.50, '#' + b.getHexString());
          g.addColorStop(0.64, '#' + b.clone().lerp(warm, 0.38).getHexString());
          g.addColorStop(1, '#' + b.getHexString());
          c.fillStyle = g; c.fillRect(0, 0, w, h);
        }));
        if (R.skyPlane) {
          R.skyPlane.material.map = R._skyTex;
          R.skyPlane.material.needsUpdate = true;
        }
      }
      if (!R.skyPlane) {
        R.skyPlane = new THREE.Mesh(
          new THREE.PlaneGeometry(1, 1),
          new THREE.MeshBasicMaterial({ map: R._skyTex, fog: false, depthWrite: false, side: THREE.DoubleSide })
        );
        R.skyPlane.renderOrder = -100;
        R.scene.add(R.skyPlane);
      }
      R.skyPlane.position.set(R.camX * 0.3, 24, camZ + 155);
      R.skyPlane.scale.set(460, 210, 1);

      /* 光晕直接烘在背景纸上（见上面的暖光带），不再单独摆一个方块 */

      /* 首次进游戏：用场上同款模型渲染菜单缩略图 */
      if (!R._thumbTried && typeof Chars3D !== 'undefined') {
        R._thumbTried = true;
        try {
          const skins = (typeof CHARS !== 'undefined' ? CHARS.map(c => c.skin) : []).concat(['bull', 'dog']);
          if (Chars3D.buildThumbs(R.canvas3d, skins)) Chars3D.thumbsReady = true;
        } catch (e) { R._thumbTried = false; }
      }
    },

    /* ---- 轨道 / 道砟 / 侧墙 / 城市 ---- */
    drawGround(th, travel) {
      if (!Pinch3D.ready) return;
      const R = Pinch3D;
      const camZ = travel - CFG.CAM_BACK;
      const FARZ = Math.max(180, CFG.FAR * 1.15);

      /* ---- 桌面：一整块绿色切割垫（接影子，但自己不出影子） ---- */
      R.box(0, -0.62, camZ + FARZ * 0.45, 130, 1.2, FARZ * 1.15, CRAFT.mat, { flat: true, noCast: true, recv: true });
      /* 垫子上的分格线：几根长条就够，多了远处会糊成一片 */
      for (let i = 0; i < 6; i++) {
        const lz = camZ + 6 + i * 19 + (travel % 19);
        if (lz > camZ + FARZ * 0.7) break;
        R.box(0, -0.014, lz, 130, 0.02, 0.10, CRAFT.matLine, { unlit: true, opacity: 0.42, noCast: true });
      }

      /* ---- 道床 ---- */
      R.box(0, -0.16, camZ + FARZ * 0.42, CFG.WALL_X * 2 + 0.6, 0.34, FARZ * 0.95, CRAFT.bed, { flat: true, noCast: true, recv: true });

      /* ---- 枕木：一根根冰棍棒，比道床浅一档，保证看得见 ---- */
      const GAP = CFG.SLEEPER_GAP, off = travel % GAP;
      const Q = R.quality === 'low' ? 0.6 : 1;
      const nSlp = Math.round(34 * Q);
      for (let i = 0; i < nSlp; i++) {
        const z = camZ + 2 + i * GAP + (GAP - off);
        if (z > camZ + FARZ * 0.5) break;
        /* 每根长度和角度都差一点，像随手摆上去的 */
        const idx = Math.round((z - camZ) / GAP);
        const s = Math.sin(idx * 12.9898) * 43758.5453;
        const j = s - Math.floor(s);
        R.box(j * 0.18 - 0.09, 0.045, z, CFG.ROAD_HALF * 2 + 0.5 + j * 0.34, 0.16, 0.60, CRAFT.stick,
          { flat: true, ry: (j - 0.5) * 0.04, recv: true });
      }

      /* ---- 铁轨：深色轨身 + 亮轨面 ---- */
      for (let ln = 0; ln < CFG.LANES; ln++) {
        const lx = Utils.laneX(ln);
        for (const s of [-1, 1]) {
          const rx = lx + s * CFG.RAIL_HALF;
          R.box(rx, 0.19, camZ + FARZ * 0.45, 0.14, 0.16, FARZ * 0.9, CRAFT.rail, { flat: true, noCast: true, recv: true });
          R.box(rx, 0.268, camZ + FARZ * 0.45, 0.11, 0.034, FARZ * 0.9, CRAFT.railTop, { flat: true, noCast: true, recv: true });
        }
      }

      /* ---- 侧墙：立起来的牛皮纸挡板 ---- */
      const SEGL = 13, SEGN = R.quality === 'low' ? 10 : 16;
      for (const sgn of [-1, 1]) {
        for (let i = 0; i < SEGN; i++) {
          const z = camZ + 3 + i * SEGL + (travel % SEGL);
          if (z > camZ + CFG.FAR * 0.72) break;
          const cx = sgn * CFG.WALL_X;
          const idx = i + Math.floor(travel / SEGL);
          /* 墙体 */
          R.box(cx, 0.62, z - SEGL / 2, 0.16, 1.24, SEGL, CRAFT.wall, { flat: true });
          /* 顶边压条 */
          R.box(cx, 1.30, z - SEGL / 2, 0.52, 0.19, SEGL, CRAFT.wallTop, { flat: true });
          /* 两块纸板接缝 */
          R.box(cx - sgn * 0.09, 0.62, z - SEGL / 2, 0.02, 1.22, 0.07, R.dark(CRAFT.wall, 0.70), { unlit: true });
          /* 偶尔来一截封箱胶带 */
          if (idx % 3 === 1) {
            R.box(cx - sgn * 0.09, 1.00, z - SEGL / 2 + 2.6, 0.02, 0.32, 1.7, CRAFT.tape, { unlit: true });
          }
          /* 偶尔贴张手写标签 */
          if (idx % 5 === 2) {
            R.box(cx - sgn * 0.09, 0.56, z - SEGL / 2 + 4.2, 0.02, 0.36, 1.1, '#f5efdd', { unlit: true });
            R.box(cx - sgn * 0.10, 0.56, z - SEGL / 2 + 4.2, 0.01, 0.16, 0.70, '#b9ab8e', { unlit: true });
          }
        }
      }

      R.api.drawCity(th, camZ, travel);

      /* ---- 接触网支架 ---- */
      const ng = R.quality === 'low' ? 5 : 7, gp = 26;
      for (let i = 0; i < ng; i++) {
        const z = camZ + 14 + i * gp + (travel % gp);
        if (z > camZ + CFG.FAR * 0.6) break;
        R.box(0, 5.30, z, CFG.WALL_X * 2, 0.14, 0.14, CRAFT.pole, { flat: true });
        for (const sgn of [-1, 1]) {
          R.box(sgn * (CFG.WALL_X - 0.10), 2.65, z, 0.18, 5.3, 0.18, CRAFT.pole, { flat: true });
        }
      }

      const map = (typeof World !== 'undefined' && typeof Store !== 'undefined' && Store.data) ? World.map(Store.data.map) : null;
      if (map) R.api.drawMapProps(th, camZ, travel, map.prop);
    },

    /* 墙外城市：纸盒楼 + 毛毡树 + 回形针路灯 */
    drawCity(th, camZ, travel) {
      const R = Pinch3D;
      const Q = R.quality === 'low' ? 0.55 : 1;
      const STEP = 12, n = Math.round(16 * Q);
      const FARZ = Math.min(CFG.FAR * 0.85, 165);
      const cols = CRAFT.paper;
      const night = th.night || 0;
      const rnd = (idx, k, sgn) => {
        const s = Math.sin((idx * 37.31 + k * 11.7 + (sgn > 0 ? 0.37 : 0)) * 12.9898) * 43758.5453;
        return s - Math.floor(s);
      };

      for (const sgn of [-1, 1]) {
        /* 桌面延伸出去的草地 + 人行道 */
        R.box(sgn * (CFG.WALL_X + 2.0), 0.05, camZ + FARZ * 0.45, 4.2, 0.14, FARZ * 0.95, CRAFT.grass, { flat: true, noCast: true, recv: true });
        R.box(sgn * (CFG.WALL_X + 4.9), 0.06, camZ + FARZ * 0.45, 1.7, 0.16, FARZ * 0.95, CRAFT.path, { flat: true, noCast: true, recv: true });

        const base = Math.floor(travel / STEP) * STEP;
        for (let i = 0; i < n; i++) {
          const z = camZ + 4 + i * STEP + (travel % STEP);
          if (z > camZ + FARZ) break;
          const idx = Math.floor(base / STEP) + i;
          const h = 5 + rnd(idx, 1, sgn) * 15;
          const w = 5.4 + rnd(idx, 2, sgn) * 3.6;
          const bx = sgn * (CFG.WALL_X + 8.2 + rnd(idx, 3, sgn) * 2.4);
          const col = cols[(idx + (sgn > 0 ? 3 : 0)) % cols.length];
          /* 略微歪一点，别摆得像效果图 */
          const tilt = (rnd(idx, 11, sgn) - 0.5) * 0.022;

          R.box(bx, h / 2, z, w, h, w * 0.82, col, { flat: true, rz: tilt });
          /* 楼顶折边 */
          R.box(bx, h + 0.30, z, w + 0.9, 0.60, w * 0.82 + 0.9, R.dark(col, 0.74), { flat: true, rz: tilt });
          /* 封箱胶带 */
          if (rnd(idx, 12, sgn) > 0.45) {
            R.box(bx - sgn * (w / 2 + 0.03), h * 0.5, z, 0.04, h * 0.88, 0.34, CRAFT.tape, { unlit: true });
          }
          /* 窗户：贴上去的小纸片 */
          const rows = Math.max(2, Math.min(5, Math.floor(h / 3.2)));
          for (let r2 = 0; r2 < rows; r2++) {
            for (let cix = 0; cix < 3; cix++) {
              if (rnd(idx * 7 + r2 * 3 + cix, 9, sgn) < 0.42) continue;
              const lit = night > 0.35;
              R.box(bx - sgn * (w / 2 + 0.04), 1.7 + r2 * 3.2, z - w * 0.28 + cix * w * 0.28,
                0.05, 1.4, w * 0.17, lit ? '#ffe6a8' : '#5d6a7a', { unlit: lit });
            }
          }
          /* 后排更高的楼，撑一下纵深 */
          if (rnd(idx, 4, sgn) > 0.34) {
            const h2 = h + 6 + rnd(idx, 5, sgn) * 11;
            R.box(bx + sgn * 8.0, h2 / 2, z + 3.2, w * 1.15, h2, w * 0.95, R.dark(col, 0.86), { flat: true });
          }
          if (rnd(idx, 6, sgn) > 0.42) R.api.drawTree(sgn * (CFG.WALL_X + 2.3), z + 5.2, rnd(idx, 7, sgn));
        }

        /* 路灯：回形针灯杆 + 小灯泡 */
        for (let i = 0; i < Math.round(6 * Q); i++) {
          const z = camZ + 16 + i * 30 + (travel % 30);
          if (z > camZ + FARZ) break;
          const lx = sgn * (CFG.WALL_X + 1.4);
          R.tube(lx, 2.1, z, 0.08, 4.2, CRAFT.pole, 8, { flat: true });
          R.box(lx - sgn * 0.45, 4.16, z, 0.9, 0.14, 0.3, CRAFT.pole, { flat: true });
          const lit = night > 0.3;
          R.box(lx - sgn * 0.82, 4.02, z, 0.56, 0.2, 0.34, lit ? '#ffe9a8' : '#cfc8b4', { unlit: lit });
        }
      }
    },

    /* 行道树：竹签 + 毛毡球 */
    drawTree(x, z, seed) {
      const R = Pinch3D;
      R.tube(x, 1.05, z, 0.15, 2.1, '#9a7448', 8, { flat: true });
      const g1 = '#' + new THREE.Color().setHSL(0.29 + seed * 0.05, 0.42, 0.30 + seed * 0.10).getHexString();
      const g2 = '#' + new THREE.Color().setHSL(0.29 + seed * 0.05, 0.44, 0.38 + seed * 0.10).getHexString();
      const a = R.take(R.g.sphere, R.matte(g1, { flat: true }));
      R.put(a, x, 2.75, z, 2.5, 2.0, 2.5);
      const b = R.take(R.g.sphere, R.matte(g2, { flat: true }));
      R.put(b, x + 0.22, 3.62, z - 0.15, 1.6, 1.4, 1.6);
    },

    /* 地图专属路边小道具 */
    drawMapProps(th, camZ, travel, propType) {
      const R = Pinch3D;
      const gap = 34;
      for (let i = 0; i < 6; i++) {
        const z = camZ + 10 + i * gap + (travel % gap);
        if (z > camZ + CFG.FAR * 0.6) break;
        for (const sgn of [-1, 1]) {
          const bx = sgn * (CFG.WALL_X + 3.6);
          switch (propType) {
            case 'lantern':
              R.tube(bx, 1.5, z, 0.06, 3.0, '#6b4a33', 8);
              R.box(bx, 3.05, z, 0.5, 0.62, 0.5, '#e0503c', { unlit: true });
              R.box(bx, 3.42, z, 0.62, 0.08, 0.62, '#f5c451');
              break;
            case 'sakura':
              R.tube(bx, 0.8, z, 0.10, 1.6, '#8a6a52', 8);
              R.put(R.take(R.g.sphere, R.matte('#f2b8cc', { flat: true })), bx, 2.0, z, 1.5, 1.1, 1.5);
              R.put(R.take(R.g.sphere, R.matte('#fad0dd', { flat: true })), bx + 0.3, 2.5, z + 0.2, 0.9, 0.8, 0.9);
              break;
            case 'palm':
              R.tube(bx, 1.5, z, 0.11, 3.0, '#9a7b52', 8);
              for (let k = 0; k < 4; k++) {
                const a = k / 4 * Math.PI * 2;
                R.box(bx + Math.cos(a) * 0.55, 3.05, z + Math.sin(a) * 0.55, 1.3, 0.08, 0.34, '#5c9c5f', { ry: a });
              }
              break;
            case 'obelisk':
              R.put(R.take(R.g.cone, R.matte('#c8a463', { flat: true })), bx, 2.1, z, 1.0, 4.2, 1.0);
              break;
            case 'dome':
              R.put(R.take(R.g.sphere, R.matte('#dfa0ab', { flat: true })), bx, 1.6, z, 1.9, 1.7, 1.9);
              R.box(bx, 2.55, z, 0.7, 0.3, 0.7, '#d9a441');
              break;
            case 'flagpole':
              R.tube(bx, 1.6, z, 0.06, 3.2, '#8a7f70', 8);
              for (let k = 0; k < 4; k++) {
                const cols = ['#e0413d', '#f5c451', '#4ab8f5', '#7dd44a'];
                R.box(bx + sgn * 0.35, 2.9 - k * 0.36, z, 0.6, 0.3, 0.03, cols[k % 4], { ry: sgn * Math.PI / 2, unlit: true });
              }
              break;
            case 'neon':
              R.tube(bx, 1.9, z, 0.07, 3.8, '#3a3f4a', 8);
              R.tube(bx, 3.0, z, 0.55, 0.10, '#2ee6d6', 8, { unlit: true });
              R.tube(bx, 3.4, z, 0.35, 0.08, '#ff3ec7', 8, { unlit: true });
              break;
            default:
              R.tube(bx, 1.7, z, 0.09, 3.4, th.wallDark, 8);
              R.box(bx, 3.5, z, 0.44, 0.2, 0.44, th.lamp, { unlit: true });
          }
        }
      }
    },

    /* ---- 影：贴地软斑 ----
       两个坑都踩过：
       1) 必须往台灯反方向甩出去。只摆在脚下的话，从上后方看会被角色本体
          整个盖住，等于没画。
       2) alpha 不能省。贴图那头要乘一次 alpha，材质这头再乘一次 opacity，
          两头都保守就只剩 0.2，压在深色道砟上完全读不出来。 */
    drawShadow(x, zr, scale, alpha) {
      if (!Pinch3D.ready) return;
      const R = Pinch3D;
      const s = 2.0 * (scale || 1);
      const a = Math.min(0.62, (alpha == null ? 0.3 : alpha) * 1.55);
      /* 台灯在 (camX+11, 7.5, camZ+5)，光的方向基本是 -x 略 +z。
         甩太远会变成一块跟角色脱开的污渍，所以只让影子从身侧探出来一截。 */
      R.flatShadow(x - s * 0.30, R.wz(zr) + s * 0.10, s * 1.55, s * 1.30, a);
    },

    /* ---- 纸盒列车 ---- */
    drawTrain(o) {
      if (!Pinch3D.ready) return;
      const R = Pinch3D;
      const z0 = R.wz(o.z0), z1 = R.wz(o.z1);
      const cz = (z0 + z1) / 2, len = Math.abs(z1 - z0);
      const w = o.x1 - o.x0, cx = (o.x0 + o.x1) / 2, h = o.y1 - o.y0;
      const base = o.color || '#3f7fd9';

      /* 车身在桌面上的投影：台灯约 35°，影长 ≈ 高 / tan35° ≈ 1.43 × 高，
         往灯的反方向（-x）甩出去，宽度是车身宽 + 影长 */
      const sl = Math.min(3.4, h) * 1.43;
      R.flatShadow(cx - sl * 0.5, cz + sl * 0.16, w + sl, len * 1.03, 0.44);

      /* 车身：一个刷了漆的纸盒 */
      const body = R.take(R.g.cube, R.matte(base, { flat: true }));
      R.put(body, cx, o.y0 + h / 2, cz, w, h, len);

      /* 裙板（深色胶带） */
      R.box(cx, o.y0 + 0.13, cz, w + 0.05, 0.26, len, R.dark(base, 0.66), { flat: true });

      /* 车身接缝：每隔一段来一条，破掉大平面的呆板 */
      const seams = Math.max(2, Math.min(6, Math.round(len / 3.4)));
      for (let k = 1; k < seams; k++) {
        const sz = z0 + k / seams * (z1 - z0);
        R.box(cx, o.y0 + h / 2, sz, w + 0.04, h * 0.92, 0.06, R.dark(base, 0.80), { flat: true });
      }

      /* 车窗：一节节贴上去的深色纸片 */
      if (h > 1.0) {
        const lit = (R.th && R.th.night > 0.4);
        const winCol = lit ? '#ffeab0' : '#3c4658';
        const segs = Math.max(3, Math.min(7, Math.round(len / 2.4)));
        const winH = h * 0.26, wy = o.y0 + h * 0.64;
        for (let k = 0; k < segs; k++) {
          const wz2 = z0 + (k + 0.5) / segs * (z1 - z0);
          R.box(cx, wy, wz2, w + 0.07, winH, (len / segs) * 0.56, winCol, { unlit: lit });
        }
      }

      /* 车顶封条 */
      R.box(cx, o.y0 + h + 0.06, cz, w * 0.94, 0.12, len * 0.95, R.dark(base, 1.22), { flat: true });

      /* 车头灯 */
      if (o.headlight) {
        for (const s of [-1, 1]) {
          R.box(cx + s * w * 0.30, o.y0 + 0.52, cz + len / 2 + 0.04, 0.30, 0.22, 0.07, '#fffbe0', { unlit: true });
        }
      }
    },

    /* ---- 障碍：全部手工小道具 ---- */
    drawObstacle(o) {
      if (!Pinch3D.ready) return;
      const R = Pinch3D;
      const x = o.x, z = R.wz(o.z);
      /* 底下一律先摊一块影，不然道具看着像浮在半空 */
      if (o.type !== 'puddle') R.flatShadow(x - 0.62, z + 0.06, 2.9, 2.5, 0.38);
      switch (o.type) {
        case 'barrier':   /* 冰棍棒栏杆 + 红白胶带 */
          for (const s of [-1, 1]) R.box(x + s * 0.85, 0.55, z, 0.12, 1.1, 0.12, '#b9ac95', { flat: true });
          for (let i = 0; i < 5; i++) {
            R.box(x - 0.8 + i * 0.4, 1.05, z, 0.4, 0.22, 0.10, i % 2 ? '#e0413d' : '#f2ece0', { flat: true });
          }
          break;
        case 'cone':      /* 黏土交通锥 */
          R.put(R.take(R.g.cone, R.matte('#ff7a1a', { flat: true })), x, 0.33, z, 0.62, 0.66, 0.62);
          R.box(x, 0.04, z, 0.72, 0.07, 0.72, '#d45a0c', { flat: true });
          R.box(x, 0.42, z, 0.40, 0.10, 0.40, '#f5f2ea', { flat: true });
          break;
        case 'dumpster':  /* 绿色纸箱垃圾桶 */
          R.box(x, 0.62, z, 1.5, 1.24, 1.3, '#4a8a46', { flat: true });
          R.box(x, 1.30, z, 1.58, 0.15, 1.38, '#3a6b37', { flat: true });
          break;
        case 'highbar':   /* 限高架：跳不过去，只能滑铲 */
          for (const s of [-1, 1]) R.box(x + s * 1.05, 0.9, z, 0.16, 1.8, 0.16, '#8d939c', { flat: true });
          R.box(x, 1.72, z, 2.3, 0.30, 0.30, '#cc4a3c', { flat: true });
          R.box(x, 1.72, z, 2.34, 0.16, 0.34, '#f2ece0', { flat: true });
          break;
        case 'spring':
        case 'ramp':      /* 弹跳垫 / 坡道 */
          R.box(x, 0.16, z, 1.5, 0.22, 1.1, o.type === 'spring' ? '#a17cf5' : '#9aa1aa', { rx: -0.34, flat: true });
          R.box(x, 0.34, z + 0.30, 1.2, 0.06, 0.24, '#ffd34d', { unlit: true });
          break;
        case 'tunnel':    /* 纸筒隧道 */
          for (const s of [-1, 1]) R.box(x + s * 1.3, 1.3, z, 0.34, 2.6, 0.9, '#6b717a', { flat: true });
          R.box(x, 2.75, z, 3.0, 0.40, 0.9, '#7a818b', { flat: true });
          break;
        case 'signal':    /* 信号灯 */
          R.tube(x, 1.2, z, 0.07, 2.4, '#737a84', 8);
          R.box(x, 2.55, z, 0.42, 0.70, 0.30, '#2e333b', { flat: true });
          R.box(x, 2.72, z - 0.16, 0.20, 0.20, 0.05, '#ff4a3d', { unlit: true });
          break;
        case 'puddle':    /* 水洼 */
          R.box(x, 0.02, z, 1.8, 0.03, 1.4, '#4a6a86', { unlit: true, opacity: 0.72 });
          break;
        case 'gantry':    /* 龙门架 */
          for (const s of [-1, 1]) R.box(x + s * 1.6, 2.0, z, 0.24, 4.0, 0.24, '#6b717a', { flat: true });
          R.box(x, 4.0, z, 3.6, 0.30, 0.30, '#757c86', { flat: true });
          break;
        default:
          R.box(x, 0.5, z, 1.6, 1.0, 0.4, '#cc6b4d', { flat: true });
      }
    },

    /* ---- 金币：铜纽扣（立起来的圆片，会转） ---- */
    drawCoin(o) {
      if (!Pinch3D.ready) return;
      const R = Pinch3D;
      const mat = R._coinMat || (R._coinMat = new THREE.MeshPhongMaterial({
        color: 0xe0a92c, specular: 0xfff0c0, shininess: 90,
        emissive: 0x3a2600, flatShading: false,
      }));
      const m = R.take(R.g.disc, mat);
      R.put(m, o.x, o.y, R.wz(o.z), 0.58, 0.58, 0.10);
      m.rotation.set(0, o.spin || 0, 0);
    },

    /* ---- 道具：红色磁铁 / 蓝色护盾 ---- */
    drawPower(o) {
      if (!Pinch3D.ready) return;
      const R = Pinch3D;
      const z = R.wz(o.z);
      const bob = Math.sin((o.t || 0) * 2.4 + (o.seed || 0)) * 0.12;
      const y = o.y + bob;
      if (o.kind === 'magnet') {
        const red = R._magnetMat || (R._magnetMat = new THREE.MeshPhongMaterial({ color: 0xd63a33, shininess: 40, specular: 0x552222 }));
        const m = R.take(R.g.horseshoe, red);
        R.put(m, o.x, y, z, 1.30, 1.30, 1.30, 0, 0, Math.PI * 0.925);
        /* 磁极：两个银头 */
        for (const s of [-1, 1]) {
          const t = R.take(R.g.cyl, R._tipMat || (R._tipMat = new THREE.MeshPhongMaterial({ color: 0xd8dde4, shininess: 80, specular: 0xffffff })));
          R.put(t, o.x + s * 0.31, y - 0.34, z, 0.18, 0.18, 0.18);
        }
      } else {
        const blue = R._shieldMat || (R._shieldMat = new THREE.MeshPhongMaterial({
          color: 0x2f8bff, transparent: true, opacity: 0.62, shininess: 110, specular: 0xffffff, depthWrite: false,
        }));
        const m = R.take(R.g.sphere, blue);
        R.put(m, o.x, y, z, 0.78, 0.78, 0.78);
        m.renderOrder = 6;
      }
    },

    /* ---- 粒子：小圆球 ---- */
    drawParticle(p) {
      if (!Pinch3D.ready) return;
      const R = Pinch3D;
      const a = Math.max(0, Math.min(1, p.life / (p.max || 0.7)));
      const r = (p.r || 0.08) * 2.4;
      const m = R.take(R.g.sphere, R.unlit(p.color || '#ffffff', { opacity: a * 0.9 }));
      R.put(m, p.x, p.y, R.wz(p.z), r, r, r);
      m.material.transparent = true;
      m.material.opacity = a * 0.9;
    },

    /* ---- 角色：交给 Chars3D 排队，drawFog 里统一挂上 ---- */
    drawChar(skin, x, y, zr, pose, worldH) {
      if (!Pinch3D.ready || typeof Chars3D === 'undefined') return;
      Chars3D.draw(skin, x, y, Pinch3D.wz(zr), pose, worldH || CFG.PLAYER_H);
    },

    /* ---- 悬浮板 ---- */
    drawHoverboard(x, y, zr, worldW, t, color) {
      if (!Pinch3D.ready) return;
      const R = Pinch3D;
      const z = R.wz(zr);
      const c = (color && color[0]) || '#ff5fa2';
      R.box(x, y + 0.10, z, worldW, 0.10, 0.5, c, { rx: -0.12, flat: true });
      R.box(x, y + 0.02, z, worldW * 0.8, 0.05, 0.36, '#ffd6ee', { unlit: true, opacity: 0.85 });
    },

    /* ---- 收尾：把角色挂上，然后真正出图 ---- */
    drawFog() {
      if (!Pinch3D.ready) return;
      const R = Pinch3D;
      if (typeof Chars3D !== 'undefined') {
        Chars3D.flush({
          attach(obj) { R.charRoot.add(obj); },
        });
      }
      /* 多余的池对象藏起来 */
      const p = R.pool;
      for (let i = p.used; i < p.all.length; i++) {
        if (p.all[i].visible) p.all[i].visible = false;
      }
      R.renderer.render(R.scene, R.camera);
    },

    /* ---- 天气与速度线：留在 2D 叠加层 ---- */
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
        const a = (speedRatio - 0.45) / 0.55 * 0.45;
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

      /* 暖调 + 暗角：整体往"台灯下拍出来的微缩模型"上靠一点 */
      c.save();
      c.fillStyle = 'rgba(255,198,128,' + (0.055 - (th.night || 0) * 0.02).toFixed(3) + ')';
      c.fillRect(0, 0, W, H);
      c.fillStyle = Pinch3D.vignette();
      c.fillRect(0, 0, W, H);
      c.restore();
    },
  },

  /* 颜色微调：把 hex 压暗/提亮，省得每个地方手写一遍 */
  dark(hex, k) {
    const c = new THREE.Color(hex);
    c.multiplyScalar(k);
    return '#' + c.getHexString();
  },

  /* 暗角：缓存的径向渐变，尺寸变了才重建 */
  vignette() {
    const c = Renderer.c;
    if (!c) return 'rgba(0,0,0,0)';
    const W = Renderer.W / Renderer.dpr, H = Renderer.H / Renderer.dpr;
    if (this._vig && this._vig.w === W && this._vig.h === H) return this._vig.g;
    const g = c.createRadialGradient(W / 2, H * 0.52, Math.min(W, H) * 0.30, W / 2, H * 0.52, Math.max(W, H) * 0.80);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(0.62, 'rgba(36,22,10,0.10)');
    g.addColorStop(1, 'rgba(28,16,6,0.36)');
    this._vig = { w: W, h: H, g: g };
    return g;
  },

  /* 自适应画质：帧率掉了就降密度和分辨率 */
  tickPerf(dt) {
    if (this.noAutoPerf) return;
    this._ft += dt; this._fn++;
    if (this._ft < 2.2) return;
    const avg = this._ft / Math.max(1, this._fn);
    this._ft = 0; this._fn = 0;
    if (avg > 0.034 && this.quality !== 'low') { this.quality = 'low'; this.resScale = 0.72; }
    else if (avg > 0.024 && this.quality === 'mid') { this.quality = 'low'; this.resScale = 0.85; }
    else if (avg < 0.018 && this.quality === 'low') { this.quality = 'mid'; this.resScale = 1; }
  },
};
