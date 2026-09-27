/* =========================================================
   奶蛙跑酷 · 真 3D 角色模型（程序化三维建模）
   —— 用立方体/圆柱/圆锥拼装角色，带关节动画（跑/跳/滑铲/翻滚/飞天）
   —— 不依赖任何外部模型文件，接入自研 WebGL 引擎
   ========================================================= */
'use strict';

/* 列主序 TRS 矩阵（位移 · 旋转XYZ · 缩放） */
function mTRS(px, py, pz, rx, ry, rz, sx, sy, sz) {
  const cx = Math.cos(rx || 0), sxr = Math.sin(rx || 0);
  const cy = Math.cos(ry || 0), syr = Math.sin(ry || 0);
  const cz = Math.cos(rz || 0), szr = Math.sin(rz || 0);
  sx = sx == null ? 1 : sx; sy = sy == null ? 1 : sy; sz = sz == null ? 1 : sz;
  // R = Rz * Ry * Rx
  const m00 = cz * cy, m01 = cz * syr * sxr - szr * cx, m02 = cz * syr * cx + szr * sxr;
  const m10 = szr * cy, m11 = szr * syr * sxr + cz * cx, m12 = szr * syr * cx - cz * sxr;
  const m20 = -syr, m21 = cy * sxr, m22 = cy * cx;
  return new Float32Array([
    m00 * sx, m10 * sx, m20 * sx, 0,
    m01 * sy, m11 * sy, m21 * sy, 0,
    m02 * sz, m12 * sz, m22 * sz, 0,
    px, py, pz, 1,
  ]);
}

/* 色相旋转（服装染色用） */
function hueRotate(rgb, deg) {
  if (!deg) return rgb;
  const a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  const m = [
    0.213 + c * 0.787 - s * 0.213, 0.715 - c * 0.715 - s * 0.715, 0.072 - c * 0.072 + s * 0.928,
    0.213 - c * 0.213 + s * 0.143, 0.715 + c * 0.285 + s * 0.140, 0.072 - c * 0.072 - s * 0.283,
    0.213 - c * 0.213 - s * 0.787, 0.715 - c * 0.715 + s * 0.715, 0.072 + c * 0.928 + s * 0.072,
  ];
  const r = rgb[0] * m[0] + rgb[1] * m[1] + rgb[2] * m[2];
  const g = rgb[0] * m[3] + rgb[1] * m[4] + rgb[2] * m[5];
  const b = rgb[0] * m[6] + rgb[1] * m[7] + rgb[2] * m[8];
  return [Math.max(0, Math.min(1, r)), Math.max(0, Math.min(1, g)), Math.max(0, Math.min(1, b))];
}

