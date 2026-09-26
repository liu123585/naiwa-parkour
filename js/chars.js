/* =========================================================
   奶蛙跑酷 · 角色「建模」与动画
   所有角色均为代码矢量绘制（无外部素材）。
   坐标空间：归一化骨架空间 —— 脚底 y=0，头顶 y≈1，y 轴向上。
   ========================================================= */
'use strict';

const CharArt = {
  /* ---------- 基础图形工具 ---------- */
  ell(c, x, y, rx, ry) { c.beginPath(); c.ellipse(x, y, Math.abs(rx), Math.abs(ry), 0, 0, Math.PI * 2); c.fill(); },
  circ(c, x, y, r) { c.beginPath(); c.arc(x, y, Math.abs(r), 0, Math.PI * 2); c.fill(); },
  rr(c, x, y, w, h, r) {
    r = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
    c.beginPath();
    c.moveTo(x + r, y);
    c.lineTo(x + w - r, y);
    c.quadraticCurveTo(x + w, y, x + w, y - r);
    c.lineTo(x + w, y - h + r);
    c.quadraticCurveTo(x + w, y - h, x + w - r, y - h);
    c.lineTo(x + r, y - h);
    c.quadraticCurveTo(x, y - h, x, y - h + r);
    c.lineTo(x, y - r);
    c.quadraticCurveTo(x, y, x + r, y);
    c.closePath(); c.fill();
  },
  /* 两点之间的胶囊（用于四肢） */
  capsule(c, x0, y0, x1, y1, w, color) {
    c.fillStyle = color;
    const dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy) || 0.001;
    const a = Math.atan2(dy, dx);
    c.save(); c.translate(x0, y0); c.rotate(a);
    this.rr(c, 0, w / 2, len, w, w / 2);
    c.restore();
    this.circ(c, x0, y0, w / 2);
    this.circ(c, x1, y1, w / 2);
  },
  shade(c, x, y, r, col, a) {
    const g = c.createRadialGradient(x, y, r * 0.1, x, y, r);
    g.addColorStop(0, col); g.addColorStop(1, 'rgba(0,0,0,0)');
    c.globalAlpha = a == null ? 0.5 : a; c.fillStyle = g;
    c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill(); c.globalAlpha = 1;
  },

  /* ---------- 姿势计算 ---------- */
  makeRig(pose) {
    const st = pose.state || 'run';
    const ph = (pose.t || 0) * Math.PI * 2;
    const s1 = Math.sin(ph), s2 = Math.sin(ph + Math.PI);
    const rig = {
      lean: pose.lean || 0, squash: pose.squash || 0, phase: ph,
      hipY: 0.45, shoulderY: 0.72, headY: 0.875, headR: 0.135,
      bodyW: 0.30, legLift: [0, 0], armSwing: [0, 0], rot: 0, bob: 0, tuck: 0,
    };
    if (st === 'jump' || st === 'fall') {
      const up = st === 'jump';
      rig.legLift = [up ? 0.20 : 0.05, up ? 0.10 : 0.16];
      rig.armSwing = [up ? -0.9 : -0.3, up ? -0.7 : -0.4];
      rig.bob = 0.02;
    } else if (st === 'roll') {
      rig.tuck = 1; rig.rot = (pose.t || 0) * Math.PI * 2; rig.bob = 0;
    } else if (st === 'fly') {
      rig.legLift = [0.16, 0.08]; rig.armSwing = [-1.05, -0.95]; rig.bob = 0.01 + s1 * 0.008;
    } else if (st === 'crash') {
      rig.rot = -0.7; rig.legLift = [0.3, 0.1]; rig.armSwing = [-1.2, -1.1];
    } else if (st === 'idle') {
      rig.legLift = [0, 0]; rig.armSwing = [0.05, -0.05];
      rig.bob = 0.012 + Math.sin(ph) * 0.012;
    } else { // run
      rig.legLift = [Math.max(0, s1) * 0.22, Math.max(0, s2) * 0.22];
      rig.armSwing = [-s1 * 0.75, -s2 * 0.75];
      rig.bob = 0.014 + Math.abs(Math.cos(ph)) * 0.022;
    }
    rig.bob -= rig.squash * 0.06;
    return rig;
  },

  /* ---------- 人形骨架（背视/正视通用） ---------- */
  drawBody(c, rig, st, face, parts) {
    const P = parts;
    const lean = rig.lean;
    c.save();
    if (rig.tuck) {
      c.translate(0, 0.42);
      c.rotate(rig.rot);
      c.scale(0.92, 0.92);
      c.translate(0, -0.42);
    } else if (rig.rot) {
      c.translate(0, 0.30); c.rotate(rig.rot); c.translate(0, -0.30);
    }
    c.translate(lean * 0.05, rig.bob);

    const hipY = rig.hipY, shY = rig.shoulderY, hR = rig.headR, hY = rig.headY;
    const w = rig.bodyW;

    /* ---- 腿 ---- */
    for (let i = 0; i < 2; i++) {
      const sgn = i === 0 ? -1 : 1;
      const lift = rig.legLift[i];
      const hx = sgn * w * 0.24;
      const footX = hx + sgn * 0.022 + lift * sgn * 0.03;
      const footY = lift * 0.30;
      const kneeX = hx + (footX - hx) * 0.45;
      const kneeY = (hipY + footY) * 0.5 + 0.045 + lift * 0.05;
      c.fillStyle = P.pants;
      this.capsule(c, hx, hipY, kneeX, kneeY, 0.088, P.pants);
      this.capsule(c, kneeX, kneeY, footX, footY + 0.032, 0.072, P.pants2 || P.pants);
      // 鞋
      c.fillStyle = P.shoe;
      this.rr(c, footX - 0.052, footY + 0.05, 0.104, 0.05, 0.024);
      this.circ(c, footX, footY + 0.045, 0.05);
      if (P.shoeSole) { c.fillStyle = P.shoeSole; this.rr(c, footX - 0.055, footY + 0.018, 0.11, 0.016, 0.008); }
    }

    /* ---- 后侧手臂（先画，被身体遮一点） ---- */
    const armLen = P.armLen || 0.30;
    const drawArm = (sgn, swing) => {
      const sx = sgn * (w * 0.5 + 0.012);
      const handX = sx + sgn * 0.035 + swing * 0.028;
      const handY = shY - armLen + Math.abs(swing) * 0.055 - Math.max(0, -swing) * 0.05;
      const elbX = sx + sgn * 0.03 + swing * 0.016;
      const elbY = (shY + handY) / 2 + 0.012;
      this.capsule(c, sx, shY - 0.02, elbX, elbY, 0.072, P.sleeve);
      this.capsule(c, elbX, elbY, handX, handY, 0.062, P.skin);
      this.circ(c, handX, handY, 0.045);
      return { x: handX, y: handY };
    };
    c.fillStyle = P.sleeve;
    const hand0 = drawArm(-1, rig.armSwing[0]);

    /* ---- 躯干 ---- */
    const bodyGrad = c.createLinearGradient(-w / 2, 0, w / 2, 0);
    bodyGrad.addColorStop(0, P.clothDark);
    bodyGrad.addColorStop(0.35, P.cloth);
    bodyGrad.addColorStop(0.75, P.cloth);
    bodyGrad.addColorStop(1, P.clothDark);
    c.fillStyle = bodyGrad;
    c.beginPath();
    c.moveTo(-w * 0.52, shY + 0.02);
    c.quadraticCurveTo(-w * 0.62, (shY + hipY) / 2, -w * 0.46, hipY - 0.035);
    c.lineTo(w * 0.46, hipY - 0.035);
    c.quadraticCurveTo(w * 0.62, (shY + hipY) / 2, w * 0.52, shY + 0.02);
    c.quadraticCurveTo(0, shY + 0.075, -w * 0.52, shY + 0.02);
    c.closePath(); c.fill();

    // 腰带 / 下摆
    if (P.belt) { c.fillStyle = P.belt; this.rr(c, -w * 0.48, hipY + 0.055, w * 0.96, 0.045, 0.012); }
    if (P.clothPattern) P.clothPattern(c, w, hipY, shY);
    if (P.backDecal && !face) P.backDecal(c, w, hipY, shY);

    // 肩膀圆润
    c.fillStyle = P.cloth;
    this.circ(c, -w * 0.47, shY, 0.055);
    this.circ(c, w * 0.47, shY, 0.055);

    /* ---- 头 ---- */
    const headX = lean * 0.02;
    c.fillStyle = P.skin;
    if (P.headShape) P.headShape(c, headX, hY, hR);
    else { this.circ(c, headX, hY + 0.005, hR); this.rr(c, headX - hR * 0.92, hY, hR * 1.84, hR * 1.05, hR * 0.6); }
    // 颈部
    c.fillStyle = P.skin;
    this.capsule(c, headX, hY - hR * 0.92, headX, shY + 0.02, 0.075, P.skin);

    if (face) this.drawFace(c, headX, hY, hR, P);
    else this.drawBackHead(c, headX, hY, hR, P);

    /* ---- 头饰 / 头发 ---- */
    if (P.hair) P.hair(c, headX, hY, hR, face);

    /* ---- 前侧手臂 ---- */
    const hand1 = drawArm(1, rig.armSwing[1]);
    c.fillStyle = P.sleeve;

    /* ---- 道具（手部） ---- */
    if (P.handProp) P.handProp(c, hand1, 1, rig);
    if (P.handProp2) P.handProp2(c, hand0, -1, rig);
    if (P.bodyProp) P.bodyProp(c, w, hipY, shY, rig);

    c.restore();
  },

  drawFace(c, x, y, r, P) {
    const eyeY = y + r * 0.06, ex = r * 0.40;
    c.fillStyle = '#fff';
    this.ell(c, x - ex, eyeY, r * 0.26, r * 0.28);
    this.ell(c, x + ex, eyeY, r * 0.26, r * 0.28);
    c.fillStyle = '#20232a';
    this.circ(c, x - ex + r * 0.03, eyeY, r * 0.125);
    this.circ(c, x + ex + r * 0.03, eyeY, r * 0.125);
    c.fillStyle = 'rgba(255,255,255,.9)';
    this.circ(c, x - ex + r * 0.07, eyeY + r * 0.06, r * 0.045);
    this.circ(c, x + ex + r * 0.07, eyeY + r * 0.06, r * 0.045);
    // 腮红
    if (P.blush !== false) {
      c.globalAlpha = 0.35; c.fillStyle = '#ff7b7b';
      this.ell(c, x - r * 0.62, y - r * 0.22, r * 0.18, r * 0.11);
      this.ell(c, x + r * 0.62, y - r * 0.22, r * 0.18, r * 0.11);
      c.globalAlpha = 1;
    }
    // 嘴
    c.strokeStyle = '#20232a'; c.lineWidth = r * 0.11; c.lineCap = 'round';
    c.beginPath();
    if (P.bigMouth) { c.arc(x, y - r * 0.05, r * 0.46, Math.PI * 1.06, Math.PI * 1.94); }
    else { c.arc(x, y - r * 0.16, r * 0.32, Math.PI * 0.18, Math.PI * 0.82); }
    c.stroke();
    if (P.faceExtras) P.faceExtras(c, x, y, r);
  },

  drawBackHead(c, x, y, r, P) {
    // 后脑：简单的高光 + 耳朵
    if (P.ears !== false) {
      c.fillStyle = P.skin;
      this.circ(c, x - r * 0.95, y - r * 0.05, r * 0.2);
      this.circ(c, x + r * 0.95, y - r * 0.05, r * 0.2);
    }
    c.globalAlpha = 0.18; c.fillStyle = '#fff';
    this.ell(c, x - r * 0.3, y + r * 0.35, r * 0.42, r * 0.3);
    c.globalAlpha = 1;
  },

  /* ---------- 人形角色工厂 ---------- */
  human(parts, scale) {
    scale = scale || {};
    return function (c, pose) {
      const rig = CharArt.makeRig(pose);
      if (scale.w) rig.bodyW = scale.w;
      if (scale.headR) rig.headR = scale.headR;
      if (scale.hipY) rig.hipY = scale.hipY;
      if (scale.shoulderY) rig.shoulderY = scale.shoulderY;
      if (scale.headY) rig.headY = scale.headY;
      const armLen = scale.armLen || parts.armLen || 0.30;
      parts.armLen = armLen;
      CharArt.drawBody(c, rig, pose.state, !!pose.front, parts);
    };
  },
};

