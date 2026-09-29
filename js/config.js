/* =========================================================
   捏捏跑酷 · PINCH RUN —— 全局配置 / 角色数据 / 存档
   世界观：玩具厂倒闭那晚，车间里没做完的小家伙全跑了。
   可玩角色全部为原创设计，材质各异（黏土/纸板/毛线/铁皮/瓷…），不含任何第三方 IP。
   ========================================================= */
'use strict';

const CFG = {
  LANES: 3,
  LANE_W: 2.3,            // 车道间距
  ROAD_HALF: 3.9,         // 轨道区域半宽
  WALL_X: 5.5,            // 侧墙位置
  RAIL_HALF: 0.66,        // 单条铁轨半宽（每条车道两根轨）
  SLEEPER_GAP: 2.6,       // 枕木间距
  FAR: 190,               // 最远绘制距离
  NEAR: 0.55,

  CAM_BACK: 9.6,          // 摄像机在角色后方距离
  CAM_Y: 4.05,            // 摄像机高度
  FOV_Y: 62,              // 垂直视场角
  CAM_FOLLOW: 0.72,       // 摄像机横向跟随系数（越大角色越居中）

  PLAYER_H: 1.72,         // 站立高度(世界单位≈米)
  ROLL_H: 0.86,
  ROLL_TIME: 0.62,
  GRAVITY: 31,
  JUMP_V: 10.2,
  JUMP_V_SHOE: 13.2,

  SPEED_START: 15.5,
  SPEED_MAX: 47,
  SPEED_ACCEL: 0.30,      // 每秒加速
  SPEED_JET: 34,

  LANE_SNAP: 12.5,        // 变道横向速度
  BOOST_BOARD_SAVE: 1.6,  // 悬浮板碎掉后的无敌时间

  POWER_TIME: { magnet: 13, jet: 9, x2: 16, shoe: 13, board: 30, shield: 11 },

  COIN_VALUE: 1,
  SCORE_PER_M: 1.0,
  COIN_SCORE: 10,
  NEAR_MISS_SCORE: 30,
  REVIVE_COST: 200,
  MAX_REVIVES: 1,

  DPR_MAX: { high: 1.5, mid: 1.25, low: 0.95 },
  EMOJI: false,
};

