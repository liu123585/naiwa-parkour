/* =========================================================
   捏捏跑酷 · PINCH RUN —— 角色 3D 建模
   ---------------------------------------------------------
   全部用代码生成，不加载任何外部模型/贴图。
   一只小家伙 = 身形(shape) + 材质(mat) + 配饰(acc)，由 config.js 的 CHARS 驱动。

   造型思路：手工玩具的"不完美"是刻意的——
   顶点做确定性扰动（捏痕）、眼睛左右不对称、材质哑光。
   动画走 6 帧步进，模仿定格动画的顿挫感。
   ========================================================= */
'use strict';

/* ---------------- 材质配方 ---------------- */
const TOY_MAT = {
  clay:    { rough: 1.00, metal: 0.00, flat: false, jitter: 0.034, shiny: 0 },
  paper:   { rough: 1.00, metal: 0.00, flat: true,  jitter: 0.022, shiny: 0 },
  yarn:    { rough: 1.00, metal: 0.00, flat: false, jitter: 0.050, shiny: 0 },
  tin:     { rough: 0.40, metal: 0.70, flat: true,  jitter: 0.012, shiny: 42 },
  /* 铁皮玩具专用：比 tin 弱一档高光。
     tin 的 specular 系数是 0.57，在暖台灯 + 强天光下会把平面整块打爆成白，
     侧面看过去一条胳膊一条腿全糊成奶油色，剪影就散了。 */
  tinToy:  { rough: 0.58, metal: 0.20, flat: true,  jitter: 0.012, shiny: 16 },
  eraser:  { rough: 0.96, metal: 0.00, flat: false, jitter: 0.016, shiny: 0 },
  felt:    { rough: 1.00, metal: 0.00, flat: false, jitter: 0.056, shiny: 0 },
  wood:    { rough: 0.90, metal: 0.00, flat: true,  jitter: 0.020, shiny: 8 },
  plastic: { rough: 0.30, metal: 0.06, flat: false, jitter: 0.006, shiny: 70 },
  ceramic: { rough: 0.26, metal: 0.02, flat: false, jitter: 0.010, shiny: 96 },
  clear:   { rough: 0.14, metal: 0.00, flat: false, jitter: 0.008, shiny: 120, opacity: 0.55 },
  brass:   { rough: 0.32, metal: 0.86, flat: false, jitter: 0.010, shiny: 88 },
  metal:   { rough: 0.44, metal: 0.78, flat: true,  jitter: 0.012, shiny: 64 },
  cotton:  { rough: 1.00, metal: 0.00, flat: false, jitter: 0.064, shiny: 0 },
};

/* ---------------- 身体比例（局部空间，脚底 y=0，头顶≈1.0） ---------------- */
const P = {
  hipY: 0.30, bodyY: 0.62, bodyRX: 0.33, bodyRY: 0.36, bodyRZ: 0.30,
  shY: 0.68, shX: 0.33,
  eyeY: 0.74, eyeZ: 0.24, eyeX: 0.125, eyeR: 0.082,
  mouthY: 0.575, mouthZ: 0.27,
  legR: 0.086, armR: 0.076,
};

const STOP_STEPS = 6;          // 定格动画：一个步态循环切成 6 个姿势

/* =========================================================
   几何 / 材质缓存
   ========================================================= */
const GeoCache = {};
const MatCache = {};

/* 确定性伪随机（同一个 skin 每次生成的捏痕完全一致） */
function hash3(x, y, z, seed) {
  let n = Math.sin(x * 127.1 + y * 311.7 + z * 74.7 + seed * 41.3) * 43758.5453;
  return n - Math.floor(n);
}