/* =========================================================
   具体角色美术定义
   ========================================================= */
const CHARDRAW = {};

/* ---- 1. 奶蛙：黄桃罐头色巨头 + 黝黑四肢 + 魔性大嘴 ---- */
CHARDRAW.naiwa = function (c, pose) {
  const rig = CharArt.makeRig(pose);
  const face = !!pose.front;
  const body = '#f8c73c', bodyD = '#dda112', limb = '#3a3330', limbD = '#241f1d';
  const headR = rig.headR * 1.42;                 // 巨头
  const headY = rig.headY + 0.02;
  c.save();
  if (rig.tuck) { c.translate(0, 0.46); c.rotate(rig.rot); c.translate(0, -0.46); }
  c.translate(rig.lean * 0.05, rig.bob - rig.squash * 0.05);
  const hipY = rig.hipY - 0.07, shY = rig.shoulderY + 0.01;

  // 腿（黑，短粗）
  for (let i = 0; i < 2; i++) {
    const sgn = i === 0 ? -1 : 1, lift = rig.legLift[i];
    const hx = sgn * 0.085, footX = hx + sgn * 0.035, footY = lift * 0.26;
    const kneeX = hx + (footX - hx) * 0.5, kneeY = (hipY + footY) * 0.5 + lift * 0.03;
    CharArt.capsule(c, hx, hipY, kneeX, kneeY, 0.095, limb);
    CharArt.capsule(c, kneeX, kneeY, footX, footY + 0.03, 0.078, limbD);
    c.fillStyle = '#f4e3a0';
    CharArt.ell(c, footX + 0.012, footY + 0.03, 0.072, 0.044);
  }
  // 手臂（黑，向两侧张开，别被圆身子挡住）
  const drawArm = (sgn, swing) => {
    const sx = sgn * 0.135, elbX = sx + sgn * 0.095, elbY = shY - 0.14 + swing * 0.02;
    const handX = elbX + sgn * 0.06 + swing * 0.025;
    const handY = shY - 0.28 + Math.abs(swing) * 0.055;
    CharArt.capsule(c, sx, shY - 0.01, elbX, elbY, 0.075, limb);
    CharArt.capsule(c, elbX, elbY, handX, handY, 0.062, limbD);
    CharArt.circ(c, handX, handY, 0.052);
    return { x: handX, y: handY };
  };
  drawArm(-1, rig.armSwing[0]);
  // 身体（黄桃色）
  const bg = c.createLinearGradient(-0.16, 0, 0.16, 0);
  bg.addColorStop(0, bodyD); bg.addColorStop(0.32, body); bg.addColorStop(0.8, body); bg.addColorStop(1, bodyD);
  c.fillStyle = bg;
  c.beginPath();
  c.moveTo(-0.145, shY + 0.07);
  c.quadraticCurveTo(-0.335, (shY + hipY) / 2, -0.175, hipY - 0.06);
  c.lineTo(0.175, hipY - 0.06);
  c.quadraticCurveTo(0.335, (shY + hipY) / 2, 0.145, shY + 0.07);
  c.quadraticCurveTo(0, shY + 0.175, -0.145, shY + 0.07);
  c.closePath(); c.fill();
  // 肚子浅色
  c.fillStyle = 'rgba(255,246,200,.55)';
  CharArt.ell(c, 0, hipY + 0.075, 0.125, 0.095);
  // 头
  c.fillStyle = body;
  CharArt.circ(c, rig.lean * 0.02, headY - 0.02, headR);
  c.fillStyle = bodyD;
  CharArt.ell(c, rig.lean * 0.02, headY - 0.02 - headR * 0.72, headR * 0.86, headR * 0.34);
  // 头顶两只鼓眼
  const ex = headR * 0.52, eyeY = headY + headR * 0.62;
  for (const sgn of [-1, 1]) {
    c.fillStyle = body;
    CharArt.circ(c, rig.lean * 0.02 + sgn * ex, eyeY, headR * 0.40);
    c.fillStyle = '#fff';
    CharArt.circ(c, rig.lean * 0.02 + sgn * ex, eyeY + (face ? 0.004 : 0.01), headR * 0.30);
    c.fillStyle = '#20232a';
    CharArt.circ(c, rig.lean * 0.02 + sgn * ex - (face ? sgn * headR * 0.06 : 0), eyeY, headR * 0.155);
    c.fillStyle = 'rgba(255,255,255,.92)';
    CharArt.circ(c, rig.lean * 0.02 + sgn * ex + headR * 0.07, eyeY + headR * 0.09, headR * 0.055);
  }
  if (face) {
    // 巨大魔性笑脸
    c.fillStyle = '#5a2b1c';
    c.beginPath();
    c.moveTo(-headR * 0.66, headY - headR * 0.34);
    c.quadraticCurveTo(0, headY - headR * 1.02, headR * 0.66, headY - headR * 0.34);
    c.quadraticCurveTo(0, headY + headR * 0.22, -headR * 0.66, headY - headR * 0.34);
    c.closePath(); c.fill();
    c.fillStyle = '#ff8b8b';
    CharArt.ell(c, 0, headY - headR * 0.42, headR * 0.42, headR * 0.19);
    // 牙齿
    c.fillStyle = '#fffdf3';
    CharArt.rr(c, -headR * 0.44, headY - headR * 0.30, headR * 0.88, headR * 0.10, headR * 0.03);
    // 腮红
    c.globalAlpha = 0.4; c.fillStyle = '#ff9a6b';
    CharArt.ell(c, -headR * 0.72, headY - headR * 0.12, headR * 0.2, headR * 0.13);
    CharArt.ell(c, headR * 0.72, headY - headR * 0.12, headR * 0.2, headR * 0.13);
    c.globalAlpha = 1;
  } else {
    // 背视：只露出大笑的嘴角
    c.strokeStyle = '#5a2b1c'; c.lineWidth = headR * 0.11; c.lineCap = 'round';
    c.beginPath();
    c.moveTo(-headR * 0.72, headY - headR * 0.36);
    c.quadraticCurveTo(-headR * 0.86, headY - headR * 0.18, -headR * 0.78, headY - headR * 0.02);
    c.moveTo(headR * 0.72, headY - headR * 0.36);
    c.quadraticCurveTo(headR * 0.86, headY - headR * 0.18, headR * 0.78, headY - headR * 0.02);
    c.stroke();
  }
  c.restore();
};