/* ---------------- 角色数据 ----------------
   每个角色：id -> 由 CHARS.build[skin] 绘制
   perk: 效果字段（在 game.js 中读取）

   body/belly : 主体色 / 肚皮色
   shape      : 身形（blob 圆坨 / box 方盒 / egg 蛋 / bean 豆 / ball 球）
   mat        : 材质（clay 黏土 / paper 纸板 / yarn 毛线 / tin 铁皮 / eraser 橡皮 /
                felt 毛毡 / wood 木头 / plastic 塑料 / ceramic 瓷 / clear 透明 /
                brass 黄铜 / metal 金属 / cotton 棉花）
   acc        : 头部配饰（实现在 pinchchars.js 的 TOY_ACC 里）
------------------------------------------------ */
const CHARS = [
  /* ===== 原创主角「泥泥」+ 12 个同厂小伙伴 ===== */
  {
    id: 'ni', skin: 'ni', name: '泥泥', price: 0, tag: '主角',
    desc: '第一批被捏出来的那只。脸上的指纹是出厂自带的，不是脏。',
    perk: '圆坨坨体质：金币 +5%',
    p: { coin: 0.05 },
    body: '#e08a4b', belly: '#f7dcbd', shape: 'blob', mat: 'clay', acc: 'none',
  },
  {
    id: 'zhipi', skin: 'zhipi', name: '纸皮', price: 300, tag: '纸板',
    desc: '瓦楞纸糊的身子，怕水，怕火，唯独不怕撞。',
    perk: '磁铁持续时间 +20%',
    p: { magnet: 0.20 },
    body: '#c9a26b', belly: '#e8d3ac', shape: 'box', mat: 'paper', acc: 'foldhat',
  },
  {
    id: 'maoqiu', skin: 'maoqiu', name: '毛球', price: 600, tag: '毛线',
    desc: '一团没织完的毛线，跑起来线头一直拖在后头。',
    perk: '分数 +5%',
    p: { score: 0.05 },
    body: '#d9584a', belly: '#f2b3a9', shape: 'ball', mat: 'yarn', acc: 'braid',
  },
  {
    id: 'tiedan', skin: 'tiedan', name: '铁蛋', price: 1000, tag: '铁皮',
    desc: '铁皮罐头改的。背上的发条一拧就能跑，跑完得记得上油。',
    perk: '分数 +8%',
    p: { score: 0.08 },
    body: '#8a97a8', belly: '#c3ccd8', shape: 'bean', mat: 'tin', acc: 'windup',
  },
  {
    id: 'xiangpi', skin: 'xiangpi', name: '橡皮', price: 1400, tag: '橡皮',
    desc: '橡皮擦削出来的。擦得掉铅笔，擦不掉自己。',
    perk: '跳跃力 +12%',
    p: { jump: 0.12 },
    body: '#f2a0b5', belly: '#fbd8e1', shape: 'box', mat: 'eraser', acc: 'none',
  },
  {
    id: 'zhanzhan', skin: 'zhanzhan', name: '毡毡', price: 1800, tag: '毛毡',
    desc: '毛毡缝的，针脚歪歪扭扭——是学徒练手缝的那只。',
    perk: '双倍金币持续时间 +30%',
    p: { x2: 0.30 },
    body: '#6e9b6b', belly: '#c2d9be', shape: 'egg', mat: 'felt', acc: 'stitch',
  },
  {
    id: 'mumu', skin: 'mumu', name: '木木', price: 2200, tag: '木头',
    desc: '一块边角料，年轮还看得见。摔过很多次，一次没裂。',
    perk: '撞击后无敌时间 +0.5 秒（皮实）',
    p: { iframe: 0.5 },
    body: '#b98a55', belly: '#ddbb90', shape: 'box', mat: 'wood', acc: 'ring',
  },
  {
    id: 'jimu', skin: 'jimu', name: '积木', price: 2600, tag: '塑料',
    desc: '塑料积木拼的。脚底那两块永远踩不严实，走路有点响。',
    perk: '超级跑鞋持续时间 +35%',
    p: { shoe: 0.35 },
    body: '#f5c63c', belly: '#ffe9a6', shape: 'box', mat: 'plastic', acc: 'studs',
  },
  {
    id: 'ciwa', skin: 'ciwa', name: '瓷娃', price: 3000, tag: '瓷',
    desc: '烧过头了。身上有裂纹，但一直没碎，也没打算碎。',
    perk: '每局开局自带一个随机道具',
    p: { starter: 1 },
    body: '#7fb3a5', belly: '#cfe6e0', shape: 'egg', mat: 'ceramic', acc: 'crack',
  },
  {
    id: 'paopao', skin: 'paopao', name: '泡泡', price: 3400, tag: '透明',
    desc: '吹出来的。所有人都以为他下一秒就要破，他到现在都没破。',
    perk: '撞击后无敌时间 +0.6 秒（皮实）',
    p: { iframe: 0.6 },
    body: '#9fd8e8', belly: '#dcf2f8', shape: 'ball', mat: 'clear', acc: 'none',
  },
  {
    id: 'tongkou', skin: 'tongkou', name: '铜扣', price: 3800, tag: '黄铜',
    desc: '黄铜纽扣当身子，四个孔。绳子穿过去，就是手脚。',
    perk: '分数 +10%',
    p: { score: 0.10 },
    body: '#d9a441', belly: '#f2d79b', shape: 'ball', mat: 'brass', acc: 'holes',
  },
  {
    id: 'tanhuang', skin: 'tanhuang', name: '弹簧', price: 4200, tag: '金属',
    desc: '一圈废弹簧。蹦得最高，落地最不稳，也最不在乎。',
    perk: '磁铁范围 +45%，分数 +5%',
    p: { magnetRange: 0.45, score: 0.05 },
    body: '#b9c2cc', belly: '#e4e9ef', shape: 'bean', mat: 'metal', acc: 'coil',
  },
  {
    id: 'mianhua', skin: 'mianhua', name: '棉花', price: 4800, tag: '棉花',
    desc: '棉花塞的，全场最轻。风一大就跑偏，他自己也没办法。',
    perk: '金币 +18%',
    p: { coin: 0.18 },
    body: '#f2ede3', belly: '#ffffff', shape: 'blob', mat: 'cotton', acc: 'puff',
  },
];

