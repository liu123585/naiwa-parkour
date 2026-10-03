/* =========================================================
   捏捏跑酷 · 角色「建模」与动画 v2
   —— 全部由代码矢量绘制：线稿描边 + 体积渐变 + 完整骨骼 + 面部细节
   坐标空间：脚底 y=0，头顶 y≈1，y 轴向上（背视 / 正视共用同一套骨架）
   ========================================================= */
'use strict';

/* ---------------- 画笔工具 ---------------- */
const PEN = {
  line: '#2a2320',

  circle(c, x, y, r) { c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); },
  ell(c, x, y, rx, ry, rot) { c.beginPath(); c.ellipse(x, y, Math.abs(rx), Math.abs(ry), rot || 0, 0, Math.PI * 2); },
  rr(c, x, y, w, h, r) {
    r = Math.min(Math.abs(r), Math.abs(w) / 2, Math.abs(h) / 2);
    const y2 = y + h;
    c.beginPath();
    c.moveTo(x + r, y);
    c.lineTo(x + w - r, y);
    c.quadraticCurveTo(x + w, y, x + w, y + r);
    c.lineTo(x + w, y2 - r);
    c.quadraticCurveTo(x + w, y2, x + w - r, y2);
    c.lineTo(x + r, y2);
    c.quadraticCurveTo(x, y2, x, y2 - r);
    c.lineTo(x, y + r);
    c.quadraticCurveTo(x, y, x + r, y);
    c.closePath();
  },
  /* 胶囊路径（用于四肢） */
  cap(c, x0, y0, x1, y1, w) {
    const r = w / 2;
    const a = Math.atan2(y1 - y0, x1 - x0);
    c.beginPath();
    c.arc(x0, y0, r, a + Math.PI / 2, a - Math.PI / 2);
    c.arc(x1, y1, r, a - Math.PI / 2, a + Math.PI / 2);
    c.closePath();
  },
  /* 沿轴向的柱面渐变（光从左上来） */
  cyl(c, x0, y0, x1, y1, w, light, base, dark) {
    let a = Math.atan2(y1 - y0, x1 - x0);
    const nx = Math.sin(a), ny = -Math.cos(a);   // 光的另一侧
    const g = c.createLinearGradient(x0 + nx * w * 0.5, y0 + ny * w * 0.5, x0 - nx * w * 0.5, y0 - ny * w * 0.5);
    g.addColorStop(0, dark); g.addColorStop(0.45, base); g.addColorStop(1, light);
    return g;
  },
  /* 球形渐变（头/身体） */
  ball(c, x, y, r, light, base, dark) {
    const g = c.createRadialGradient(x - r * 0.35, y + r * 0.4, r * 0.1, x, y, r * 1.05);
    g.addColorStop(0, light); g.addColorStop(0.55, base); g.addColorStop(1, dark);
    return g;
  },
  vertical(c, x, y, h, top, base, bottom) {
    const g = c.createLinearGradient(x, y - h, x, y);
    g.addColorStop(0, top); g.addColorStop(0.5, base); g.addColorStop(1, bottom);
    return g;
  },
  cylFill(c, x0, y0, x1, y1, w, col, lw) {
    PEN.cap(c, x0, y0, x1, y1, w);
    c.fillStyle = col; c.fill();
    if (lw) { c.strokeStyle = PEN.line; c.lineWidth = lw; c.stroke(); }
  },
  shape(c, fill, lw) {
    c.fillStyle = fill; c.fill();
    if (lw !== 0) { c.strokeStyle = PEN.line; c.lineWidth = lw || 0.013; c.stroke(); }
  },
  /* 明暗色调 */
  tone(hex, k) {
    const p = parseInt(hex.slice(1), 16);
    const r = Math.max(0, Math.min(255, Math.round(((p >> 16) & 255) * k)));
    const g = Math.max(0, Math.min(255, Math.round(((p >> 8) & 255) * k)));
    const b = Math.max(0, Math.min(255, Math.round((p & 255) * k)));
    return 'rgb(' + r + ',' + g + ',' + b + ')';
  },
  pal(base) {
    return { base: base, light: PEN.tone(base, 1.22), dark: PEN.tone(base, 0.68), deeper: PEN.tone(base, 0.45) };
  },
};

/* ---------------- 骨架参数 ---------------- */
const PROP = {
  /* 头身比偏卡通（头大、腿短）更有亲和力 */
  human: { hipY: 0.415, shoulderY: 0.690, headR: 0.145, shoulderW: 0.099, hipW: 0.071, leg: 0.415, build: 1, neck: 0.036 },
  burly: { hipY: 0.395, shoulderY: 0.665, headR: 0.132, shoulderW: 0.130, hipW: 0.086, leg: 0.395, build: 1.18, neck: 0.032 },
  slim: { hipY: 0.435, shoulderY: 0.705, headR: 0.140, shoulderW: 0.092, hipW: 0.066, leg: 0.435, build: 0.94, neck: 0.04 },
  chibi: { hipY: 0.335, shoulderY: 0.575, headR: 0.200, shoulderW: 0.098, hipW: 0.078, leg: 0.335, build: 1, neck: 0.018 },
  tall: { hipY: 0.43, shoulderY: 0.71, headR: 0.138, shoulderW: 0.106, hipW: 0.074, leg: 0.43, build: 1.02, neck: 0.038 },
};