/* ---- 2. 奶龙：圆滚黄色小萌龙 ---- */
CHARDRAW.nailong = function (c, pose) {
  const rig = CharArt.makeRig(pose), face = !!pose.front;
  const body = '#ffd94a', bodyD = '#e0ad1d', belly = '#fff3c4', limb = '#f2c533';
  c.save();
  if (rig.tuck) { c.translate(0, 0.46); c.rotate(rig.rot); c.translate(0, -0.46); }
  c.translate(rig.lean * 0.04, rig.bob - rig.squash * 0.05);
  const hipY = rig.hipY, shY = rig.shoulderY;
  // 尾巴
  c.fillStyle = bodyD;
  c.beginPath();
  c.moveTo(0, hipY + 0.02);
  c.quadraticCurveTo(rig.lean * 0.1 + 0.1, hipY - 0.18, 0.06 + rig.phase % 1 * 0.02, hipY - 0.05);
  c.quadraticCurveTo(0.02, hipY + 0.02, 0, hipY + 0.02); c.fill();
  // 腿
  for (let i = 0; i < 2; i++) {
    const sgn = i === 0 ? -1 : 1, lift = rig.legLift[i];
    const hx = sgn * 0.07, footX = hx + sgn * 0.025, footY = lift * 0.26;
    CharArt.capsule(c, hx, hipY, footX, footY + 0.03, 0.085, limb);
    c.fillStyle = bodyD; CharArt.ell(c, footX + 0.012, footY + 0.03, 0.062, 0.04);
  }
  const drawArm = (sgn, swing) => {
    const sx = sgn * 0.165, handX = sx + sgn * 0.055, handY = shY - 0.22 + Math.abs(swing) * 0.05;
    CharArt.capsule(c, sx, shY - 0.01, handX, handY, 0.07, limb);
    CharArt.circ(c, handX, handY, 0.05);
    return { x: handX, y: handY };
  };
  drawArm(-1, rig.armSwing[0]);
  // 身体
  const bg = c.createLinearGradient(-0.18, 0, 0.18, 0);
  bg.addColorStop(0, bodyD); bg.addColorStop(0.3, body); bg.addColorStop(1, bodyD);
  c.fillStyle = bg;
  CharArt.ell(c, 0, (shY + hipY) / 2 + 0.02, 0.20, 0.20);
  c.fillStyle = belly;
  CharArt.ell(c, 0, (shY + hipY) / 2 - 0.02, 0.135, 0.14);
  // 背鳍
  c.fillStyle = '#ff9f43';
  c.beginPath();
  c.moveTo(-0.02, shY + 0.16); c.lineTo(0.04, shY + 0.02); c.lineTo(-0.09, shY + 0.03);
  c.closePath(); c.fill();
  drawArm(1, rig.armSwing[1]);
  // 头
  const hR = rig.headR * 1.2, hY = rig.headY + 0.01;
  c.fillStyle = body;
  CharArt.circ(c, rig.lean * 0.02, hY, hR);
  c.fillStyle = bodyD;
  CharArt.ell(c, rig.lean * 0.02, hY + hR * 0.72, hR * 0.72, hR * 0.3);
  // 小角
  c.fillStyle = '#ff9f43';
  CharArt.circ(c, -hR * 0.6, hY + hR * 0.72, hR * 0.2);
  CharArt.circ(c, hR * 0.6, hY + hR * 0.72, hR * 0.2);
  if (face) {
    CharArt.drawFace(c, rig.lean * 0.02, hY, hR, { bigMouth: false });
  } else {
    c.globalAlpha = 0.2; c.fillStyle = '#fff';
    CharArt.ell(c, rig.lean * 0.02 - hR * 0.25, hY + hR * 0.35, hR * 0.4, hR * 0.28); c.globalAlpha = 1;
  }
  c.restore();
};