/* 沿法线做顶点扰动 → 手工捏制的不规则感 */
function handmade(geo, amount, seed) {
  if (amount <= 0) return geo;
  const pos = geo.attributes.position;
  const nrm = geo.attributes.normal;
  if (!pos || !nrm) return geo;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const r = hash3(Math.round(x * 40), Math.round(y * 40), Math.round(z * 40), seed) - 0.5;
    const k = r * amount * 2;
    pos.setXYZ(i, x + nrm.getX(i) * k, y + nrm.getY(i) * k, z + nrm.getZ(i) * k);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

function geoSphere(key, rx, ry, rz, amount, seed) {
  const k = 's' + key + rx + '_' + ry + '_' + rz + '_' + amount + '_' + seed;
  if (GeoCache[k]) return GeoCache[k];
  const g = new THREE.SphereGeometry(1, 20, 14);
  handmade(g, amount, seed);
  g.scale(rx, ry, rz);
  return (GeoCache[k] = g);
}

function geoBox(key, w, h, d, amount, seed) {
  const k = 'b' + key + w + '_' + h + '_' + d + '_' + amount + '_' + seed;
  if (GeoCache[k]) return GeoCache[k];
  const g = new THREE.BoxGeometry(w, h, d, 3, 3, 3);
  handmade(g, amount, seed);
  return (GeoCache[k] = g);
}

function geoCapsule(key, r, len, amount, seed) {
  const k = 'c' + key + r + '_' + len + '_' + amount + '_' + seed;
  if (GeoCache[k]) return GeoCache[k];
  const g = new THREE.CapsuleGeometry(r, len, 6, 14);
  handmade(g, amount, seed);
  return (GeoCache[k] = g);
}

function geoTorus(key, R, tube, arc) {
  const k = 't' + key + R + '_' + tube + '_' + arc;
  if (GeoCache[k]) return GeoCache[k];
  return (GeoCache[k] = new THREE.TorusGeometry(R, tube, 8, 20, arc));
}

function geoCyl(key, rt, rb, h, seg) {
  const k = 'y' + key + rt + '_' + rb + '_' + h + '_' + seg;
  if (GeoCache[k]) return GeoCache[k];
  return (GeoCache[k] = new THREE.CylinderGeometry(rt, rb, h, seg || 12));
}

/* 哑光用 Lambert（无高光），有光泽的用 Phong（靠灯打高光，不依赖环境贴图） */
function toyMat(color, matName) {
  const m = TOY_MAT[matName] || TOY_MAT.clay;
  const k = matName + '|' + color + '|' + (m.opacity || 1);
  if (MatCache[k]) return MatCache[k];
  let out;
  if (m.shiny > 0) {
    out = new THREE.MeshPhongMaterial({
      color: new THREE.Color(color),
      shininess: m.shiny,
      specular: new THREE.Color(0xffffff).multiplyScalar(0.22 + m.metal * 0.5),
      flatShading: !!m.flat,
      transparent: m.opacity !== undefined,
      opacity: m.opacity === undefined ? 1 : m.opacity,
    });
  } else {
    out = new THREE.MeshLambertMaterial({
      color: new THREE.Color(color),
      flatShading: !!m.flat,
    });
  }
  return (MatCache[k] = out);
}

/* 描边：同一个几何体外扩一圈背面，剪影立刻清楚——小屏幕上尤其重要 */
let _outlineMat = null;
function outlineMat() {
  if (!_outlineMat) {
    _outlineMat = new THREE.MeshBasicMaterial({ color: 0x2b1f16, side: THREE.BackSide, fog: true });
  }
  return _outlineMat;
}

function mesh(geo, mat, x, y, z, outline) {
  const m = new THREE.Mesh(geo, mat);
  if (x !== undefined) m.position.set(x, y, z);
  if (outline) {
    const o = new THREE.Mesh(geo, outlineMat());
    o.scale.setScalar(1.07);
    m.add(o);
  }
  return m;
}

/* 把颜色压暗/提亮一档 */
function shade(hex, k) {
  const c = new THREE.Color(hex || '#888888');
  c.multiplyScalar(k);
  return '#' + c.getHexString();
}

/* =========================================================
   头部配饰
   ========================================================= */
const TOY_ACC = {
  none: () => [],

  /* 纸折帽：一顶折出来的三角帽 */
  foldhat: (cd) => {
    const g = new THREE.Group();
    const paper = toyMat('#e8d3ac', 'paper');
    const cap = mesh(geoCyl('fh', 0.02, 0.22, 0.20, 4), paper, 0, 0.10, 0);
    cap.rotation.y = Math.PI / 4;
    g.add(cap);
    g.add(mesh(geoBox('fhbrim', 0.42, 0.03, 0.34, 0.01, 7), paper, 0, 0.01, 0));
    return [g];
  },

  /* 毛线辫：两侧各一颗小线球 */
  braid: (cd) => {
    const yarn = toyMat(cd.body, 'yarn');
    const out = [];
    for (const s of [-1, 1]) {
      out.push(mesh(geoSphere('br', 0.10, 0.10, 0.10, 0.05, 11), yarn, s * 0.30, 0.16, -0.02));
    }
    out.push(mesh(geoTorus('brring', 0.085, 0.028, Math.PI * 2), yarn, 0, 0.30, 0));
    return out;
  },

  /* 发条：背后一把铁皮钥匙 */
  windup: (cd) => {
    const metal = toyMat('#c3ccd8', 'tin');
    const g = new THREE.Group();
    const stem = mesh(geoCyl('wus', 0.028, 0.028, 0.16, 8), metal, 0, 0, 0);
    stem.rotation.x = Math.PI / 2;
    g.add(stem);
    const loop = mesh(geoTorus('wul', 0.085, 0.026, Math.PI * 1.4), metal, 0, 0, 0.16);
    g.add(loop);
    g.position.set(0, 0.16, -0.30);
    return [g];
  },

  /* 缝线：脸上一道歪歪扭扭的针脚 */
  stitch: (cd) => {
    const thread = toyMat('#3f3a34', 'felt');
    const out = [];
    for (let i = 0; i < 6; i++) {
      const s = mesh(geoBox('st', 0.045, 0.022, 0.022, 0.0, 0), thread,
        -0.16 + i * 0.064, 0.90 + (i % 2 ? 0.026 : -0.026), 0.06);
      s.rotation.z = (i % 2 ? 1 : -1) * 0.5;
      out.push(s);
    }
    return out;
  },

  /* 年轮：头顶一圈圈同心环 */
  ring: (cd) => {
    const wood = toyMat('#8f6435', 'wood');
    const out = [];
    for (let i = 0; i < 3; i++) {
      out.push(mesh(geoTorus('rn', 0.075 + i * 0.062, 0.014, Math.PI * 2), wood, 0, 0.975, 0));
    }
    return out;
  },

  /* 凸点：积木顶上的四个圆柱 */
  studs: (cd) => {
    const pl = toyMat('#ffe9a6', 'plastic');
    const out = [];
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      out.push(mesh(geoCyl('sd', 0.075, 0.075, 0.055, 12), pl, sx * 0.15, 0.985, sz * 0.13));
    }
    return out;
  },

  /* 裂纹：瓷身上的一道开片 */
  crack: (cd) => {
    const dark = toyMat('#4a6f68', 'ceramic');
    const out = [];
    for (let i = 0; i < 5; i++) {
      const s = mesh(geoBox('ck', 0.020, 0.10, 0.020, 0.0, 0), dark,
        0.12 + (i % 2 ? 0.05 : -0.02), 0.55 + i * 0.085, 0.29 - i * 0.012);
      s.rotation.z = (i % 2 ? 1 : -1) * 0.34;
      out.push(s);
    }
    return out;
  },

  /* 四孔：黄铜纽扣的四个穿线孔 */
  holes: (cd) => {
    const dark = toyMat('#6b4d16', 'brass');
    const out = [];
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
      out.push(mesh(geoCyl('hl', 0.036, 0.036, 0.06, 8), dark, sx * 0.105, 0.62 + sy * 0.105, 0.295));
    }
    return out;
  },

  /* 弹簧圈：腰上一圈废弹簧 */
  coil: (cd) => {
    const m = toyMat('#8e99a6', 'metal');
    const out = [];
    for (let i = 0; i < 4; i++) {
      out.push(mesh(geoTorus('cl', 0.235 - i * 0.006, 0.022, Math.PI * 2), m, 0, 0.44 + i * 0.062, 0));
    }
    return out;
  },

  /* 蓬松：多出来的一撮棉花 */
  puff: (cd) => {
    const c = toyMat('#ffffff', 'cotton');
    return [
      mesh(geoSphere('pf', 0.14, 0.12, 0.13, 0.07, 21), c, 0.10, 0.99, -0.04),
      mesh(geoSphere('pf', 0.10, 0.09, 0.10, 0.07, 22), c, -0.13, 0.96, 0.05),
    ];
  },
};

