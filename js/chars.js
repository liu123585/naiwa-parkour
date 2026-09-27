/* =========================================================
   奶蛙跑酷 · 角色「建模」与动画 v2
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
    const fn = CHARDRAW[skin] || CHARDRAW.naiwa;
    try { fn(c, pose); } catch (e) { /* 单个角色绘制异常不影响整局 */ }
  },
  thumb(canvas, skin, time) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = canvas.clientWidth || 120, h = canvas.clientHeight || 104;
    if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
      canvas.width = Math.floor(w * dpr); canvas.height = Math.floor(h * dpr);
    }
    const c = canvas.getContext('2d');
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, w, h);
    // 首选：场上同款真 3D 模型渲染出来的缩略图（保证菜单/商店和游戏里长得一样）
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

/* ---------- 1. 奶蛙：黄桃罐头色巨头 + 黝黑四肢 + 魔性大笑 ---------- */
CHARDRAW.naiwa = function (c, pose) {
  const R = CharArt.rig(pose, { hipY: 0.32, shoulderY: 0.575, headR: 0.20, shoulderW: 0.095, hipW: 0.072, leg: 0.32, neck: 0.012 });
  const front = R.front, lw = 0.014;
  const bodyC = PEN.pal('#f9c93c');
  const limbC = PEN.pal('#3a332e');
  const bellyC = '#fff1c2';
  const hy = R.P.headY, hr = R.P.headR;

  c.save();
  if (R.tuck) { c.translate(0, 0.40); c.rotate(R.rot); c.translate(0, -0.40); }
  c.translate(R.sway + R.lean * 0.03, R.bob - R.squash * 0.05);

  const hipY = R.P.hipY, shY = R.P.shoulderY;

  // ---- 腿（黑，短粗，带脚蹼） ----
  const drawLeg = (L, back) => {
    const col = back ? { light: PEN.tone(limbC.base, 0.7), base: PEN.tone(limbC.base, 0.62), dark: PEN.tone(limbC.base, 0.5) } : limbC;
    PEN.cap(c, L.hipX, hipY, L.kneeX, L.kneeY, 0.105);
    PEN.shape(c, PEN.cyl(c, L.hipX, hipY, L.kneeX, L.kneeY, 0.105, col.light, col.base, col.dark), lw);
    PEN.cap(c, L.kneeX, L.kneeY, L.ankleX, L.ankleY + 0.02, 0.086);
    PEN.shape(c, PEN.cyl(c, L.kneeX, L.kneeY, L.ankleX, L.ankleY, 0.086, col.light, col.base, col.dark), lw);
    // 大脚掌 + 蹼
    c.save();
    c.translate(L.ankleX, Math.max(0.03, L.ankleY));
    c.rotate(-L.lift * 0.12);
    PEN.ell(c, 0, -0.005, 0.086, 0.042);
    PEN.shape(c, '#f6e6ae', lw * 0.9);
    for (const sgn of [-1, 1]) {
      PEN.ell(c, sgn * 0.055, -0.02, 0.03, 0.02);
      PEN.shape(c, '#f6e6ae', 0.006);
    }
    c.restore();
  };
  // ---- 手臂（黑，外张，手带指） ----
  const drawArm = (A, back) => {
    const col = back ? { light: PEN.tone(limbC.base, 0.7), base: PEN.tone(limbC.base, 0.62), dark: PEN.tone(limbC.base, 0.5) } : limbC;
    // 手臂外张，避免被圆身子挡住
    const out = A.sgn * 0.085;
    A = { shX: A.shX, shY: A.shY, elbX: A.elbX + out, elbY: A.elbY + 0.01, handX: A.handX + out * 1.7, handY: A.handY, sgn: A.sgn };
    const midX = A.shX + (A.elbX - A.shX) * 0.6, midY = A.shY + (A.elbY - A.shY) * 0.6;
    PEN.cap(c, A.shX, A.shY, midX, midY, 0.078);
    PEN.shape(c, PEN.cyl(c, A.shX, A.shY, midX, midY, 0.078, col.light, col.base, col.dark), lw);
    PEN.cap(c, midX, midY, A.elbX, A.elbY, 0.068);
    PEN.shape(c, PEN.cyl(c, midX, midY, A.elbX, A.elbY, 0.068, col.light, col.base, col.dark), lw);
    PEN.cap(c, A.elbX, A.elbY, A.handX, A.handY, 0.062);
    PEN.shape(c, PEN.cyl(c, A.elbX, A.elbY, A.handX, A.handY, 0.062, col.light, col.base, col.dark), lw);
    // 三指手掌
    c.save();
    c.translate(A.handX, A.handY);
    c.rotate(-A.sgn * 0.5);
    PEN.ell(c, 0, 0, 0.05, 0.045);
    PEN.shape(c, '#f6e6ae', lw * 0.85);
    for (const k of [-1, 0, 1]) {
      PEN.cap(c, 0, 0, 0.028 * A.sgn, 0.05 + (k === 0 ? 0.012 : 0), 0.026);
      c.save(); c.rotate(k * 0.42); PEN.shape(c, '#f6e6ae', 0.006); c.restore();
    }
    c.restore();
  };

  drawLeg(R.legs[0], true);
  drawArm(R.arms[0], true);

  // ---- 身体（下宽上窄的胖子体型） ----
  c.save();
  c.translate(0, hipY); c.rotate(R.twist); c.translate(0, -hipY);
  c.beginPath();
  c.moveTo(-0.125, shY + 0.05);
  c.bezierCurveTo(-0.265, shY - 0.02, -0.245, hipY - 0.04, -0.155, hipY - 0.07);
  c.quadraticCurveTo(0, hipY - 0.105, 0.155, hipY - 0.07);
  c.bezierCurveTo(0.245, hipY - 0.04, 0.265, shY - 0.02, 0.125, shY + 0.05);
  c.quadraticCurveTo(0, shY + 0.11, -0.125, shY + 0.05);
  c.closePath();
  PEN.shape(c, PEN.vertical(c, 0, shY + 0.06, shY - hipY + 0.14, bodyC.light, bodyC.base, bodyC.dark), lw);
  // 肚皮（仅正视可见，背视画背部纹理）
  if (front) {
    PEN.ell(c, 0, hipY + 0.015, 0.125, 0.10);
    PEN.shape(c, bellyC, 0.008);
    c.globalAlpha = 0.35; c.fillStyle = '#fff';
    PEN.ell(c, -0.05, hipY + 0.05, 0.05, 0.035); c.fill(); c.globalAlpha = 1;
  } else {
    c.globalAlpha = 0.14; c.fillStyle = PEN.tone(bodyC.base, 0.72);
    PEN.ell(c, 0, hipY + 0.03, 0.115, 0.085); c.fill();
    c.globalAlpha = 0.18; c.fillStyle = '#fff';
    PEN.ell(c, -0.045, hipY + 0.08, 0.055, 0.04); c.fill();
    c.globalAlpha = 1;
  }
  // 颈/头
  const headY = hy + 0.015;
  PEN.circle(c, 0, headY, hr);
  PEN.shape(c, PEN.ball(c, 0, headY, hr, PEN.tone('#ffe38f', 1.05), bodyC.base, bodyC.dark), lw);

  // 头顶鼓眼
  const ex = hr * 0.5, eyeY = headY + hr * 0.6;
  for (const sgn of [-1, 1]) {
    // 眼泡
    PEN.circle(c, sgn * ex, eyeY, hr * 0.4);
    PEN.shape(c, PEN.ball(c, sgn * ex, eyeY, hr * 0.4, PEN.tone('#ffe38f', 1.08), bodyC.base, bodyC.dark), lw * 0.9);
    // 眼球
    PEN.circle(c, sgn * ex + (front ? -sgn * hr * 0.04 : 0), eyeY + (front ? 0.006 : 0.012), hr * 0.30);
    PEN.shape(c, '#fffdf6', 0.009);
    // 瞳孔（笑时眯眼）
    const happy = Math.sin((pose.t || 0) * Math.PI * 2) > 0.6;
    if (front) {
      PEN.circle(c, sgn * ex - sgn * hr * 0.07, eyeY + 0.002, hr * 0.16);
      PEN.shape(c, '#221d1a', 0.006);
      PEN.circle(c, sgn * ex - sgn * hr * 0.11, eyeY + hr * 0.09, hr * 0.055);
      PEN.shape(c, 'rgba(255,255,255,.95)', 0);
      if (happy) {  // 眯眼弧线
        c.strokeStyle = '#221d1a'; c.lineWidth = 0.012;
        c.beginPath(); c.arc(sgn * ex, eyeY - hr * 0.02, hr * 0.22, Math.PI * 1.1, Math.PI * 1.9); c.stroke();
      }
    } else {
      PEN.circle(c, sgn * ex, eyeY + 0.006, hr * 0.155);
      PEN.shape(c, '#221d1a', 0.006);
      PEN.circle(c, sgn * ex + hr * 0.06, eyeY + hr * 0.09, hr * 0.05);
      PEN.shape(c, 'rgba(255,255,255,.9)', 0);
    }
    // 眼皮
    c.globalAlpha = 0.25; c.fillStyle = bodyC.dark;
    c.beginPath(); c.arc(sgn * ex, eyeY, hr * 0.4, Math.PI * 0.95, Math.PI * 2.05); c.fill();
    c.globalAlpha = 1;
  }

  if (front) {
    // 巨型魔性笑口
    const mw = hr * 0.78, mtop = headY - hr * 0.30, mbot = headY - hr * 0.86;
    c.beginPath();
    c.moveTo(-mw, mtop);
    c.quadraticCurveTo(0, mbot, mw, mtop);
    c.quadraticCurveTo(0, headY - hr * 0.02, -mw, mtop);
    c.closePath();
    c.fillStyle = '#4a2419'; c.fill();
    c.strokeStyle = PEN.line; c.lineWidth = lw; c.stroke();
    c.save(); c.clip();
    // 舌头
    c.fillStyle = '#ff8b8b';
    PEN.ell(c, 0, headY - hr * 0.16, hr * 0.44, hr * 0.24); c.fill();
    // 上排牙
    c.fillStyle = '#fffdf3';
    PEN.rr(c, -mw * 0.94, mtop - hr * 0.10, mw * 1.88, hr * 0.12, 0.012); c.fill();
    c.restore();
    // 鼻孔
    c.fillStyle = PEN.tone(bodyC.base, 0.7);
    PEN.ell(c, -hr * 0.16, headY + hr * 0.16, hr * 0.045, hr * 0.03); c.fill();
    PEN.ell(c, hr * 0.16, headY + hr * 0.16, hr * 0.045, hr * 0.03); c.fill();
    // 腮红
    c.globalAlpha = 0.35; c.fillStyle = '#ff9f76';
    PEN.ell(c, -hr * 0.72, headY - hr * 0.2, hr * 0.18, hr * 0.12); c.fill();
    PEN.ell(c, hr * 0.72, headY - hr * 0.2, hr * 0.18, hr * 0.12); c.fill();
    c.globalAlpha = 1;
  } else {
    // 背视：嘴角从两侧露出，笑到变形
    c.strokeStyle = '#4a2419'; c.lineWidth = 0.016; c.lineCap = 'round';
    c.beginPath();
    c.moveTo(-hr * 0.74, headY - hr * 0.34);
    c.quadraticCurveTo(-hr * 0.92, headY - hr * 0.14, -hr * 0.8, headY - hr * 0.0);
    c.moveTo(hr * 0.74, headY - hr * 0.34);
    c.quadraticCurveTo(hr * 0.92, headY - hr * 0.14, hr * 0.8, headY - hr * 0.0);
    c.stroke();
    // 后脑纹理
    c.globalAlpha = 0.18; c.fillStyle = '#fff';
    PEN.ell(c, -hr * 0.3, headY + hr * 0.35, hr * 0.4, hr * 0.28); c.fill();
    c.globalAlpha = 1;
  }
  c.restore();

  drawLeg(R.legs[1], false);
  drawArm(R.arms[1], false);
  c.restore();
};