const CharArt = {
  /* 计算骨骼位置（含跑步循环） */
  rig(pose, prop) {
    const P = Object.assign({}, PROP.human, prop || {});
    const state = pose.state || 'run';
    const ph = (pose.t || 0) * Math.PI * 2;
    const tw = Math.sin(ph * 2) * 0.05;
    P.headY = P.shoulderY + P.neck + P.headR;   // 头部中心（写回体型参数，供各角色绘制使用）
    const R = {
      P: P, state: state, ph: ph,
      hipY: P.hipY, shoulderY: P.shoulderY, headR: P.headR,
      headY: P.headY,
      twist: 0, sway: 0, bob: 0, squash: pose.squash || 0, rot: 0, tuck: 0,
      legs: [], arms: [], lean: pose.lean || 0, front: !!pose.front,
    };
    const legAt = (i, lift, swing, bend) => {
      const sgn = i ? 1 : -1;
      const hipX = sgn * P.hipW;
      const ankleY = Math.max(0.012, 0.05 + lift * P.leg * 0.80);
      const ankleX = hipX + swing * 0.034 + sgn * 0.006;
      const kneeX = hipX + swing * 0.016;
      const kneeY = (P.hipY + ankleY) * 0.5 + 0.045 + lift * 0.03 + bend;
      return { hipX: hipX, hipY: P.hipY, kneeX: kneeX, kneeY: kneeY, ankleX: ankleX, ankleY: ankleY, lift: lift, sgn: sgn };
    };
    const armAt = (i, swing, bend) => {
      const sgn = i ? 1 : -1;
      const shX = sgn * (P.shoulderW * 0.98);
      const shY = P.shoulderY - 0.012;
      const len = 0.30 * (0.9 + P.build * 0.1);
      const handY = shY - len + Math.max(0, swing) * 0.055 - bend * 0.03;
      const handX = shX + sgn * 0.012 + swing * 0.042;
      const elbX = shX + sgn * 0.022 + swing * 0.026;
      const elbY = (shY + handY) * 0.5 - 0.004 + bend * 0.01;
      return { shX: shX, shY: shY, elbX: elbX, elbY: elbY, handX: handX, handY: handY, sgn: sgn };
    };

    if (state === 'jump' || state === 'fall') {
      const up = state === 'jump';
      R.legs = [legAt(0, up ? 0.85 : 0.25, up ? 0.5 : -0.55, up ? 0.05 : 0), legAt(1, up ? 0.35 : 0.6, up ? -0.4 : 0.45, 0.02)];
      R.arms = [armAt(0, up ? -1.05 : -0.35, 0.02), armAt(1, up ? -0.85 : -0.5, 0.03)];
      R.bob = 0.015;
      R.twist = up ? 0.04 : -0.04;
    } else if (state === 'roll') {
      R.tuck = 1; R.rot = (pose.t || 0) * Math.PI * 2; R.bob = 0;
      R.legs = [legAt(0, 0.7, 0.25, 0.06), legAt(1, 0.7, 0.25, 0.06)];
      R.arms = [armAt(0, -0.9, 0.06), armAt(1, -0.9, 0.06)];
    } else if (state === 'fly') {
      R.legs = [legAt(0, 0.45, -0.35, 0.02), legAt(1, 0.3, -0.15, 0.02)];
      R.arms = [armAt(0, -1.1, 0.02), armAt(1, -1.0, 0.02)];
      R.bob = 0.01 + Math.sin(ph) * 0.01;
    } else if (state === 'crash') {
      R.rot = -0.75; R.legs = [legAt(0, 0.8, 0.5, 0.05), legAt(1, 0.45, -0.2, 0.02)];
      R.arms = [armAt(0, -1.25, 0.05), armAt(1, -1.15, 0.05)];
    } else if (state === 'idle') {
      R.legs = [legAt(0, 0, 0, 0.005), legAt(1, 0, 0, 0.005)];
      R.arms = [armAt(0, 0.06, 0.03), armAt(1, -0.06, 0.03)];
      R.bob = 0.012 + Math.sin(ph) * 0.014;
      R.twist = Math.sin(ph * 0.5) * 0.02;
    } else {  // run
      const s0 = Math.sin(ph), s1 = Math.sin(ph + Math.PI);
      R.legs = [legAt(0, Math.max(0, Math.sin(ph - 0.5)), s0, 0), legAt(1, Math.max(0, Math.sin(ph + Math.PI - 0.5)), s1, 0)];
      R.arms = [armAt(0, -s0, 0.02), armAt(1, -s1, 0.02)];
      R.bob = 0.016 + Math.abs(Math.cos(ph)) * 0.02;
      R.twist = -tw;
      R.sway = s0 * 0.008;
    }
    R.bob -= R.squash * 0.05;
    return R;
  },

  /* ---------------- 人形角色绘制 ---------------- */
  human(c, pose, S) {
    const R = this.rig(pose, S._prop);
    const P = R.P;
    const front = R.front;
    const line = PEN.line;
    const lw = 0.0125;

    c.save();
    if (R.tuck) { c.translate(0, 0.40); c.rotate(R.rot); c.translate(0, -0.40); }
    else if (R.rot) { c.translate(0, 0.28); c.rotate(R.rot); c.translate(0, -0.28); }
    c.translate(R.sway + R.lean * 0.03, R.bob);

    const drawLeg = (L, back) => {
      const pant = back ? S.pantsBack : S.pants;
      const skin = S.skin;
      // 大腿
      PEN.cap(c, L.hipX, L.hipY, L.kneeX, L.kneeY, S.legW * 1.06);
      PEN.shape(c, PEN.cyl(c, L.hipX, L.hipY, L.kneeX, L.kneeY, S.legW * 1.06, pant.light, pant.base, pant.dark), lw);
      // 小腿（裤脚或皮肤）
      const shinCol = (S.shorts || L.lift > 0.45) ? skin : pant;
      PEN.cap(c, L.kneeX, L.kneeY, L.ankleX, L.ankleY + S.footH * 0.5, S.legW * 0.86);
      PEN.shape(c, PEN.cyl(c, L.kneeX, L.kneeY, L.ankleX, L.ankleY, S.legW * 0.86, shinCol.light, shinCol.base, shinCol.dark), lw);
      // 裤脚/袜口
      if (!S.shorts && L.lift <= 0.45) {
        PEN.cap(c, L.ankleX, L.ankleY + 0.075, L.ankleX, L.ankleY + 0.055, S.legW * 0.92);
        PEN.shape(c, pant.dark, 0);
      }
      // 鞋
      const shoe = back ? S.shoeDark : S.shoe;
      const fy = L.ankleY;
      c.save();
      c.translate(L.ankleX, fy + S.footH * 0.5);
      c.rotate(L.sgn * 0.05 - L.lift * 0.15);
      PEN.rr(c, -S.footW * 0.5, -S.footH * 0.5, S.footW, S.footH, S.footH * 0.4);
      PEN.shape(c, PEN.ball(c, 0, 0, S.footW * 0.5, shoe.light, shoe.base, shoe.dark), lw);
      PEN.rr(c, -S.footW * 0.46, S.footH * 0.06, S.footW * 0.92, S.footH * 0.34, S.footH * 0.16);
      PEN.shape(c, S.shoeSole || '#e8e4dc', 0);
      if (L.lift > 0.35) {   // 抬脚时露出鞋底
        PEN.rr(c, -S.footW * 0.40, -S.footH * 0.62, S.footW * 0.8, S.footH * 0.3, S.footH * 0.14);
        PEN.shape(c, PEN.tone(S.shoeSole || '#e8e4dc', 0.72), 0);
      }
      c.restore();
    };

    const drawArm = (A, back, isBack) => {
      const sleeve = back ? S.sleeveBack : S.sleeve;
      // 上臂（袖子）
      const sleeveLen = S.sleeveLen == null ? 0.62 : S.sleeveLen;
      const midX = A.shX + (A.elbX - A.shX) * sleeveLen, midY = A.shY + (A.elbY - A.shY) * sleeveLen;
      PEN.cap(c, A.shX, A.shY, midX, midY, S.armW * 1.04);
      PEN.shape(c, PEN.cyl(c, A.shX, A.shY, midX, midY, S.armW * 1.04, sleeve.light, sleeve.base, sleeve.dark), lw);
      // 袖子收口
      PEN.cap(c, midX, midY, midX + (A.elbX - midX) * 0.18, midY + (A.elbY - midY) * 0.18, S.armW * 1.12);
      PEN.shape(c, sleeve.dark, 0);
      // 前臂（皮肤）
      PEN.cap(c, midX, midY, A.elbX, A.elbY, S.armW * 0.84);
      PEN.shape(c, PEN.cyl(c, midX, midY, A.elbX, A.elbY, S.armW * 0.84, S.skin.light, S.skin.base, S.skin.dark), lw);
      PEN.cap(c, A.elbX, A.elbY, A.handX, A.handY, S.armW * 0.74);
      PEN.shape(c, PEN.cyl(c, A.elbX, A.elbY, A.handX, A.handY, S.armW * 0.74, S.skin.light, S.skin.base, S.skin.dark), lw);
      // 手
      c.save();
      c.translate(A.handX, A.handY);
      c.rotate(-A.sgn * 0.3);
      PEN.rr(c, -0.036, -0.030, 0.072, 0.070, 0.03);
      PEN.shape(c, PEN.ball(c, 0, 0, 0.05, S.skin.light, S.skin.base, S.skin.dark), lw * 0.9);
      c.restore();
      if (isBack ? S.propBack : S.prop) {
        if (isBack) S.propBack(c, A, true); else S.prop(c, A, false);
      }
    };

    // 后侧四肢 → 躯干 → 前侧四肢（产生前后层次）
    drawLeg(R.legs[0], true);
    drawArm(R.arms[0], true, true);
    if (S.wing) S.wing(c, R, true);

    // 躯干（含上身扭转）
    c.save();
    c.translate(0, P.hipY);
    c.rotate(R.twist);
    c.translate(0, -P.hipY);
    const bw = P.shoulderW * 1.28 * P.build, hw = P.hipW * 1.5 * P.build;
    c.beginPath();
    c.moveTo(-bw, P.shoulderY + 0.012);
    c.quadraticCurveTo(-bw * 1.06, P.shoulderY - (P.shoulderY - P.hipY) * 0.45, -hw, P.hipY - 0.028);
    c.quadraticCurveTo(0, P.hipY - 0.062, hw, P.hipY - 0.028);
    c.quadraticCurveTo(bw * 1.06, P.shoulderY - (P.shoulderY - P.hipY) * 0.45, bw, P.shoulderY + 0.012);
    c.quadraticCurveTo(0, P.shoulderY + 0.062, -bw, P.shoulderY + 0.012);
    c.closePath();
    PEN.shape(c, PEN.vertical(c, 0, P.shoulderY + 0.03, P.shoulderY - P.hipY + 0.09, S.cloth.light, S.cloth.base, S.cloth.dark), lw);
    if (S.clothDetail) S.clothDetail(c, R, bw, hw, front);
    // 肩部
    for (const sgn of [-1, 1]) {
      PEN.circle(c, sgn * bw * 0.98, P.shoulderY, S.armW * 0.62);
      PEN.shape(c, PEN.ball(c, sgn * bw * 0.98, P.shoulderY, S.armW * 0.62, S.cloth.light, S.cloth.base, S.cloth.dark), lw * 0.9);
    }
    // 脖子
    PEN.cap(c, 0, P.shoulderY + 0.005, 0, P.shoulderY + P.neck + P.headR * 0.35, P.headR * 0.62);
    PEN.shape(c, PEN.vertical(c, 0, P.shoulderY + 0.06, P.neck + P.headR * 0.3, S.skin.dark, S.skin.base, S.skin.dark), lw * 0.9);
    // 头
    const hy = P.headY, hr = P.headR;
    PEN.circle(c, 0, hy, hr);
    PEN.shape(c, PEN.ball(c, 0, hy, hr, S.skin.light, S.skin.base, S.skin.dark), lw);
    // 下颌/脸颊
    PEN.ell(c, 0, hy - hr * 0.52, hr * 0.82, hr * 0.5);
    PEN.shape(c, PEN.ball(c, 0, hy - hr * 0.5, hr * 0.7, S.skin.light, S.skin.base, S.skin.dark), lw * 0.8);
    if (front) S.face ? S.face(c, 0, hy, hr, R) : this.face(c, 0, hy, hr, S, R);
    else S.backHead ? S.backHead(c, 0, hy, hr, R) : this.backHead(c, 0, hy, hr, S);
    if (S.hair) S.hair(c, 0, hy, hr, front, R);
    if (S.headwear) S.headwear(c, 0, hy, hr, front, R);
    c.restore();

    if (S.wing) S.wing(c, R, false);
    drawLeg(R.legs[1], false);
    drawArm(R.arms[1], false, false);

    c.restore();
  },

  /* 通用正脸 */
  face(c, x, y, r, S, R) {
    const eyeY = y + r * 0.08, ex = r * 0.42;
    const blink = (R && R.state === 'crash') ? 1 : 0;
    for (const sgn of [-1, 1]) {
      // 眼白
      PEN.ell(c, x + sgn * ex, eyeY, r * 0.24, blink ? r * 0.05 : r * 0.27);
      PEN.shape(c, '#fffdf8', 0.009);
      if (!blink) {
        PEN.circle(c, x + sgn * ex + r * 0.04, eyeY - r * 0.01, r * 0.145);
        PEN.shape(c, '#2b2521', 0.007);
        PEN.circle(c, x + sgn * ex + r * 0.09, eyeY + r * 0.07, r * 0.05);
        PEN.shape(c, 'rgba(255,255,255,.95)', 0);
      }
      // 眉毛
      c.save();
      c.translate(x + sgn * ex, eyeY + r * 0.36);
      c.rotate(sgn * 0.13);
      PEN.rr(c, -r * 0.17, -r * 0.035, r * 0.34, r * 0.07, r * 0.035);
      PEN.shape(c, S.brow || '#3a2f2a', 0);
      c.restore();
    }
    // 鼻
    if (S.nose !== false) {
      PEN.ell(c, x, y - r * 0.12, r * 0.07, r * 0.05);
      PEN.shape(c, PEN.tone(S.skin.base, 0.86), 0);
    }
    // 嘴
    c.save();
    c.strokeStyle = S.mouth || '#5a3b32'; c.lineWidth = r * 0.09; c.lineCap = 'round';
    if (S.mouthType === 'laugh') {
      c.beginPath(); c.arc(x, y - r * 0.30, r * 0.36, Math.PI * 0.12, Math.PI * 0.88, false); c.stroke();
      c.fillStyle = '#6b3a30'; c.beginPath();
      c.moveTo(x - r * 0.4, y - r * 0.24);
      c.quadraticCurveTo(x, y - r * 0.78, x + r * 0.4, y - r * 0.24);
      c.quadraticCurveTo(x, y - r * 0.02, x - r * 0.4, y - r * 0.24);
      c.closePath(); c.fill();
      c.fillStyle = '#fffdf3';
      PEN.rr(c, x - r * 0.30, y - r * 0.40, r * 0.60, r * 0.075, r * 0.02); c.fill();
    } else if (S.mouthType === 'smirk') {
      c.beginPath(); c.moveTo(x - r * 0.26, y - r * 0.28); c.quadraticCurveTo(x + r * 0.05, y - r * 0.1, x + r * 0.3, y - r * 0.34); c.stroke();
    } else if (S.mouthType === 'straight') {
      c.beginPath(); c.moveTo(x - r * 0.24, y - r * 0.26); c.lineTo(x + r * 0.24, y - r * 0.26); c.stroke();
    } else {
      c.beginPath(); c.arc(x, y - r * 0.18, r * 0.3, Math.PI * 0.16, Math.PI * 0.84); c.stroke();
    }
    c.restore();
    // 腮红
    if (S.blush) {
      c.globalAlpha = 0.34; c.fillStyle = S.blush;
      PEN.ell(c, x - r * 0.66, y - r * 0.18, r * 0.19, r * 0.12);
      c.fill(); PEN.ell(c, x + r * 0.66, y - r * 0.18, r * 0.19, r * 0.12); c.fill();
      c.globalAlpha = 1;
    }
  },

  /* 通用后脑 */
  backHead(c, x, y, r, S) {
    // 耳朵
    PEN.ell(c, x - r * 0.98, y - r * 0.05, r * 0.17, r * 0.24);
    PEN.shape(c, S.skin.dark, 0.01);
    PEN.ell(c, x + r * 0.98, y - r * 0.05, r * 0.17, r * 0.24);
    PEN.shape(c, S.skin.dark, 0.01);
    // 后脑高光
    c.globalAlpha = 0.22; c.fillStyle = '#fff';
    PEN.ell(c, x - r * 0.28, y + r * 0.4, r * 0.42, r * 0.3); c.fill();
    c.globalAlpha = 1;
  },

  /* ---------------- 缩略图 / 对外接口 ---------------- */
  makePose(state, t, opt) {
    return Object.assign({ state: state || 'run', t: t || 0, lean: 0, squash: 0, front: false }, opt || {});
  },
  draw(c, skin, pose) {
    const fn = CHARDRAW[skin] || CHARDRAW[DEFAULT_SKIN];
    if (!fn) return;
    try { fn(c, pose); } catch (e) { /* 单个角色绘制异常不影响整局 */ }
  },
  thumb(canvas, skin, time, opts) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = canvas.clientWidth || 120, h = canvas.clientHeight || 104;
    if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
      canvas.width = Math.floor(w * dpr); canvas.height = Math.floor(h * dpr);
    }
    const c = canvas.getContext('2d');
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    /* 滤镜必须在这里设，不能由调用方提前设。
       给 canvas.width 赋值会重置整个 2D 上下文状态（包括 filter），
       调用方先设好 filter 再进来，上面那次 resize 一执行就被抹掉了——
       服装商城 6 套衣服因此长得一模一样。 */
    c.filter = (opts && opts.filter) ? opts.filter : 'none';
    c.clearRect(0, 0, w, h);
    // 首选：AI 原创立绘（观感远好于程序化模型）
    const port0 = (typeof ART !== 'undefined' && ART.portrait) ? ART.portrait(skin) : null;
    if (port0) {
      const hq = h * 0.92;
      const wq = hq * (port0.width / port0.height);
      const g0 = c.createRadialGradient(w / 2, h * 0.95, 1, w / 2, h * 0.95, w * 0.34);
      g0.addColorStop(0, 'rgba(0,0,0,.20)'); g0.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = g0;
      c.beginPath(); c.ellipse(w / 2, h * 0.95, w * 0.32, h * 0.05, 0, 0, Math.PI * 2); c.fill();
      c.drawImage(port0, (w - wq) / 2, h * 0.97 - hq, wq, hq);
      return;
    }
    // 次选：场上同款真 3D 模型渲染出来的缩略图（保证菜单/商店和游戏里长得一样）
    const t3 = (typeof Chars3D !== 'undefined' && Chars3D.thumbs) ? Chars3D.thumbs[skin] : null;
    if (t3) {
      const s = Math.min(w / t3.width, h * 1.02 / t3.height);
      const dw = t3.width * s, dh = t3.height * s;
      c.drawImage(t3, (w - dw) / 2, h * 0.99 - dh, dw, dh);
      return;
    }
    // 地面阴影
    const g = c.createRadialGradient(w / 2, h * 0.95, 1, w / 2, h * 0.95, w * 0.34);
    g.addColorStop(0, 'rgba(0,0,0,.22)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g;
    c.beginPath(); c.ellipse(w / 2, h * 0.95, w * 0.34, h * 0.055, 0, 0, Math.PI * 2); c.fill();
    // 有 AI 立绘就优先用立绘
    const port = (typeof ART !== 'undefined' && ART.portrait) ? ART.portrait(skin) : null;
    const hp = h * 0.9;
    if (port) {
      const w2 = hp * (port.width / port.height);
      c.drawImage(port, (w - w2) / 2, h * 0.96 - hp, w2, hp);
      return;
    }
    c.save();
    c.translate(w / 2, h * 0.96);
    c.scale(hp, -hp);
    const pose = CharArt.makePose('idle', (time || 0) * 0.9, { front: true });
    CharArt.draw(c, skin, pose);
    c.restore();
  },

  /* 兼容旧调用 */
  ell(c, x, y, rx, ry) { PEN.ell(c, x, y, rx, ry); c.fill(); },
  circ(c, x, y, r) { PEN.circle(c, x, y, r); c.fill(); },
  rr(c, x, y, w, h, r) { PEN.rr(c, x, y, w, h, r); c.fill(); },
  capsule(c, x0, y0, x1, y1, w, col) { PEN.cylFill(c, x0, y0, x1, y1, w, col, 0); },
  shade(c, x, y, r, col, a) {
    const g = c.createRadialGradient(x, y, r * 0.1, x, y, r);
    g.addColorStop(0, col); g.addColorStop(1, 'rgba(0,0,0,0)');
    c.globalAlpha = a == null ? 0.5 : a; c.fillStyle = g;
    c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill(); c.globalAlpha = 1;
  },
  tone: PEN.tone,
  pal: PEN.pal,
};