/* ---- 人形角色样式表 ---- */
const HUMANS = {
  /* 东北雨姐：魁梧、花棉袄、头巾，扛大铁勺 */
  yujie: {
    scale: { w: 0.40, headR: 0.118, armLen: 0.32 },
    parts: {
      cloth: '#e6423c', clothDark: '#b52b26', sleeve: '#e6423c',
      pants: '#3d3a52', pants2: '#33304a', shoe: '#2b2b30', skin: '#f7cdae', belt: '#f0c14b',
      blush: true,
      clothPattern(c, w, hipY, shY) {
        c.fillStyle = '#ffe9a8';
        const pts = [[-w * .3, shY - .06], [w * .18, shY - .1], [-w * .05, hipY + .12], [w * .32, hipY + .06], [-w * .34, hipY + .04], [w * .05, shY - .02]];
        pts.forEach((p, i) => { c.globalAlpha = .95; CharArt.circ(c, p[0], p[1], 0.017); CharArt.circ(c, p[0] - 0.014, p[1] - 0.012, 0.009); c.globalAlpha = 1; });
      },
      hair(c, x, y, r, face) {
        c.fillStyle = '#3a2a24';
        CharArt.ell(c, x, y + r * 0.62, r * 0.95, r * 0.5);
        CharArt.circ(c, x, y + r * 1.02, r * 0.3);
        c.fillStyle = '#f5f0e2';   // 头巾
        CharArt.rr(c, x - r * 1.06, y + r * 0.52, r * 2.12, r * 0.34, r * 0.16);
      },
      handProp(c, hand, sgn) {
        // 大铁勺
        c.save(); c.translate(hand.x, hand.y); c.rotate(sgn * -0.35);
        c.fillStyle = '#9aa0a6'; CharArt.rr(c, -0.012, 0.16, 0.024, 0.34, 0.012);
        c.fillStyle = '#7d848b';
        c.beginPath(); c.arc(0, 0.5, 0.062, 0, Math.PI * 2); c.fill();
        c.restore();
      },
    },
  },

  /* 疯狂小杨哥：黑色短发、卫衣、手持麦 */
  xiaoyang: {
    parts: {
      cloth: '#f2f4f7', clothDark: '#cfd4dc', sleeve: '#f2f4f7',
      pants: '#2f333b', pants2: '#262b33', shoe: '#f5f5f5', skin: '#f6c9a4', belt: '#ffd34d',
      hair(c, x, y, r, face) {
        c.fillStyle = '#1d1f24';
        if (face) { CharArt.rr(c, x - r * 1.02, y + r * 0.42, r * 2.04, r * 0.5, r * 0.24); CharArt.circ(c, x, y + r * 0.95, r * 0.62); }
        else { CharArt.circ(c, x, y + r * 0.06, r * 1.02); CharArt.rr(c, x - r * 1.0, y + r * 0.1, r * 2.0, r * 0.62, r * 0.28); }
      },
      handProp(c, hand, sgn) {
        c.fillStyle = '#2b2f36';
        c.save(); c.translate(hand.x, hand.y); c.rotate(sgn * -0.5);
        CharArt.rr(c, -0.022, 0.13, 0.044, 0.16, 0.018);
        c.fillStyle = '#8d949c'; CharArt.circ(c, 0, 0.16, 0.038);
        c.restore();
      },
      handProp2(c, hand) {
        c.fillStyle = '#20232a'; CharArt.rr(c, hand.x - 0.035, hand.y - 0.05, 0.07, 0.11, 0.016);
        c.fillStyle = '#4bb8ff'; CharArt.rr(c, hand.x - 0.025, hand.y - 0.04, 0.05, 0.075, 0.01);
      },
    },
  },

  /* 张同学：棉帽、军绿外套、三脚架 */
  zhangtongxue: {
    parts: {
      cloth: '#5c6b45', clothDark: '#465334', sleeve: '#5c6b45',
      pants: '#2f3a44', pants2: '#28313a', shoe: '#3b2f26', skin: '#e8b98e', belt: '#2f2a24',
      hair(c, x, y, r, face) {
        c.fillStyle = '#2a2d33';
        CharArt.circ(c, x, y + r * 0.35, r * 1.06);
        c.fillStyle = '#3b4048';
        CharArt.rr(c, x - r * 1.14, y + r * 0.72, r * 2.28, r * 0.36, r * 0.16);
        c.fillStyle = '#2b2f36';
        CharArt.rr(c, x - r * 0.9, y + r * 1.0, r * 1.8, r * 0.46, r * 0.2);
      },
      hairSide: true,
      handProp(c, hand) {
        c.fillStyle = '#2b2f36';
        CharArt.rr(c, hand.x - 0.014, hand.y, 0.028, 0.3, 0.012);
        c.strokeStyle = '#2b2f36'; c.lineWidth = 0.018;
        c.beginPath(); c.moveTo(hand.x - 0.05, hand.y + 0.3); c.lineTo(hand.x, hand.y + 0.3); c.lineTo(hand.x + 0.05, hand.y + 0.3); c.stroke();
      },
      bodyProp(c, w, hipY, shY) {
        // 斜挎包
        c.fillStyle = '#3a2f24';
        c.beginPath(); c.moveTo(-w * 0.45, shY); c.lineTo(w * 0.4, hipY + 0.05); c.lineWidth = 0.03; c.strokeStyle = '#3a2f24'; c.stroke();
        CharArt.rr(c, w * 0.18, hipY + 0.14, 0.13, 0.11, 0.025);
      },
    },
  },

  /* 李子柒：汉服、发髻、竹篮 */
  liziqi: {
    parts: {
      cloth: '#f6f2e7', clothDark: '#ddd6c4', sleeve: '#f6f2e7',
      pants: '#e9e2d2', pants2: '#dcd3c0', shoe: '#6a5540', skin: '#f8d3b6', belt: '#b2432f',
      clothPattern(c, w, hipY, shY) {   // 汉服交领
        c.strokeStyle = '#c8bda4'; c.lineWidth = 0.014;
        c.beginPath(); c.moveTo(-w * 0.3, shY + 0.02); c.lineTo(0, hipY + 0.1); c.lineTo(w * 0.3, shY + 0.02); c.stroke();
      },
      hair(c, x, y, r, face) {
        c.fillStyle = '#241d1a';
        if (face) { CharArt.rr(c, x - r * 1.06, y + r * 0.34, r * 2.12, r * 0.62, r * 0.28); CharArt.circ(c, x, y + r * 1.16, r * 0.42); }
        else { CharArt.circ(c, x, y + r * 0.1, r * 1.08); CharArt.rr(c, x - r * 1.0, y - r * 0.4, r * 2.0, r * 0.9, r * 0.3); }
        c.fillStyle = '#b2432f'; CharArt.circ(c, x, y + r * 1.5, r * 0.1);
      },
      handProp(c, hand) {   // 竹篮
        c.fillStyle = '#c99a54';
        CharArt.rr(c, hand.x - 0.075, hand.y - 0.02, 0.15, 0.115, 0.03);
        c.strokeStyle = '#a97f3c'; c.lineWidth = 0.012;
        c.beginPath(); c.arc(hand.x, hand.y + 0.1, 0.062, Math.PI, 0); c.stroke();
        c.fillStyle = '#7cd44a';
        CharArt.circ(c, hand.x - 0.03, hand.y + 0.11, 0.024); CharArt.circ(c, hand.x + 0.03, hand.y + 0.11, 0.024);
      },
    },
  },

  /* 刘教练：健身背心、肌肉、哑铃 */
  liugenhong: {
    parts: {
      cloth: '#2bb3d6', clothDark: '#1c8aa8', sleeve: '#f2c9a0',
      pants: '#37404c', pants2: '#2e3540', shoe: '#eef2f6', skin: '#efa86f', belt: '#20232a',
      armLen: 0.30,
      clothPattern(c, w, hipY, shY) {
        c.fillStyle = 'rgba(255,255,255,.5)';
        CharArt.rr(c, -w * 0.4, shY - 0.02, w * 0.8, 0.026, 0.012);
        c.fillStyle = 'rgba(0,0,0,.12)';
        CharArt.rr(c, -w * 0.4, hipY + 0.16, w * 0.8, 0.02, 0.01);
      },
      hair(c, x, y, r, face) {
        c.fillStyle = '#1e1c1a';
        if (face) { CharArt.rr(c, x - r * 1.0, y + r * 0.5, r * 2.0, r * 0.42, r * 0.2); }
        else { CharArt.circ(c, x, y + r * 0.12, r * 0.98); }
      },
      handProp(c, hand) {
        c.fillStyle = '#3b4048';
        CharArt.rr(c, hand.x - 0.075, hand.y + 0.008, 0.15, 0.03, 0.015);
        c.fillStyle = '#22262c';
        CharArt.circ(c, hand.x - 0.078, hand.y + 0.023, 0.032); CharArt.circ(c, hand.x + 0.078, hand.y + 0.023, 0.032);
      },
    },
  },

  /* 董老师：衬衫马甲、书 */
  donglaoshi: {
    parts: {
      cloth: '#f8f8f6', clothDark: '#dfe2e6', sleeve: '#f8f8f6',
      pants: '#2f3339', pants2: '#282c31', shoe: '#3a3a3f', skin: '#f4c9a3', belt: '#5a4632',
      clothPattern(c, w, hipY, shY) {   // 马甲
        c.fillStyle = '#2c303a';
        c.beginPath();
        c.moveTo(-w * 0.5, shY + 0.03); c.lineTo(-w * 0.16, shY + 0.03); c.lineTo(-w * 0.1, hipY - 0.03);
        c.lineTo(-w * 0.52, hipY - 0.03); c.closePath(); c.fill();
        c.beginPath();
        c.moveTo(w * 0.5, shY + 0.03); c.lineTo(w * 0.16, shY + 0.03); c.lineTo(w * 0.1, hipY - 0.03);
        c.lineTo(w * 0.52, hipY - 0.03); c.closePath(); c.fill();
      },
      hair(c, x, y, r, face) {
        c.fillStyle = '#22201f';
        if (face) { CharArt.rr(c, x - r * 1.0, y + r * 0.46, r * 2.0, r * 0.5, r * 0.22); }
        else { CharArt.circ(c, x, y + r * 0.1, r * 1.0); }
      },
      faceExtras(c, x, y, r) {
        c.strokeStyle = '#2b2f36'; c.lineWidth = r * 0.07;
        c.beginPath();
        c.arc(x - r * 0.4, y + r * 0.06, r * 0.3, Math.PI * 0.05, Math.PI * 0.95);
        c.arc(x + r * 0.4, y + r * 0.06, r * 0.3, Math.PI * 0.05, Math.PI * 0.95);
        c.stroke();
      },
      handProp(c, hand) {
        c.fillStyle = '#8d5a3b';
        CharArt.rr(c, hand.x - 0.07, hand.y - 0.03, 0.14, 0.09, 0.012);
        c.fillStyle = '#fffdf6';
        CharArt.rr(c, hand.x - 0.062, hand.y - 0.024, 0.124, 0.078, 0.008);
      },
    },
  },
};