/* ---------- 2. 奶龙 ---------- */
CHARDRAW.nailong = (function () {
  const S = {
    _prop: Object.assign({}, PROP.chibi, { headR: 0.195, shoulderY: 0.585, hipY: 0.335, hipW: 0.088 }),
    cloth: PEN.pal('#ffd84a'), skin: PEN.pal('#ffd84a'),
    pants: PEN.pal('#e8b81c'), shoe: PEN.pal('#e8b81c'), shoeSole: '#fff2c0',
    blush: '#ff9f9f', mouthType: 'smile', sleeveLen: 1.0,
    legW: 0.088, armW: 0.082, footW: 0.105, footH: 0.048,
    clothDetail(c, R, bw, hw, front) {
      if (front) {
        // 奶白色肚皮
        PEN.ell(c, 0, R.P.hipY + 0.055, bw * 0.52, (R.P.shoulderY - R.P.hipY) * 0.46);
        PEN.shape(c, '#fff8d8', 0.009);
      } else {
        // 背部鳞纹
        c.globalAlpha = 0.5;
        for (let i = 0; i < 3; i++) {
          c.strokeStyle = PEN.tone('#ffd84a', 0.78); c.lineWidth = 0.009;
          c.beginPath();
          c.arc(0, R.P.hipY + 0.02 + i * 0.055, bw * 0.42, Math.PI * 0.15, Math.PI * 0.85);
          c.stroke();
        }
        c.globalAlpha = 1;
      }
    },
    /* 背上的小翅膀 */
    wing(c, R, back) {
      const sgn = back ? -1 : 1;
      const shY = R.P.shoulderY + 0.035;
      c.save();
      c.translate(sgn * R.P.shoulderW * 1.05, shY);
      c.rotate(sgn * (0.55 + Math.sin(R.ph) * 0.22));
      c.beginPath();
      c.moveTo(0, 0.03);
      c.quadraticCurveTo(sgn * 0.11, 0.05, sgn * 0.13, -0.09);
      c.quadraticCurveTo(sgn * 0.05, -0.07, 0, 0.03);
      c.closePath();
      PEN.shape(c, PEN.tone('#ff9f43', back ? 0.78 : 1), 0.011);
      c.restore();
    },
    hair(c, x, y, r, front) {
      // 头顶小角
      for (const sgn of [-1, 1]) {
        c.save();
        c.translate(sgn * r * 0.5, y + r * 0.78);
        c.rotate(sgn * 0.4);
        PEN.cap(c, 0, 0, 0, r * 0.34, r * 0.17);
        PEN.shape(c, '#ff9f43', 0.011);
        c.restore();
      }
    },
    tail(c, R) {
      c.save();
      c.translate(0, R.P.hipY + 0.02);
      c.beginPath();
      c.moveTo(-0.03, 0);
      c.quadraticCurveTo(-0.22, -0.06 + Math.sin(R.ph) * 0.03, -0.30, -0.16 + Math.sin(R.ph) * 0.05);
      c.quadraticCurveTo(-0.16, -0.12, -0.02, -0.06);
      c.closePath();
      PEN.shape(c, PEN.tone('#ffd84a', 0.9), 0.012);
      c.restore();
    },
  };
  const base = makeHuman(S, S._prop);
  return function (c, pose) {
    const R = CharArt.rig(pose, S._prop);
    S._r = R;
    c.save();
    // 尾巴先画（在身后）
    c.save(); c.translate(R.sway, R.bob); S.tail(c, R); c.restore();
    base(c, pose);
    c.restore();
  };
})();

