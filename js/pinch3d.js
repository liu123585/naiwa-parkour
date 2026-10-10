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

/* 顶点按确定性噪声顶出去，做出"手捏出来的"不规则球。
   用两组不同频率的正弦叠加，够随机又完全可复现（每次刷新长得一样）。 */
function lumpySphere(r, wSeg, hSeg, amount, seed) {
  const g = new THREE.SphereGeometry(r, wSeg, hSeg);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const n = Math.sin(x * 9.7 + y * 13.1 + z * 7.3 + seed) * 0.55
      + Math.sin(x * 21.3 - y * 5.9 + z * 17.7 + seed * 2.3) * 0.45;
    const k = 1 + n * amount;
    pos.setXYZ(i, x * k, y * k, z * k);
  }
  pos.needsUpdate = true;
  g.computeVertexNormals();
  return g;
}

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
        /* antialias 开着。老版为了省性能关了，代价是所有的箱体边缘全是锯齿，
           本来就偏低的分辨率再叠一层锯齿，观感就是"马赛克"。
           DPR_MAX 提上去之后，MSAA 的开销相对可接受，而且它买到的是
           最显眼的观感提升，这笔账划算。 */
        canvas: canvas, antialias: true, alpha: false,
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
    this.scene.fog = new THREE.Fog(0xb98d64, 38, CFG.FAR * 0.92);

    this.camera = new THREE.PerspectiveCamera(CFG.FOV_Y || 62, 1, 0.28, 320);
    this.camTarget = new THREE.Vector3();
    /* 打开 layer 1：角色描边 mesh 都挂在这一层，关掉这一层就能整批省掉描边。 */
    this.camera.layers.enable(1);

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

    /* 静态世界 / 动态物件 / 角色 三个挂载点。
       这三个组整体塞进一个 scale.x = -1 的镜像组里，原因见下面 mirrorX 的注释。 */
    this.staticRoot = new THREE.Group();
    this.dynRoot = new THREE.Group();
    this.charRoot = new THREE.Group();
    this.mirror = new THREE.Group();
    this.mirror.scale.x = -1;
    this.mirror.add(this.staticRoot, this.dynRoot, this.charRoot);
    this.scene.add(this.mirror);

    /* 网格池：每帧复用，避免 GC 抖动 */
    this.pool = { all: [], used: 0, root: this.dynRoot };
    this.skyPlane = null;

    this.buildTextures();
    this.buildGeos();

    this.canvas3d = canvas;
    this.ready = true;
    this.applyDetail();
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
      /* 毛毡球：球面按确定性噪声往外顶一点。
         行道树原来就是一颗光滑绿球，一眼"塑料"。顶出凹凸之后，
         配上 flatShading 才有毛毡团子的手感。 */
      sphereLump: lumpySphere(0.5, 12, 9, 0.11, 3.1),
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
    /* transparent 要显式给布尔。写成 `opts && ...` 在不传 opts 时会得到 undefined，
       three 那边会警告 "parameter 'transparent' has value of undefined"。 */
    const hasAlpha = !!(opts && opts.opacity !== undefined);
    return (this._uc[key] = new THREE.MeshBasicMaterial({
      color: new THREE.Color(color),
      transparent: hasAlpha,
      opacity: hasAlpha ? opts.opacity : 1,
      fog: !(opts && opts.fog === false),
    }));
  },
  textured(t, color, opts) {
    const key = 't' + (t.uuid || '') + color + (opts && opts.flat ? 'f' : '');
    if (!this._tc) this._tc = {};
    if (this._tc[key]) return this._tc[key];
    return (this._tc[key] = new THREE.MeshLambertMaterial({
      map: t, color: new THREE.Color(color || '#ffffff'),
      flatShading: !!(opts && opts.flat),
      transparent: !!(opts && opts.transparent),
      opacity: opts && opts.opacity !== undefined ? opts.opacity : 1,
      side: opts && opts.doubleSide ? THREE.DoubleSide : THREE.FrontSide,
    }));
  },

  /* 纸纹颗粒：给大面积纯色块铺一层细碎杂色。
     没有它，道床/墙面/楼房就是三块干净的平色，一眼"批量生成的 CG"。
     但强度要克制：颗粒太密太黑，在低分辨率下会被眼睛读成"压缩噪点"，
     整张画面显得脏、显得糊 —— 那正是"马赛克感"的一部分来源。
     所以点数从 1100 收到 750，不透明度也压掉三成，质感还在，脏感没了。 */
  get grainTex() {
    if (this._grainT) return this._grainT;
    const t = this.tex(this.mkCanvas(96, 96, (c, w, h) => {
      c.fillStyle = '#ffffff'; c.fillRect(0, 0, w, h);
      for (let i = 0; i < 750; i++) {
        const a = 0.03 + Math.random() * 0.085;
        c.fillStyle = (i % 3 ? 'rgba(0,0,0,' : 'rgba(255,255,255,') + a.toFixed(3) + ')';
        c.fillRect(Math.random() * w, Math.random() * h, 0.6 + Math.random() * 1.5, 0.6 + Math.random() * 1.5);
      }
      for (let i = 0; i < 10; i++) {          // 几道纸纤维
        c.strokeStyle = 'rgba(0,0,0,.035)'; c.lineWidth = 0.7;
        const y = Math.random() * h;
        c.beginPath(); c.moveTo(0, y); c.lineTo(w, y + (Math.random() - 0.5) * 5); c.stroke();
      }
    }));
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(5, 5);
    this._grainT = t;
    return t;
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
  /* ---------------- 盒子的实例化批次 ----------------
     全场 80% 的绘制都是盒子（枕木、挡板、楼房、窗户、支架…）。自研池子
     一个盒子就是一次 draw call，手机上 400+ 次直接卡住，而且三角面才 3 万，
     瓶颈完全在 call 数上。所以按材质类型分成 4 个 InstancedMesh：
     每帧只写实例矩阵与实例色，绘制次数从四百多降到个位数。
     颜色走 instanceColor，贴图共用 grainTex。
     带 opacity 的（水洼、玻璃）会退化回原来的池子路径，全场只有三四处。 */
  BOXCAP: 2600,
  boxBatch() {
    if (this._bb) return this._bb;
    const defs = [
      ['flat', new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true })],
      ['smooth', new THREE.MeshLambertMaterial({ color: 0xffffff })],
      ['unlit', new THREE.MeshBasicMaterial({ color: 0xffffff })],
      ['tex', new THREE.MeshLambertMaterial({ map: this.grainTex, color: 0xffffff, flatShading: true })],
    ];
    this._bb = {};
    for (const d of defs) {
      const im = new THREE.InstancedMesh(this.g.cube, d[1], this.BOXCAP);
      if (THREE.DynamicDrawUsage !== undefined) im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      im.frustumCulled = false;          // 自己按距离剔除，别让整批被整体裁掉
      im.count = 0;
      im.matrixAutoUpdate = false;
      this.dynRoot.add(im);
      this._bb[d[0]] = { mesh: im, n: 0 };
    }
    this._tmp();
    return this._bb;
  },
  /* 实例矩阵 / 临时色复用的对象，box 与 inst 两套批次共用。
     单独抽出来是因为 inst 批次可能先于 box 批次被首次调用到。 */
  _tmp() {
    if (this._m4) return;
    this._m4 = new THREE.Matrix4();
    this._q4 = new THREE.Quaternion();
    this._e3 = new THREE.Euler();
    this._p3 = new THREE.Vector3();
    this._s3 = new THREE.Vector3();
    this._c3 = new THREE.Color();
  },
  boxReset() {
    const B = this.boxBatch();
    for (const k in B) { B[k].n = 0; B[k].mesh.count = 0; }
  },
  boxFlush() {
    const B = this._bb;
    if (!B) return;
    for (const k in B) {
      const s = B[k];
      s.mesh.count = s.n;
      if (s.n > 0) {
        s.mesh.instanceMatrix.needsUpdate = true;
        if (s.mesh.instanceColor) s.mesh.instanceColor.needsUpdate = true;
      }
    }
  },

  /* ---------------- 通用实例化批次（圆柱 / 球 / 圆锥 / 圆片） ----------------
     和 boxBatch 是同一套思路，只是几何体不固定。
     原来 tube / sphere / cone 全走 take-put 池子，一个物体就是一次 draw call：
     一盏路灯的灯杆、一棵行道树的树干、屋顶的水箱和天线、路边道具的立柱，
     一条可视距离里光圆柱就有四五十根，加上球体二十多个 —— 手机上每帧
     要提交 170+ 次绘制调用，GPU 还没开始画，CPU 就先烧掉一大块帧时间。
     这里按「几何体 + 着色方式」分组，每组一个 InstancedMesh，
     颜色走 instanceColor（与 box 批次一致，材质底色留白）。
     分组键里带 shade 是因为同一根圆柱有的用 flatShading、有的用平滑法线，
     合成一批会改变受光外观 —— 那是看得出来的。 */
  INSTCAP: 900,
  instBatch(key, geo, shade) {
    if (!this._ib) this._ib = {};
    const k = key + '|' + shade;
    let b = this._ib[k];
    if (!b) {
      let mat;
      if (shade === 'unlit') mat = new THREE.MeshBasicMaterial({ color: 0xffffff });
      else mat = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: shade === 'flat' });
      const im = new THREE.InstancedMesh(geo, mat, this.INSTCAP);
      if (THREE.DynamicDrawUsage !== undefined) im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      im.frustumCulled = false;          // 和 box 批次一样：自己按距离剔除
      im.count = 0;
      im.matrixAutoUpdate = false;
      this.dynRoot.add(im);
      b = this._ib[k] = { mesh: im, n: 0 };
    }
    return b;
  },
  instReset() {
    if (!this._ib) return;
    for (const k in this._ib) { this._ib[k].n = 0; this._ib[k].mesh.count = 0; }
  },
  instFlush() {
    if (!this._ib) return;
    for (const k in this._ib) {
      const s = this._ib[k];
      s.mesh.count = s.n;
      if (s.n > 0) {
        s.mesh.instanceMatrix.needsUpdate = true;
        if (s.mesh.instanceColor) s.mesh.instanceColor.needsUpdate = true;
      }
    }
  },
  /* 往批次里塞一件。不返回 mesh —— 实例化的东西没法在事后单独改。 */
  inst(key, geo, x, y, z, sx, sy, sz, rx, ry, rz, color, shade) {
    this._tmp();
    const b = this.instBatch(key, geo, shade || 'flat');
    const i = b.n;
    if (i >= this.INSTCAP) return null;   // 到顶就丢，宁可少画也不崩
    this._e3.set(rx || 0, ry || 0, rz || 0);
    this._q4.setFromEuler(this._e3);
    this._p3.set(x, y, z);
    this._s3.set(sx === undefined ? 1 : sx, sy === undefined ? 1 : sy, sz === undefined ? 1 : sz);
    this._m4.compose(this._p3, this._q4, this._s3);
    b.mesh.setMatrixAt(i, this._m4);
    b.mesh.setColorAt(i, this._c3.set(color));
    b.n++;
    return b.mesh;
  },

  /* 一个盒子（宽高深 + 可选绕各轴旋转） */
  box(x, y, z, w, h, d, color, opts) {
    opts = opts || {};
    const exotic = opts.opacity !== undefined || (opts.tex && opts.tex !== this.grainTex);
    if (exotic) {                        // 带透明度 / 特殊贴图：退回池子路径
      const m = this.take(this.g.cube, opts.tex ? this.textured(opts.tex, color, opts) : (opts.unlit ? this.unlit(color, opts) : this.matte(color, opts)));
      this.put(m, x, y, z, w, h, d, opts.rx || 0, opts.ry || 0, opts.rz || 0);
      return m;
    }
    const B = this.boxBatch();
    const s = B[opts.unlit ? 'unlit' : (opts.tex ? 'tex' : (opts.flat ? 'flat' : 'smooth'))];
    const i = s.n;
    if (i >= this.BOXCAP) return null;   // 到顶就丢，宁可少画也不崩
    this._e3.set(opts.rx || 0, opts.ry || 0, opts.rz || 0);
    this._q4.setFromEuler(this._e3);
    this._p3.set(x, y, z);
    this._s3.set(w, h, d);
    this._m4.compose(this._p3, this._q4, this._s3);
    s.mesh.setMatrixAt(i, this._m4);
    s.mesh.setColorAt(i, this._c3.set(color));
    s.n++;
    return s.mesh;
  },
  tube(x, y, z, r, h, color, seg, opts) {
    opts = opts || {};
    const geo = seg === 8 ? this.g.cyl8 : this.g.cyl;
    /* 带透明度或特殊贴图的（全场只有霓虹灯那两三处）走池子，
       其余全部进实例化批次 —— 见 instBatch 上面那段说明。 */
    if (opts.opacity !== undefined || (opts.tex && opts.tex !== this.grainTex)) {
      const m = this.take(geo, opts.unlit ? this.unlit(color, opts) : this.matte(color, opts));
      this.put(m, x, y, z, r * 2, h, r * 2, opts.rx || 0, opts.ry || 0, opts.rz || 0);
      return m;
    }
    /* shade 必须按原样复现 matte/unlit 的行为：
       原来 matte() 里 flatShading 取的是 !!opts.flat，没传就是平滑法线，
       混成一批会让灯杆/道具杆的受光变样。 */
    const shade = opts.unlit ? 'unlit' : (opts.flat ? 'flat' : 'smooth');
    return this.inst(seg === 8 ? 'cyl8' : 'cyl', geo, x, y, z, r * 2, h, r * 2,
      opts.rx || 0, opts.ry || 0, opts.rz || 0, color, shade);
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

  /* ---------------- 主渲染入口 ----------------
     ⚠️ 关于左右方向（踩过的坑，别改回去）：
     相机朝 +z 看、+y 朝上时，摄像机的"屏幕右"向量是 cross(up, -forward) = (-1,0,0)，
     也就是**世界 -x 落在屏幕右边**。但游戏世界和 2D 渲染器（sx = cx + (x-camX)*s）
     的约定都是"世界 +x 落在屏幕右边"。两边不一致的结果就是：按←角色往屏幕右跑。
     所以 init 里把三个挂载点整体放进 scale.x = -1 的镜像组，
     相机 / 灯 / 天空幕布 / proj 这几个不在组里的，x 要手动取负。
     整体镜像而不是逐个取负，是因为逐个取负会漏掉旋转（绕 y、绕 z 的旋转也要反号）。 */
  wz(zr) { return this.travel + zr - CFG.CAM_BACK; },

  api: {
    /* 让外部（game.js 的设置面板）也能触发一次细节开合重判。
       api 里的东西才会被 Object.assign 到 Renderer 上，所以这里必须有这一层转发。 */
    applyDetail() { Pinch3D.applyDetail(); },

    setCamera(camX, camY) { Pinch3D.camX = camX; Pinch3D.camY = camY; },

    proj(x, y, zr) {
      if (!Pinch3D.ready) return null;
      const p = Pinch3D._v3 || (Pinch3D._v3 = new THREE.Vector3());
      /* 场景被镜像过，所以世界 x 对应的渲染坐标要取负 */
      p.set(-x, y, Pinch3D.wz(zr)).project(Pinch3D.camera);
      const W = Renderer.W, H = Renderer.H;
      if (p.z > 1) return null;
      const d = Pinch3D._depth || (Pinch3D._depth = new THREE.Vector3());
      d.set(-x, y, Pinch3D.wz(zr));
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
        /* ⚠️ setTransform 之后逻辑坐标系就等于 CSS 像素坐标系，
           所以这里必须用 Renderer.W / Renderer.H，**不能**再除以 dpr。
           原来写的是 Renderer.W / Renderer.dpr —— 那只会清掉 1/dpr 的宽度：
           dpr=1.25 时清 80%，dpr=1.75 时只剩 57%，
           右半边留着上一帧的旧天空不透明像素，把 3D 层整个盖住，
           表现就是"画面只有左半边是 3D，右半边是一块死色"。
           这个 bug 在 dpr=1 时完全看不出来，所以一直潜伏着；
           把 DPR_MAX 提上去之后才炸出来。 */
        c2.setTransform(Renderer.dpr, 0, 0, Renderer.dpr, 0, 0);
        c2.clearRect(0, 0, Renderer.W, Renderer.H);
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

      /* 池与角色清空，盒子 / 实例两个批次的计数也归零 */
      R.pool.used = 0;
      R.boxReset();
      R.instReset();
      R.charRoot.clear();

      /* 相机。注意 x 取负：场景整体被 scale.x=-1 镜像过，
         相机不在那个组里，要手动镜像才能对上（否则左右反）。
         -R.camX 而不是 R.camX，配合 proj 里也取负，三者才自洽。 */
      const camZ = travel - CFG.CAM_BACK;
      const mx = -R.camX;
      R.camera.position.set(mx, R.camY, camZ);
      /* 视线跟着相机走（不再乘 0.5）——乘 0.5 的话视角中心滞后于相机，
         角色会被推到画面边上。 */
      R.camTarget.set(mx, 0.62, camZ + 18);
      R.camera.lookAt(R.camTarget);
      /* 灯跟着相机走，否则跑远了光照会跑偏。
         台灯压到 35° 左右——之前 65° 太陡，影子短到全藏在物体自己底下，
         等于白开投影；压低之后影子才会横着甩过整条轨道。
         注意灯的 x 是 mx - 11 / mx + 8（不是 +11 / -8）：灯在世界里位于
         camX+11，镜像到渲染坐标就是 -(camX+11) = mx-11。写成 mx+11 的话
         灯会跑到影子的同一侧，影子就变成朝灯甩了。 */
      R.key.position.set(mx - 11, 7.5, camZ + 5);
      R.key.target.position.set(mx, 0, camZ + 6);
      R.key.target.updateMatrixWorld();
      R.fill.position.set(mx + 8, 6, camZ - 6);
      R.fill.target.position.set(mx, 0, camZ + 6);
      R.fill.target.updateMatrixWorld();

      /* 天光：以拍摄台背景纸为底（冷调顶 + 暖地平线），再按地图主题染色。
         染色比例从 14%/12% 提到 46%/40%。中间那档（34%/30%）实测还是不够：
         底色 `#2f4257` 太暗太灰，只染三成的话出来是 rgb(56,103,137) 的灰青，
         整片天跟楼房一样"没颜色"，全屏糊成一团灰米。
         再往上加又会把"背景纸"这个设定冲掉，46/40 是两头都保住的点。
         Color 对象按 (夜色档 + 主题 + 两色) 缓存：这几行以前每帧 new 出 5 个
         THREE.Color（4 个构造 + 1 个 clone），一秒 300 个，纯粹给 GC 添堵。 */
      const night = th.night || 0;
      const nq = Math.round(night * 20);
      const ck = nq + '|' + th.skyTop + '|' + th.skyBot;
      let sc = R._skyCols;
      if (!sc || sc.k !== ck) {
        const nf = nq / 20;
        const skyTopC = new THREE.Color(SKY.dayTop).lerp(new THREE.Color(SKY.nightTop), nf)
          .lerp(new THREE.Color(th.skyTop), 0.46 * (1 - nf));
        const skyBotC = new THREE.Color(SKY.dayBot).lerp(new THREE.Color(SKY.nightBot), nf)
          .lerp(new THREE.Color(th.skyBot), 0.40 * (1 - nf));
        const fogCol = skyBotC.clone().lerp(skyTopC, 0.30);
        sc = R._skyCols = { k: ck, top: skyTopC, bot: skyBotC, fog: fogCol };
      }
      const skyTopC = sc.top, skyBotC = sc.bot, fogCol = sc.fog;
      R.scene.fog.color.copy(fogCol);
      /* 雾的近端从 24 推到 38。24 是贴着相机的——相机在 camZ，接触网支架在
         camZ+14，也就二十来米，等于整个中景一进来就吃雾，远景近景全糊成
         同一个灰米色，画面毫无纵深。推远之后近处恢复对比，远处照样化开。 */
      R.scene.fog.near = 38;
      R.scene.fog.far = CFG.FAR * 0.92;
      R.renderer.setClearColor(fogCol, 1);
      /* 夜间照度：以前只降了 amb 0.28 / key 0.72，摊下来还剩白天七成亮度——
         天已经黑成深蓝，道床和枕木却还是白天的白，昼夜完全对不上，
         一眼就是"换了个天空贴图"的廉价感。现在总照度压到白天的一半左右，
         环境光同时转冷（夜里没有暖太阳，只有冷天光）。
         别压过头：障碍辨识全靠这点亮度，暗到看不清就是另一个 bug 了。 */
      R.amb.intensity = 0.72 - night * 0.44;
      R.hemi.intensity = 0.40 - night * 0.20;
      R.key.intensity = 1.90 - night * 1.00;
      R.key.color.set(night > 0.5 ? 0xcfe0ff : 0xfff0d2);
      R.amb.color.set(night > 0.5 ? 0xbcd2ee : 0xfff1de);
      R.fill.intensity = 0.55 + night * 0.14;

      const key = skyTopC.getHexString() + skyBotC.getHexString();
      if (R.skyKey !== key) {
        R.skyKey = key;
        if (R._skyTex) R._skyTex.dispose();
        R._skyTex = R.tex(R.mkCanvas(8, 256, (c, w, h) => {
          const a = skyTopC, b = skyBotC;
          const warm = new THREE.Color('#fff0cf');
          const g = c.createLinearGradient(0, 0, 0, h);
          /* 屏幕能看到的只是这张幕布 y∈[0.15,0.50] 那一段（见下面的尺寸推导），
             所以停靠点不能按"整张幕布"来分。实测老配方（0/0.26/0.50）里
             0.26 那档在屏幕往下 10% 就到了，三分之二的天都在往暖色跑，
             白天也像黄昏。现在把蓝压到 0.30/0.44 才放，0.52 才落地平线的暖光带。
             地平线（幕布 y=0.50）那一条永远是暖的——那是台灯烤出来的。 */
          g.addColorStop(0, '#' + a.getHexString());
          g.addColorStop(0.30, '#' + a.clone().lerp(b, 0.22).getHexString());
          g.addColorStop(0.44, '#' + a.clone().lerp(b, 0.58).getHexString());
          g.addColorStop(0.52, '#' + b.getHexString());
          g.addColorStop(0.66, '#' + b.clone().lerp(warm, 0.34).getHexString());
          g.addColorStop(1, '#' + b.getHexString());
          c.fillStyle = g; c.fillRect(0, 0, w, h);
        }));
        if (R.skyPlane) {
          R.skyPlane.material.map = R._skyTex;
          R.skyPlane.material.needsUpdate = true;
        }
      }
      /* 天空幕布的位置和尺寸是算出来的，不是拍的数：
         相机俯角 atan((camY-0.62)/18)，竖半视角 31°，幕布在 camZ+155 处，
         于是屏幕顶端打在幕布上的 y = camY + 155*tan(31° - 俯角)。
         camY=4.05 时约 61。要让这一段落进渐变的上半区（冷调顶），
         并且让 0.50 那一档正好压在真正的地平线上（地平线在幕布上的 y 就是
         相机高度 camY），解出来幕布高 ≈163、中心在 camY。
         以前是「高 210、中心 24」——顶上一大截冷色整个浪费在屏幕外，
         可见的那条带正好是渐变最暖的一段，所以白天也糊成一片灰米。 */
      if (!R.skyPlane) {
        R.skyPlane = new THREE.Mesh(
          new THREE.PlaneGeometry(1, 1),
          new THREE.MeshBasicMaterial({ map: R._skyTex, fog: false, depthWrite: false, side: THREE.DoubleSide })
        );
        R.skyPlane.renderOrder = -100;
        R.scene.add(R.skyPlane);
      }
      R.skyPlane.position.set(mx * 0.3, R.camY, camZ + 155);
      R.skyPlane.scale.set(460, 163, 1);

      /* 光晕直接烘在背景纸上（见上面的暖光带），不再单独摆一个方块 */

      /* 首次进游戏：用场上同款模型渲染菜单缩略图。
         追兵不进商店，所以不用给它们出缩略图。 */
      if (!R._thumbTried && typeof Chars3D !== 'undefined') {
        R._thumbTried = true;
        try {
          const skins = (typeof CHARS !== 'undefined' ? CHARS.map(c => c.skin) : []);
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

      /* ---- 道床 ----
         地图配色真正驱动场景：道床/枕木/侧墙都跟着当前地图走。
         （以前这几处颜色全写死在 CRAFT 里，所以 8 张地图跑起来几乎一个样） */
      const bedCol = th.ballast || CRAFT.bed;
      const wallCol = th.wall || CRAFT.wall;
      const wallTopCol = th.wallTop || CRAFT.wallTop;
      /* 道床压暗一档：它占了下半屏六成面积，跟枕木一个亮度的话整片地就是
         一块平板，看不出轨道在哪。 */
      R.box(0, -0.16, camZ + FARZ * 0.42, CFG.WALL_X * 2 + 0.6, 0.34, FARZ * 0.95, R.dark(bedCol, 0.86),
        { flat: true, noCast: true, recv: true, tex: R.grainTex });

      /* ---- 枕木：一根根冰棍棒，比道床浅一档，保证看得见 ----
         CRAFT.stick 从建库第一天就写着"冰棍棒枕木"，可这里一直用的是
         R.dark(bedCol, 1.18)——跟道床只差一档亮度，加上道床本身就浅，
         铺出来是一片糊的沙色。改成往冰棍棒色拉 0.62：既留住地图的色系，
         又把"一根根摆上去"的对比度拉开。 */
      const slpCol = R.mixHex(bedCol, CRAFT.stick, 0.62);
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
        R.box(j * 0.18 - 0.09, 0.045, z, CFG.ROAD_HALF * 2 + 0.5 + j * 0.34, 0.16, 0.60, slpCol,
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
          R.box(cx, 0.62, z - SEGL / 2, 0.16, 1.24, SEGL, wallCol, { flat: true, tex: R.grainTex });
          /* 顶边压条 */
          R.box(cx, 1.30, z - SEGL / 2, 0.52, 0.19, SEGL, wallTopCol, { flat: true });
          /* 两块纸板接缝 */
          R.box(cx - sgn * 0.09, 0.62, z - SEGL / 2, 0.02, 1.22, 0.07, R.dark(wallCol, 0.70), { unlit: true });
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
      /* 楼房色板也跟着地图走，换图时天际线整个变味 */
      const cols = (th.bldg && th.bldg.length) ? th.bldg : CRAFT.paper;
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
          /* 同一排楼不能全长一个样。亮度抖动量化成 5 档再缓存：
             直接调 dark() 每帧要 new 一堆 THREE.Color，量化之后
             组合数是固定的，缓存起来一次就够。 */
          const jit = Math.round(rnd(idx, 31, sgn) * 4) / 4;
          R._bldgTint = R._bldgTint || {};
          const tk = col + jit;
          let body = R._bldgTint[tk];
          if (!body) body = R._bldgTint[tk] = R.dark(col, 0.90 + jit * 0.20);
          /* 略微歪一点，别摆得像效果图 */
          const tilt = (rnd(idx, 11, sgn) - 0.5) * 0.022;
          /* 远景只留剪影：这栋楼的窗户/空调/雨棚/天线加起来十几个 draw call，
             而 60 米外它们只有几个像素大——手机上卡住的大头就在这儿。 */
          const far = (z - camZ) > (R.quality === 'low' ? 44 : 66);

          R.box(bx, h / 2, z, w, h, w * 0.82, body, { flat: true, rz: tilt, tex: R.grainTex });
          /* 楼顶折边 */
          R.box(bx, h + 0.30, z, w + 0.9, 0.60, w * 0.82 + 0.9, R.dark(col, 0.74), { flat: true, rz: tilt });
          /* 封箱胶带 */
          if (!far && rnd(idx, 12, sgn) > 0.45) {
            R.box(bx - sgn * (w / 2 + 0.03), h * 0.5, z, 0.04, h * 0.88, 0.34, CRAFT.tape, { unlit: true });
          }
          /* 窗户：贴上去的小纸片 */
          const rows = far ? 0 : Math.max(2, Math.min(5, Math.floor(h / 3.2)));
          for (let r2 = 0; r2 < rows; r2++) {
            for (let cix = 0; cix < 3; cix++) {
              if (rnd(idx * 7 + r2 * 3 + cix, 9, sgn) < 0.42) continue;
              const lit = night > 0.35;
              R.box(bx - sgn * (w / 2 + 0.04), 1.7 + r2 * 3.2, z - w * 0.28 + cix * w * 0.28,
                0.05, 1.4, w * 0.17, lit ? '#ffe6a8' : '#5d6a7a', { unlit: lit });
            }
          }
          /* ---- 手工细节：一楼雨棚店门 / 空调外机 / 屋顶杂物 / 天线 ----
             没有这些，每栋楼都是同一个方盒子，一眼就是批量生成的街景。
             但只发给近景楼：远景十几个 call 换不来几个像素。 */
          if (far) { /* 远景跳过 */ } else {
          if (rnd(idx, 21, sgn) > 0.42) {
            R.box(bx - sgn * (w / 2 + 0.30), 2.10, z, 0.62, 0.10, w * 0.70,
              rnd(idx, 22, sgn) > 0.5 ? CRAFT.tape : '#c9553f', { flat: true });
          }
          if (rnd(idx, 23, sgn) > 0.50) {
            R.box(bx - sgn * (w / 2 + 0.03), 0.95, z + w * 0.16, 0.05, 1.9, w * 0.22, '#3f4a58', { unlit: true });
          }
          const nac = 1 + Math.floor(rnd(idx, 24, sgn) * 3);
          for (let a = 0; a < nac; a++) {
            const ay = 2.5 + rnd(idx * 13 + a, 25, sgn) * Math.max(1.2, h - 3.6);
            const az = z - w * 0.26 + rnd(idx * 17 + a, 26, sgn) * w * 0.52;
            R.box(bx - sgn * (w / 2 + 0.16), ay, az, 0.32, 0.44, 0.64, R.dark(col, 0.80), { flat: true });
          }
          const rk = rnd(idx, 27, sgn);
          if (rk > 0.42) R.box(bx + sgn * 1.2, h + 1.05, z, 1.3, 1.1, 1.3, R.dark(col, 0.72), { flat: true });
          if (rk > 0.72) R.tube(bx - sgn * 1.4, h + 1.5, z + 1.2, 0.20, 2.3, '#a8b0ba', 8, { flat: true });
          if (rnd(idx, 28, sgn) > 0.62) {
            const antH = 1.6 + rnd(idx, 29, sgn) * 2.2;
            R.tube(bx, h + 0.6 + antH / 2, z, 0.05, antH, '#8d95a0', 8, { flat: true });
          }
          }

          /* 后排更高的楼，撑一下纵深 */
          if (rnd(idx, 4, sgn) > 0.34) {
            const h2 = h + 6 + rnd(idx, 5, sgn) * 11;
            R.box(bx + sgn * 8.0, h2 / 2, z + 3.2, w * 1.15, h2, w * 0.95, R.dark(col, 0.86), { flat: true });
          }
          if (!far && rnd(idx, 6, sgn) > 0.42) R.api.drawTree(sgn * (CFG.WALL_X + 2.3), z + 5.2, rnd(idx, 7, sgn));
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
      /* 颜色按 seed 分档缓存：原来每棵树每帧都 new 两个 THREE.Color，长期跑会 GC 抖动 */
      const q = Math.round(Math.max(0, Math.min(1, seed)) * 8) / 8;
      R._treeCols = R._treeCols || {};
      let tc = R._treeCols[q];
      if (!tc) {
        tc = R._treeCols[q] = {
          g1: '#' + new THREE.Color().setHSL(0.29 + q * 0.05, 0.42, 0.30 + q * 0.10).getHexString(),
          g2: '#' + new THREE.Color().setHSL(0.29 + q * 0.05, 0.44, 0.38 + q * 0.10).getHexString(),
        };
      }
      const g1 = tc.g1, g2 = tc.g2;
      const a = R.take(R.g.sphereLump, R.matte(g1, { flat: true }));
      R.put(a, x, 2.75, z, 2.5, 2.0, 2.5);
      const b = R.take(R.g.sphereLump, R.matte(g2, { flat: true }));
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

      /* 车头灯：迎面列车是朝玩家开的（worldZ 每帧递减），
         所以"车头"是靠近玩家的那一端 z0，不是远端 z1。
         以前画在 cz + len/2（远端）—— 等于把车灯装在了车屁股上。 */
      if (o.headlight) {
        for (const s of [-1, 1]) {
          R.box(cx + s * w * 0.30, o.y0 + 0.52, cz - len / 2 - 0.05, 0.30, 0.22, 0.07, '#fffbe0', { unlit: true });
        }
      }
    },

    /* ---- 障碍：全部手工小道具 ---- */
    drawObstacle(o) {
      if (!Pinch3D.ready) return;
      const R = Pinch3D;
      const x = o.x, z = R.wz(o.z);
      /* 底下一律先摊一块影，不然道具看着像浮在半空。
         楼梯是长条结构，那块 2.5 米的通用小圆影根本盖不住，单独摊一条长的。 */
      if (o.type === 'stairs') {
        const SL = o.len || 4.4;
        R.flatShadow(x - 0.5, z + SL * 0.5, 3.4, SL * 1.06, 0.36);
      } else if (o.type !== 'puddle') {
        R.flatShadow(x - 0.62, z + 0.06, 2.9, 2.5, 0.38);
      }
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
        case 'highbar': { /* 限高门：下沿 1.30 就是"必须滑铲"的那条线，上面一路封到 3.2 米。
                             以前只在 1.72 米处挂一根横杆、碰撞却按 2.55 算，
                             视觉和判定对不上，玩家一跳发现过不去就说"碰撞没做"。 */
          const clear = o.y0 || 1.30, topY = o.y1 || 3.20;
          for (const s of [-1, 1]) R.box(x + s * 1.05, topY / 2, z, 0.16, topY, 0.30, '#8d939c', { flat: true });
          R.box(x, clear + 0.16, z, 2.26, 0.32, 0.30, '#cc4a3c', { flat: true });    // 红横梁：下沿即净空线
          R.box(x, clear - 0.01, z, 2.30, 0.12, 0.34, '#f2ece0', { flat: true });    // 白色警示边
          /* 横梁以上的竖向栅栏：一眼就知道"上面也过不去" */
          for (let i = -1; i <= 1; i++) {
            R.box(x + i * 0.72, (clear + 0.32 + topY) / 2, z, 0.15, topY - clear - 0.32, 0.16, '#9aa1a8', { flat: true });
          }
          break;
        }
        case 'spring':
        case 'ramp':      /* 弹跳垫 / 坡道 */
          R.box(x, 0.16, z, 1.5, 0.22, 1.1, o.type === 'spring' ? '#a17cf5' : '#9aa1aa', { rx: -0.34, flat: true });
          R.box(x, 0.34, z + 0.30, 1.2, 0.06, 0.24, '#ffd34d', { unlit: true });
          break;
        case 'tunnel': {  /* 限高隧道：顶棚下沿就是 1.26 米，站着进去必撞。
                             旧版只在 worldZ 那一处画了个 0.9 米深的门框，
                             可碰撞区间是从 worldZ 一路延伸到 worldZ+3 ——
                             于是玩家会"撞在什么都没有的空气上"。现在整体铺满整段。 */
          const L = o.len || 3.0, cz2 = z + L / 2;
          const clr = o.y0 || 1.26, tY = o.y1 || 3.10;
          for (const s of [-1, 1]) R.box(x + s * 1.30, tY / 2, cz2, 0.32, tY, L, '#6b717a', { flat: true });
          R.box(x, clr + 0.36, cz2, 3.02, 0.72, L, '#7a818b', { flat: true });               // 顶棚主体
          R.box(x, clr - 0.02, cz2, 3.04, 0.16, L * 1.01, '#e0b23a', { unlit: true });      // 下沿警示带
          R.box(x, tY - 0.16, cz2, 3.10, 0.32, L, '#5f666e', { flat: true });                // 顶部横梁
          break;
        }
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
        case 'turnstile': /* 闸机：齐人高，跳不过也滑不过，只能变道 */
          for (const s of [-1, 0, 1]) R.box(x + s * 0.42, 1.10, z, 0.16, 2.20, 0.16, '#8d939c', { flat: true });
          R.box(x, 2.24, z, 1.34, 0.22, 0.30, '#cc4a3c', { flat: true });
          R.box(x, 0.06, z, 1.34, 0.12, 0.42, '#6b717a', { flat: true });
          R.box(x, 1.08, z - 0.03, 0.88, 0.10, 0.10, '#f2ece0', { flat: true });
          break;
        case 'sweeper':   /* 横扫杆：底座 + 来回摆动的横杆 */
          R.box(x, 0.10, z, 0.92, 0.20, 0.62, '#7a818b', { flat: true });
          R.box(x, 0.55, z, 0.22, 1.10, 0.22, '#e0b23a', { flat: true });
          R.box(x, 1.00, z, 2.20, 0.16, 0.16, '#cc4a3c', { flat: true });
          break;
        case 'stairs': {  /* 缓行楼梯：一级级台阶从 base 爬到 climb，直接跑上去
                             台阶沿 +z（前进方向）铺开，和支撑面公式同一套口径：
                             人在 worldZ 处踩到 base、在 worldZ+len 处正好等于车顶高度。
                             base>0 就是从这节车厢爬到更高那节的接力楼梯。 */
          const top = o.climb || 1.35;
          const bot = o.base || 0;
          const rise = top - bot;
          const SL = o.len || 4.4;
          const n = Math.max(4, Math.min(10, Math.round(SL / 0.62)));
          const w = (o.hw || 1.02) * 2 * 0.94;
          for (let i = 0; i < n; i++) {
            const hh = bot + rise * (i + 1) / n;          // 这一级的台面高度
            const dz = z + SL * (i + 0.5) / n;
            const hgt = rise * (i + 1) / n;
            R.box(x, bot + hgt / 2, dz, w, hgt, SL / n * 0.97, i % 2 ? '#8f959e' : '#7c828b', { flat: true });
            R.box(x, hh - 0.035, dz, w * 0.94, 0.07, SL / n * 0.90, '#e0b23a', { unlit: true });  // 每级踏面前缘刷黄
          }
          /* 两侧扶手：跟着台阶一起升高。
             注意别做成"一整块高墙"——之前用 top+1.04 的高度画，
             2.25 米高的楼梯就变成一堵 3.3 米的墙，把后面的车厢整个挡没了。
             现在是每级一根短立柱 + 一根贴着坡度的斜顶杆。 */
          const railH = 0.86;
          const tilt = -Math.atan2(rise, SL);            // 负角 = +z 端抬高，和 ramp 的 rx 同号
          for (const s of [-1, 1]) {
            const rx2 = x + s * ((o.hw || 1.02) + 0.04);
            for (let i = 0; i < n; i++) {
              const hh = bot + rise * (i + 1) / n;
              const dz = z + SL * (i + 0.5) / n;
              R.box(rx2, hh + railH * 0.5, dz, 0.08, railH, 0.08, '#5f666e', { flat: true });
            }
            R.box(rx2, bot + rise * 0.5 + railH + 0.04, z + SL * 0.5,
              0.10, 0.10, Math.hypot(SL, rise), '#5f666e', { flat: true, rx: tilt });
          }
          /* 到顶那一下铺一块小平台，和车顶齐平，衔接不会"咯噔"一下 */
          R.box(x, top - 0.04, z + SL + 0.16, w, 0.08, 0.36, '#8f959e', { flat: true });
          break;
        }
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

      /* 地面投影 —— 金币"有多高"全靠它读出来。
         以前没有这层影子，一串悬空金币在屏幕上就是几个圆片排成一条直线，
         玩家分不清哪枚高哪枚低，自然也就不知道该在哪一枚起跳 ——
         反馈里"金币在上面我看不出来要跳"说的就是这件事。
         离地越高 → 影子越小越淡，这是最符合直觉的深度线索。 */
      const gy = o.y || 0.85;
      const hk = Math.max(0, Math.min(1, (gy - 0.6) / 2.2));   // 0 = 贴地，1 = 最高
      const sc = 1 - hk * 0.42;
      R.flatShadow(o.x, R.wz(o.z) + 0.04, 1.0 * sc, 0.60 * sc, 0.30 - hk * 0.17);
    },

    /* ---- 道具：每种道具一个专属造型，方便一眼认出来 ---- */
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
      } else if (o.kind === 'jet') {          /* 喷射背包：蓝色气瓶 + 喷焰 */
        R.put(R.take(R.g.cyl, R.matte('#4f9dff', { flat: true })), o.x, y, z, 0.32, 0.64, 0.32);
        R.put(R.take(R.g.sphere, R.matte('#a9d1ff', { flat: true })), o.x, y + 0.34, z, 0.30, 0.30, 0.30);
        R.put(R.take(R.g.cone, R.unlit('#ffd34d')), o.x, y - 0.48, z, 0.28, 0.36, 0.28, Math.PI, 0, 0);
      } else if (o.kind === 'x2') {           /* 双倍金币：金色方片 */
        R.put(R.take(R.g.cube, R.matte('#f5b21a', { flat: true })), o.x, y, z, 0.58, 0.58, 0.24);
        R.put(R.take(R.g.cube, R.unlit('#fff6d0')), o.x, y, z + 0.15, 0.42, 0.10, 0.03);
      } else if (o.kind === 'shoe') {         /* 超级跑鞋：橙色鞋身 + 白底 */
        R.put(R.take(R.g.cube, R.matte('#ff8b2b', { flat: true })), o.x, y + 0.06, z, 0.68, 0.30, 0.32);
        R.put(R.take(R.g.cube, R.unlit('#f2ece0')), o.x, y - 0.18, z, 0.72, 0.09, 0.34);
      } else if (o.kind === 'board') {        /* 悬浮板：粉色薄板 */
        R.put(R.take(R.g.cube, R.matte('#ff4fb0', { flat: true })), o.x, y, z, 0.88, 0.13, 0.36);
      } else if (o.kind === 'dash') {         /* 无敌冲刺：朝前的红色箭头 */
        R.put(R.take(R.g.cone, R.matte('#ff2d5e', { flat: true })), o.x, y, z, 0.46, 0.62, 0.46, Math.PI / 2, 0, 0);
        R.put(R.take(R.g.cube, R.unlit('#ffb3c4')), o.x, y - 0.42, z + 0.26, 0.16, 0.16, 0.16);
      } else if (o.kind === 'slow') {         /* 时间减速：紫色圆环 */
        R.put(R.take(R.g.torus, R.matte('#7f5bff', { flat: true })), o.x, y, z, 0.64, 0.64, 0.64);
        R.put(R.take(R.g.cyl, R.unlit('#c9b8ff')), o.x, y + 0.02, z, 0.10, 0.46, 0.10);
      } else {                                /* 护盾：蓝色半透明泡泡 */
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
      /* 提交盒子实例的时机必须在这里，不能放在 drawSky 末尾：
         车厢 / 障碍 / 金币 / 粒子是 drawSky 之后才发出来的（game.js render 里），
         早一步提交它们会被漏掉，整帧都画不出来。就在出图前一刻提交。 */
      R.boxFlush();
      R.instFlush();
      R.renderer.render(R.scene, R.camera);
    },

    /* ---- 天气与速度线：留在 2D 叠加层 ---- */
    drawWeather(th, time, speedRatio) {
      const c = Renderer.c;
      if (!c) return;
      const W = Renderer.W, H = Renderer.H;
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

      /* 暖调 + 夜间冷调 + 暗角：整体往"台灯下拍出来的微缩模型"上靠一点。
         色调层和颗粒层分开画：色调层随昼夜变化要重建（但很便宜），
         颗粒层几乎不重建。掉帧时（fxLow）连颗粒一起省掉。 */
      const ov = Pinch3D.overlay(th.night || 0);
      if (ov) c.drawImage(ov, 0, 0, W, H);
      if (!Renderer.fxLow) {
        const gr = Pinch3D.grain();
        if (gr) {
          /* 每帧随机偏移 ±2 像素：颗粒就有了手摇的抖动感 */
          c.save();
          c.translate((Math.random() * 4 - 2) | 0, (Math.random() * 4 - 2) | 0);
          c.drawImage(gr, 0, 0, W, H);
          c.restore();
        }
      }
    },
  },

  /* 颜色微调：把 hex 压暗/提亮，省得每个地方手写一遍。
     带备忘：这个函数每帧会被调上百次（楼身/楼顶折边/空调/雨棚/枕木/车厢接缝…），
     而实际传进来的 k 基本都是从「固定常量」或「量化到 5 档的抖动」来的，
     组合数很少。以前每次调用都要 new 一个 THREE.Color 再拼一个字符串，
     一秒上千次纯属给 GC 添堵——加个表就全免了。
     k 按千分位取整当键，避免浮点尾数把表撑爆；表上限 512 条，超了整体清空。 */
  dark(hex, k) {
    const key = hex + '|' + Math.round(k * 1000);
    const memo = Pinch3D.darkMemo || (Pinch3D.darkMemo = {});
    const hit = memo[key];
    if (hit !== undefined) return hit;
    if (memo._n === undefined) memo._n = 0;
    if (++memo._n > 512) { for (const p in memo) delete memo[p]; memo._n = 1; }
    const c = new THREE.Color(hex);
    c.multiplyScalar(k);
    return (memo[key] = '#' + c.getHexString());
  },

  /* 两色按比例插值。
     为什么不直接用 draw.js 里的 hexMix：那个只认 `#rrggbb` 字面量，
     而主题色经过 World.applyMap 之后全是 `rgb(r,g,b)` 字符串，传进去会被
     parseInt 解成 NaN。这里走 THREE.Color，两种写法都吃得下。
     跟 dark() 一样带备忘——它会被枕木/侧墙这类每帧上百次的地方调用。 */
  mixHex(a, b, t) {
    const key = a + '>' + b + '>' + Math.round(t * 1000);
    const memo = Pinch3D.mixMemo || (Pinch3D.mixMemo = {});
    const hit = memo[key];
    if (hit !== undefined) return hit;
    if (memo._n === undefined) memo._n = 0;
    if (++memo._n > 512) { for (const p in memo) delete memo[p]; memo._n = 1; }
    const c = new THREE.Color(a).lerp(new THREE.Color(b), t);
    return (memo[key] = '#' + c.getHexString());
  },

  /* 后期叠层：暖调 + 夜间冷调 + 暗角，合成一张缓存图，一次 drawImage 画完。
     以前这三样是每帧三次全屏填充（其中一次还是 pattern fill），手机上纯属白掉帧。
     颗粒不在这里——见下面 grain()，它单独缓存。 */
  overlay(night) {
    /* 键要把各段隔开。写成 ((night*20)|0) + Renderer.W + 'x' + ... 的话，
       `8 + 390` 会先走数值加法变成 398，键成了 "398x844" 而不是 "8390x844"——
       凑巧还能当键用，但 night 档 8 配宽 390 跟 night 档 0 配宽 398 会撞车。
       用 '|' 分隔就干净了。 */
    const key = Renderer.W + 'x' + Renderer.H + '|' + ((night || 0) * 20 | 0);
    if (this._ovKey === key && this._ov) return this._ov;
    try {
      const W = Math.max(1, Math.round(Renderer.W));
      const H = Math.max(1, Math.round(Renderer.H));
      const cv = document.createElement('canvas');
      cv.width = W; cv.height = H;
      const g2 = cv.getContext('2d');
      g2.fillStyle = 'rgba(255,198,128,' + (0.055 - (night || 0) * 0.02).toFixed(3) + ')';
      g2.fillRect(0, 0, W, H);
      /* 夜里再压一层冷色。以前这一层只有暖调，夜色全靠灯撑，
         道床和枕木还是白天的白——白天黑夜看着像同一张图换了个天空。
         冷蓝压上去之后，暗部会统一往蓝里沉，跟天空接得上。 */
      if (night > 0.02) {
        g2.fillStyle = 'rgba(16,26,56,' + (night * 0.18).toFixed(3) + ')';
        g2.fillRect(0, 0, W, H);
      }
      /* 暗角。
         ⚠️ 这层在修掉 W/dpr 那个 bug 之前只覆盖左半边，修好之后整屏生效，
         观感一下子暗了不少（边缘原本只压左半屏，现在是整圈）——
         所以强度要跟着回调：边缘从 0.36 收到 0.26，否则画面会发闷。
         暗角的作用是把视线收拢到中间，不是把画面压黑。 */
      const rg = g2.createRadialGradient(W / 2, H * 0.52, Math.min(W, H) * 0.30, W / 2, H * 0.52, Math.max(W, H) * 0.80);
      rg.addColorStop(0, 'rgba(0,0,0,0)');
      rg.addColorStop(0.62, 'rgba(36,22,10,0.065)');
      rg.addColorStop(1, 'rgba(28,16,6,0.26)');
      g2.fillStyle = rg;
      g2.fillRect(0, 0, W, H);
      this._ov = cv; this._ovKey = key;
      return cv;
    } catch (e) { return null; }
  },

  /* 胶片颗粒单独一张，跟色调层分开缓存。
     以前颗粒是烤在 overlay() 里的，而 overlay 的键带着 night——
     昼夜过渡时 night 会跨 20 个档，整张图就得重建 20 次，每次还要跑
     约 (W*H/70) ≈ 4700 次 fillRect 画点。一次主题切换就是二十来下肉眼可见的
     顿挫。拆开之后：颗粒只在尺寸变化时重建（几乎不发生），
     色调层重建只剩一次纯色填充 + 一次径向渐变，便宜到可以忽略。
     颗粒保留每帧随机偏移，手摇质感是这张图的意义所在。 */
  grain() {
    const W = Math.max(1, Math.round(Renderer.W));
    const H = Math.max(1, Math.round(Renderer.H));
    const key = W + 'x' + H;
    if (this._grKey === key && this._gr) return this._gr;
    try {
      const cv = document.createElement('canvas');
      cv.width = W; cv.height = H;
      const g2 = cv.getContext('2d');
      /* 密度从 /70 放到 /140、不透明度砍半。
         这层是铺满整屏的随机噪点，密到一定程度就不是"胶片颗粒"，
         而是"视频压缩块"——玩家会直接描述成"画面糊了、有马赛克"。
         留一点点就够压住色带，多了纯粹是负分。 */
      const n = (W * H) / 140;
      for (let i = 0; i < n; i++) {
        const v = Math.random();
        g2.fillStyle = 'rgba(' + (v > 0.5 ? '255,255,255,' : '0,0,0,') + (0.018 + Math.random() * 0.038).toFixed(3) + ')';
        g2.fillRect(Math.random() * W, Math.random() * H, 1.2, 1.2);
      }
      this._gr = cv; this._grKey = key;
      return cv;
    } catch (e) { return null; }
  },

  /* 暗角：缓存的径向渐变，尺寸变了才重建。
     注意：暗角已经烤进 overlay() 了，这个函数目前没有调用点。
     留着是给"想单独画暗角"的场合（比如菜单），但别误以为它在跑。 */
  vignette() {
    const c = Renderer.c;
    if (!c) return 'rgba(0,0,0,0)';
    const W = Renderer.W, H = Renderer.H;
    if (this._vig && this._vig.w === W && this._vig.h === H) return this._vig.g;
    const g = c.createRadialGradient(W / 2, H * 0.52, Math.min(W, H) * 0.30, W / 2, H * 0.52, Math.max(W, H) * 0.80);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(0.62, 'rgba(36,22,10,0.10)');
    g.addColorStop(1, 'rgba(28,16,6,0.36)');
    this._vig = { w: W, h: H, g: g };
    return g;
  },

  /* 自适应画质
     ---------------------------------------------------------
     旧版两个问题，都是玩家能直接感觉到的：
     1) 只降不升。回升判据是 avg < 0.014（>71fps），可 60Hz 屏幕上
        rAF 被 vsync 钉在 16.7ms，这个数永远达不到 —— 设备只要在启动
        阶段抖一下，就被永久锁在低画质上，之后一直又糊又"卡"。
     2) 直接改 quality（玩家的画质档位）。玩家自己选的档被系统悄悄改掉，
        设置面板里显示的还是"中"，对不上。
     现在只动 resScale 这一个动态旋钮，quality 永远尊重玩家选择；
     降档看"最差帧"（体感的卡顿来自那几帧长帧，不是平均值），
     升档要求连续两个窗口都稳，避免在阈值上来回横跳。 */
  tickPerf(dt) {
    if (this.noAutoPerf) return;
    this._ft += dt; this._fn++;
    if (dt > (this._worst || 0)) this._worst = dt;
    if (this._ft < 2.0) return;

    const avg = this._ft / Math.max(1, this._fn);
    const worst = this._worst || avg;
    this._ft = 0; this._fn = 0; this._worst = 0;

    /* LO 从 0.62 提到 0.86。
       0.62 是"糊到不能看"的程度：它和 game.js 的 dprScale 是两个各降各的旋钮，
       两个一起降的时候是相乘的（0.68 × 0.62 ≈ 0.42），
       叠上本来就偏低的 DPR_MAX，最终分辨率只剩屏幕的一半不到 —— 就是马赛克。
       宁可少省这一点性能，也不能把画面糊掉。 */
    const STEP = 0.05, LO = 0.86, HI = 1.0;
    let rs = this.resScale || 1;

    if (worst > 0.048 || avg > 0.026) {
      /* 有肉眼可见的长帧（>48ms）或平均掉到 38fps 以下 → 降一档 */
      rs = Math.max(LO, rs - STEP);
      this._good = 0;
    } else if (worst < 0.026 && avg < 0.0195) {
      /* 稳定在 51fps 以上，连着两个窗口都稳才慢慢涨回去 */
      this._good = (this._good || 0) + 1;
      if (this._good >= 2) { this._good = 0; rs = Math.min(HI, rs + STEP * 0.5); }
    } else {
      this._good = 0;
    }

    if (rs !== this.resScale) {
      this.resScale = rs;
      this.applyDetail();
    }
  },

  /* 低分辨率/低画质时把"锦上添花"的东西关掉：先关角色描边（省几十个 draw call），
     再低就关颗粒。都在一个地方判，免得散得到处都是。 */
  applyDetail() {
    const rs = this.resScale || 1;
    const q = this.quality || 'mid';
    const thin = rs < 0.92 || q === 'low';
    if (this.camera) {
      if (thin) this.camera.layers.disable(1);
      else this.camera.layers.enable(1);
    }
  },
};
