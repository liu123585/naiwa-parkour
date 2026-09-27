/* =========================================================
   奶蛙跑酷 · 内容系统（高仿《奶蛙快跑》的产品结构，代码与美术自研）
   —— 世界巡游地图 / 难度 / 服装衣橱 / 障碍图鉴 / 挑战之路
   ========================================================= */
'use strict';

/* ---------------- 难度三档 ---------------- */
const DIFFICULTIES = [
  {
    id: 'easy', name: '简单', tag: '轻松跑',
    speedStart: 22, speedMax: 38, accel: 0.42,
    obstacleRate: 0.72, coinRate: 1.25, scoreMul: 0.8, reviveFree: 1,
    desc: '障碍更少、速度更慢，第一次复活免费，适合熟悉操作',
  },
  {
    id: 'normal', name: '普通', tag: '标准',
    speedStart: 28, speedMax: 48, accel: 0.53,
    obstacleRate: 1, coinRate: 1, scoreMul: 1, reviveFree: 0,
    desc: '标准体验，约 38 秒到极速；云端排行榜只统计此难度',
  },
  {
    id: 'hard', name: '困难', tag: '硬核',
    speedStart: 34, speedMax: 56, accel: 0.58,
    obstacleRate: 1.3, coinRate: 0.9, scoreMul: 1.3, reviveFree: 0,
    desc: '起步就很快、障碍密集，金币略少但分数 ×1.3，老手专属',
  },
];
/* 三种模式（对齐参考游戏：自由选图 / 单地图无尽 / 限时挑战） */
const MODES = [
  { id: 'endless', name: '无尽奔跑', desc: '选一张地图一直跑下去，撞两次就被抓' },
  { id: 'challenge60', name: '60秒挑战', desc: '埃及·金沙秘境，60 秒内跑出最远距离', map: 'egypt', time: 60 },
];
const DIFF_MAP = {};
DIFFICULTIES.forEach(d => { DIFF_MAP[d.id] = d; });