/* ---------- 3. 东北雨姐 ---------- */
CHARDRAW.yujie = makeHuman({
  cloth: PEN.pal('#d93a34'), sleeve: PEN.pal('#d93a34'),
  pants: PEN.pal('#33304a'), skin: PEN.pal('#f6cca8'),
  shoe: PEN.pal('#2b2b30'), shoeSole: '#8d8d92',
  brow: '#3a2a24', blush: '#ff8f7a', mouthType: 'smirk',
  legW: 0.118, armW: 0.104, footW: 0.13, footH: 0.052,
  clothDetail(c, R, bw, hw, front) {
    const shY = R.P.shoulderY, hipY = R.P.hipY;
    // 花棉袄：碎花 + 衣襟
    const dots = [
      [-bw * 0.55, shY - 0.10], [bw * 0.42, shY - 0.14], [-bw * 0.1, shY - 0.2], [bw * 0.62, shY - 0.05],
      [-bw * 0.62, hipY + 0.14], [bw * 0.16, hipY + 0.13], [-bw * 0.2, hipY + 0.2], [bw * 0.55, hipY + 0.19],
      [0, shY - 0.32], [-bw * 0.42, hipY + 0.06], [bw * 0.34, hipY + 0.06],
    ];
    dots.forEach((p, i) => {
      c.fillStyle = i % 3 === 0 ? '#ffe9a8' : '#fff4d0';
      PEN.circle(c, p[0], p[1], 0.017); c.fill();
      for (let k = 0; k < 5; k++) {
        const a = k / 5 * Math.PI * 2;
        PEN.circle(c, p[0] + Math.cos(a) * 0.019, p[1] + Math.sin(a) * 0.019, 0.008); c.fill();
      }
    });
    // 衣襟（盘扣）
    c.strokeStyle = '#f0c14b'; c.lineWidth = 0.012;
    c.beginPath(); c.moveTo(0, shY + 0.02); c.lineTo(0, hipY - 0.02); c.stroke();
    for (let i = 0; i < 3; i++) {
      PEN.circle(c, 0, shY - 0.05 - i * 0.09, 0.014);
      PEN.shape(c, '#f0c14b', 0.007);
    }
    // 下摆厚棉
    PEN.rr(c, -hw * 1.02, hipY - 0.075, hw * 2.04, 0.05, 0.02);
    PEN.shape(c, PEN.tone('#d93a34', 0.82), 0.011);
  },
  hair(c, x, y, r, front) {
    c.fillStyle = '#3a2a24';
    if (front) {
      PEN.rr(c, x - r * 1.04, y + r * 0.30, r * 2.08, r * 0.72, r * 0.3); c.fill();
      PEN.circle(c, x - r * 0.98, y + r * 0.05, r * 0.26); c.fill();
      PEN.circle(c, x + r * 0.98, y + r * 0.05, r * 0.26); c.fill();
    } else {
      PEN.circle(c, x, y + r * 0.08, r * 1.06); c.fill();
      PEN.rr(c, x - r * 1.0, y - r * 0.5, r * 2.0, r * 0.95, r * 0.32); c.fill();
    }
    // 花头巾
    c.fillStyle = '#f7f1e0';
    PEN.rr(c, x - r * 1.12, y + r * 0.52, r * 2.24, r * 0.36, r * 0.16); c.fill();
    c.strokeStyle = PEN.line; c.lineWidth = 0.011; c.stroke();
    c.fillStyle = '#d93a34';
    for (let i = -2; i <= 2; i++) { PEN.circle(c, x + i * r * 0.42, y + r * 0.7, r * 0.075); c.fill(); }
    // 头巾结
    PEN.ell(c, x + r * 1.06, y + r * 0.76, r * 0.2, r * 0.13);
    PEN.shape(c, '#f7f1e0', 0.01);
  },
  /* 手里拎大铁勺 */
  prop(c, A) {
    c.save();
    c.translate(A.handX, A.handY);
    c.rotate(-0.35);
    PEN.rr(c, -0.014, 0.02, 0.028, 0.34, 0.012);
    PEN.shape(c, '#9aa1a8', 0.011);
    PEN.ell(c, 0, 0.36, 0.078, 0.062);
    PEN.shape(c, PEN.ball(c, 0, 0.36, 0.07, '#c8ced4', '#8d949c', '#5f666d'), 0.012);
    c.restore();
  },
}, PROP.burly);

/* ---------- 4. 疯狂小杨哥 ---------- */
CHARDRAW.xiaoyang = makeHuman({
  cloth: PEN.pal('#f2f4f7'), sleeve: PEN.pal('#f2f4f7'),
  pants: PEN.pal('#2f333b'), skin: PEN.pal('#f5c6a1'),
  shoe: PEN.pal('#ffffff'), shoeSole: '#d9dde3',
  brow: '#1d1f24', blush: '#ff9d9d', mouthType: 'laugh',
  clothDetail(c, R, bw, shY, front) {
    const hipY = R.P.hipY;
    // 帽衫口袋
    PEN.rr(c, -bw * 0.45, hipY + 0.05, bw * 0.9, 0.11, 0.03);
    PEN.shape(c, PEN.tone('#f2f4f7', 0.92), 0.01);
    // 抽绳
    c.strokeStyle = '#c8ced8'; c.lineWidth = 0.012;
    c.beginPath(); c.moveTo(-0.03, R.P.shoulderY - 0.01); c.lineTo(-0.03, R.P.shoulderY - 0.16); c.stroke();
    c.beginPath(); c.moveTo(0.03, R.P.shoulderY - 0.01); c.lineTo(0.03, R.P.shoulderY - 0.18); c.stroke();
    // 印花
    c.fillStyle = '#ffd34d';
    PEN.circle(c, 0, (R.P.shoulderY + hipY) / 2 - 0.01, 0.038); c.fill();
    c.fillStyle = '#262a31';
    c.font = 'inherit';
  },
  hair(c, x, y, r, front) {
    c.fillStyle = '#1d1f24';
    if (front) {
      PEN.rr(c, x - r * 1.02, y + r * 0.34, r * 2.04, r * 0.56, r * 0.26); c.fill();
      // 刘海
      c.beginPath();
      c.moveTo(x - r * 0.98, y + r * 0.66);
      c.quadraticCurveTo(x - r * 0.5, y + r * 0.86, x - r * 0.1, y + r * 0.62);
      c.quadraticCurveTo(x + r * 0.4, y + r * 0.9, x + r * 0.98, y + r * 0.62);
      c.lineTo(x + r * 0.98, y + r * 1.05); c.lineTo(x - r * 0.98, y + r * 1.05);
      c.closePath(); c.fill();
    } else {
      PEN.circle(c, x, y + r * 0.06, r * 1.04); c.fill();
      PEN.rr(c, x - r * 1.0, y + r * 0.05, r * 2.0, r * 0.6, r * 0.28); c.fill();
    }
  },
  prop(c, A) {
    // 麦克风
    c.save(); c.translate(A.handX, A.handY); c.rotate(-0.5);
    PEN.rr(c, -0.024, 0.02, 0.048, 0.15, 0.018);
    PEN.shape(c, '#2b2f36', 0.011);
    PEN.circle(c, 0, 0.20, 0.042);
    PEN.shape(c, PEN.ball(c, 0, 0.20, 0.04, '#d6dbe2', '#8d949c', '#5c626a'), 0.011);
    c.restore();
  },
}, PROP.human);