/* =========================================================
   身形
   ========================================================= */
/* 椭球面上某高度处的 z 半径，用来把装饰贴到身体表面而不是飘在外面 */
function surfZ(y, ry, rz) {
  const dy = (y - P.bodyY) / ry;
  return rz * Math.sqrt(Math.max(0.06, 1 - dy * dy));
}

function buildBody(cd, seed) {
  const m = TOY_MAT[cd.mat] || TOY_MAT.clay;
  const j = m.jitter;
  const bodyMat = toyMat(cd.body, cd.mat);
  const bellyMat = toyMat(cd.belly, cd.mat);
  const g = new THREE.Group();
  const s = cd.shape || 'blob';
  let frontZ = P.bodyRZ * 0.8;      // 肚皮贴片的前表面
  let backZ = -P.bodyRZ * 0.95;     // 背面缝合线

  if (s === 'box') {
    const w = P.bodyRX * 1.72, h = P.bodyRY * 1.82, d = P.bodyRZ * 1.66;
    g.add(mesh(geoBox('bd', w, h, d, j, seed), bodyMat, 0, P.bodyY, 0, true));
    g.add(mesh(geoBox('bl', w * 0.60, h * 0.56, 0.03, j * 0.4, seed + 3), bellyMat, 0, P.bodyY - 0.05, d / 2));
    frontZ = d / 2 + 0.015;
    backZ = -d / 2 - 0.015;
  } else if (s === 'egg') {
    g.add(mesh(geoSphere('eg', P.bodyRX * 0.94, P.bodyRY * 1.12, P.bodyRZ * 0.94, j, seed), bodyMat, 0, P.bodyY + 0.02, 0, true));
    g.add(mesh(geoSphere('be', P.bodyRX * 0.60, P.bodyRY * 0.66, 0.02, j * 0.4, seed + 3), bellyMat, 0, P.bodyY - 0.06, P.bodyRZ * 0.78));
  } else if (s === 'bean') {
    g.add(mesh(geoCapsule('bn', P.bodyRX * 0.86, P.bodyRY * 1.24, j, seed), bodyMat, 0, P.bodyY + 0.02, 0, true));
    g.add(mesh(geoSphere('be', P.bodyRX * 0.52, P.bodyRY * 0.60, 0.02, j * 0.4, seed + 3), bellyMat, 0, P.bodyY - 0.08, P.bodyRZ * 0.72));
  } else if (s === 'ball') {
    g.add(mesh(geoSphere('ba', P.bodyRX, P.bodyRY, P.bodyRZ, j, seed), bodyMat, 0, P.bodyY, 0, true));
    g.add(mesh(geoSphere('be', P.bodyRX * 0.56, P.bodyRY * 0.56, 0.02, j * 0.4, seed + 3), bellyMat, 0, P.bodyY - 0.05, P.bodyRZ * 0.80));
  } else {
    g.add(mesh(geoSphere('bb', P.bodyRX, P.bodyRY, P.bodyRZ, j, seed), bodyMat, 0, P.bodyY, 0, true));
    g.add(mesh(geoSphere('be', P.bodyRX * 0.62, P.bodyRY * 0.60, 0.02, j * 0.4, seed + 3), bellyMat, 0, P.bodyY - 0.06, P.bodyRZ * 0.78));
  }

  /* 背面：一道歪歪扭扭的缝合线。
     跑酷时玩家看到的是背影，没这道线背影就是一颗光球。 */
  const thread = toyMat(shade(cd.body, 0.46), cd.mat);
  const ry = s === 'box' ? P.bodyRY * 0.91 : P.bodyRY;
  const rz = s === 'box' ? P.bodyRZ * 0.83 : P.bodyRZ;
  for (let i = 0; i < 6; i++) {
    const y = 0.32 + i * 0.115;
    const st = mesh(geoBox('bk', 0.052, 0.026, 0.026, 0, 0), thread,
      (i % 2 ? 0.024 : -0.024), y, -surfZ(y, ry, rz) - 0.012);
    st.rotation.z = (i % 2 ? 1 : -1) * 0.55;
    g.add(st);
  }

  /* 毛线球：绕几圈线 */
  if (cd.mat === 'yarn') {
    const yarn = toyMat(shade(cd.body, 0.80), 'yarn');
    for (let i = 0; i < 3; i++) {
      const t = mesh(geoTorus('yw', P.bodyRX * 1.01, 0.022, Math.PI * 2), yarn, 0, P.bodyY, 0);
      t.rotation.set(Math.PI / 2, 0, i * 1.05);
      g.add(t);
    }
  }
  /* 瓷：一圈釉面高光带 */
  if (cd.mat === 'ceramic') {
    g.add(mesh(geoTorus('gl', P.bodyRX * 0.92, 0.016, Math.PI * 2), toyMat('#ffffff', 'ceramic'), 0, P.bodyY + 0.13, 0));
  }
  /* 棉花：边上再蓬两撮 */
  if (cd.mat === 'cotton') {
    const c = toyMat('#ffffff', 'cotton');
    g.add(mesh(geoSphere('cf', 0.10, 0.09, 0.10, 0.08, 31), c, -0.26, P.bodyY - 0.06, 0.10));
    g.add(mesh(geoSphere('cf', 0.09, 0.08, 0.09, 0.08, 32), c, 0.24, P.bodyY + 0.14, -0.12));
  }
  void frontZ;
  return g;
}

/* =========================================================
   整只装配
   ========================================================= */