const CHAR_MAP = {};
CHARS.forEach(c => CHAR_MAP[c.id] = c);
const DEFAULT_SKIN = 'ni';

/* ---------------- 角色可见性 / 原创皮肤辅助 ---------------- */
function visibleChars() { return CHARS; }
/* 带 shape/mat 字段的角色条目，供 3D / 2D 模型统一驱动 */
function isToySkin(skin) { const c = CHAR_MAP[skin]; return !!(c && c.shape !== undefined); }
function toyDef(skin) { return isToySkin(skin) ? CHAR_MAP[skin] : CHAR_MAP[DEFAULT_SKIN]; }
/* 兼容旧调用名 */
function isYuanSkin(skin) { return isToySkin(skin); }
function yuanDef(skin) { return toyDef(skin); }

/* ---------------- 技能升级 ---------------- */
const SKILLS = [
  { id: 'magnet', name: '磁铁时长', desc: '每级 +1.6 秒吸引金币时间', max: 5, base: 260, ico: 'ico-magnet' },
  { id: 'jet', name: '喷射背包', desc: '每级 +0.9 秒飞行时间', max: 5, base: 300, ico: 'ico-jet' },
  { id: 'shoe', name: '超级跑鞋', desc: '每级 +1.2 秒弹跳鞋时间', max: 5, base: 240, ico: 'ico-shoe' },
  { id: 'board', name: '悬浮板时长', desc: '每级 +3 秒悬浮板时间', max: 5, base: 220, ico: 'ico-board' },
  { id: 'revive', name: '复活折扣', desc: '每级复活费 -20 金币', max: 4, base: 400, ico: 'ico-heart' },
];
const SKILL_MAP = {};
SKILLS.forEach(s => SKILL_MAP[s.id] = s);
function skillCost(s, lv) { return Math.round(s.base * Math.pow(1.85, lv)); }

/* ---------------- 道具 ----------------
   kind: 生成器里出现的概率权重 */
/* 道具与参考游戏保持一致：只有「红色磁铁」与「蓝色护盾」两种 */
const POWERS = [
  { id: 'magnet', name: '金币磁铁', color: '#e6423c', weight: 50 },
  { id: 'shield', name: '护盾', color: '#2f8bff', weight: 50 },
];

/* ---------------- 任务池 ---------------- */
const MISSION_POOL = [
  { id: 'dist',   name: '跑满 {n} 米',            icon: '里', target: [1500, 2500, 4000], reward: [260, 420, 640] },
  { id: 'coins',  name: '收集 {n} 枚金币',        icon: '币', target: [220, 380, 600], reward: [240, 400, 620] },
  { id: 'jump',   name: '跳跃 {n} 次',            icon: '跳', target: [40, 70, 110], reward: [180, 300, 460] },
  { id: 'roll',   name: '滑铲 {n} 次',            icon: '铲', target: [25, 45, 75], reward: [180, 300, 460] },
  { id: 'magnet', name: '使用磁铁 {n} 次',        icon: '磁', target: [3, 5, 8], reward: [200, 340, 520] },
  { id: 'jet',    name: '使用喷射背包 {n} 次',    icon: '喷', target: [2, 4, 6], reward: [220, 360, 540] },
  { id: 'board',  name: '使用悬浮板 {n} 次',      icon: '板', target: [2, 3, 5], reward: [220, 360, 540] },
  { id: 'roof',   name: '跳上车顶 {n} 次',        icon: '顶', target: [5, 10, 18], reward: [240, 400, 600] },
  { id: 'single', name: '单局得分达到 {n}',       icon: '分', target: [6000, 12000, 20000], reward: [300, 520, 800] },
  { id: 'boardrun', name: '踩悬浮板跑 {n} 米',    icon: '滑', target: [600, 1200, 2000], reward: [260, 440, 660] },
];