/* ---------- 5. 张同学 ---------- */
CHARDRAW.zhangtongxue = makeHuman({
  cloth: PEN.pal('#5c6b45'), sleeve: PEN.pal('#5c6b45'),
  pants: PEN.pal('#2f3a44'), skin: PEN.pal('#e7b78c'),
  shoe: PEN.pal('#3b2f26'), shoeSole: '#6b5a48',
  brow: '#33291f', mouthType: 'straight',
  clothDetail(c, R, bw, hw) {
    const shY = R.P.shoulderY, hipY = R.P.hipY;
    // 棉服压线
    c.strokeStyle = PEN.tone('#5c6b45', 0.78); c.lineWidth = 0.009;
    for (let i = 1; i <= 3; i++) {
      const yy = shY - 0.09 * i;
      c.beginPath(); c.moveTo(-bw * 0.85, yy); c.lineTo(bw * 0.85, yy); c.stroke();
    }
    // 拉链
    c.strokeStyle = '#8d8468'; c.lineWidth = 0.013;
    c.beginPath(); c.moveTo(0, shY + 0.03); c.lineTo(0, hipY - 0.03); c.stroke();
    // 斜挎带
    c.strokeStyle = '#3a2f24'; c.lineWidth = 0.026;
    c.beginPath(); c.moveTo(-bw * 0.9, shY + 0.02); c.lineTo(bw * 0.55, hipY + 0.02); c.stroke();
  },
  hair(c, x, y, r, front) {
    // 棉帽（护耳）
    c.fillStyle = '#3b4048';
    PEN.circle(c, x, y + r * 0.28, r * 1.08); c.fill();
    c.strokeStyle = PEN.line; c.lineWidth = 0.012; c.stroke();
    PEN.rr(c, x - r * 1.16, y + r * 0.62, r * 2.32, r * 0.34, r * 0.14);
    c.fillStyle = '#2b2f36'; c.fill();
    c.strokeStyle = PEN.line; c.stroke();
    // 帽檐
    PEN.rr(c, x - r * 0.95, y + r * 0.86, r * 1.9, r * 0.26, r * 0.1);
    c.fillStyle = '#23262c'; c.fill(); c.strokeStyle = PEN.line; c.stroke();
    // 护耳
    for (const sgn of [-1, 1]) {
      PEN.rr(c, x + sgn * r * 0.92 - (sgn > 0 ? 0 : r * 0.28), y + r * 0.36, r * 0.28, r * 0.5, r * 0.12);
      c.fillStyle = '#2b2f36'; c.fill(); c.strokeStyle = PEN.line; c.stroke();
    }
    // 露出的头发
    c.fillStyle = '#2a2d33';
    if (front) { PEN.rr(c, x - r * 0.8, y + r * 0.62, r * 1.6, r * 0.18, r * 0.08); c.fill(); }
  },
  prop(c, A) {
    // 三脚架
    c.save(); c.translate(A.handX, A.handY);
    PEN.rr(c, -0.015, -0.02, 0.03, 0.30, 0.012);
    PEN.shape(c, '#2b2f36', 0.01);
    c.strokeStyle = '#2b2f36'; c.lineWidth = 0.016;
    c.beginPath(); c.moveTo(0, 0.28); c.lineTo(-0.06, 0.36); c.moveTo(0, 0.28); c.lineTo(0.06, 0.36);
    c.moveTo(0, 0.28); c.lineTo(0, 0.38); c.stroke();
    c.restore();
  },
}, PROP.human);

/* ---------- 6. 李子柒 ---------- */
CHARDRAW.liziqi = makeHuman({
  cloth: PEN.pal('#f7f3e8'), sleeve: PEN.pal('#f7f3e8'),
  pants: PEN.pal('#e6ddc9'), skin: PEN.pal('#f8d3b6'),
  shoe: PEN.pal('#6a5540'), shoeSole: '#4f3f2f',
  brow: '#2b211c', blush: '#ff9d9d', mouthType: 'smirk',
  legW: 0.082, armW: 0.072, footW: 0.105, footH: 0.046,
  sleeveLen: 0.9,
  clothDetail(c, R, bw, hw) {
    const shY = R.P.shoulderY, hipY = R.P.hipY;
    // 交领
    c.strokeStyle = '#b2432f'; c.lineWidth = 0.014;
    c.beginPath();
    c.moveTo(-bw * 0.6, shY + 0.02); c.lineTo(0.01, hipY + 0.09); c.lineTo(bw * 0.6, shY + 0.02);
    c.stroke();
    // 内衬
    c.beginPath(); c.moveTo(-bw * 0.24, shY + 0.03); c.lineTo(0.005, hipY + 0.06); c.lineTo(bw * 0.24, shY + 0.03);
    c.closePath();
    PEN.shape(c, '#d9c6a8', 0.008);
    // 腰带
    PEN.rr(c, -hw * 1.06, hipY + 0.075, hw * 2.12, 0.05, 0.012);
    PEN.shape(c, '#b2432f', 0.01);
    // 下摆褶皱
    c.strokeStyle = PEN.tone('#f7f3e8', 0.86); c.lineWidth = 0.008;
    for (let i = -2; i <= 2; i++) {
      c.beginPath(); c.moveTo(i * hw * 0.42, hipY + 0.03); c.lineTo(i * hw * 0.5, hipY - 0.06); c.stroke();
    }
  },
  hair(c, x, y, r, front) {
    c.fillStyle = '#241d1a';
    if (front) {
      PEN.rr(c, x - r * 1.06, y + r * 0.28, r * 2.12, r * 0.66, r * 0.3); c.fill();
      // 中分刘海
      c.beginPath();
      c.moveTo(x, y + r * 0.94);
      c.quadraticCurveTo(x - r * 0.9, y + r * 0.9, x - r * 1.0, y + r * 0.3);
      c.lineTo(x - r * 0.9, y + r * 0.62);
      c.quadraticCurveTo(x - r * 0.4, y + r * 0.7, x, y + r * 0.94);
      c.closePath(); c.fill();
      c.beginPath();
      c.moveTo(x, y + r * 0.94);
      c.quadraticCurveTo(x + r * 0.9, y + r * 0.9, x + r * 1.0, y + r * 0.3);
      c.lineTo(x + r * 0.9, y + r * 0.62);
      c.quadraticCurveTo(x + r * 0.4, y + r * 0.7, x, y + r * 0.94);
      c.closePath(); c.fill();
      // 鬓发
      PEN.cap(c, x - r * 0.96, y + r * 0.5, x - r * 0.86, y - r * 0.5, r * 0.24); c.fill();
      PEN.cap(c, x + r * 0.96, y + r * 0.5, x + r * 0.86, y - r * 0.5, r * 0.24); c.fill();
    } else {
      PEN.circle(c, x, y + r * 0.08, r * 1.06); c.fill();
      c.beginPath();
      c.moveTo(x - r * 1.02, y + r * 0.5);
      c.quadraticCurveTo(x, y - r * 1.15, x + r * 1.02, y + r * 0.5);
      c.quadraticCurveTo(x, y - r * 0.2, x - r * 1.02, y + r * 0.5);
      c.closePath(); c.fill();
    }
    // 发髻 + 发簪
    PEN.circle(c, x, y + r * 1.14, r * 0.42);
    c.fillStyle = '#241d1a'; c.fill();
    c.strokeStyle = PEN.line; c.lineWidth = 0.01; c.stroke();
    c.strokeStyle = '#c9a24b'; c.lineWidth = 0.014;
    c.beginPath(); c.moveTo(x - r * 0.5, y + r * 1.3); c.lineTo(x + r * 0.5, y + r * 1.1); c.stroke();
  },
  clothDetail2() {},
  prop(c, A) {
    // 竹篮
    c.save(); c.translate(A.handX, A.handY);
    c.rotate(-0.15);
    PEN.rr(c, -0.085, -0.02, 0.17, 0.12, 0.03);
    PEN.shape(c, PEN.vertical(c, 0, 0.1, 0.12, '#e0b877', '#c99a54', '#a97f3c'), 0.011);
    c.strokeStyle = '#a97f3c'; c.lineWidth = 0.009;
    for (let i = -2; i <= 2; i++) { c.beginPath(); c.moveTo(i * 0.03, -0.02); c.lineTo(i * 0.032, 0.1); c.stroke(); }
    c.strokeStyle = '#8d6a34'; c.lineWidth = 0.013;
    c.beginPath(); c.arc(0, 0.1, 0.07, Math.PI, 0); c.stroke();
    // 果蔬
    c.fillStyle = '#7cd44a';
    PEN.circle(c, -0.035, 0.115, 0.026); c.fill();
    PEN.circle(c, 0.03, 0.12, 0.024); c.fill();
    c.fillStyle = '#e6423c';
    PEN.circle(c, 0, 0.125, 0.022); c.fill();
    c.restore();
  },
}, PROP.slim);