/* ---------------- 世界巡游地图 ----------------
   pal: 叠加到昼夜主题上的色调（hex 混色，mix 为混合强度）
   prop: 路边装饰物类型；ambient: 环境粒子；unlock: 解锁金币（0=免费）
------------------------------------------------ */
const MAPS = [
  {
    id: 'city', name: '摩天大楼 · 云端都会', sub: '高楼与霓虹的起点', unlock: 0,
    prop: 'pylon', ambient: null, mix: 0.35,
    pal: {
      skyTop: '#3f9fe0', skyBot: '#cfeaff', ground: '#7fae6a',
      wall: '#9aa3ae', wallDark: '#7a838f', wallTop: '#cfd6de',
      ballast: '#8e8a7e', bldg: ['#b9c6d6', '#9fb0c4', '#cdd8e4'],
    },
  },
  {
    id: 'changan', name: '中国古城 · 灯火长安', sub: '红墙灯笼与飞檐', unlock: 0,
    prop: 'lantern', ambient: null, mix: 0.75,
    pal: {
      skyTop: '#e0603f', skyBot: '#ffd9a8', ground: '#8a6a4a',
      wall: '#9c3f34', wallDark: '#7a2c24', wallTop: '#c4594a',
      ballast: '#8c7d68', bldg: ['#7c4a3c', '#5e352c', '#a06552'],
    },
  },
  {
    id: 'sakura', name: '日本 · 樱色列车', sub: '樱花纷飞的站台', unlock: 600,
    prop: 'sakura', ambient: 'petal', mix: 0.8,
    pal: {
      skyTop: '#7fb6e8', skyBot: '#ffe6f0', ground: '#93a86f',
      wall: '#d9a8bd', wallDark: '#b3819a', wallTop: '#f3d5e2',
      ballast: '#9a9188', bldg: ['#c8b6c4', '#a894a6', '#e5d4de'],
    },
  },
  {
    id: 'egypt', name: '埃及 · 金沙秘境', sub: '金字塔与神庙石柱', unlock: 1200,
    prop: 'obelisk', ambient: 'sand', mix: 0.8,
    pal: {
      skyTop: '#f0a94b', skyBot: '#ffe6b0', ground: '#d9b878',
      wall: '#c8a463', wallDark: '#a3813f', wallTop: '#e7c98f',
      ballast: '#c2a878', bldg: ['#c9a870', '#a98a4f', '#e0c48c'],
    },
  },
  {
    id: 'brazil', name: '巴西 · 海风狂想', sub: '海岸棕榈与彩绘墙', unlock: 1800,
    prop: 'palm', ambient: 'leaf', mix: 0.75,
    pal: {
      skyTop: '#2fa8d8', skyBot: '#d8f6ff', ground: '#e0c56a',
      wall: '#3f9d8c', wallDark: '#2c7568', wallTop: '#5cbcaa',
      ballast: '#c0a878', bldg: ['#e88a5c', '#cc6b44', '#f2ad80'],
    },
  },
  {
    id: 'india', name: '印度 · 粉城巡游', sub: '粉色之城与彩绘穹顶', unlock: 2400,
    prop: 'dome', ambient: null, mix: 0.78,
    pal: {
      skyTop: '#e07a9a', skyBot: '#ffe2d0', ground: '#c99a6a',
      wall: '#d97a92', wallDark: '#b05a72', wallTop: '#f0a3b6',
      ballast: '#bda07c', bldg: ['#e0919f', '#bd6f80', '#f2b6c0'],
    },
  },
  {
    id: 'tibet', name: '高原 · 雪山天路', sub: '雪山与经幡', unlock: 3200,
    prop: 'flagpole', ambient: 'snow', mix: 0.7,
    pal: {
      skyTop: '#3f7fd8', skyBot: '#e8f4ff', ground: '#b8c4cc',
      wall: '#8f9aa8', wallDark: '#6d7885', wallTop: '#c3ccd8',
      ballast: '#9aa2aa', bldg: ['#9fb0c2', '#7c8da0', '#c4d2e0'],
    },
  },
  {
    id: 'cyber', name: '赛博 · 霓虹夜轨', sub: '永远的电竞之夜', unlock: 5000,
    prop: 'neon', ambient: null, mix: 0.85, forceNight: true,
    pal: {
      skyTop: '#0a0f2e', skyBot: '#2a1a5e', ground: '#1d2230',
      wall: '#2a2f4a', wallDark: '#1b1f34', wallTop: '#3d4468',
      ballast: '#33384a', bldg: ['#241d48', '#1a1536', '#3a2a68'],
    },
  },
];
const MAP_DEF = {};
MAPS.forEach(m => { MAP_DEF[m.id] = m; });

/* ---------------- 服装衣橱（纯外观，不改变碰撞体积） ---------------- */
const OUTFIT_TINTS = [
  { id: 'origin', name: '原装', price: 0, filter: 'none', desc: '经典原色' },
  { id: 'night', name: '夜行', price: 300, filter: 'hue-rotate(200deg) saturate(1.15)', desc: '冷色夜行装' },
  { id: 'sunset', name: '夕阳', price: 700, filter: 'hue-rotate(-35deg) saturate(1.35) brightness(1.05)', desc: '暖橘夕阳色' },
  { id: 'neon', name: '霓虹', price: 1500, filter: 'hue-rotate(120deg) saturate(1.6) contrast(1.1)', desc: '赛博霓虹色' },
  { id: 'ice', name: '冰雪', price: 2200, filter: 'saturate(0.45) brightness(1.18)', desc: '雪原素色' },
  { id: 'gold', name: '鎏金', price: 3600, filter: 'sepia(0.55) saturate(1.8) brightness(1.06)', desc: '土豪鎏金' },
];
/* 每个角色 6 套 → 12 角色 × 6 = 72 套 */
const OUTFITS = [];
CHARS.forEach(ch => {
  OUTFIT_TINTS.forEach((t, i) => {
    OUTFITS.push({
      key: ch.skin + ':' + t.id,
      skin: ch.skin,
      id: t.id,
      name: t.name + '·' + ch.name,
      price: i === 0 ? 0 : Math.round(t.price * (1 + i * 0.1)),
      filter: t.filter,
      desc: t.desc,
    });
  });
});
const OUTFIT_MAP = {};
OUTFITS.forEach(o => { OUTFIT_MAP[o.key] = o; });