/* 生成人形角色绘制函数 */
['yujie', 'xiaoyang', 'zhangtongxue', 'liziqi', 'liugenhong', 'donglaoshi'].forEach(k => {
  const def = HUMANS[k];
  CHARDRAW[k] = CharArt.human(def.parts, def.scale || {});
});

/* ---- 9. 雨姐的鹅：白色大鹅 ---- */
CHARDRAW.goose = function (c, pose) {
  const rig = CharArt.makeRig(pose), face = !!pose.front;
  c.save();
  if (rig.tuck) { c.translate(0, 0.42); c.rotate(rig.rot); c.translate(0, -0.42); }
  c.translate(rig.lean * 0.04, rig.bob - rig.squash * 0.05);
  const body = '#fdfdf7', bodyD = '#d8dbe0', beak = '#ff9d1e';
  const hipY = 0.34;
  // 腿（橙）
  for (let i = 0; i < 2; i++) {
    const sgn = i === 0 ? -1 : 1, lift = rig.legLift[i];
    c.fillStyle = beak;
    CharArt.capsule(c, sgn * 0.06, hipY, sgn * 0.075, lift * 0.24 + 0.03, 0.032, beak);
    c.fillStyle = '#e07f0c';
    CharArt.rr(c, sgn * 0.075 - 0.055, lift * 0.24 + 0.03, 0.11, 0.022, 0.01);
  }
  // 身体
  const bg = c.createLinearGradient(-0.2, 0, 0.2, 0);
  bg.addColorStop(0, bodyD); bg.addColorStop(0.35, body); bg.addColorStop(1, bodyD);
  c.fillStyle = bg;
  CharArt.ell(c, 0, hipY + 0.12, 0.22, 0.19);
  // 翅膀（扑棱）
  const flap = Math.sin(rig.phase) * 0.10;
  for (const sgn of [-1, 1]) {
    c.save(); c.translate(sgn * 0.19, hipY + 0.16); c.rotate(sgn * (0.5 + flap));
    c.fillStyle = body;
    c.beginPath(); c.moveTo(0, 0); c.quadraticCurveTo(sgn * 0.12, -0.08, sgn * 0.06, -0.2);
    c.quadraticCurveTo(sgn * 0.02, -0.12, 0, 0); c.fill();
    c.fillStyle = bodyD;
    c.beginPath(); c.moveTo(0, -0.01); c.quadraticCurveTo(sgn * 0.1, -0.08, sgn * 0.05, -0.18);
    c.quadraticCurveTo(sgn * 0.015, -0.1, 0, -0.01); c.fill();
    c.restore();
  }
  // 长脖子
  const neckLean = rig.lean * 0.06;
  CharArt.capsule(c, 0, hipY + 0.26, neckLean, 0.80, 0.075, body);
  // 头
  const hR = 0.12;
  c.fillStyle = body;
  CharArt.circ(c, neckLean, 0.88, hR);
  // 嘴
  c.fillStyle = beak;
  c.beginPath();
  if (face) { c.moveTo(neckLean - 0.06, 0.86); c.lineTo(neckLean - 0.2, 0.84); c.lineTo(neckLean - 0.06, 0.80); }
  else { c.moveTo(neckLean + 0.06, 0.86); c.lineTo(neckLean + 0.2, 0.84); c.lineTo(neckLean + 0.06, 0.80); }
  c.closePath(); c.fill();
  // 眼
  c.fillStyle = '#20232a';
  CharArt.circ(c, neckLean + (face ? -0.045 : 0.03), 0.915, 0.022);
  if (face) CharArt.circ(c, neckLean - 0.075, 0.905, 0.022);
  // 愤怒的小红点（鹅脾气）
  c.fillStyle = '#e6423c';
  CharArt.circ(c, neckLean + (face ? -0.05 : 0.035), 0.955, 0.016);
  c.restore();
};