/* ---------- 7. 刘教练 ---------- */
CHARDRAW.liugenhong = makeHuman({
  cloth: PEN.pal('#23b0d6'), sleeve: PEN.pal('#23b0d6'),
  pants: PEN.pal('#37404c'), skin: PEN.pal('#eda76b'),
  shoe: PEN.pal('#eef2f6'), shoeSole: '#c3c9d1',
  brow: '#1e1c1a', mouthType: 'laugh',
  legW: 0.10, armW: 0.094, footW: 0.122, footH: 0.05,
  sleeveLen: 0.2,
  shorts: false,
  clothDetail(c, R, bw, hw) {
    const shY = R.P.shoulderY, hipY = R.P.hipY;
    // 背心（露肩，大 V 领）
    c.beginPath();
    c.moveTo(-bw * 0.55, shY + 0.03);
    c.lineTo(0, hipY - 0.02);
    c.lineTo(bw * 0.55, shY + 0.03);
    c.quadraticCurveTo(0, shY + 0.075, -bw * 0.55, shY + 0.03);
    c.closePath();
    PEN.shape(c, '#f7f9fb', 0.009);
    // 胸肌线
    c.strokeStyle = PEN.tone('#23b0d6', 0.7); c.lineWidth = 0.01;
    c.beginPath(); c.moveTo(0, shY - 0.06); c.lineTo(0, hipY - 0.04); c.stroke();
    // 腹肌
    for (let i = 0; i < 3; i++) {
      c.beginPath();
      c.moveTo(-0.03, hipY + 0.12 + i * 0.05); c.lineTo(0.03, hipY + 0.12 + i * 0.05);
      c.stroke();
    }
  },
  hair(c, x, y, r, front) {
    c.fillStyle = '#1e1c1a';
    if (front) { PEN.rr(c, x - r * 1.0, y + r * 0.42, r * 2.0, r * 0.48, r * 0.2); c.fill(); }
    else { PEN.circle(c, x, y + r * 0.1, r * 0.98); c.fill(); }
    // 运动发带
    PEN.rr(c, x - r * 1.04, y + r * 0.56, r * 2.08, r * 0.22, r * 0.09);
    PEN.shape(c, '#ff3b30', 0.011);
  },
  prop(c, A, back) {
    if (back) return;
    // 哑铃
    c.save(); c.translate(A.handX, A.handY);
    c.rotate(-0.25);
    PEN.rr(c, -0.09, -0.012, 0.18, 0.024, 0.01);
    PEN.shape(c, '#4b525c', 0.01);
    for (const sgn of [-1, 1]) {
      PEN.circle(c, sgn * 0.092, 0, 0.036);
      PEN.shape(c, PEN.ball(c, sgn * 0.092, 0, 0.034, '#7d858f', '#3b4048', '#22262c'), 0.01);
    }
    c.restore();
  },
  propBack(c, A) {
    // 另一只手也举哑铃，交替
    c.save(); c.translate(A.handX, A.handY); c.rotate(0.25);
    PEN.rr(c, -0.08, -0.011, 0.16, 0.022, 0.01);
    PEN.shape(c, '#4b525c', 0.009);
    for (const sgn of [-1, 1]) {
      PEN.circle(c, sgn * 0.082, 0, 0.032);
      PEN.shape(c, PEN.ball(c, sgn * 0.082, 0, 0.03, '#7d858f', '#3b4048', '#22262c'), 0.009);
    }
    c.restore();
  },
}, PROP.burly);

/* ---------- 8. 董老师 ---------- */
CHARDRAW.donglaoshi = makeHuman({
  cloth: PEN.pal('#f8f8f6'), sleeve: PEN.pal('#f8f8f6'),
  pants: PEN.pal('#2f3339'), skin: PEN.pal('#f3c7a1'),
  shoe: PEN.pal('#3a3a3f'), shoeSole: '#6d6d74',
  brow: '#22201f', mouthType: 'smirk',
  clothDetail(c, R, bw, hw) {
    const shY = R.P.shoulderY, hipY = R.P.hipY;
    // 马甲
    c.beginPath();
    c.moveTo(-bw * 1.0, shY + 0.03);
    c.lineTo(-bw * 0.3, shY + 0.03);
    c.lineTo(-bw * 0.22, hipY - 0.02);
    c.lineTo(-bw * 1.0, hipY - 0.02);
    c.closePath();
    PEN.shape(c, PEN.vertical(c, 0, shY, hipY, '#414751', '#2c303a', '#20242c'), 0.011);
    c.beginPath();
    c.moveTo(bw * 1.0, shY + 0.03);
    c.lineTo(bw * 0.3, shY + 0.03);
    c.lineTo(bw * 0.22, hipY - 0.02);
    c.lineTo(bw * 1.0, hipY - 0.02);
    c.closePath();
    PEN.shape(c, PEN.vertical(c, 0, shY, hipY, '#414751', '#2c303a', '#20242c'), 0.011);
    // 扣子
    for (let i = 0; i < 3; i++) { PEN.circle(c, 0, shY - 0.06 - i * 0.08, 0.011); PEN.shape(c, '#c9c9c9', 0.006); }
  },
  hair(c, x, y, r, front) {
    c.fillStyle = '#22201f';
    if (front) { PEN.rr(c, x - r * 1.0, y + r * 0.4, r * 2.0, r * 0.52, r * 0.22); c.fill(); }
    else { PEN.circle(c, x, y + r * 0.1, r * 1.0); c.fill(); }
  },
  face(c, x, y, r) {
    CharArt.face(c, x, y, r, { skin: PEN.pal('#f3c7a1'), brow: '#22201f', mouthType: 'smirk', nose: false }, null);
    // 眼镜
    c.strokeStyle = '#2b2f36'; c.lineWidth = r * 0.06;
    for (const sgn of [-1, 1]) {
      c.beginPath(); c.arc(x + sgn * r * 0.42, y + r * 0.08, r * 0.28, 0, Math.PI * 2); c.stroke();
    }
    c.beginPath(); c.moveTo(x - r * 0.14, y + r * 0.08); c.lineTo(x + r * 0.14, y + r * 0.08); c.stroke();
  },
  prop(c, A) {
    // 书
    c.save(); c.translate(A.handX, A.handY);
    c.rotate(-0.3);
    PEN.rr(c, -0.075, -0.05, 0.15, 0.1, 0.012);
    PEN.shape(c, PEN.ball(c, 0, 0, 0.09, '#a8703f', '#8d5a3b', '#6b4029'), 0.012);
    PEN.rr(c, -0.068, -0.043, 0.136, 0.086, 0.006);
    PEN.shape(c, '#fffdf6', 0.006);
    c.strokeStyle = '#c8c2b4'; c.lineWidth = 0.007;
    for (let i = 0; i < 3; i++) { c.beginPath(); c.moveTo(-0.05, 0.02 - i * 0.026); c.lineTo(0.05, 0.02 - i * 0.026); c.stroke(); }
    c.restore();
  },
}, PROP.slim);