const Chars3D = {
  cache: {},
  tintDeg: 0,

  /* ---------- 关节枢轴（单位身高 1.0，脚底 y=0） ---------- */
  PIVOT: {
    human: {
      body: [0, 0, 0], head: [0, 0.80, 0],
      armL: [-0.20, 0.71, 0], armR: [0.20, 0.71, 0],
      legL: [-0.10, 0.42, 0], legR: [0.10, 0.42, 0],
      tail: [0, 0.42, -0.14],
    },
    chibi: {                 // 奶蛙 / 奶龙 / 赛博奶蛙：短腿短手
      body: [0, 0, 0], head: [0, 0.62, 0],
      armL: [-0.23, 0.52, 0], armR: [0.23, 0.52, 0],
      legL: [-0.14, 0.30, 0], legR: [0.14, 0.30, 0],
      tail: [0, 0.30, -0.14],
    },
    bird: {                  // 鹅
      body: [0, 0, 0], head: [0, 0.62, 0],
      armL: [-0.26, 0.44, 0], armR: [0.26, 0.44, 0],
      legL: [-0.11, 0.16, 0], legR: [0.11, 0.16, 0],
      tail: [0, 0.30, -0.20],
    },
    quadruped: {             // 狗 / 牛
      body: [0, 0, 0], head: [0, 0.60, 0],
      armL: [-0.20, 0.55, 0], armR: [0.20, 0.55, 0],
      legL: [-0.12, 0.28, 0], legR: [0.12, 0.28, 0],
      tail: [0, 0.45, -0.30],
    },
    bull: {
      body: [0, 0, 0], head: [0, 0.72, 0],
      armL: [-0.22, 0.60, 0], armR: [0.22, 0.60, 0],
      legL: [-0.16, 0.40, 0], legR: [0.16, 0.40, 0],
      tail: [0, 0.60, -0.40],
    },
  },
  pivotsFor(skin) {
    if (skin === 'naiwa' || skin === 'nailong' || skin === 'cybernaiwa') return this.PIVOT.chibi;
    if (skin === 'goose') return this.PIVOT.bird;
    if (skin === 'dog') return this.PIVOT.quadruped;
    if (skin === 'bull') return this.PIVOT.bull;
    return this.PIVOT.human;
  },

  /* ---------- 建模辅助 ---------- */
  B(parts, grp, size, pos, color, rot, opt) {
    parts.push({ grp: grp, mesh: 'cube', size: size, pos: pos, color: color, rot: rot || [0, 0, 0], opt: opt || null });
  },
  C(parts, grp, size, pos, color, rot, opt) {
    parts.push({ grp: grp, mesh: 'cyl', size: size, pos: pos, color: color, rot: rot || [0, 0, 0], opt: opt || null });
  },
  K(parts, grp, size, pos, color, rot, opt) {
    parts.push({ grp: grp, mesh: 'cone', size: size, pos: pos, color: color, rot: rot || [0, 0, 0], opt: opt || null });
  },

  /* ---------- 人形基础模型 ---------- */
  human(o) {
    const c = o.col, p = [];
    const legW = o.legW || 0.115, armW = o.armW || 0.105;
    // 腿 + 鞋
    for (const s of [-1, 1]) {
      const g = s < 0 ? 'legL' : 'legR';
      this.C(p, g, [legW, 0.40, legW], [s * 0.10, -0.20, 0], c.pants);
      this.B(p, g, [legW * 1.35, 0.075, 0.22], [s * 0.10, -0.42, 0.03], c.shoe);
    }
    // 躯干
    this.B(p, 'body', [o.bodyW || 0.34, o.bodyH || 0.38, o.bodyD || 0.21], [0, 0.57, 0], c.cloth);
    this.B(p, 'body', [0.30, 0.11, 0.20], [0, 0.365, 0], c.pants);
    if (o.belt) this.B(p, 'body', [0.35, 0.06, 0.22], [0, 0.44, 0], o.belt);
    // 手臂 + 手
    for (const s of [-1, 1]) {
      const g = s < 0 ? 'armL' : 'armR';
      this.C(p, g, [armW, 0.34, armW], [s * 0.21, -0.17, 0], c.sleeve || c.cloth);
      this.B(p, g, [0.105, 0.10, 0.105], [s * 0.21, -0.35, 0], c.skin);
    }
    // 头 + 五官
    const hr = o.headR || 0.135;
    this.B(p, 'head', [hr * 2, hr * 2.05, hr * 1.85], [0, 0.86, 0], c.skin);
    if (o.hair) {
      this.B(p, 'head', [hr * 2.1, hr * 0.75, hr * 1.95], [0, 0.86 + hr * 0.72, -0.005], c.hair);
      if (o.hairBack) this.B(p, 'head', [hr * 1.9, hr * 1.3, hr * 0.5], [0, 0.86 - hr * 0.25, -hr * 0.85], c.hair);
      if (o.bangs) this.B(p, 'head', [hr * 2.05, hr * 0.5, hr * 0.35], [0, 0.86 + hr * 0.42, hr * 0.9], c.hair);
    }
    for (const s of [-1, 1]) {
      this.B(p, 'head', [0.045, 0.05, 0.02], [s * hr * 0.42, 0.865, hr * 0.93], o.eye || '#23272e');
      if (o.brow) this.B(p, 'head', [0.05, 0.016, 0.02], [s * hr * 0.42, 0.90, hr * 0.94], o.brow);
    }
    // 嘴
    this.B(p, 'head', [0.055, 0.02, 0.02], [0, 0.83, hr * 0.94], o.mouth || '#8a4038');
    if (o.blush) for (const s of [-1, 1]) this.B(p, 'head', [0.04, 0.028, 0.02], [s * hr * 0.72, 0.845, hr * 0.85], o.blush);
    return p;
  },

  /* ---------- 各角色模型 ---------- */
  build(skin) {
    const p = [];
    switch (skin) {
      /* —— 奶蛙：梨形身体 + 绿色大眼睛 + 细四肢 —— */
      case 'naiwa': {
        const Y = '#ffd84a', YD = '#e8b81c', CREAM = '#fff8d8', DARK = '#3a3f46';
        this.C(p, 'body', [0.42, 0.40, 0.40], [0, 0.42, 0], Y);          // 梨形身体（上窄）
        this.C(p, 'body', [0.50, 0.36, 0.50], [0, 0.26, 0], Y);          // 下腹更宽
        this.B(p, 'body', [0.30, 0.30, 0.05], [0, 0.33, 0.235], CREAM);  // 乳白肚皮
        for (const s of [-1, 1]) {                                        // 细腿
          const g = s < 0 ? 'legL' : 'legR';
          this.C(p, g, [0.085, 0.22, 0.085], [s * 0.14, -0.11, 0], YD);
          this.B(p, g, [0.20, 0.07, 0.28], [s * 0.14, -0.235, 0.03], YD);
        }
        for (const s of [-1, 1]) {                                        // 细手臂
          const g = s < 0 ? 'armL' : 'armR';
          this.C(p, g, [0.075, 0.26, 0.075], [s * 0.235, -0.13, 0], YD);
          this.B(p, g, [0.13, 0.09, 0.13], [s * 0.235, -0.28, 0], DARK);
        }
        this.B(p, 'head', [0.44, 0.42, 0.40], [0, 0.84, 0], Y);           // 巨头
        for (const s of [-1, 1]) {                                        // 鼓出的绿眼
          this.B(p, 'head', [0.17, 0.17, 0.13], [s * 0.115, 0.94, 0.145], '#f4f7f2');
          this.B(p, 'head', [0.085, 0.095, 0.04], [s * 0.115, 0.935, 0.215], '#2f6b3a');
          this.B(p, 'head', [0.035, 0.04, 0.02], [s * 0.115, 0.95, 0.238], '#101418');
        }
        this.B(p, 'head', [0.19, 0.028, 0.03], [0, 0.775, 0.20], '#5b4a2a');   // 一字嘴
        this.B(p, 'head', [0.06, 0.012, 0.02], [0, 0.86, 0.21], '#c9a24a');
        this.B(p, 'head', [0.40, 0.09, 0.34], [0, 1.03, 0.03], Y);             // 头顶鼓包（背视也认得出）
        break;
      }
      /* —— 奶龙：黄色小恐龙 + 角 + 小翅膀 —— */
      case 'nailong': {
        const Y = '#ffd84a', O = '#ff9f43', CREAM = '#fff8d8';
        this.C(p, 'body', [0.44, 0.42, 0.42], [0, 0.41, 0], Y);
        this.B(p, 'body', [0.32, 0.30, 0.05], [0, 0.36, 0.245], CREAM);
        for (const s of [-1, 1]) {
          const g = s < 0 ? 'legL' : 'legR';
          this.C(p, g, [0.11, 0.20, 0.11], [s * 0.15, -0.10, 0], Y);
          this.B(p, g, [0.19, 0.07, 0.24], [s * 0.15, -0.215, 0.02], O);
        }
        for (const s of [-1, 1]) {
          const g = s < 0 ? 'armL' : 'armR';
          this.C(p, g, [0.09, 0.24, 0.09], [s * 0.245, -0.12, 0], Y);
        }
        // 小翅膀
        for (const s of [-1, 1]) {
          this.B(p, 'body', [0.05, 0.22, 0.20], [s * 0.23, 0.60, -0.14], O, [0, 0, s * -0.5]);
        }
        this.B(p, 'head', [0.46, 0.44, 0.42], [0, 0.83, 0], Y);
        for (const s of [-1, 1]) {                                     // 小角
          this.K(p, 'head', [0.10, 0.16, 0.10], [s * 0.15, 1.07, -0.02], O, [0.2, 0, s * 0.35]);
        }
        for (const s of [-1, 1]) {                                     // 大眼睛
          this.B(p, 'head', [0.16, 0.18, 0.06], [s * 0.115, 0.875, 0.205], '#f4f7f2');
          this.B(p, 'head', [0.09, 0.11, 0.03], [s * 0.115, 0.87, 0.235], '#2f6b3a');
          this.B(p, 'head', [0.035, 0.04, 0.02], [s * 0.115, 0.885, 0.25], '#101418');
        }
        this.B(p, 'head', [0.16, 0.035, 0.03], [0, 0.775, 0.21], '#8a4038');
        this.B(p, 'head', [0.40, 0.10, 0.34], [0, 1.02, 0.02], Y);
        break;
      }
      /* —— 东北雨姐：花棉袄 + 小辫 + 大铁勺 —— */
      case 'yujie': {
        const RED = '#d8352b', RED_D = '#a8241c', PANTS = '#2f3542', SKIN = '#f2c9a0';
        this.human({
          col: { cloth: RED, pants: PANTS, shoe: '#1d2027', skin: SKIN, hair: '#1c1a18' },
          bodyW: 0.40, bodyH: 0.40, headR: 0.145, hair: '#1c1a18', hairBack: true, bangs: true,
          mouth: '#a04438', blush: '#e08a80',
        }).forEach(x => p.push(x));
        // 棉袄上的碎花与盘扣
        for (let i = 0; i < 5; i++) {
          this.B(p, 'body', [0.045, 0.045, 0.02], [-0.11 + (i % 3) * 0.11, 0.50 + Math.floor(i / 3) * 0.11, 0.11], '#f5e07a');
        }
        for (let i = 0; i < 3; i++) this.B(p, 'body', [0.03, 0.03, 0.02], [0, 0.68 - i * 0.10, 0.115], '#f2d06a');
        // 小辫（背后）
        this.C(p, 'head', [0.07, 0.26, 0.07], [0, 0.68, -0.16], '#1c1a18', [0.35, 0, 0]);
        this.B(p, 'head', [0.09, 0.09, 0.09], [0, 0.55, -0.185], '#1c1a18');
        // 大铁勺（右手）
        this.C(p, 'armR', [0.035, 0.55, 0.035], [0.21, -0.42, 0.06], '#b9bec7', [0.15, 0, 0]);
        this.B(p, 'armR', [0.18, 0.10, 0.14], [0.21, -0.72, 0.10], '#cfd4dc');
        break;
      }
      /* —— 疯狂小杨哥：白卫衣 + 麦克风 —— */
      case 'xiaoyang': {
        const W = '#f7f8fa', SKIN = '#f6d3ad';
        this.human({
          col: { cloth: W, pants: '#2b3140', shoe: '#e8e9ec', skin: SKIN, hair: '#141414' },
          headR: 0.135, hair: '#141414', bangs: true, mouth: '#8a4038',
        }).forEach(x => p.push(x));
        this.B(p, 'body', [0.22, 0.14, 0.06], [0, 0.50, 0.115], '#e8eaee');     // 卫衣口袋
        this.B(p, 'head', [0.30, 0.16, 0.16], [0, 0.70, -0.13], W);             // 兜帽
        this.C(p, 'armR', [0.04, 0.20, 0.04], [0.23, -0.45, 0.05], '#2b303a');  // 麦克风
        this.B(p, 'armR', [0.10, 0.10, 0.10], [0.23, -0.56, 0.05], '#3a4048');
        break;
      }
      /* —— 张同学：军绿棉服 + 护耳棉帽 + 斜挎包 —— */
      case 'zhangtongxue': {
        const G = '#4a5a3c', SKIN = '#ecc79f';
        this.human({
          col: { cloth: G, pants: '#2e3340', shoe: '#2a2a2a', skin: SKIN, hair: '#191919' },
          bodyW: 0.38, headR: 0.145, mouth: '#8a4038', blush: '#d98f86',
        }).forEach(x => p.push(x));
        this.B(p, 'head', [0.32, 0.14, 0.30], [0, 1.00, 0], '#3b4630');          // 棉帽
        for (const s of [-1, 1]) this.B(p, 'head', [0.08, 0.20, 0.20], [s * 0.17, 0.86, -0.02], '#3b4630');
        this.B(p, 'body', [0.26, 0.22, 0.12], [-0.19, 0.50, -0.02], '#5c5340', [0, 0.2, 0]);  // 斜挎包
        this.B(p, 'body', [0.05, 0.34, 0.03], [-0.05, 0.60, 0.115], '#6b6047', [0, 0, 0.5]);
        break;
      }
      /* —— 李子柒：汉服 + 盘发 + 竹篮 —— */
      case 'liziqi': {
        const W = '#f4f6f8', RED = '#c8463c', SKIN = '#f7d7b6';
        this.human({
          col: { cloth: W, pants: '#eef1f4', shoe: '#8a6a4a', skin: SKIN, hair: '#161616' },
          bodyW: 0.30, headR: 0.128, hair: '#161616', hairBack: true, bangs: true, mouth: '#b05a58',
          blush: '#eaa6a0', belt: RED,
        }).forEach(x => p.push(x));
        this.B(p, 'body', [0.32, 0.42, 0.22], [0, 0.36, 0], W);                  // 裙摆
        this.B(p, 'head', [0.22, 0.10, 0.22], [0, 1.02, 0], '#161616');          // 发髻
        this.C(p, 'head', [0.03, 0.14, 0.03], [0.10, 1.06, 0], '#c9a24a', [0, 0, 0.5]);  // 发簪
        this.C(p, 'armL', [0.20, 0.12, 0.20], [0.21, -0.44, 0.06], '#c8a45c');   // 竹篮
        break;
      }
      /* —— 刘教练：运动背心 + 发带 + 哑铃 —— */
      case 'liugenhong': {
        const B = '#3f7fd9', SKIN = '#e8b184';
        this.human({
          col: { cloth: B, pants: '#2b3140', shoe: '#f0f1f3', skin: SKIN, hair: '#1a1a1a' },
          bodyW: 0.40, headR: 0.132, hair: '#1a1a1a', mouth: '#8a4038',
        }).forEach(x => p.push(x));
        this.B(p, 'head', [0.29, 0.055, 0.25], [0, 0.945, 0], '#e6423c');        // 发带
        for (const s of [-1, 1]) {                                               // 哑铃
          this.C(p, 'arm' + (s < 0 ? 'L' : 'R'), [0.035, 0.16, 0.035], [s * 0.21, -0.44, 0.02], '#5a6068');
          for (const d of [-1, 1]) this.B(p, 'arm' + (s < 0 ? 'L' : 'R'), [0.10, 0.10, 0.10], [s * 0.21, -0.44, 0.02 + d * 0.09], '#33383f');
        }
        break;
      }
      /* —— 董老师：衬衫马甲 + 眼镜 + 书 —— */
      case 'donglaoshi': {
        const SKIN = '#f3d2ac';
        this.human({
          col: { cloth: '#f2f3f5', sleeve: '#f2f3f5', pants: '#2f3542', shoe: '#22262c', skin: SKIN, hair: '#1b1b1b' },
          bodyW: 0.33, headR: 0.132, hair: '#1b1b1b', bangs: true, mouth: '#8a4038',
        }).forEach(x => p.push(x));
        this.B(p, 'body', [0.30, 0.34, 0.22], [0, 0.58, 0], '#2b3140');          // 马甲
        this.B(p, 'body', [0.10, 0.30, 0.03], [0, 0.58, 0.115], '#f2f3f5');
        for (const s of [-1, 1]) {                                               // 黑框眼镜
          this.B(p, 'head', [0.075, 0.055, 0.02], [s * 0.062, 0.868, 0.128], '#1f232a');
          this.B(p, 'head', [0.055, 0.04, 0.015], [s * 0.062, 0.868, 0.132], '#cfe3f5');
        }
        this.B(p, 'head', [0.03, 0.012, 0.02], [0, 0.868, 0.13], '#1f232a');
        this.B(p, 'armL', [0.16, 0.20, 0.05], [0.21, -0.44, 0.05], '#c8463c');   // 书
        break;
      }
      /* —— 雨姐的鹅：白鹅，长脖子，橙喙 —— */
      case 'goose': {
        const W = '#f7f8fa', O = '#f5a623';
        this.C(p, 'body', [0.46, 0.42, 0.52], [0, 0.34, -0.02], W);
        for (const s of [-1, 1]) {                                               // 橙脚
          const g = s < 0 ? 'legL' : 'legR';
          this.C(p, g, [0.07, 0.16, 0.07], [s * 0.11, -0.08, 0], O);
          this.B(p, g, [0.14, 0.045, 0.20], [s * 0.11, -0.17, 0.05], O);
        }
        for (const s of [-1, 1]) {                                               // 张开的翅膀
          const g = s < 0 ? 'armL' : 'armR';
          this.B(p, g, [0.10, 0.30, 0.36], [s * 0.26, 0.44, -0.04], W, [0, 0, s * -0.45]);
        }
        this.C(p, 'head', [0.135, 0.34, 0.135], [0, 0.62, 0.06], W, [-0.25, 0, 0]);  // 长脖子
        this.B(p, 'head', [0.24, 0.22, 0.26], [0, 0.80, 0.08], W);                    // 头
        this.K(p, 'head', [0.10, 0.20, 0.10], [0, 0.80, 0.24], O, [Math.PI / 2, 0, 0]); // 喙
        this.B(p, 'head', [0.05, 0.05, 0.03], [0, 0.855, 0.20], '#e6423c');           // 红额
        for (const s of [-1, 1]) this.B(p, 'head', [0.045, 0.05, 0.02], [s * 0.07, 0.83, 0.20], '#171a1f');
        break;
      }
      /* —— 赛博奶蛙：金属身体 + 霓虹核心 —— */
      case 'cybernaiwa': {
        const M = '#5a626e', MD = '#3a414c', CY = '#2ee6d6';
        this.C(p, 'body', [0.44, 0.40, 0.42], [0, 0.42, 0], M);
        this.C(p, 'body', [0.52, 0.34, 0.50], [0, 0.26, 0], MD);
        for (const s of [-1, 1]) {
          const g = s < 0 ? 'legL' : 'legR';
          this.C(p, g, [0.10, 0.22, 0.10], [s * 0.15, -0.11, 0], MD);
          this.B(p, g, [0.20, 0.07, 0.26], [s * 0.15, -0.235, 0.02], MD);
        }
        for (const s of [-1, 1]) {
          const g = s < 0 ? 'armL' : 'armR';
          this.C(p, g, [0.085, 0.26, 0.085], [s * 0.24, -0.13, 0], M);
        }
        this.B(p, 'body', [0.20, 0.20, 0.05], [0, 0.42, 0.23], CY, null, { unlit: true });   // 能量核心
        this.B(p, 'body', [0.40, 0.03, 0.03], [0, 0.60, 0.20], '#ff3ec8', null, { unlit: true });
        this.B(p, 'head', [0.46, 0.42, 0.42], [0, 0.84, 0], M);
        for (const s of [-1, 1]) {
          this.B(p, 'head', [0.17, 0.13, 0.06], [s * 0.115, 0.90, 0.20], CY, null, { unlit: true });
        }
        this.B(p, 'head', [0.30, 0.05, 0.03], [0, 0.79, 0.21], CY, null, { unlit: true });
        this.B(p, 'head', [0.42, 0.09, 0.34], [0, 1.03, 0.03], M);
        this.C(p, 'head', [0.02, 0.20, 0.02], [0.10, 1.12, 0], '#8b93a1');                    // 天线
        this.B(p, 'head', [0.05, 0.05, 0.05], [0.10, 1.23, 0], '#ff3ec8', null, { unlit: true });
        break;
      }
      /* —— 检票员：深蓝制服 + 大盖帽 —— */
      case 'inspector': {
        this.human({
          col: { cloth: '#2b3a63', pants: '#232f52', shoe: '#15181f', skin: '#ecc79f', hair: '#2a2a2a' },
          bodyW: 0.36, headR: 0.138, mouth: '#8a4038', brow: '#2a2a2a',
        }).forEach(x => p.push(x));
        this.B(p, 'body', [0.36, 0.06, 0.23], [0, 0.68, 0], '#d9b44a');           // 金色肩章
        for (const s of [-1, 1]) this.B(p, 'body', [0.09, 0.05, 0.22], [s * 0.13, 0.715, 0], '#d9b44a');
        this.B(p, 'body', [0.05, 0.30, 0.02], [0, 0.56, 0.115], '#d9b44a');
        this.B(p, 'head', [0.34, 0.09, 0.30], [0, 1.00, 0], '#222d4d');           // 帽檐
        this.B(p, 'head', [0.34, 0.14, 0.30], [0, 1.09, 0], '#2b3a63');
        this.B(p, 'head', [0.10, 0.05, 0.04], [0, 1.02, 0.16], '#d9b44a');
        this.B(p, 'head', [0.20, 0.045, 0.03], [0, 0.815, 0.135], '#5a4632');     // 胡子
        break;
      }
      /* —— 猎犬：棕色四足 —— */
      case 'dog': {
        const BR = '#b5793f', BR_D = '#8f5c2c', CREAM = '#f0dcc0', RED = '#d8453a';
        this.B(p, 'body', [0.26, 0.26, 0.62], [0, 0.36, -0.02], BR);
        this.B(p, 'body', [0.20, 0.08, 0.50], [0, 0.235, 0.0], CREAM);
        for (const s of [-1, 1]) {                                              // 四条腿
          const g = s < 0 ? 'legL' : 'legR';
          this.C(p, g, [0.075, 0.26, 0.075], [s * 0.10, -0.13, 0.20], BR_D);
          this.C(p, g, [0.075, 0.26, 0.075], [s * 0.10, -0.13, -0.20], BR_D);
          this.B(p, g, [0.10, 0.05, 0.12], [s * 0.10, -0.25, 0.22], '#e8dcc8');
          this.B(p, g, [0.10, 0.05, 0.12], [s * 0.10, -0.25, -0.18], '#e8dcc8');
        }
        this.B(p, 'body', [0.20, 0.05, 0.20], [0, 0.50, 0.06], RED);            // 项圈
        this.B(p, 'body', [0.07, 0.07, 0.02], [0, 0.44, 0.17], '#e8c04a');
        this.B(p, 'head', [0.24, 0.22, 0.26], [0, 0.60, 0.34], BR);             // 头
        this.K(p, 'head', [0.11, 0.16, 0.06], [0, 0.60, 0.47], BR_D, [Math.PI / 2, 0, 0]);  // 吻部
        for (const s of [-1, 1]) this.B(p, 'head', [0.05, 0.10, 0.05], [s * 0.09, 0.73, 0.30], BR_D);  // 耳朵
        for (const s of [-1, 1]) this.B(p, 'head', [0.04, 0.045, 0.02], [s * 0.07, 0.645, 0.47], '#171a1f');
        this.B(p, 'body', [0.07, 0.07, 0.22], [0, 0.50, -0.36], BR_D, [0.5, 0, 0]);   // 尾巴
        break;
      }
      /* —— 牛来：黄牛（追逐者） —— */
      case 'bull': {
        const Y = '#c8912f', YD = '#96691c', CREAM = '#f0ddb8';
        this.B(p, 'body', [0.42, 0.40, 0.80], [0, 0.52, -0.02], Y);
        this.B(p, 'body', [0.30, 0.10, 0.62], [0, 0.34, 0.0], CREAM);
        for (const s of [-1, 1]) {
          const g = s < 0 ? 'legL' : 'legR';
          this.C(p, g, [0.11, 0.40, 0.11], [s * 0.16, -0.20, 0.24], YD);
          this.C(p, g, [0.11, 0.40, 0.11], [s * 0.16, -0.20, -0.26], YD);
          this.B(p, g, [0.13, 0.06, 0.14], [s * 0.16, -0.38, 0.24], '#3a3126');
          this.B(p, g, [0.13, 0.06, 0.14], [s * 0.16, -0.38, -0.26], '#3a3126');
        }
        this.B(p, 'head', [0.36, 0.32, 0.36], [0, 0.72, 0.48], Y);
        this.K(p, 'head', [0.16, 0.22, 0.16], [0, 0.72, 0.68], '#e0c8a0', [Math.PI / 2, 0, 0]);   // 口鼻
        for (const s of [-1, 1]) this.K(p, 'head', [0.09, 0.24, 0.09], [s * 0.17, 0.92, 0.44], '#f2ead6', [0.2, 0, s * 0.9]);  // 牛角
        for (const s of [-1, 1]) this.B(p, 'head', [0.05, 0.05, 0.02], [s * 0.11, 0.78, 0.66], '#171a1f');
        this.B(p, 'body', [0.05, 0.05, 0.34], [0, 0.62, -0.52], YD, [0.5, 0, 0]);   // 尾巴
        this.B(p, 'body', [0.09, 0.09, 0.09], [0, 0.46, -0.70], YD);
        break;
      }
      default: {
        // 缺省：通用卡通人
        this.human({ col: { cloth: '#7cd44a', pants: '#3a4150', shoe: '#22262c', skin: '#f2c9a0', hair: '#1b1b1b' }, hair: '#1b1b1b', mouth: '#8a4038' }).forEach(x => p.push(x));
      }
    }
    return p;
  },

  parts(skin) {
    if (!this.cache[skin]) {
      const list = this.build(skin);
      const piv = this.pivotsFor(skin);
      // 约定：y 为负的部件坐标是「相对关节枢轴」，这里统一换算成绝对坐标
      for (const pt of list) {
        if (pt.pos[1] < 0 && piv[pt.grp]) pt.pos[1] += piv[pt.grp][1];
      }
      this.cache[skin] = list;
    }
    return this.cache[skin];
  },

  /* ---------- 动画：根据状态算出各关节角度 ---------- */
  anim(pose) {
    const st = pose.state || 'run';
    const t = pose.t || 0;
    const ph = t * Math.PI * 2;
    const A = {
      root: { pos: [0, 0, 0], rot: [0, 0, 0] },
      body: { rot: [0, 0, 0] }, head: { rot: [0, 0, 0] },
      armL: { rot: [0, 0, 0] }, armR: { rot: [0, 0, 0] },
      legL: { rot: [0, 0, 0] }, legR: { rot: [0, 0, 0] },
      tail: { rot: [0, 0, 0] },
    };
    const lean = pose.lean || 0;
    if (st === 'run') {
      const sw = Math.sin(ph), sw2 = Math.sin(ph * 2);
      A.root.pos[1] = Math.abs(sw2) * 0.035;
      A.root.rot[0] = -0.10 + lean * 0.08;
      A.body.rot[1] = sw * 0.10;
      A.body.rot[2] = sw * 0.05;
      A.head.rot[0] = 0.06;
      A.legL.rot[0] = sw * 0.95;
      A.legR.rot[0] = -sw * 0.95;
      A.armL.rot[0] = -sw * 0.80 - 0.12;
      A.armR.rot[0] = sw * 0.80 - 0.12;
      A.armL.rot[2] = -0.10;
      A.armR.rot[2] = 0.10;
      A.tail.rot[0] = sw * 0.25;
    } else if (st === 'jump') {
      A.root.rot[0] = -0.16;
      A.legL.rot[0] = -0.85; A.legR.rot[0] = -0.45;
      A.armL.rot[0] = -2.0; A.armR.rot[0] = -2.0;
      A.armL.rot[2] = -0.35; A.armR.rot[2] = 0.35;
      A.head.rot[0] = 0.12;
      A.tail.rot[0] = -0.35;
    } else if (st === 'fall') {
      A.root.rot[0] = 0.10;
      A.legL.rot[0] = 0.45; A.legR.rot[0] = -0.35;
      A.armL.rot[0] = -1.35; A.armR.rot[0] = -1.35;
      A.armL.rot[2] = -0.55; A.armR.rot[2] = 0.55;
      A.tail.rot[0] = 0.3;
    } else if (st === 'roll') {
      A.root.rot[0] = -(t % 1) * Math.PI * 2;
      A.root.pos[1] = 0.16;
      A.legL.rot[0] = -1.5; A.legR.rot[0] = -1.5;
      A.armL.rot[0] = -1.2; A.armR.rot[0] = -1.2;
      A.body.rot[0] = 0.25;
    } else if (st === 'fly') {
      A.root.rot[0] = -0.30;
      A.root.pos[1] = 0.05 + Math.sin(t * 6) * 0.02;
      A.legL.rot[0] = 0.5; A.legR.rot[0] = 0.35;
      A.armL.rot[0] = -0.4; A.armR.rot[0] = -0.4;
      A.armL.rot[2] = -0.9; A.armR.rot[2] = 0.9;
    } else if (st === 'crash') {
      A.root.rot[0] = 1.15;
      A.root.pos[1] = 0.18;
      A.legL.rot[0] = -0.5; A.legR.rot[0] = 0.4;
      A.armL.rot[0] = -2.4; A.armR.rot[0] = -2.4;
      A.head.rot[0] = -0.3;
    } else {  // idle
      const b = Math.sin(t * Math.PI * 2);
      A.root.pos[1] = b * 0.010;
      A.body.rot[0] = 0.02;
      A.head.rot[0] = -b * 0.03;
      A.armL.rot[0] = -0.08; A.armR.rot[0] = -0.08;
      A.armL.rot[2] = -0.06; A.armR.rot[2] = 0.06;
    }
    return A;
  },

  /* ---------- 绘制 ---------- */
  draw(skin, x, y, wz, pose, H, tintDeg) {
    const parts = this.parts(skin);
    const A = this.anim(pose);
    const P = this.pivotsFor(skin);
    const tint = tintDeg || 0;
    // 根变换：把单位模型（脚底 y=0）放大到 H，并按状态旋转/位移
    // 跑酷视角在角色背后：front=false 时把模型转 180°，让脸朝前（背对镜头）
    const faceYaw = (pose.front === false) ? Math.PI : 0;
    const root = mTRS(x, y + A.root.pos[1] * H, wz, A.root.rot[0], A.root.rot[1] + faceYaw, A.root.rot[2], H, H, H);
    const pivotM = {};
    for (const g in P) {
      const r = A[g] || { rot: [0, 0, 0] };
      const pv = P[g];
      // 绕关节旋转：T(pivot) · R · T(-pivot)，部件坐标为绝对坐标
      const gRoot = M4.mul(M4.mul(M4.mul(root,
        mTRS(pv[0] * H, pv[1] * H, pv[2] * H, 0, 0, 0, 1, 1, 1)),
        mTRS(0, 0, 0, r.rot[0], r.rot[1], r.rot[2], 1, 1, 1)),
        mTRS(-pv[0] * H, -pv[1] * H, -pv[2] * H, 0, 0, 0, 1, 1, 1));
      pivotM[g] = gRoot;
    }
    for (const part of parts) {
      const base = pivotM[part.grp] || root;
      const m = M4.mul(base, mTRS(
        part.pos[0] * H, part.pos[1] * H, part.pos[2] * H,
        part.rot[0], part.rot[1], part.rot[2],
        part.size[0] * H, part.size[1] * H, part.size[2] * H
      ));
      let col = hex2rgb(part.color);
      if (tint) col = hueRotate(col, tint);
      let mesh = GL3D.cube();
      if (part.mesh === 'cyl') mesh = GL3D.cylinder(10);
      else if (part.mesh === 'cone') mesh = GL3D.cone(10);
      GL3D.draw(mesh, m, {
        color: col,
        unlit: !!(part.opt && part.opt.unlit),
        blend: false,
      });
    }
  },

  /* 解析服装 filter → 色相角度 */
  outfitTint(skin) {
    try {
      if (typeof World === 'undefined' || !Store || !Store.data) return 0;
      const o = World.outfit(skin);
      if (!o || !o.filter || o.filter === 'none') return 0;
      const m = /hue-rotate\((-?\d+)deg\)/.exec(o.filter);
      if (m) return parseInt(m[1], 10);
      if (/sepia/.test(o.filter)) return 45;      // 鎏金
      if (/saturate\(0\.4/.test(o.filter)) return 200;  // 冰雪偏冷
      return 0;
    } catch (e) { return 0; }
  },
};