/* ---- 10. 赛博奶蛙：机械霓虹奶蛙 ---- */
CHARDRAW.cybernaiwa = function (c, pose) {
  const rig = CharArt.makeRig(pose), face = !!pose.front;
  const body = '#4a4f5c', bodyD = '#2c303a', neon = '#22e6ff', neon2 = '#ff3ec8';
  const headR = rig.headR * 1.42, headY = rig.headY + 0.02;
  c.save();
  if (rig.tuck) { c.translate(0, 0.46); c.rotate(rig.rot); c.translate(0, -0.46); }
  c.translate(rig.lean * 0.05, rig.bob - rig.squash * 0.05);
  const hipY = rig.hipY - 0.02, shY = rig.shoulderY - 0.01;
  // 腿
  for (let i = 0; i < 2; i++) {
    const sgn = i === 0 ? -1 : 1, lift = rig.legLift[i];
    const hx = sgn * 0.075, footX = hx + sgn * 0.03, footY = lift * 0.26;
    const kneeX = hx + (footX - hx) * 0.5, kneeY = (hipY + footY) * 0.5 + lift * 0.03;
    CharArt.capsule(c, hx, hipY, kneeX, kneeY, 0.078, body);
    CharArt.capsule(c, kneeX, kneeY, footX, footY + 0.03, 0.062, bodyD);
    c.fillStyle = neon; CharArt.ell(c, footX + 0.01, footY + 0.028, 0.055, 0.03);
  }
  const drawArm = (sgn, swing) => {
    const sx = sgn * 0.155, handX = sx + sgn * 0.055 + swing * 0.02;
    const handY = shY - 0.26 + Math.abs(swing) * 0.05;
    CharArt.capsule(c, sx, shY - 0.01, handX, handY, 0.066, body);
    c.fillStyle = neon2; CharArt.circ(c, handX, handY, 0.042);
    return { x: handX, y: handY };
  };
  drawArm(-1, rig.armSwing[0]);
  c.fillStyle = body;
  CharArt.ell(c, 0, (shY + hipY) / 2, 0.19, 0.19);
  c.strokeStyle = neon; c.lineWidth = 0.018;
  c.beginPath(); c.moveTo(-0.1, hipY + 0.03); c.lineTo(0.1, hipY + 0.03); c.stroke();
  c.fillStyle = 'rgba(34,230,255,.35)';
  CharArt.ell(c, 0, (shY + hipY) / 2 - 0.02, 0.11, 0.1);
  // 头
  c.fillStyle = body;
  CharArt.circ(c, rig.lean * 0.02, headY - 0.02, headR);
  c.strokeStyle = neon2; c.lineWidth = 0.02;
  c.beginPath(); c.arc(rig.lean * 0.02, headY - 0.02, headR * 0.86, Math.PI * 1.1, Math.PI * 1.9); c.stroke();
  const ex = headR * 0.52, eyeY = headY + headR * 0.6;
  for (const sgn of [-1, 1]) {
    c.fillStyle = bodyD;
    CharArt.circ(c, rig.lean * 0.02 + sgn * ex, eyeY, headR * 0.4);
    c.fillStyle = neon;
    CharArt.circ(c, rig.lean * 0.02 + sgn * ex, eyeY, headR * 0.24);
    c.fillStyle = '#101318';
    CharArt.circ(c, rig.lean * 0.02 + sgn * ex, eyeY, headR * 0.1);
  }
  if (face) {
    c.fillStyle = '#14171d';
    c.beginPath();
    c.moveTo(-headR * 0.62, headY - headR * 0.36);
    c.quadraticCurveTo(0, headY - headR * 0.96, headR * 0.62, headY - headR * 0.36);
    c.quadraticCurveTo(0, headY + headR * 0.18, -headR * 0.62, headY - headR * 0.36);
    c.closePath(); c.fill();
    c.strokeStyle = neon; c.lineWidth = 0.014;
    c.beginPath(); c.moveTo(-headR * 0.5, headY - headR * 0.36); c.lineTo(headR * 0.5, headY - headR * 0.36); c.stroke();
  } else {
    c.strokeStyle = neon; c.lineWidth = 0.018;
    c.beginPath(); c.moveTo(-headR * 0.6, headY - headR * 0.3); c.lineTo(-headR * 0.85, headY - headR * 0.05);
    c.moveTo(headR * 0.6, headY - headR * 0.3); c.lineTo(headR * 0.85, headY - headR * 0.05); c.stroke();
  }
  c.restore();
};