/* ---------- 9. 雨姐的鹅 ---------- */
CHARDRAW.goose = function (c, pose) {
  const R = CharArt.rig(pose, { hipY: 0.30, shoulderY: 0.56, headR: 0.115, shoulderW: 0.1, hipW: 0.07, leg: 0.3 });
  const front = R.front;
  const line = PEN.line, lw = 0.012;
  const bodyC = PEN.pal('#fdfcf6'), beakC = PEN.pal('#ff9d1e');
  const hipY = 0.30;

  c.save();
  if (R.tuck) { c.translate(0, 0.38); c.rotate(R.rot); c.translate(0, -0.38); }
  c.translate(R.sway + R.lean * 0.04, R.bob);

  // 腿
  for (const L of R.legs) {
    PEN.cap(c, L.hipX, hipY + 0.05, L.ankleX, L.ankleY + 0.03, 0.038);
    PEN.shape(c, PEN.cyl(c, L.hipX, hipY, L.ankleX, L.ankleY, 0.038, '#ffb954', '#ff9d1e', '#d97d0c'), lw * 0.8);
    c.save(); c.translate(L.ankleX, Math.max(0.02, L.ankleY));
    PEN.ell(c, 0, 0, 0.058, 0.022);
    PEN.shape(c, '#e07f0c', 0.01);
    for (const sgn of [-1, 1]) { PEN.cap(c, 0, 0, sgn * 0.05, -0.012, 0.02); PEN.shape(c, '#e07f0c', 0.008); }
    c.restore();
  }
  // 翅膀（扑棱）
  const flap = Math.sin(R.ph * 2) * 0.25;
  for (const sgn of [-1, 1]) {
    c.save();
    c.translate(sgn * 0.17, hipY + 0.14);
    c.rotate(sgn * (0.55 + flap));
    c.beginPath();
    c.moveTo(0, 0.04);
    c.quadraticCurveTo(sgn * 0.20, -0.02, sgn * 0.15, -0.22);
    c.quadraticCurveTo(sgn * 0.05, -0.16, 0, 0.04);
    c.closePath();
    PEN.shape(c, PEN.cyl(c, 0, 0.04, sgn * 0.15, -0.22, 0.16, '#ffffff', '#f2f0e6', '#d5d2c6'), lw);
    c.strokeStyle = '#d5d2c6'; c.lineWidth = 0.009;
    c.beginPath(); c.moveTo(sgn * 0.03, -0.02); c.lineTo(sgn * 0.13, -0.16); c.stroke();
    c.restore();
  }
  // 身体
  c.beginPath();
  c.moveTo(-0.20, hipY + 0.16);
  c.bezierCurveTo(-0.26, hipY + 0.30, 0.26, hipY + 0.30, 0.20, hipY + 0.16);
  c.bezierCurveTo(0.14, hipY - 0.02, -0.14, hipY - 0.02, -0.20, hipY + 0.16);
  c.closePath();
  PEN.shape(c, PEN.ball(c, 0, hipY + 0.14, 0.22, '#ffffff', '#f7f5ec', '#dcd9cd'), lw);
  // 尾巴
  c.beginPath();
  c.moveTo(-0.18, hipY + 0.2);
  c.quadraticCurveTo(-0.30, hipY + 0.26 + Math.sin(R.ph) * 0.03, -0.34, hipY + 0.14);
  c.quadraticCurveTo(-0.26, hipY + 0.16, -0.18, hipY + 0.2);
  c.closePath();
  PEN.shape(c, '#e8e5d8', lw * 0.8);
  // 脖子
  const neckX = R.sway * 0.4;
  PEN.cap(c, 0, hipY + 0.24, neckX, 0.80, 0.085);
  PEN.shape(c, PEN.cyl(c, 0, hipY + 0.24, neckX, 0.80, 0.085, '#ffffff', '#f7f5ec', '#dcd9cd'), lw);
  // 头
  const hR = 0.125, hY = 0.885;
  PEN.ell(c, neckX, hY, hR * 1.02, hR * 0.92);
  PEN.shape(c, PEN.ball(c, neckX, hY, hR, '#ffffff', '#f7f5ec', '#dcd9cd'), lw);
  // 喙
  c.save();
  c.translate(neckX, hY - hR * 0.12);
  c.rotate(front ? Math.PI : 0);
  c.beginPath();
  c.moveTo(0, 0.03); c.quadraticCurveTo(0.14, 0.02, 0.15, -0.02);
  c.quadraticCurveTo(0.06, -0.06, 0, -0.03);
  c.closePath();
  PEN.shape(c, PEN.ball(c, 0.07, 0, 0.08, '#ffc46b', '#ff9d1e', '#d97d0c'), lw);
  c.restore();
  // 眼睛
  const ex = front ? 0.045 : -0.03;
  PEN.circle(c, neckX + ex, hY + 0.045, 0.023);
  PEN.shape(c, '#20232a', 0.008);
  PEN.circle(c, neckX + ex + 0.008, hY + 0.055, 0.008);
  PEN.shape(c, 'rgba(255,255,255,.9)', 0);
  if (front) { PEN.circle(c, neckX - 0.045, hY + 0.04, 0.021); PEN.shape(c, '#20232a', 0.007); }
  // 额头的红色突起（鹅脾气）
  PEN.ell(c, neckX + (front ? -0.03 : 0.03), hY + 0.095, 0.028, 0.02);
  PEN.shape(c, '#e6423c', 0.009);
  // 腮红
  if (front) {
    c.globalAlpha = 0.3; c.fillStyle = '#ff8f7a';
    c.beginPath(); c.arc(neckX - 0.07, hY - 0.03, 0.022, 0, 6.29); c.fill();
    c.beginPath(); c.arc(neckX + 0.07, hY - 0.03, 0.022, 0, 6.29); c.fill();
    c.globalAlpha = 1;
  }
  c.restore();
};