/* 兼容旧接口名 */
const CharArtAPI = CharArt;

/* =========================================================
   体型工厂：把配色 + 细节组装成绘制函数
   ========================================================= */
function makeHuman(S, prop) {
  S._prop = prop;
  S.cloth = S.cloth || PEN.pal('#3a6fb0');
  S.sleeve = S.sleeve || S.cloth;
  S.sleeveBack = S.sleeveBack || { light: PEN.tone(S.sleeve.base, 0.78), base: PEN.tone(S.sleeve.base, 0.7), dark: PEN.tone(S.sleeve.base, 0.55) };
  S.pants = S.pants || PEN.pal('#33384a');
  S.pantsBack = S.pantsBack || { light: PEN.tone(S.pants.base, 0.78), base: PEN.tone(S.pants.base, 0.7), dark: PEN.tone(S.pants.base, 0.55) };
  S.skin = S.skin || PEN.pal('#f2c39b');
  S.shoe = S.shoe || PEN.pal('#f2f2f0');
  S.shoeDark = S.shoeDark || { light: PEN.tone(S.shoe.base, 0.8), base: PEN.tone(S.shoe.base, 0.72), dark: PEN.tone(S.shoe.base, 0.58) };
  S.legW = S.legW || 0.088 * (S._prop === PROP.burly ? 1.25 : 1);
  S.armW = S.armW || 0.078 * (S._prop === PROP.burly ? 1.3 : 1);
  S.footW = S.footW || 0.105;
  S.footH = S.footH || 0.05;
  return function (c, pose) { CharArt.human(c, pose, S); };
}