function buildRig(skin, opts) {
  const cd = CHAR_MAP[skin] || CHAR_MAP[DEFAULT_SKIN];
  const seed = (skin.charCodeAt(0) * 7 + skin.length * 13) % 97;
  const j = (TOY_MAT[cd.mat] || TOY_MAT.clay).jitter;
  const bodyMat = toyMat(cd.body, cd.mat);

  const root = new THREE.Group();
  const tilt = new THREE.Group();          // 撞击/翻滚时的整体翻转
  root.add(tilt);
  const core = new THREE.Group();          // 呼吸/挤压
  tilt.add(core);

  core.add(buildBody(cd, seed));

  /* ---- 眼睛（左右刻意不对称，像手贴上去的） ---- */
  const eyeW = toyMat('#fdfaf3', 'ceramic');
  const pupil = toyMat('#2b2622', 'eraser');
  const eyeY = P.eyeY + (seed % 3) * 0.006;
  for (const s of [-1, 1]) {
    const off = s < 0 ? 0.014 : -0.010;
    const eg = geoSphere('eye', P.eyeR, P.eyeR * 1.06, P.eyeR * 0.72, 0, 0);
    const e = mesh(eg, eyeW, s * P.eyeX, eyeY + off, P.eyeZ);
    core.add(e);
    const p = mesh(geoSphere('pu', P.eyeR * 0.50, P.eyeR * 0.54, P.eyeR * 0.30, 0, 0), pupil,
      s * P.eyeX, eyeY + off - 0.004, P.eyeZ + P.eyeR * 0.52);
    core.add(p);
    // 高光小点
    core.add(mesh(geoSphere('sp', P.eyeR * 0.15, P.eyeR * 0.15, 0.01, 0, 0), toyMat('#ffffff', 'ceramic'),
      s * P.eyeX - 0.022, eyeY + off + 0.026, P.eyeZ + P.eyeR * 0.62));
  }

  /* ---- 嘴：一段弧 ---- */
  const mouth = mesh(geoTorus('mo', 0.055, 0.013, Math.PI * 0.9), pupil, 0, P.mouthY, P.mouthZ);
  mouth.rotation.z = Math.PI;
  core.add(mouth);

  /* ---- 四肢：比身体暗一档，剪影才分得开 ---- */
  const limbMat = toyMat(shade(cd.body, 0.74), cd.mat);
  const limb = (x, y, r, len, isArm) => {
    const pivot = new THREE.Group();
    pivot.position.set(x, y, 0);
    const g = geoCapsule('lm', r, len, j * 0.7, isArm ? seed + 5 : seed + 6);
    pivot.add(mesh(g, limbMat, 0, -(len / 2 + r * 0.5), 0, true));
    /* 末端小球：圆手圆脚 */
    pivot.add(mesh(geoSphere('ft', r * 1.16, r * 0.92, r * 1.24, j * 0.6, seed + 8), limbMat, 0, -(len + r), 0, true));
    return pivot;
  };
  const armL = limb(-P.shX, P.shY, P.armR, 0.16, true);
  const armR = limb(P.shX, P.shY, P.armR, 0.16, true);
  const legL = limb(-0.135, P.hipY, P.legR, 0.17, false);
  const legR = limb(0.135, P.hipY, P.legR, 0.17, false);
  core.add(armL, armR, legL, legR);

  /* ---- 配饰 ---- */
  const head = new THREE.Group();
  head.position.set(0, 0, 0);
  const accFn = TOY_ACC[cd.acc] || TOY_ACC.none;
  try { accFn(cd).forEach(m => head.add(m)); } catch (e) { /* 配饰失败不影响角色 */ }
  core.add(head);

  const rig = {
    root, tilt, core, armL, armR, legL, legR, head,
    def: cd, baseY: 0,
  };
  /* 模型默认脸朝 +z（前进方向）——游戏里摄像机在身后，正好看到背影。
     缩略图那边摄像机在 +z 正对角色，所以不需要再转，保持 0 即可。 */
  if (opts && opts.faceCamera) root.rotation.y = 0;
  return rig;
}

/* =========================================================
   姿态驱动（定格动画：姿势量化到 6 帧）
   ========================================================= */