/* ---------- 10. 赛博奶蛙 ---------- */
CHARDRAW.cybernaiwa = function (c, pose) {
  const R = CharArt.rig(pose, { hipY: 0.32, shoulderY: 0.575, headR: 0.20, shoulderW: 0.095, hipW: 0.072, leg: 0.32, neck: 0.012 });
  const front = R.front, lw = 0.014;
  const metal = PEN.pal('#565d6b');
  const metalD = PEN.pal('#3a404b');
  const neon = '#26e9ff', neon2 = '#ff3ec8';
  const hy = R.P.headY, hr = R.P.headR;
  const hipY = R.P.hipY, shY = R.P.shoulderY;

  c.save();
  if (R.tuck) { c.translate(0, 0.40); c.rotate(R.rot); c.translate(0, -0.40); }
  c.translate(R.sway + R.lean * 0.03, R.bob - R.squash * 0.05);

  const glow = (x, y, r, col) => {
    const g = c.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, col); g.addColorStop(1, 'rgba(0,0,0,0)');
    c.globalAlpha = 0.75; c.fillStyle = g; c.beginPath(); c.arc(x, y, r, 0, 6.283); c.fill(); c.globalAlpha = 1;
  };

  const drawLeg = (L, back) => {
    const col = back ? metalD : metal;
    PEN.cap(c, L.hipX, hipY, L.kneeX, L.kneeY, 0.10);
    PEN.shape(c, PEN.cyl(c, L.hipX, hipY, L.kneeX, L.kneeY, 0.10, col.light, col.base, col.dark), lw);
    PEN.cap(c, L.kneeX, L.kneeY, L.ankleX, L.ankleY + 0.02, 0.082);
    PEN.shape(c, PEN.cyl(c, L.kneeX, L.kneeY, L.ankleX, L.ankleY, 0.082, col.light, col.base, col.dark), lw);
    // 霓虹关节
    PEN.circle(c, L.kneeX, L.kneeY, 0.026);
    c.fillStyle = neon; c.fill();
    c.save(); c.translate(L.ankleX, Math.max(0.03, L.ankleY));
    PEN.ell(c, 0, 0, 0.082, 0.04);
    PEN.shape(c, '#2c303a', lw * 0.9);
    c.fillStyle = neon; c.globalAlpha = 0.85;
    PEN.rr(c, -0.055, -0.008, 0.11, 0.016, 0.008); c.fill();
    c.globalAlpha = 1;
    c.restore();
    glow(L.kneeX, L.kneeY, 0.07, 'rgba(38,233,255,.55)');
  };
  const drawArm = (A, back) => {
    const col = back ? metalD : metal;
    const midX = A.shX + (A.elbX - A.shX) * 0.55, midY = A.shY + (A.elbY - A.shY) * 0.55;
    PEN.cap(c, A.shX, A.shY, midX, midY, 0.076);
    PEN.shape(c, PEN.cyl(c, A.shX, A.shY, midX, midY, 0.076, col.light, col.base, col.dark), lw);
    PEN.cap(c, midX, midY, A.elbX, A.elbY, 0.066);
    PEN.shape(c, PEN.cyl(c, midX, midY, A.elbX, A.elbY, 0.066, col.light, col.base, col.dark), lw);
    PEN.cap(c, A.elbX, A.elbY, A.handX, A.handY, 0.06);
    PEN.shape(c, PEN.cyl(c, A.elbX, A.elbY, A.handX, A.handY, 0.06, col.light, col.base, col.dark), lw);
    PEN.circle(c, A.handX, A.handY, 0.042);
    PEN.shape(c, neon2, 0.01);
    glow(A.handX, A.handY, 0.075, 'rgba(255,62,200,.5)');
  };

  drawLeg(R.legs[0], true); drawArm(R.arms[0], true);
  c.save(); c.translate(0, hipY); c.rotate(R.twist); c.translate(0, -hipY);
  // 身体（装甲）
  c.beginPath();
  c.moveTo(-0.145, shY + 0.05);
  c.bezierCurveTo(-0.30, shY - 0.03, -0.29, hipY + 0.02, -0.165, hipY - 0.06);
  c.quadraticCurveTo(0, hipY - 0.10, 0.165, hipY - 0.06);
  c.bezierCurveTo(0.29, hipY + 0.02, 0.30, shY - 0.03, 0.145, shY + 0.05);
  c.quadraticCurveTo(0, shY + 0.10, -0.145, shY + 0.05);
  c.closePath();
  PEN.shape(c, PEN.vertical(c, 0, shY + 0.05, shY - hipY + 0.1, '#6c7484', '#4a505c', '#2c303a'), lw);
  // 胸口能量核心
  PEN.circle(c, 0, hipY + 0.09, 0.055);
  PEN.shape(c, '#1b1f27', 0.012);
  glow(0, hipY + 0.09, 0.14, 'rgba(38,233,255,.75)');
  PEN.circle(c, 0, hipY + 0.09, 0.032);
  c.fillStyle = neon; c.fill();
  // 腹部霓虹线
  c.strokeStyle = neon2; c.lineWidth = 0.012;
  c.beginPath(); c.moveTo(-0.1, hipY - 0.02); c.lineTo(0.1, hipY - 0.02); c.stroke();
  // 头（机械）
  const headY = hy + 0.015;
  PEN.circle(c, 0, headY, hr);
  PEN.shape(c, PEN.ball(c, 0, headY, hr, '#7d8695', '#565d6b', '#333844'), lw);
  // 面罩
  c.beginPath();
  c.moveTo(-hr * 0.86, headY - hr * 0.02);
  c.quadraticCurveTo(0, headY - hr * 0.55, hr * 0.86, headY - hr * 0.02);
  c.quadraticCurveTo(0, headY + hr * 0.3, -hr * 0.86, headY - hr * 0.02);
  c.closePath();
  PEN.shape(c, '#14181f', 0.012);
  // 面罩上的奶蛙大嘴（霓虹）
  c.strokeStyle = neon; c.lineWidth = 0.013;
  c.beginPath();
  if (front) {
    c.moveTo(-hr * 0.5, headY - hr * 0.14);
    c.quadraticCurveTo(0, headY - hr * 0.72, hr * 0.5, headY - hr * 0.14);
  } else {
    c.moveTo(-hr * 0.52, headY - hr * 0.1);
    c.quadraticCurveTo(-hr * 0.72, headY + hr * 0.22, -hr * 0.42, headY + hr * 0.3);
    c.moveTo(hr * 0.52, headY - hr * 0.1);
    c.quadraticCurveTo(hr * 0.72, headY + hr * 0.22, hr * 0.42, headY + hr * 0.3);
  }
  c.stroke();
  // 顶部发光眼
  const ex = hr * 0.5, eyeY = headY + hr * 0.58;
  for (const sgn of [-1, 1]) {
    PEN.circle(c, sgn * ex, eyeY, hr * 0.38);
    PEN.shape(c, PEN.ball(c, sgn * ex, eyeY, hr * 0.38, '#8a93a3', '#4d5462', '#2b303a'), lw * 0.9);
    PEN.circle(c, sgn * ex + (front ? -sgn * hr * 0.04 : 0), eyeY + 0.004, hr * 0.26);
    PEN.shape(c, '#0d1014', 0.008);
    PEN.circle(c, sgn * ex + (front ? -sgn * hr * 0.04 : 0), eyeY + 0.004, hr * 0.13);
    c.fillStyle = neon; c.fill();
    glow(sgn * ex, eyeY, hr * 0.55, 'rgba(38,233,255,.55)');
  }
  // 天线
  c.strokeStyle = neon2; c.lineWidth = 0.012;
  c.beginPath(); c.moveTo(hr * 0.5, headY + hr * 0.9); c.lineTo(hr * 0.75, headY + hr * 1.35); c.stroke();
  PEN.circle(c, hr * 0.75, headY + hr * 1.38, 0.018);
  PEN.shape(c, neon2, 0.008);
  c.restore();

  drawLeg(R.legs[1], false); drawArm(R.arms[1], false);
  c.restore();
};

