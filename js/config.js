/* =========================================================
   奶蛙跑酷 · 全局配置 / 角色数据 / 存档
   ========================================================= */
'use strict';

const CFG = {
  LANES: 3,
  LANE_W: 2.3,            // 车道间距
  ROAD_HALF: 3.9,         // 轨道区域半宽
  WALL_X: 4.6,            // 侧墙位置
  RAIL_HALF: 0.66,        // 单条铁轨半宽（每条车道两根轨）
  SLEEPER_GAP: 2.6,       // 枕木间距
  FAR: 190,               // 最远绘制距离
  NEAR: 0.55,

  CAM_BACK: 7.0,          // 摄像机在角色后方距离
  CAM_Y: 2.55,            // 摄像机高度
  FOV_Y: 58,              // 垂直视场角
  CAM_FOLLOW: 0.46,       // 摄像机横向跟随系数

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

  POWER_TIME: { magnet: 13, jet: 9, x2: 16, shoe: 13, board: 30 },

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
------------------------------------------------ */
const CHARS = [
  {
    id: 'naiwa', skin: 'naiwa', name: '奶蛙', price: 0,
    tag: '默认',
    desc: '黄桃罐头色的巨头魔性生物，全网呼叫奶家人！',
    perk: '笑到金币自动上门（金币 +5%）',
    p: { coin: 0.05 },
  },
  {
    id: 'nailong', skin: 'nailong', name: '奶龙', price: 600,
    tag: '萌系',
    desc: '奶蛙的老前辈，圆滚滚的黄色小萌龙。',
    perk: '磁铁持续时间 +25%',
    p: { magnet: 0.25 },
  },
  {
    id: 'yujie', skin: 'yujie', name: '东北雨姐', price: 1200,
    tag: '乡村',
    desc: '一米八的东北大姐，花棉袄一穿，铁锅一扛，跑道都得让路。',
    perk: '大嗓门吸金：金币 +15%',
    p: { coin: 0.15 },
  },
  {
    id: 'xiaoyang', skin: 'xiaoyang', name: '疯狂小杨哥', price: 1500,
    tag: '直播',
    desc: '直播间一秒不消停的带货老哥，边跑边讲解。',
    perk: '双倍金币持续时间 +30%',
    p: { x2: 0.30 },
  },
  {
    id: 'zhangtongxue', skin: 'zhangtongxue', name: '张同学', price: 1800,
    tag: 'Vlog',
    desc: '棉帽子一带，扛着三脚架在村口一路狂奔。',
    perk: '超级跑鞋持续时间 +35%',
    p: { shoe: 0.35 },
  },
  {
    id: 'liziqi', skin: 'liziqi', name: '李子柒', price: 2000,
    tag: '田园',
    desc: '一身汉服，竹篮在手，跑起来像风过竹林。',
    perk: '每局开局自带一个随机道具',
    p: { starter: 1 },
  },
  {
    id: 'liugenhong', skin: 'liugenhong', name: '刘教练', price: 2200,
    tag: '健身',
    desc: '背心短裤的健身狂人，边跑边喊：跟上节奏！',
    perk: '跳得更高（跳跃力 +12%）',
    p: { jump: 0.12 },
  },
  {
    id: 'donglaoshi', skin: 'donglaoshi', name: '董老师', price: 2500,
    tag: '文化',
    desc: '怀里揣本书的讲台型选手，知识就是跑分。',
    perk: '分数 +10%',
    p: { score: 0.10 },
  },
  {
    id: 'goose', skin: 'goose', name: '雨姐的鹅', price: 2800,
    tag: '整活',
    desc: '一口咬住全村的鹅，跑得比主人还快。',
    perk: '撞击后无敌时间 +0.6 秒（皮实）',
    p: { iframe: 0.6 },
  },
  {
    id: 'cybernaiwa', skin: 'cybernaiwa', name: '赛博奶蛙', price: 5000,
    tag: '限定',
    desc: '被 AI 二次改造的机械奶蛙，霓虹灯管里也在笑。',
    perk: '磁铁范围 +45%，分数 +5%',
    p: { magnetRange: 0.45, score: 0.05 },
  },
];

const CHAR_MAP = {};
CHARS.forEach(c => CHAR_MAP[c.id] = c);

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
const POWERS = [
  { id: 'magnet', name: '金币磁铁', color: '#ff6b6b', weight: 26 },
  { id: 'jet', name: '喷射背包', color: '#7fb6ff', weight: 18 },
  { id: 'x2', name: '双倍金币', color: '#ffd34d', weight: 24 },
  { id: 'shoe', name: '超级跑鞋', color: '#ff9d4d', weight: 22 },
  { id: 'board', name: '悬浮板', color: '#ff6bd0', weight: 16 },
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
  { id: 'a_dist1', name: '奶家人入门', desc: '累计奔跑 3000 米', check: s => s.totalDist >= 3000, reward: 200 },
  { id: 'a_dist2', name: '风一样的蛙', desc: '累计奔跑 20000 米', check: s => s.totalDist >= 20000, reward: 800 },
  { id: 'a_dist3', name: '东北速度', desc: '累计奔跑 80000 米', check: s => s.totalDist >= 80000, reward: 2500 },
  { id: 'a_coin1', name: '捡币小能手', desc: '累计收集 1000 金币', check: s => s.totalCoins >= 1000, reward: 300 },
  { id: 'a_coin2', name: '金币收割机', desc: '累计收集 12000 金币', check: s => s.totalCoins >= 12000, reward: 1200 },
  { id: 'a_single1', name: '第一张成绩单', desc: '单局得分超过 8000', check: s => s.best >= 8000, reward: 400 },
  { id: 'a_single2', name: '跑酷名人', desc: '单局得分超过 25000', check: s => s.best >= 25000, reward: 1000 },
  { id: 'a_single3', name: '魔性天花板', desc: '单局得分超过 60000', check: s => s.best >= 60000, reward: 2600 },
  { id: 'a_char1', name: '收藏家', desc: '解锁 4 个角色', check: s => s.chars.length >= 4, reward: 500 },
  { id: 'a_char2', name: '奶家人集合', desc: '解锁全部 10 个角色', check: s => s.chars.length >= 10, reward: 3000 },
  { id: 'a_power', name: '道具大师', desc: '使用道具 200 次', check: s => s.powerUses >= 200, reward: 700 },
  { id: 'a_roof', name: '车顶漫步', desc: '跳上车顶 100 次', check: s => s.roofCount >= 100, reward: 600 },
  { id: 'a_revive', name: '绝地求生', desc: '复活 5 次', check: s => s.revives >= 5, reward: 500 },
  { id: 'a_run1', name: '坚持不懈', desc: '完成 30 局游戏', check: s => s.runs >= 30, reward: 600 },
  { id: 'a_run2', name: '奶蛙真爱粉', desc: '完成 120 局游戏', check: s => s.runs >= 120, reward: 2000 },
];

/* ---------------- 奶蛙语录 ---------------- */
const QUOTES = {
  crash: ['齁齁齁——你被抓了！', '奶蛙笑得卡痰了…', '再跑一次，奶家人不服输！', '就这？奶蛙表示想再笑一次。'],
  revive: ['奶瓶一灌，满血复活！', '奶家人，绝不认输！'],
  power: ['齁！我变强了。', '这波道具吃得漂亮！'],
  high: ['你已经是奶蛙大师了！', '跑道都追不上你！'],
  menu: [
    '按 ← → 变道，↑ 跳，↓ 滑铲，空格踩悬浮板。',
    '听到「齁齁齁」别慌，那是奶蛙在给你加油。',
    '跳上车顶可以捡到更多金币。',
    '磁铁 + 双倍金币是刷分最快的组合。',
    '悬浮板能替你挡一次撞击。',
    '一局里只有一次复活机会，省着用。',
  ],
};

/* ---------------- 存档 ---------------- */
const SAVE_KEY = 'naiwaRun.save.v1';

const DEFAULT_SAVE = {
  coins: 0,
  best: 0,
  runs: 0,
  totalDist: 0,
  totalCoins: 0,
  powerUses: 0,
  roofCount: 0,
  revives: 0,
  chars: ['naiwa'],
  char: 'naiwa',
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
    if (!Array.isArray(this.data.chars) || !this.data.chars.length) this.data.chars = ['naiwa'];
    if (!this.data.skills) this.data.skills = { magnet: 0, jet: 0, shoe: 0, board: 0, revive: 0 };
    SKILLS.forEach(s => { if (typeof this.data.skills[s.id] !== 'number') this.data.skills[s.id] = 0; });
    this.data.settings = Object.assign({}, DEFAULT_SAVE.settings, this.data.settings || {});
    if (typeof this.data.boardCount !== 'number') this.data.boardCount = 3;
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