function outfitsOf(skin) { return OUTFITS.filter(o => o.skin === skin); }
function outfitKey(skin, id) { return skin + ':' + (id || 'origin'); }

/* ---------------- 障碍图鉴（18 种） ---------------- */
const CODEX = [
  { id: 'barrier', name: '护栏', kind: '跳过', icon: 'barrier', desc: '橙白相间的小护栏，直接跳过去。' },
  { id: 'cone', name: '交通锥', kind: '跳过', icon: 'cone', desc: '检修用的锥桶，跳一下就过了。' },
  { id: 'dumpster', name: '垃圾箱', kind: '跳过', icon: 'dumpster', desc: '绿色大垃圾箱，助跑起跳可以越过去。' },
  { id: 'highbar', name: '限高架', kind: '滑铲', icon: 'highbar', desc: '低矮的横梁，只能滑铲通过。' },
  { id: 'train_low', name: '矮车厢', kind: '车顶', icon: 'train', desc: '与地面齐平的矮车厢，可以直接跳上车顶继续跑。' },
  { id: 'train_mid', name: '中车厢', kind: '车顶', icon: 'train', desc: '中等高度的车厢，用跑鞋或斜坡才能上去。' },
  { id: 'train_high', name: '高车厢', kind: '变道', icon: 'train', desc: '齐人高的车厢，只能换道绕开。' },
  { id: 'oncoming', name: '迎面列车', kind: '变道', icon: 'train', desc: '从远处驶来的列车，会有警示提示，立刻换道。' },
  { id: 'spring', name: '弹跳垫', kind: '互动', icon: 'spring', desc: '踩上去会被弹到空中，正好落在车顶。' },
  { id: 'ramp', name: '斜坡', kind: '互动', icon: 'ramp', desc: '冲上斜坡会自动登上车厢顶部，车顶也能换道落回地面。' },
  { id: 'barrier_double', name: '双臂护栏', kind: '跳过', icon: 'barrier', desc: '横跨两条车道的护栏，注意第三条道。' },
  { id: 'coin_line', name: '金币路线', kind: '收集', icon: 'coin', desc: '金币铺成的路线就是推荐线路，跟着金币跑最安全。' },
  { id: 'roof_coins', name: '车顶金币', kind: '收集', icon: 'coin', desc: '车顶上一整排金币，值得冒险上去。' },
  { id: 'gap_train', name: '并行列车', kind: '变道', icon: 'train', desc: '两列车并排，中间只留一条缝隙。' },
  { id: 'tunnel', name: '隧道', kind: '环境', icon: 'tunnel', desc: '限高的隧道口，进去前记得滑铲。' },
  { id: 'signal', name: '信号灯', kind: '环境', icon: 'signal', desc: '路边的信号灯，纯粹的氛围装饰。' },
  { id: 'puddle', name: '积水', kind: '环境', icon: 'puddle', desc: '雨后积水，踩过去会溅水花。' },
  { id: 'gantry', name: '龙门架', kind: '环境', icon: 'gantry', desc: '接触网支架，从下方穿过去。' },
];

/* 障碍类型 → 图鉴条目 */
const CODEX_MAP = {
  barrier: 'barrier', cone: 'cone', dumpster: 'dumpster', highbar: 'highbar',
  spring: 'spring', ramp: 'ramp', tunnel: 'tunnel', signal: 'signal',
  puddle: 'puddle', gantry: 'gantry', train_low: 'train_low', train_mid: 'train_mid',
  train_high: 'train_high', oncoming: 'oncoming',
};