/* ---------------- 成就 ---------------- */
const ACHIEVEMENTS = [
  { id: 'a_dist1', name: '跑酷新手', desc: '累计奔跑 3000 米', check: s => s.totalDist >= 3000, reward: 200 },
  { id: 'a_dist2', name: '疾风之影', desc: '累计奔跑 20000 米', check: s => s.totalDist >= 20000, reward: 800 },
  { id: 'a_dist3', name: '极速传说', desc: '累计奔跑 80000 米', check: s => s.totalDist >= 80000, reward: 2500 },
  { id: 'a_coin1', name: '捡币小能手', desc: '累计收集 1000 金币', check: s => s.totalCoins >= 1000, reward: 300 },
  { id: 'a_coin2', name: '金币收割机', desc: '累计收集 12000 金币', check: s => s.totalCoins >= 12000, reward: 1200 },
  { id: 'a_single1', name: '第一张成绩单', desc: '单局得分超过 8000', check: s => s.best >= 8000, reward: 400 },
  { id: 'a_single2', name: '跑酷名人', desc: '单局得分超过 25000', check: s => s.best >= 25000, reward: 1000 },
  { id: 'a_single3', name: '跑酷之神', desc: '单局得分超过 60000', check: s => s.best >= 60000, reward: 2600 },
  { id: 'a_char1', name: '收藏家', desc: '解锁 4 套皮肤', check: s => s.chars.filter(id => CHAR_MAP[id] && !CHAR_MAP[id].hidden).length >= 4, reward: 500 },
  { id: 'a_char2', name: '皮肤全收集', desc: '解锁全部 13 套皮肤', check: s => s.chars.filter(id => CHAR_MAP[id] && !CHAR_MAP[id].hidden).length >= 13, reward: 3000 },
  { id: 'a_power', name: '道具大师', desc: '使用道具 200 次', check: s => s.powerUses >= 200, reward: 700 },
  { id: 'a_roof', name: '车顶漫步', desc: '跳上车顶 100 次', check: s => s.roofCount >= 100, reward: 600 },
  { id: 'a_revive', name: '绝地求生', desc: '复活 5 次', check: s => s.revives >= 5, reward: 500 },
  { id: 'a_run1', name: '坚持不懈', desc: '完成 30 局游戏', check: s => s.runs >= 30, reward: 600 },
  { id: 'a_run2', name: '跑酷真爱粉', desc: '完成 120 局游戏', check: s => s.runs >= 120, reward: 2000 },
];

/* ---------------- 小家伙语录 ----------------
   语气：出厂没多久，嘴硬，怕被回收，但乐天。 */
const QUOTES = {
  crash: [
    '零件掉了一个，捡起来还能跑。',
    '压模机差一点就够着我了。',
    '摔成这样，出厂日期都糊了。',
    '没事，本来也就是个次品。',
  ],
  revive: ['胶水糊上了，接着跑！', '焊一下，满血复活。'],
  power: ['这零件不错，我先用着。', '捡到了！'],
  high: ['你已经跑得比传送带还快了。', '整个车间都追不上你。'],
  menu: [
    '按 ← → 变道，↑ 跳，↓ 滑铲，空格踩悬浮板。',
    '手机可以滑动屏幕，也可以点屏幕下方的按钮。',
    '跳上纸箱车顶，上面藏着一串铜扣。',
    '磁铁 + 双倍金币，是攒铜扣最快的组合。',
    '悬浮板能替你挡一次撞击，挡完就碎。',
    '一局只有一次复活机会，省着用。',
  ],
};

/* ---------------- 存档 ---------------- */
const SAVE_KEY = 'pinchRun.save.v1';

const DEFAULT_SAVE = {
  coins: 0,
  difficulty: 'normal',
  mode: 'endless',
  map: 'city',
  mapsUnlocked: ['city', 'changan'],
  outfits: {},            // skin -> 已穿戴的服装 id
  outfitOwned: {},        // skin -> [已购服装 id]
  codexSeen: [],          // 已见过的障碍 id
  challenges: [],         // 已完成的挑战 id
  bestByMap: {},          // mapId -> { easy:0, normal:0, hard:0 }
  playCount: {},
  playerName: '',
  cloudId: '',
  cloudBest: 0,
  cloudSaveCode: '',      // 云端存档的取件码，空=还没存过
  cloudSavedAt: 0,
  best: 0,
  runs: 0,
  totalDist: 0,
  totalCoins: 0,
  powerUses: 0,
  roofCount: 0,
  revives: 0,
  chars: ['ni'],
  char: 'ni',
  skills: { magnet: 0, jet: 0, shoe: 0, board: 0, revive: 0 },
  boardCount: 3,          // 悬浮板库存
  settings: { sfx: true, music: true, vibe: true, quality: 'mid', tips: true },
  missions: null,          // { date:'2026-09-26', list:[{id,idx,progress,done,claimed}] }
  achClaimed: [],
  runs_log: [],
  seenIntro: false,
};