function applyPose(rig, pose) {
  const st = pose.state || 'run';
  // 量化 → 定格动画的顿挫
  const raw = pose.t || 0;
  const t = Math.round(((raw % 1) + 1) % 1 * STOP_STEPS) / STOP_STEPS;
  const ph = t * Math.PI * 2;
  const lean = pose.lean || 0;
  const squash = pose.squash || 0;

  // 复位
  rig.tilt.rotation.set(0, 0, 0);
  rig.core.rotation.set(0, 0, 0);
  rig.core.position.set(0, 0, 0);
  rig.core.scale.set(1, 1, 1);
  rig.armL.rotation.set(0, 0, 0);
  rig.armR.rotation.set(0, 0, 0);
  rig.legL.rotation.set(0, 0, 0);
  rig.legR.rotation.set(0, 0, 0);

  const swingA = Math.sin(ph);
  const swingB = -swingA;
  /* 步幅系数：铁皮玩具腿长、关节硬，摆太开会像在跨栏。
     收窄之后是那种一格一格的小碎步，更像上紧发条的玩具。 */
  const sw = rig.swing == null ? 1 : rig.swing;

  switch (st) {
    case 'jump':
      rig.legL.rotation.x = -0.75; rig.legR.rotation.x = -0.35;
      rig.armL.rotation.x = -2.05; rig.armR.rotation.x = -1.85;
      rig.armL.rotation.z = -0.28; rig.armR.rotation.z = 0.28;
      rig.core.rotation.x = -0.12;
      rig.core.position.y = 0.03;
      break;

    case 'fall':
      rig.legL.rotation.x = 0.42; rig.legR.rotation.x = -0.22;
      rig.armL.rotation.x = -1.35; rig.armR.rotation.x = -1.5;
      rig.armL.rotation.z = -0.6; rig.armR.rotation.z = 0.6;
      rig.core.rotation.x = 0.14;
      break;

    case 'roll':
      // 整体向前翻滚：用 pose.t 连续转，但同样走步进
      rig.tilt.rotation.x = -(pose.t || 0) * Math.PI * 2;
      rig.legL.rotation.x = -1.1; rig.legR.rotation.x = -0.9;
      rig.armL.rotation.x = -1.7; rig.armR.rotation.x = -1.7;
      rig.core.position.y = 0.30;
      rig.core.scale.set(1.02, 0.9, 1.02);
      break;

    case 'crash':
      rig.tilt.rotation.x = 0.55;
      rig.tilt.rotation.z = 0.24;
      rig.legL.rotation.x = 0.9; rig.legR.rotation.x = 0.6;
      rig.armL.rotation.x = -2.4; rig.armR.rotation.x = -2.2;
      rig.armL.rotation.z = -0.5; rig.armR.rotation.z = 0.5;
      break;

    case 'fly':
      rig.armL.rotation.x = -2.5; rig.armR.rotation.x = -2.5;
      rig.armL.rotation.z = -0.5; rig.armR.rotation.z = 0.5;
      rig.legL.rotation.x = 0.55; rig.legR.rotation.x = 0.35;
      rig.core.rotation.x = -0.20;
      rig.core.position.y = Math.sin(ph * 2) * 0.02;
      break;

    case 'idle':
      rig.core.position.y = Math.sin(ph) * 0.014;
      rig.core.scale.set(1, 1 + Math.sin(ph) * 0.02, 1);
      rig.armL.rotation.z = -0.12; rig.armR.rotation.z = 0.12;
      break;

    default: { // run
      rig.legL.rotation.x = swingA * 0.95 * sw;
      rig.legR.rotation.x = swingB * 0.95 * sw;
      rig.armL.rotation.x = swingB * 0.85 * sw;
      rig.armR.rotation.x = swingA * 0.85 * sw;
      rig.armL.rotation.z = -0.16; rig.armR.rotation.z = 0.16;
      rig.core.rotation.x = -0.13;
      rig.core.position.y = Math.abs(Math.sin(ph)) * 0.035;
      // 每步落地时压一下
      rig.core.scale.set(1 + Math.abs(swingA) * 0.03, 1 - Math.abs(swingA) * 0.05, 1);
      break;
    }
  }

  // 侧倾 + 落地挤压
  rig.tilt.rotation.z += lean * 0.30;
  rig.core.scale.y *= (1 - squash * 0.30);
  rig.core.scale.x *= (1 + squash * 0.16);
  rig.core.scale.z *= (1 + squash * 0.16);

  /* 定格动画的"呼吸抖动"：
     每个步进姿势都带一点固定的偏移，看起来就像逐帧拍出来的，
     而不是插值出来的顺滑动画。这是让画面"不 AI"的关键一笔。 */
  const step = Math.round(((raw % 1) + 1) % 1 * STOP_STEPS);
  const b1 = hash3(step, 1, 7, 3) - 0.5;
  const b2 = hash3(step, 2, 7, 3) - 0.5;
  const b3 = hash3(step, 3, 7, 3) - 0.5;
  rig.core.position.x += b1 * 0.016;
  rig.core.position.z += b2 * 0.016;
  rig.core.rotation.y += b3 * 0.035;

  /* 铁皮玩具背后的发条钥匙：跟着步态一格一格转，
     正好卡在定格动画的节拍上（一圈分 6 格，和步态同频）。 */
  if (rig.spin) {
    const a = -(step / STOP_STEPS) * Math.PI * 2;
    for (let i = 0; i < rig.spin.length; i++) rig.spin[i].rotation.z = a;
  }
}

/* =========================================================
   追兵：铁皮发条检票员 + 他那只铁皮狗
   ---------------------------------------------------------
   为什么不走 buildRig：
   buildRig 是按 CHAR_MAP[skin] 查表的，而 'bull' / 'dog' 根本不在角色表里，
   于是 `CHAR_MAP[skin] || CHAR_MAP[DEFAULT_SKIN]` 会一路回退成主角泥泥。
   也就是说——追兵以前其实是主角的换色版，看着当然不对。
   这里给它们单独建模。

   美术方向还是贴着"玩具厂"这条线：两个都是铁皮印刷玩具，
   平直的铁皮板、冲压出来的缝、背后一把黄铜发条钥匙、磨掉漆的边角。
   ========================================================= */
const TIN = {
  coat:   '#2f4468',   // 制服深蓝
  coatLt: '#41608c',   // 前襟（比制服亮一档，破开大平面）
  trous:  '#5d6d88',   // 裤腿——故意比上衣浅，不然从背后看整只人是一团深蓝
  trim:   '#a8342f',   // 领口 / 袖口 / 项圈
  brass:  '#d9a441',   // 纽扣 / 帽徽 / 发条钥匙
  glove:  '#efe9dc',   // 白手套，深色制服上唯一的亮点
  face:   '#d9c1a0',   // 铁皮脸
  cap:    '#1e2838',   // 大檐帽
  capTop: '#39496a',
  boot:   '#20242c',
  steel:  '#b6bfc9',
};

/* 背后那把发条钥匙。z 越小越靠后，所以钥匙环挂在 z = -0.16 那一头。 */
function buildWindupKey(scale) {
  const g = new THREE.Group();
  const brass = toyMat(TIN.brass, 'brass');
  const stem = mesh(geoCyl('wk_s', 0.030, 0.030, 0.16, 8), brass, 0, 0, -0.08);
  stem.rotation.x = Math.PI / 2;
  g.add(stem);
  g.add(mesh(geoTorus('wk_l', 0.105, 0.030, Math.PI * 2), brass, 0, 0, -0.165));
  /* 环里那道横梁：没有它就是个铜圈，加了才像发条钥匙 */
  g.add(mesh(geoBox('wk_b', 0.21, 0.030, 0.030, 0, 0), brass, 0, 0, -0.165));
  g.scale.setScalar(scale || 1);
  return g;
}

/* 检票钳：一把黄铜打孔钳，钳口张着。
   尺寸一定要压住——第一版给了 1.15 倍，结果钳子跟人一样高，
   侧面看就是一根金色大棒子戳出屏幕。 */