/* ---------------- 挑战之路（12 关，逐级解锁） ---------------- */
const CHALLENGES = [
  { id: 'c1', name: '第一步', goal: '单局跑出 200 米', type: 'dist', val: 200, reward: 100 },
  { id: 'c2', name: '金币猎人', goal: '单局吃到 40 枚金币', type: 'coins', val: 40, reward: 150 },
  { id: 'c3', name: '空中飞人', goal: '单局完成 15 次跳跃', type: 'jumps', val: 15, reward: 180 },
  { id: 'c4', name: '风火轮', goal: '单局滑铲 12 次', type: 'rolls', val: 12, reward: 200 },
  { id: 'c5', name: '车顶行者', goal: '单局在车顶跑 100 米', type: 'roof', val: 100, reward: 260 },
  { id: 'c6', name: '千步不停', goal: '单局跑出 1000 米', type: 'dist', val: 1000, reward: 320 },
  { id: 'c7', name: '连击达人', goal: '单局最高连击 30', type: 'combo', val: 30, reward: 380 },
  { id: 'c8', name: '擦身而过', goal: '单局 8 次贴身超车', type: 'near', val: 8, reward: 420 },
  { id: 'c9', name: '不死神话', goal: '单局 0 次撞击跑出 800 米', type: 'nodist', val: 800, reward: 500 },
  { id: 'c10', name: '道具大师', goal: '单局吃到 5 个道具', type: 'powers', val: 5, reward: 560 },
  { id: 'c11', name: '马拉松', goal: '单局跑出 2500 米', type: 'dist', val: 2500, reward: 700 },
  { id: 'c12', name: '传奇跑者', goal: '单局跑出 5000 米', type: 'dist', val: 5000, reward: 1200 },
];

/* ---------------- 道具（含护盾） ---------------- */
const POWERS_V2 = [
  { id: 'magnet', name: '金币磁铁', color: '#e6423c' },
  { id: 'jet', name: '喷射背包', color: '#4f9dff' },
  { id: 'x2', name: '双倍金币', color: '#f5b21a' },
  { id: 'shoe', name: '超级跑鞋', color: '#7cd44a' },
  { id: 'board', name: '悬浮板', color: '#ff5fa2' },
  { id: 'shield', name: '护盾', color: '#2ee6d6' },
];

/* ---------------- 工具 ---------------- */
const World = {
  diff(id) { return DIFF_MAP[id] || DIFF_MAP.normal; },
  map(id) { return MAP_DEF[id] || MAPS[0]; },
  cur() {
    if (typeof Store === 'undefined' || !Store.data) return { diff: DIFF_MAP.normal, map: MAPS[0] };
    return {
      diff: this.diff(Store.data.difficulty),
      map: this.map(Store.data.map),
    };
  },
  outfit(skin) {
    const id = (Store.data.outfits && Store.data.outfits[skin]) || 'origin';
    return OUTFIT_MAP[outfitKey(skin, id)] || OUTFIT_MAP[outfitKey(skin, 'origin')];
  },
  outfitOwned(skin, id) {
    return id === 'origin' || ((Store.data.outfitOwned || {})[skin] || []).indexOf(id) >= 0;
  },
  /* 把地图色调叠加到昼夜主题上 */
  applyMap(base, map) {
    if (!map || !map.pal) return base;
    const mix = map.mix == null ? 0.7 : map.mix;
    const out = {};
    for (const k in base) {
      const v = base[k], m = map.pal[k];
      if (m === undefined) { out[k] = v; continue; }
      if (typeof v === 'string' && v[0] === '#' && typeof m === 'string') out[k] = hexMix(v, m, mix);
      else if (Array.isArray(v) && Array.isArray(m)) out[k] = v.map((c, i) => hexMix(c, m[i % m.length], mix));
      else out[k] = v;
    }
    out.night = base.night; out.star = base.star; out.rain = base.rain;
    out.overlay = base.overlay; out.name = map.name;
    return out;
  },
};