/* ---------- 11. 检票员（追逐者） ---------- */
CHARDRAW.inspector = makeHuman({
  cloth: PEN.pal('#2c3e6b'), sleeve: PEN.pal('#2c3e6b'),
  pants: PEN.pal('#243258'), skin: PEN.pal('#e7b78c'),
  shoe: PEN.pal('#1a1a1f'), shoeSole: '#4a4a52',
  brow: '#33291f', mouthType: 'straight',
  clothDetail(c, R, bw, hw) {
    const shY = R.P.shoulderY, hipY = R.P.hipY;
    // 制服：双排扣 + 肩章 + 腰带
    c.strokeStyle = '#e6c34a'; c.lineWidth = 0.011;
    c.beginPath(); c.moveTo(-bw * 0.28, shY + 0.02); c.lineTo(-bw * 0.2, hipY - 0.02); c.stroke();
    for (let i = 0; i < 3; i++) {
      for (const sgn of [-1, 1]) {
        PEN.circle(c, sgn * bw * 0.26, shY - 0.05 - i * 0.085, 0.012);
        PEN.shape(c, '#e6c34a', 0.006);
      }
    }
    // 肩章
    PEN.rr(c, -bw * 1.0, shY + 0.005, bw * 0.5, 0.032, 0.012);
    PEN.shape(c, '#e6c34a', 0.009);
    PEN.rr(c, bw * 0.5, shY + 0.005, bw * 0.5, 0.032, 0.012);
    PEN.shape(c, '#e6c34a', 0.009);
    // 腰带
    PEN.rr(c, -hw * 1.04, hipY + 0.07, hw * 2.08, 0.045, 0.012);
    PEN.shape(c, '#1b1b20', 0.01);
    PEN.rr(c, -0.028, hipY + 0.074, 0.056, 0.038, 0.008);
    PEN.shape(c, '#c9a24b', 0.009);
  },
  hair(c, x, y, r, front) {
    c.fillStyle = '#243258';
    PEN.circle(c, x, y + r * 0.5, r * 1.08); c.fill();
    c.strokeStyle = PEN.line; c.lineWidth = 0.011; c.stroke();
    // 大盖帽
    PEN.rr(c, x - r * 1.24, y + r * 0.74, r * 2.48, r * 0.3, r * 0.12);
    c.fillStyle = '#1b2540'; c.fill(); c.strokeStyle = PEN.line; c.stroke();
    c.beginPath();
    c.moveTo(x - r * 0.9, y + r * 0.78); c.quadraticCurveTo(x, y + r * 1.5, x + r * 0.9, y + r * 0.78);
    c.closePath();
    c.fillStyle = '#243258'; c.fill(); c.strokeStyle = PEN.line; c.stroke();
    // 帽徽
    PEN.circle(c, x, y + r * 0.98, r * 0.13);
    PEN.shape(c, '#e6c34a', 0.008);
    // 帽檐
    PEN.rr(c, x - r * 1.0, y + r * 0.6, r * 2.0, r * 0.2, r * 0.08);
    c.fillStyle = '#141a30'; c.fill(); c.strokeStyle = PEN.line; c.stroke();
  },
  face(c, x, y, r) {
    CharArt.face(c, x, y, r, { skin: PEN.pal('#e7b78c'), brow: '#33291f', mouthType: 'straight', nose: false }, null);
    // 小胡子
    c.fillStyle = '#3a2a20';
    PEN.rr(c, x - r * 0.42, y - r * 0.3, r * 0.84, r * 0.12, r * 0.05); c.fill();
  },
  prop(c, A) {
    // 检票钳
    c.save(); c.translate(A.handX, A.handY); c.rotate(-0.4);
    PEN.rr(c, -0.03, 0.01, 0.06, 0.1, 0.014);
    PEN.shape(c, '#c0392b', 0.01);
    PEN.rr(c, -0.02, 0.09, 0.04, 0.07, 0.008);
    PEN.shape(c, '#9aa1a8', 0.01);
    c.restore();
  },
}, PROP.human);

/* ---------- 12. 狗（追逐者） ---------- */
CHARDRAW.dog = function (c, pose) {
  const R = CharArt.rig(pose, { hipY: 0.30, shoulderY: 0.5, headR: 0.1, shoulderW: 0.08, hipW: 0.06, leg: 0.3 });
  const line = PEN.line, lw = 0.012;
  const fur = PEN.pal('#c08a45'), furD = PEN.pal('#8f6129'), belly = '#efd6ae';
  c.save();
  if (R.tuck) { c.translate(0, 0.34); c.rotate(R.rot); c.translate(0, -0.34); }
  c.translate(R.sway * 1.4 + R.lean * 0.04, R.bob * 1.5);

  const hipY = 0.30;
  // 四条腿
  const legSets = [
    { x: -0.155, lift: R.legs[0].lift },
    { x: -0.075, lift: R.legs[1].lift },
    { x: 0.075, lift: R.legs[0].lift },
    { x: 0.155, lift: R.legs[1].lift },
  ];
  for (const L of legSets) {
    const footY = 0.02 + L.lift * 0.16;
    PEN.cap(c, L.x, hipY + 0.02, L.x + (L.x < 0 ? -0.012 : 0.012), footY, 0.046);
    PEN.shape(c, PEN.cyl(c, L.x, hipY, L.x, footY, 0.046, furD.light, furD.base, furD.dark), lw * 0.85);
    PEN.ell(c, L.x + (L.x < 0 ? -0.012 : 0.012), footY - 0.005, 0.038, 0.02);
    PEN.shape(c, '#e2c79c', 0.009);
  }
  // 身体
  PEN.ell(c, 0, hipY + 0.08, 0.24, 0.15);
  PEN.shape(c, PEN.ball(c, 0, hipY + 0.08, 0.2, fur.light, fur.base, fur.dark), lw);
  PEN.ell(c, 0, hipY - 0.02, 0.185, 0.06);
  PEN.shape(c, belly, 0.008);
  // 尾巴
  c.save();
  c.translate(-0.22, hipY + 0.1);
  c.rotate(0.5 + Math.sin(R.ph * 2) * 0.4);
  c.beginPath();
  c.moveTo(0, 0.02); c.quadraticCurveTo(-0.06, 0.12, -0.02, 0.22);
  c.quadraticCurveTo(0.04, 0.12, 0.03, 0.02);
  c.closePath();
  PEN.shape(c, furD.base, 0.011);
  c.restore();
  // 头
  const hx = 0.235, hY = hipY + 0.22;
  PEN.circle(c, hx, hY, 0.115);
  PEN.shape(c, PEN.ball(c, hx, hY, 0.11, fur.light, fur.base, fur.dark), lw);
  // 吻部
  PEN.ell(c, hx + 0.09, hY - 0.03, 0.075, 0.055);
  PEN.shape(c, '#e8cfa8', lw * 0.9);
  PEN.ell(c, hx + 0.145, hY - 0.035, 0.028, 0.022);
  PEN.shape(c, '#2b2521', 0.009);
  // 耳朵
  for (const sgn of [1, -1]) {
    c.save();
    c.translate(hx + sgn * 0.045, hY + 0.08);
    c.rotate(sgn * 0.35);
    PEN.ell(c, 0, 0, 0.04, 0.062);
    PEN.shape(c, furD.base, 0.011);
    c.restore();
  }
  // 眼睛 + 鼻子
  PEN.circle(c, hx + 0.03, hY + 0.03, 0.022);
  PEN.shape(c, '#20232a', 0.008);
  PEN.circle(c, hx + 0.036, hY + 0.038, 0.008);
  PEN.shape(c, 'rgba(255,255,255,.9)', 0);
  PEN.circle(c, hx + 0.15, hY - 0.02, 0.026);
  PEN.shape(c, '#2b2521', 0.008);
  // 舌头
  PEN.rr(c, hx + 0.105, hY - 0.075, 0.05, 0.06, 0.02);
  PEN.shape(c, '#ff8b8b', 0.009);
  // 项圈
  PEN.rr(c, hx - 0.06, hY - 0.1, 0.1, 0.03, 0.012);
  PEN.shape(c, '#e6423c', 0.009);
  c.restore();
};