const Store = {
  data: null,
  load() {
    let d = null;
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (raw) d = JSON.parse(raw);
    } catch (e) { d = null; }
    this.data = Object.assign(JSON.parse(JSON.stringify(DEFAULT_SAVE)), d || {});
    // 兼容旧存档字段
    if (!Array.isArray(this.data.chars) || !this.data.chars.length) this.data.chars = [DEFAULT_SKIN];
    // 存档里出现过的已下线角色：清掉残留 id 与对应服装记录，并确保主角可用
    this.data.chars = this.data.chars.filter(id => !!CHAR_MAP[id]);
    if (this.data.chars.indexOf(DEFAULT_SKIN) < 0) this.data.chars.unshift(DEFAULT_SKIN);
    if (!this.data.char || !CHAR_MAP[this.data.char]) this.data.char = DEFAULT_SKIN;
    ['outfits', 'outfitOwned'].forEach(k => {
      if (this.data[k]) for (const sk in this.data[k]) { if (!CHAR_MAP[sk]) delete this.data[k][sk]; }
    });
    if (!this.data.skills) this.data.skills = { magnet: 0, jet: 0, shoe: 0, board: 0, revive: 0 };
    SKILLS.forEach(s => { if (typeof this.data.skills[s.id] !== 'number') this.data.skills[s.id] = 0; });
    this.data.settings = Object.assign({}, DEFAULT_SAVE.settings, this.data.settings || {});
    if (typeof this.data.boardCount !== 'number') this.data.boardCount = 3;
    if (typeof this.data.difficulty !== 'string') this.data.difficulty = 'normal';
    if (typeof this.data.map !== 'string') this.data.map = 'city';
    ['mapsUnlocked', 'codexSeen', 'challenges'].forEach(k => {
      if (!Array.isArray(this.data[k])) this.data[k] = DEFAULT_SAVE[k].slice();
    });
    if (!this.data.mapsUnlocked.length) this.data.mapsUnlocked = ['city', 'changan'];
    ['outfits', 'outfitOwned', 'bestByMap', 'playCount'].forEach(k => {
      if (!this.data[k] || typeof this.data[k] !== 'object') this.data[k] = {};
    });
    return this.data;
  },
  save() {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(this.data)); } catch (e) { /* 隐私模式忽略 */ }
  },
  wipe() {
    try { localStorage.removeItem(SAVE_KEY); } catch (e) {}
    this.data = JSON.parse(JSON.stringify(DEFAULT_SAVE));
  },
};

/* ---------------- 工具函数 ---------------- */
const Utils = {
  clamp(v, a, b) { return v < a ? a : v > b ? b : v; },
  lerp(a, b, t) { return a + (b - a) * t; },
  rand(a, b) { return a + Math.random() * (b - a); },
  irand(a, b) { return Math.floor(a + Math.random() * (b - a + 1)); },
  pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; },
  todayStr() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  },
  fmt(n) {
    n = Math.floor(n);
    return n >= 10000 ? n.toLocaleString('en-US') : String(n);
  },
  laneX(lane) { return (lane - (CFG.LANES - 1) / 2) * CFG.LANE_W; },
  nearestLane(x) { return Utils.clamp(Math.round(x / CFG.LANE_W + (CFG.LANES - 1) / 2), 0, CFG.LANES - 1); },
};

/* 每日任务生成（同一天返回同一套） */
function buildMissions(dateStr) {
  const seedRand = (i) => {
    let s = 0;
    for (let k = 0; k < dateStr.length; k++) s += dateStr.charCodeAt(k) * (k + 3);
    s = (s * 9301 + 49297 + i * 1717) % 233280;
    return s / 233280;
  };
  const pool = MISSION_POOL.slice();
  const out = [];
  for (let i = 0; i < 3 && pool.length; i++) {
    const idx = Math.floor(seedRand(i) * pool.length);
    const m = pool.splice(idx, 1)[0];
    const lvl = Math.min(2, Math.floor(seedRand(i + 77) * 3));
    out.push({
      id: m.id, name: m.name.replace('{n}', m.target[lvl]), icon: m.icon,
      target: m.target[lvl], reward: m.reward[lvl],
      progress: 0, done: false, claimed: false,
    });
  }
  return { date: dateStr, list: out };
}