/* =========================================================
   具体角色
   ========================================================= */
const CHARDRAW = {};

/* =========================================================
   原创主角「泥泥」及 12 个小伙伴（2D 回退绘制）
   仅在 WebGL 不可用、走 Canvas 2D 时使用
   ========================================================= */
function makeYuan2D(cd) {
  const BODY = PEN.pal(cd.body || '#ffd44a');
  const BELLY = cd.belly || '#fff2c0';
  const FOOT = '#3b3b44';
  const ACC = {
    hat: '#e0483f', shades: '#20202a', crown: '#ffd23a', cap: '#4c9440', phones: '#6a4fd0',
    halo: '#ffe27a', antler: '#9c6b3c', star: '#ffd23a', mask: '#2b3140', glasses: '#e8f4ff',
    bow: '#ff6fb0', chef: '#fdfdfd',
  };
  return function (c, pose) {
    const R = CharArt.rig(pose, { hipY: 0.34, shoulderY: 0.60, headR: 0.20, shoulderW: 0.115, hipW: 0.085, leg: 0.34, neck: 0.02 });
    const front = R.front, lw = 0.014;
    const hipY = R.P.hipY, shY = R.P.shoulderY, hy = R.P.headY, hr = R.P.headR;
    c.save();
    if (R.tuck) { c.translate(0, 0.42); c.rotate(R.rot); c.translate(0, -0.42); }
    c.translate(R.sway + R.lean * 0.03, R.bob - R.squash * 0.05);

    const limb = (L, back) => {
      const col = back ? { light: PEN.tone(BODY.base, 0.8), base: PEN.tone(BODY.base, 0.72), dark: PEN.tone(BODY.base, 0.6) } : BODY;
      PEN.cap(c, L.hipX, hipY, L.kneeX, L.kneeY, 0.13);
      PEN.shape(c, PEN.cyl(c, L.hipX, hipY, L.kneeX, L.kneeY, 0.13, col.light, col.base, col.dark), lw);
      PEN.cap(c, L.kneeX, L.kneeY, L.ankleX, L.ankleY, 0.115);
      PEN.shape(c, PEN.cyl(c, L.kneeX, L.kneeY, L.ankleX, L.ankleY, 0.115, col.light, col.base, col.dark), lw);
      c.save(); c.translate(L.ankleX, Math.max(0.03, L.ankleY)); c.rotate(-L.lift * 0.1);
      PEN.ell(c, 0, -0.012, 0.10, 0.05); PEN.shape(c, FOOT, lw * 0.9);
      c.restore();
    };
    const arm = (A, back) => {
      const col = back ? { light: PEN.tone(BODY.base, 0.8), base: PEN.tone(BODY.base, 0.72), dark: PEN.tone(BODY.base, 0.6) } : BODY;
      PEN.cap(c, A.shX, A.shY, A.elbX, A.elbY, 0.10);
      PEN.shape(c, PEN.cyl(c, A.shX, A.shY, A.elbX, A.elbY, 0.10, col.light, col.base, col.dark), lw);
      PEN.cap(c, A.elbX, A.elbY, A.handX, A.handY, 0.09);
      PEN.shape(c, PEN.cyl(c, A.elbX, A.elbY, A.handX, A.handY, 0.09, col.light, col.base, col.dark), lw);
      c.save(); c.translate(A.handX, A.handY); PEN.circle(c, 0, 0, 0.072); PEN.shape(c, col.base, lw); c.restore();
    };

    limb(R.legs[0], true); arm(R.arms[0], true);

    c.save();
    c.translate(0, hipY + 0.06); c.rotate(R.twist); c.translate(0, -(hipY + 0.06));
    // 圆坨身体 + 大肚皮
    PEN.ell(c, 0, hipY + 0.10, 0.24, 0.255);
    PEN.shape(c, PEN.vertical(c, 0, shY + 0.05, shY - hipY + 0.34, BODY.light, BODY.base, BODY.dark), lw);
    if (front) { PEN.ell(c, 0, hipY + 0.05, 0.15, 0.145); PEN.shape(c, BELLY, 0.008); }
    // 脑袋
    const hcy = hy + 0.02;
    PEN.circle(c, 0, hcy, hr);
    PEN.shape(c, PEN.ball(c, 0, hcy, hr, PEN.tone(cd.body || '#ffd44a', 1.16), BODY.base, BODY.dark), lw);
    for (const s of [-1, 1]) {
      PEN.circle(c, s * hr * 0.42, hcy + hr * 0.10, hr * 0.30);
      PEN.shape(c, '#fffdf6', 0.008);
      if (front) { PEN.circle(c, s * hr * 0.42 - s * hr * 0.05, hcy + hr * 0.10, hr * 0.15); PEN.shape(c, '#22201c', 0.006); }
    }
    if (front) {
      c.beginPath();
      c.moveTo(-hr * 0.6, hcy - hr * 0.30);
      c.quadraticCurveTo(0, hcy - hr * 0.78, hr * 0.6, hcy - hr * 0.30);
      c.quadraticCurveTo(0, hcy - hr * 0.12, -hr * 0.6, hcy - hr * 0.30);
      c.closePath();
      c.fillStyle = '#5a2b26'; c.fill(); c.strokeStyle = PEN.line; c.lineWidth = lw; c.stroke();
      c.globalAlpha = 0.4; c.fillStyle = '#ff9fae';
      PEN.ell(c, -hr * 0.78, hcy - hr * 0.06, hr * 0.16, hr * 0.10); c.fill();
      PEN.ell(c, hr * 0.78, hcy - hr * 0.06, hr * 0.16, hr * 0.10); c.fill();
      c.globalAlpha = 1;
    }
    // 头部配饰
    const col = ACC[cd.acc];
    const T = hcy + hr;
    if (col) {
      c.save();
      if (cd.acc === 'shades' || cd.acc === 'mask') {
        c.fillStyle = col;
        PEN.rr(c, -hr * 1.02, hcy + hr * (cd.acc === 'shades' ? 0.02 : -0.26), hr * 2.04, hr * (cd.acc === 'shades' ? 0.42 : 0.60), 0.02);
        c.fill(); c.strokeStyle = PEN.line; c.lineWidth = lw; c.stroke();
      } else if (cd.acc === 'glasses') {
        c.strokeStyle = col; c.lineWidth = 0.016;
        for (const s of [-1, 1]) { PEN.circle(c, s * hr * 0.42, hcy + hr * 0.10, hr * 0.34); c.stroke(); }
      } else if (cd.acc === 'halo') {
        PEN.ell(c, 0, T + hr * 0.46, hr * 0.66, hr * 0.20); PEN.shape(c, col, lw);
      } else if (cd.acc === 'star') {
        c.fillStyle = col; c.translate(0, T + hr * 0.30);
        c.beginPath();
        for (let i = 0; i < 10; i++) { const r = i % 2 ? hr * 0.16 : hr * 0.34, a = -Math.PI / 2 + i * Math.PI / 5; c.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
        c.closePath(); c.fill(); c.strokeStyle = PEN.line; c.lineWidth = lw; c.stroke();
      } else if (cd.acc === 'hat') {
        c.fillStyle = col; c.beginPath(); c.moveTo(-hr * 0.9, T); c.lineTo(0, T - hr * 1.15); c.lineTo(hr * 0.9, T); c.closePath();
        c.fill(); c.strokeStyle = PEN.line; c.lineWidth = lw; c.stroke();
      } else if (cd.acc === 'chef') {
        c.fillStyle = col; PEN.rr(c, -hr * 0.7, T - hr * 0.72, hr * 1.4, hr * 0.5, 0.03); c.fill(); c.strokeStyle = PEN.line; c.lineWidth = lw; c.stroke();
        PEN.ell(c, 0, T - hr * 0.78, hr * 0.8, hr * 0.44); c.fillStyle = col; c.fill(); c.stroke();
      } else if (cd.acc === 'cap') {
        c.fillStyle = col; c.beginPath(); c.arc(0, T, hr * 0.92, Math.PI, 0); c.closePath(); c.fill();
        c.strokeStyle = PEN.line; c.lineWidth = lw; c.stroke();
        PEN.ell(c, hr * 0.38, T, hr * 0.6, hr * 0.14); c.fill(); c.stroke();
      } else if (cd.acc === 'crown') {
        c.fillStyle = col; c.beginPath();
        c.moveTo(-hr * 0.8, T); c.lineTo(-hr * 0.55, T - hr * 0.5); c.lineTo(-hr * 0.25, T);
        c.lineTo(0, T - hr * 0.55); c.lineTo(hr * 0.25, T); c.lineTo(hr * 0.55, T - hr * 0.5); c.lineTo(hr * 0.8, T);
        c.closePath(); c.fill(); c.strokeStyle = PEN.line; c.lineWidth = lw; c.stroke();
      } else if (cd.acc === 'bow') {
        c.fillStyle = col;
        for (const s of [-1, 1]) { c.beginPath(); c.ellipse(s * hr * 0.5, T + hr * 0.1, hr * 0.34, hr * 0.24, s * 0.5, 0, Math.PI * 2); c.fill(); c.strokeStyle = PEN.line; c.lineWidth = lw; c.stroke(); }
        PEN.circle(c, 0, T + hr * 0.1, hr * 0.16); c.fillStyle = '#ff9ccb'; c.fill(); c.stroke();
      } else if (cd.acc === 'phones') {
        c.strokeStyle = col; c.lineWidth = 0.03;
        c.beginPath(); c.arc(0, hcy + hr * 0.05, hr * 1.12, Math.PI * 1.05, Math.PI * 1.95); c.stroke();
        c.fillStyle = col;
        for (const s of [-1, 1]) { PEN.ell(c, s * hr * 1.05, hcy + hr * 0.05, hr * 0.22, hr * 0.30); c.fill(); c.strokeStyle = PEN.line; c.lineWidth = lw; c.stroke(); }
      } else if (cd.acc === 'antler') {
        c.strokeStyle = col; c.lineWidth = 0.022; c.lineCap = 'round';
        for (const s of [-1, 1]) {
          c.beginPath(); c.moveTo(s * hr * 0.45, T - hr * 0.05); c.lineTo(s * hr * 0.72, T - hr * 0.85); c.stroke();
          c.beginPath(); c.moveTo(s * hr * 0.60, T - hr * 0.5); c.lineTo(s * hr * 1.05, T - hr * 0.75); c.stroke();
        }
      }
      c.restore();
    }
    c.restore();

    limb(R.legs[1], false); arm(R.arms[1], false);
  };
}
CHARS.forEach(cd => { if (cd.acc !== undefined) CHARDRAW[cd.id] = makeYuan2D(cd); });
CHARDRAW[DEFAULT_SKIN] = makeYuan2D(CHAR_MAP[DEFAULT_SKIN]);

/* =========================================================
   追兵（2D 回退版）
   3D 模式下追兵由 pinchchars.js 的程序化模型负责；
   这里只在 WebGL 不可用、走 Canvas 2D 时兜个底。
   ========================================================= */
CHARDRAW.bull = makeYuan2D({ body: '#8d5b3f', belly: '#d8a077', acc: 'none' });
CHARDRAW.dog = makeYuan2D({ body: '#b0b7c0', belly: '#e2e7ee', acc: 'none' });
