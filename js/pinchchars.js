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
      rig.legL.rotation.x = swingA * 0.95;
      rig.legR.rotation.x = swingB * 0.95;
      rig.armL.rotation.x = swingB * 0.85;
      rig.armR.rotation.x = swingA * 0.85;
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
}

/* =========================================================
   追兵（game.js 用 'bull' / 'dog' 两个 skin 调 drawChar）
   ========================================================= */
const CHASER_DEF = {
  bull: {
    id: 'bull', skin: 'bull', name: '打包机', body: '#8d5b3f', belly: '#d8a077',
    shape: 'box', mat: 'wood', acc: 'none',
  },
  dog: {
    id: 'dog', skin: 'dog', name: '小滚轮', body: '#b0b7c0', belly: '#e2e7ee',
    shape: 'ball', mat: 'metal', acc: 'none',
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