function buildTicketPunch(scale) {
  const g = new THREE.Group();
  const brass = toyMat(TIN.brass, 'brass');
  const steel = toyMat(TIN.steel, 'metal');
  /* 两根手柄，微微叉开 */
  for (const s of [-1, 1]) {
    const h = mesh(geoBox('tp_h', 0.050, 0.30, 0.056, 0, 0), brass, s * 0.052, -0.19, 0, true);
    h.rotation.z = s * 0.17;
    g.add(h);
  }
  /* 铰链 */
  g.add(mesh(geoCyl('tp_p', 0.052, 0.052, 0.094, 10), steel, 0, -0.03, 0));
  /* 上下颚：两块斜着的铁片，中间留个口 */
  for (const s of [-1, 1]) {
    const jaw = mesh(geoBox('tp_j', 0.080, 0.22, 0.058, 0, 0), brass, 0, 0.115, s * 0.080, true);
    jaw.rotation.x = -s * 0.38;
    g.add(jaw);
  }
  /* 冲头 */
  g.add(mesh(geoSphere('tp_t', 0.034, 0.050, 0.034, 0, 0), steel, 0, 0.205, 0.02));
  g.scale.setScalar(scale || 0.38);
  return g;
}

/* ---------------- 检票员：铁皮发条人形 ---------------- */
function buildInspector(core) {
  const j = 0.011;                 // 铁皮是冲压出来的，捏痕要轻
  const sd = 41;
  const coat = toyMat(TIN.coat, 'tinToy');
  const coatLt = toyMat(TIN.coatLt, 'tinToy');
  const trous = toyMat(TIN.trous, 'tinToy');
  const trim = toyMat(TIN.trim, 'tinToy');
  const brass = toyMat(TIN.brass, 'brass');
  const glove = toyMat(TIN.glove, 'tinToy');
  const faceM = toyMat(TIN.face, 'tinToy');
  const bootM = toyMat(TIN.boot, 'tinToy');
  const inkM = toyMat('#241f1a', 'eraser');

  /* ---- 躯干：一块冲压出来的铁皮盒，肩宽收成腰窄 ---- */
  core.add(mesh(geoBox('ins_t', 0.36, 0.42, 0.25, j, sd), coat, 0, 0.63, 0, true));
  /* 前襟：比制服亮一档，把胸前一整块大平面破开 */
  core.add(mesh(geoBox('ins_v', 0.21, 0.31, 0.022, 0, 0), coatLt, 0, 0.665, 0.132));
  /* 前襟上那排金纽扣——铁皮玩具最标志性的一笔 */
  for (let i = 0; i < 4; i++) {
    core.add(mesh(geoCyl('ins_b', 0.023, 0.023, 0.03, 8), brass, 0, 0.775 - i * 0.095, 0.152));
  }
  /* 领口 + 领带 */
  core.add(mesh(geoBox('ins_c', 0.27, 0.07, 0.235, j * 0.5, sd + 1), trim, 0, 0.845, 0.004));
  core.add(mesh(geoBox('ins_tie', 0.065, 0.19, 0.03, 0, 0), trim, 0, 0.745, 0.146));
  /* 腰带 + 铜扣 */
  core.add(mesh(geoBox('ins_bl', 0.375, 0.058, 0.265, 0, 0), toyMat('#1b2740', 'tinToy'), 0, 0.455, 0));
  core.add(mesh(geoBox('ins_bk', 0.085, 0.07, 0.03, 0, 0), brass, 0, 0.455, 0.142));
  /* 肩章：两片小铁皮，压在肩线上，别做宽——做宽了就成了横在肩上的一块金牌 */
  for (const s of [-1, 1]) {
    core.add(mesh(geoBox('ins_sp', 0.092, 0.028, 0.16, 0, 0), brass, s * 0.172, 0.858, 0));
  }
  /* 背后的发条钥匙 */
  const key = buildWindupKey(1.0);
  key.position.set(0, 0.68, -0.13);
  core.add(key);

  /* ---- 头 ----
     铁皮是两块冲压件：脑袋本体是中性的铁皮色，正面再贴一块浅色的"脸"。
     整颗头都用肤色的话，从背后看后脑勺也是一张脸，很怪。 */
  const head = new THREE.Group();
  head.position.set(0, 0.925, 0);
  head.add(mesh(geoBox('ins_h', 0.24, 0.24, 0.215, j, sd + 2), toyMat('#bda98b', 'tinToy'), 0, 0, 0, true));
  head.add(mesh(geoBox('ins_f', 0.212, 0.196, 0.022, 0, 0), faceM, 0, -0.008, 0.112));
  /* 眼睛：两条压出来的横缝，铁皮玩具的脸就是这么印的 */
  for (const s of [-1, 1]) {
    head.add(mesh(geoBox('ins_e', 0.060, 0.030, 0.02, 0, 0), inkM, s * 0.056, 0.032, 0.126));
  }
  /* 八字胡 */
  head.add(mesh(geoBox('ins_m', 0.105, 0.026, 0.02, 0, 0), inkM, 0, -0.052, 0.128));
  for (const s of [-1, 1]) {
    const t = mesh(geoBox('ins_mt', 0.058, 0.023, 0.02, 0, 0), inkM, s * 0.076, -0.037, 0.128);
    t.rotation.z = s * 0.42;
    head.add(t);
  }
  /* 大檐帽：帽圈贴头 + 向上外扩的帽顶 + 宽圆帽檐 + 帽徽。
     第一版是个等径高筒，出来是礼帽不是大檐帽——大檐帽的帽顶是"往外摊开"的。
     帽檐做宽是有用的：从背后看，那是唯一能把帽子和头分开的轮廓线。 */
  const capM = toyMat(TIN.cap, 'tinToy');
  head.add(mesh(geoCyl('ins_c1', 0.126, 0.126, 0.062, 14), capM, 0, 0.128, 0, true));
  head.add(mesh(geoCyl('ins_c5', 0.152, 0.130, 0.052, 14), capM, 0, 0.180, 0));
  head.add(mesh(geoCyl('ins_c3', 0.156, 0.156, 0.018, 14), toyMat(TIN.capTop, 'tinToy'), 0, 0.213, 0));
  head.add(mesh(geoCyl('ins_c2', 0.190, 0.190, 0.022, 16), capM, 0, 0.098, 0.030));
  head.add(mesh(geoCyl('ins_c4', 0.032, 0.032, 0.02, 10), brass, 0, 0.170, 0.140));
  core.add(head);

  /* ---- 腿：裤腿比上衣浅一档，靴子压到近黑 ---- */
  const legAt = (sx, seed) => {
    const pivot = new THREE.Group();
    pivot.position.set(sx * 0.108, 0.40, 0);
    pivot.add(mesh(geoBox('ins_l', 0.125, 0.36, 0.14, j * 0.6, seed), trous, 0, -0.18, 0, true));
    pivot.add(mesh(geoBox('ins_ft', 0.145, 0.078, 0.215, 0, 0), bootM, 0, -0.361, 0.038, true));
    return pivot;
  };
  const legL = legAt(-1, sd + 5);
  const legR = legAt(1, sd + 6);

  /* ---- 手臂 ----
     垂着的那条走正常摆臂；举着检票钳的那条，在肩关节下面再套一层"折起来"的组——
     因为 applyPose 每帧都会把 armR 复位，折角写在 armR 上会被抹掉。
     臂长从 0.28 收到 0.22：原来那截小臂长到膝盖，垂下来像根棍子。
     两只手都是白手套：一身深蓝里，那两点白就是全场的视觉锚。 */
  const AL = 0.22;
  const armAt = (sx) => {
    const pivot = new THREE.Group();
    pivot.position.set(sx * 0.222, 0.812, 0);
    return pivot;
  };
  const limb = (g) => {
    g.add(mesh(geoBox('ins_a', 0.088, AL, 0.094, j * 0.6, 0), coat, 0, -AL / 2, 0, true));
    g.add(mesh(geoBox('ins_cf', 0.098, 0.042, 0.104, 0, 0), trim, 0, -AL - 0.006, 0));
    g.add(mesh(geoBox('ins_hd', 0.086, 0.086, 0.086, 0, 0), glove, 0, -AL - 0.060, 0, true));
  };
  const armL = armAt(-1);
  limb(armL);

  const armR = armAt(1);
  const bendR = new THREE.Group();
  bendR.rotation.x = -1.15;
  limb(bendR);
  const punch = buildTicketPunch(0.46);
  /* 手柄尾端落在手掌上：钳心相对手沿它自己的 +y 挪 0.46*0.30 那么多 */
  punch.position.set(0, -AL - 0.060 + 0.138 * Math.cos(1.15), 0.138 * Math.sin(1.15));
  punch.rotation.x = 1.15;        // 抵消 bendR，让钳子重新立起来
  bendR.add(punch);
  armR.add(bendR);

  core.add(armL, armR, legL, legR);
  return { armL: armL, armR: armR, legL: legL, legR: legR, head: head, spin: [key] };
}