/* ---- 11. 检票员（追逐者，不可选） ---- */
CHARDRAW.inspector = CharArt.human({
  cloth: '#2c3e6b', clothDark: '#1e2c50', sleeve: '#2c3e6b',
  pants: '#243258', pants2: '#1c2745', shoe: '#1a1a1f', skin: '#e8b98e', belt: '#111',
  clothPattern(c, w, hipY, shY) {
    c.fillStyle = '#e6c34a';
    CharArt.circ(c, -w * 0.22, shY - 0.06, 0.018);
    CharArt.circ(c, -w * 0.22, shY - 0.16, 0.018);
    c.fillStyle = '#d8b23a';
    CharArt.rr(c, -w * 0.3, hipY + 0.1, w * 0.6, 0.035, 0.014);
  },
  hair(c, x, y, r, face) {
    c.fillStyle = '#243258';
    CharArt.circ(c, x, y + r * 0.5, r * 1.1);
    c.fillStyle = '#1b2540';
    CharArt.rr(c, x - r * 1.2, y + r * 0.78, r * 2.4, r * 0.28, r * 0.14);
    CharArt.rr(c, x - r * 0.85, y + r * 0.95, r * 1.7, r * 0.42, r * 0.12);
    c.fillStyle = '#e6c34a';
    CharArt.circ(c, x, y + r * 1.02, r * 0.13);
  },
  faceExtras(c, x, y, r) {
    c.fillStyle = '#3a2a20';
    CharArt.rr(c, x - r * 0.5, y - r * 0.34, r * 1.0, r * 0.16, r * 0.07);
  },
  handProp(c, hand) {
    c.fillStyle = '#dcdcdc';
    CharArt.rr(c, hand.x - 0.05, hand.y - 0.02, 0.1, 0.13, 0.02);
    c.fillStyle = '#c0392b'; CharArt.rr(c, hand.x - 0.05, hand.y + 0.055, 0.1, 0.035, 0.01);
  },
}, { w: 0.33 });