/* ---------------- 铁皮狗 ---------------- */
/* ---------------- 铁皮狗 ---------------- */
function buildTinDog(core) {
  const j = 0.010;
  const tin = toyMat('#c2c8d0', 'tinToy');
  const tinDk = toyMat('#79828e', 'tinToy');
  const pawM = toyMat('#262b33', 'tinToy');
  const spot = toyMat('#39424f', 'tinToy');
  const inkM = toyMat('#241f1a', 'eraser');

  /* 身子：横躺的铁皮胶囊。做窄一点——太粗就成了一根香肠，看不出是狗 */
  const body = mesh(geoCapsule('dog_b', 0.105, 0.24, j, 61), tin, 0, 0.40, -0.02, true);
  body.rotation.x = Math.PI / 2;
  core.add(body);
  /* 背上的印刷斑点 */
  const spots = [[-0.050, 0.482, -0.09, 0.050], [0.046, 0.498, 0.05, 0.044], [-0.018, 0.466, 0.16, 0.038]];
  for (const sp of spots) {
    core.add(mesh(geoSphere('dog_sp', sp[3], sp[3] * 0.42, sp[3], 0, 0), spot, sp[0], sp[1], sp[2]));
  }
  /* 脖子：把头和身子接上，不然头是浮在空中的一块方糖 */
  core.add(mesh(geoBox('dog_nk', 0.115, 0.115, 0.10, 0, 0), tin, 0, 0.475, 0.175, true));
  /* 脖子上的红项圈 */
  core.add(mesh(geoTorus('dog_col', 0.088, 0.022, Math.PI * 2), toyMat(TIN.trim, 'tinToy'), 0, 0.475, 0.185));
  /* 背后发条钥匙 */
  const key = buildWindupKey(0.72);
  key.position.set(0, 0.50, -0.09);
  core.add(key);

  /* 四条腿：按"前后"分成两组，各自绕 x 摆。
     为什么不按左右分：applyPose 只会转 legL / legR 两个组，如果每组里塞的是
     同一侧的前后两条腿，旋转轴就落在身体正中（z=0），腿会从身上"甩出去"。
     按前后分，每组自己的轴就在自己那对胯上，转起来不会脱节。
     副作用是前腿一起迈、后腿一起迈——正好是狗小跑时的"bound"，反而更对。 */
  const legPair = (pz, seed) => {
    const g = new THREE.Group();
    g.position.set(0, 0.36, pz);
    for (const sx of [-1, 1]) {
      g.add(mesh(geoBox('dog_l', 0.070, 0.36, 0.080, j * 0.5, seed), tin, sx * 0.082, -0.18, 0, true));
      g.add(mesh(geoBox('dog_p', 0.086, 0.062, 0.108, 0, 0), pawM, sx * 0.082, -0.329, 0.014));
    }
    return g;
  };
  const legL = legPair(0.115, 62);    // 前腿
  const legR = legPair(-0.115, 63);   // 后腿

  /* 头：比身子大一号，玩具狗就是头大 */
  const head = new THREE.Group();
  head.position.set(0, 0.555, 0.255);
  head.add(mesh(geoBox('dog_h', 0.175, 0.165, 0.175, j, 64), tin, 0, 0, 0, true));
  head.add(mesh(geoBox('dog_m', 0.100, 0.088, 0.115, 0, 0), tinDk, 0, -0.030, 0.132, true));
  head.add(mesh(geoSphere('dog_n', 0.032, 0.026, 0.028, 0, 0), pawM, 0, -0.018, 0.192));
  for (const s of [-1, 1]) {
    /* 尖耳朵：用四棱锥（顶半径收到 0.012 的 4 面柱），
       是狗剪影里最好认的一笔——圆耳朵一眼就变成熊了 */
    const ear = mesh(geoCyl('dog_ear', 0.014, 0.062, 0.130, 4), tinDk, s * 0.070, 0.128, -0.015, true);
    ear.rotation.z = s * 0.20;
    head.add(ear);
    head.add(mesh(geoSphere('dog_ey', 0.026, 0.028, 0.02, 0, 0), inkM, s * 0.055, 0.024, 0.090));
  }
  core.add(head);

  /* 尾巴：卷起来的铁皮条 */
  const tail = mesh(geoTorus('dog_t', 0.075, 0.018, Math.PI * 1.5), tinDk, 0, 0.495, -0.250);
  tail.rotation.y = Math.PI / 2;
  core.add(tail);

  /* 狗没有手臂，但 applyPose 每帧都会转 armL / armR，
     所以给两个空组当占位，省得在姿态代码里到处判空。 */
  const armL = new THREE.Group();
  const armR = new THREE.Group();
  core.add(armL, armR, legL, legR);
  return { armL: armL, armR: armR, legL: legL, legR: legR, head: head, spin: [key] };
}