/* ---- 12. 追逐的狗（不可选） ---- */
CHARDRAW.dog = function (c, pose) {
  const rig = CharArt.makeRig(pose);
  c.save();
  c.translate(rig.lean * 0.04, rig.bob * 1.6 - rig.squash * 0.05);
  const body = '#b8813f', bodyD = '#8f6129', belly = '#e8cfa8';
  const hipY = 0.30;
  // 四条腿
  for (let i = 0; i < 4; i++) {
    const sgn = i % 2 === 0 ? -1 : 1;
    const lift = rig.legLift[i % 2];
    const x = sgn * 0.12 + (i > 1 ? 0.03 : -0.03);
    CharArt.capsule(c, x, hipY, x + sgn * 0.02, lift * 0.2 + 0.02, 0.042, bodyD);
  }
  // 身体
  c.fillStyle = body;
  CharArt.ell(c, 0, hipY + 0.04, 0.24, 0.135);
  c.fillStyle = belly;
  CharArt.ell(c, 0, hipY - 0.05, 0.19, 0.07);
  // 尾巴
  c.strokeStyle = body; c.lineWidth = 0.05; c.lineCap = 'round';
  c.beginPath(); c.moveTo(-0.22, hipY + 0.1);
  c.quadraticCurveTo(-0.34, hipY + 0.2 + Math.sin(rig.phase * 2) * 0.05, -0.3, hipY + 0.32); c.stroke();
  // 头
  const hy = hipY + 0.22;
  c.fillStyle = body;
  CharArt.circ(c, 0.26, hy, 0.115);
  c.fillStyle = bodyD;
  CharArt.ell(c, 0.34, hy - 0.03, 0.075, 0.055);
  c.fillStyle = '#20232a';
  CharArt.circ(c, 0.4, hy - 0.03, 0.026);
  CharArt.circ(c, 0.28, hy + 0.03, 0.018);
  // 耳朵
  c.fillStyle = bodyD;
  c.beginPath(); c.moveTo(0.2, hy + 0.09); c.lineTo(0.17, hy + 0.19); c.lineTo(0.28, hy + 0.12); c.closePath(); c.fill();
  c.restore();
};

/* ---- 对外接口 ---- */
const CharArtAPI = {
  /* 在世界坐标绘制角色：c 为已按投影缩放好的上下文（原点在脚底，y 向上） */
  draw(c, skin, pose) {
    const fn = CHARDRAW[skin] || CHARDRAW.naiwa;
    fn(c, pose);
  },
  makePose(state, t, opt) {
    return Object.assign({ state: state || 'run', t: t || 0, lean: 0, squash: 0, front: false }, opt || {});
  },
  /* 在 2D 缩略图上绘制（用于商店卡片 / 主菜单） */
  thumb(canvas, skin, time) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = canvas.clientWidth || 120, h = canvas.clientHeight || 118;
    if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
      canvas.width = Math.floor(w * dpr); canvas.height = Math.floor(h * dpr);
    }
    const c = canvas.getContext('2d');
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, w, h);
    const hp = h * 0.94;
    c.save();
    c.translate(w / 2, h * 0.95);
    c.scale(hp, -hp);
    const pose = CharArtAPI.makePose('idle', (time || 0) * 0.9, { front: true });
    CharArtAPI.draw(c, skin, pose);
    c.restore();
    // 地面阴影
    const g = c.createRadialGradient(w / 2, h * 0.93, 1, w / 2, h * 0.93, w * 0.3);
    g.addColorStop(0, 'rgba(0,0,0,.22)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g;
    c.beginPath(); c.ellipse(w / 2, h * 0.93, w * 0.3, h * 0.05, 0, 0, Math.PI * 2); c.fill();
  },
};