/* ---------------- 追兵总装配 ---------------- */
function buildChaserRig(kind, opts) {
  const root = new THREE.Group();
  const tilt = new THREE.Group();
  root.add(tilt);
  const core = new THREE.Group();
  tilt.add(core);

  const parts = (kind === 'dog') ? buildTinDog(core) : buildInspector(core);
  const rig = {
    root: root, tilt: tilt, core: core,
    armL: parts.armL, armR: parts.armR,
    legL: parts.legL, legR: parts.legR,
    head: parts.head, spin: parts.spin,
    swing: kind === 'dog' ? 1.0 : 0.62,
    def: CHASER_DEF[kind] || CHASER_DEF.bull, baseY: 0,
  };
  if (opts && opts.faceCamera) root.rotation.y = 0;
  return rig;
}

const CHASER_DEF = {
  bull: {
    id: 'bull', skin: 'bull', kind: 'inspector', name: '检票员',
    body: TIN.coat, belly: TIN.brass, shape: 'box', mat: 'tin', acc: 'none',
  },
  dog: {
    id: 'dog', skin: 'dog', kind: 'dog', name: '铁皮狗',
    body: '#b6bcc4', belly: '#7d858f', shape: 'ball', mat: 'tin', acc: 'none',
  },
};

/* =========================================================
   对外接口（保持与旧 Chars3D 完全一致，game.js / ui.js 无需改动）
   ========================================================= */
const Chars3D = {
  thumbs: {},
  thumbsReady: false,
  queue: [],
  rigs: {},
  _building: {},

  loadModels() { return Promise.resolve(); },
  outfitTint() { return null; },

  def(skin) { return CHAR_MAP[skin] || CHASER_DEF[skin] || CHAR_MAP[DEFAULT_SKIN]; },

  build(skin, opts) {
    /* 追兵单独走一条路：它们不在角色表里，混进 buildRig 会被回退成主角 */
    if (CHASER_DEF[skin]) return buildChaserRig(skin, opts);
    return buildRig(this.def(skin).skin || skin, opts);
  },

  /* 取一只可复用的骨架（追兵会同时出现两只，用不同实例避免打架） */
  acquire(skin, slot) {
    const key = skin + '#' + (slot || 0);
    if (!this.rigs[key]) this.rigs[key] = this.build(skin, null);
    return this.rigs[key];
  },

  /* 由渲染器每帧调用：把游戏传进来的角色塞进队列 */
  draw(skin, x, y, wz, pose, height, tint) {
    this.queue.push({ skin: skin, x: x, y: y, z: wz, pose: pose, h: height || CFG.PLAYER_H });
  },

  /* 渲染器消费队列 */
  flush(api) {
    const q = this.queue;
    if (!q.length) return;
    const slots = {};
    for (const it of q) {
      const slot = slots[it.skin] = (slots[it.skin] || 0) + 1;
      const rig = this.acquire(it.skin, slot);
      applyPose(rig, it.pose || {});
      rig.root.position.set(it.x, it.y, it.z);
      rig.root.scale.setScalar(it.h);
      api.attach(rig.root);
    }
    q.length = 0;
  },

  /* ---------------- 缩略图：离屏渲染一次，商店/封面直接用 ---------------- */
  buildThumbs(canvas3d, skins) {
    if (this.thumbsReady) return true;
    if (typeof THREE === 'undefined') return false;
    let renderer = null;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    } catch (e) { return false; }

    const S = 320;
    renderer.setPixelRatio(1);
    renderer.setSize(S, S, false);
    renderer.setClearAlpha(0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    const scene = new THREE.Scene();
    scene.add(new THREE.AmbientLight(0xfff3e2, 1.15));
    const key = new THREE.DirectionalLight(0xfff0d6, 1.9);
    key.position.set(2.2, 3.4, 3.0);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x9fc4e8, 0.75);
    rim.position.set(-2.6, 1.6, -2.4);
    scene.add(rim);

    const cam = new THREE.PerspectiveCamera(30, 1, 0.1, 60);
    cam.position.set(0.42, 1.16, 2.62);
    cam.lookAt(0, 0.86, 0);

    for (const skin of (skins || [])) {
      if (this.thumbs[skin]) continue;
      let rig = null;
      try {
        rig = this.build(skin, { faceCamera: true });
        rig.root.scale.setScalar(1.5);
        rig.root.position.set(0, 0, 0);
        applyPose(rig, { state: 'idle', t: 0.25 });
        scene.add(rig.root);
        renderer.render(scene, cam);
        const cv = document.createElement('canvas');
        cv.width = S; cv.height = S;
        cv.getContext('2d').drawImage(renderer.domElement, 0, 0);
        this.thumbs[skin] = cv;
      } catch (e) {
        /* 单只失败跳过 */
      } finally {
        if (rig) scene.remove(rig.root);
      }
    }

    renderer.dispose();
    try { renderer.forceContextLoss(); } catch (e) {}
    return true;
  },
};
