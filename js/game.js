/* =========================================================
   奶蛙跑酷 · 游戏主逻辑
   ========================================================= */
'use strict';

const Game = {
  state: 'boot',
  time: 0, elapsed: 0, travel: 0, speed: 0,
  score: 0, runCoins: 0, mult: 1, maxMult: 1, coinStreak: 0, lastCoinAt: 0,
  objs: [], parts: [], rq: [], nextZ: 0, springs: 0,
  invuln: 0, dying: 0, hurtFlash: 0, shake: 0,
  nearMissCd: 0, coinSndCd: 0,
  themeFrom: THEMES.day, themeTo: THEMES.day, themeT: 1, theme: THEMES.day, themeTimer: 0,
  runStats: null, ranRevive: 0, reviveUsed: 0, pausedFrom: 'run',
  fps: { samples: [], avg: 60, quality: 'mid', lowFrames: 0, dprStep: 0 },

  player: {
    x: 0, y: 0, vy: 0, lane: 1, state: 'run', phase: 0,
    rollT: 0, grounded: true, supportY: 0, onRoofZ: 0, squash: 0, lean: 0, boardT: 0,
  },
  powers: { magnet: 0, jet: 0, x2: 0, shoe: 0, board: 0 },
  chaser: { on: false, dist: 4.0, mode: 'intro', t: 0 },
  camera: { x: 0, shake: 0 },

  /* ================= 初始化 ================= */
  init(canvas) {
    Store.load();
    Renderer.quality = Store.data.settings.quality;
    Renderer.init(canvas);
    this.fps.quality = Store.data.settings.quality;
    this.bindInput();
    UI.init();
    this.applySettings();
    this.state = 'menu';
    UI.showMenu();
    this.reset();
    this.last = performance.now();
    requestAnimationFrame((t) => this.loop(t));
    // 主菜单角色预览动画
    const heroTick = () => {
      if (this.state === 'menu' || this.state === 'boot') UI.animateMenu(this.time);
      requestAnimationFrame(heroTick);
    };
    requestAnimationFrame(heroTick);
  },

  applySettings() {
    const s = Store.data.settings;
    Sound.setSfx(s.sfx); Sound.setMusic(s.music);
    Renderer.quality = s.quality;
    Renderer.resize();
  },

  charDef() { return CHAR_MAP[Store.data.char] || CHAR_MAP.naiwa; },

  /* ================= 开局 / 重置 ================= */
  reset() {
    this.time = 0; this.elapsed = 0; this.travel = 0; this.speed = 0;
    this.score = 0; this.runCoins = 0; this.mult = 1; this.maxMult = 1;
    this.coinStreak = 0; this.objs = []; this.parts = []; this.nextZ = 46;
    this.invuln = 0; this.dying = 0; this.hurtFlash = 0; this.shake = 0;
    this.reviveUsed = 0; this.springs = 0;
    this.powers = { magnet: 0, jet: 0, x2: 0, shoe: 0, board: 0 };
    this.player = {
      x: 0, y: 0, vy: 0, lane: 1, state: 'run', phase: 0,
      rollT: 0, grounded: true, supportY: 0, squash: 0, lean: 0, boardT: 0,
    };
    this.camera.x = 0; this.camera.shake = 0;
    this.runStats = { coins: 0, jumps: 0, rolls: 0, roofs: 0, boardDist: 0, magnet: 0, jet: 0, boards: 0, best: 0 };
    this.themeTimer = 26;
    this.themeFrom = this.themeTo = THEMES.day; this.themeT = 1; this.theme = THEMES.day;
    this.intro = 1.25;
    this.chaser = { on: true, dist: 4.6, mode: 'intro', t: 0 };
  },

  start() {
    this.reset();
    this.state = 'run';
    // 开局自带道具（李子柒）
    const ch = this.charDef();
    if (ch && ch.p.starter) this.grantPower(Utils.pick(POWERS).id, true);
    // 悬浮板库存
    UI.hideAllScreens();
    UI.showHUD();
    Sound.resume();
    if (Store.data.settings.music) Sound.startMusic();
    UI.countdown('出发!', 700);
    Sound.countdown(true);
    // 起步生成少量金币
    for (let i = 0; i < 7; i++) this.addCoin(this.travel + 22 + i * 2.2, 0, 0.85);
  },

  /* ================= 主循环 ================= */
  loop(ts) {
    const dtRaw = (ts - this.last) / 1000;
    this.last = ts;
    const dt = Math.min(0.05, Math.max(0.0001, dtRaw));
    this.time += dt;
    this.trackFps(dtRaw);

    if (this.state === 'run') this.update(dt);
    else if (this.state === 'pause' || this.state === 'over' || this.state === 'menu') {
      // 菜单/暂停时也让粒子缓慢衰减
      if (this.state === 'menu') this.updateMenuScene(dt);
    }
    this.render();
    requestAnimationFrame((t) => this.loop(t));
  },

  trackFps(dtRaw) {
    const f = this.fps;
    f.samples.push(dtRaw);
    if (f.samples.length > 45) f.samples.shift();
    if (f.samples.length < 45 || this.state !== 'run') return;
    const avg = f.samples.reduce((a, b) => a + b, 0) / f.samples.length;
    f.avg = 1 / Math.max(0.0001, avg);
    if (f.avg < 48) {
      f.lowFrames++;
      if (f.lowFrames > 90 && f.dprStep === 0) { f.dprStep = 1; Renderer.dprScale = 0.82; Renderer.resize(); f.lowFrames = 0; }
      else if (f.lowFrames > 190 && f.dprStep === 1) { f.dprStep = 2; Renderer.dprScale = 0.66; Renderer.fxLow = true; Renderer.resize(); f.lowFrames = 0; }
    } else { f.lowFrames = Math.max(0, f.lowFrames - 1); }
  },

  /* 菜单背景用一点慢速卷动，看起来更活 */
  updateMenuScene(dt) {
    this.travel += dt * 6;
    this.theme = THEMES.day;
  },

  /* ================= 更新 ================= */
  update(dt) {
    if (this.devFreeze) return;             // 调试截图用：冻结世界只保留渲染
    this.elapsed += dt;
    const p = this.player;

    /* ---- 死亡演出 ---- */
    if (this.dying > 0) {
      this.dying -= dt;
      this.speed = Math.max(0, this.speed - dt * 34);
      this.travel += this.speed * dt;
      this.chaser.dist = Utils.lerp(this.chaser.dist, 1.5, 1 - Math.pow(0.001, dt));
      this.chaser.on = true; this.chaser.mode = 'catch';
      this.updateParticles(dt);
      this.shake = Math.max(0, this.shake - dt * 6);
      if (this.dying <= 0) this.finishRun();
      return;
    }

    /* ---- 开场加速 ---- */
    if (this.intro > 0) {
      this.intro -= dt;
      this.speed = Math.min(CFG.SPEED_START, this.speed + dt * 30);
    }
    const ch = this.charDef();
    const jetOn = this.powers.jet > 0;
    let target = Math.min(CFG.SPEED_MAX, CFG.SPEED_START + this.elapsed * CFG.SPEED_ACCEL + this.travel * 0.0011);
    if (jetOn) target = Math.max(target, CFG.SPEED_JET);
    this.speed = jetOn ? Utils.lerp(this.speed, target, 1 - Math.pow(0.05, dt))
      : Utils.lerp(this.speed, target, 1 - Math.pow(0.35, dt));
    this.travel += this.speed * dt;

    /* ---- 倍数 ---- */
    this.mult = Math.min(5, 1 + Math.floor(this.travel / 400) * 0.25) * (this.powers.x2 > 0 ? 2 : 1);
    if (this.mult > this.maxMult) this.maxMult = this.mult;
    const scorePerM = CFG.SCORE_PER_M * (1 + (ch && ch.p.score ? ch.p.score : 0));
    this.score += this.speed * dt * scorePerM * this.mult;
    if (this.runStats) { this.runStats.best = Math.max(this.runStats.best, this.score); this.runStats.dist = this.travel; }

    /* ---- 道具计时 ---- */
    for (const k in this.powers) {
      if (this.powers[k] > 0) {
        const before = this.powers[k];
        this.powers[k] = Math.max(0, this.powers[k] - dt);
        if (before > 0 && this.powers[k] === 0) this.onPowerEnd(k);
      }
    }
    if (this.powers.board > 0) this.runStats.boardDist += this.speed * dt;

    /* ---- 角色状态与物理 ---- */
    p.phase += dt * (1.9 + this.speed * 0.055) * (p.state === 'roll' ? 0.5 : 1);
    if (p.phase > 1e6) p.phase = 0;
    const laneTargetX = Utils.laneX(p.lane);
    const ldx = laneTargetX - p.x;
    p.x += Utils.clamp(ldx, -CFG.LANE_SNAP * dt, CFG.LANE_SNAP * dt);
    p.lean = Utils.lerp(p.lean, Utils.clamp(ldx * 1.6, -1, 1), 1 - Math.pow(0.001, dt));
    if (p.rollT > 0) {
      p.rollT -= dt;
      if (p.rollT <= 0) { p.rollT = 0; if (p.grounded) p.state = 'run'; }
    }
    // 悬浮板计时（库存板）
    if (p.boardT > 0) {
      p.boardT -= dt;
      if (p.boardT <= 0) { p.boardT = 0; this.breakBoard(false); }
    }

    // 支撑面（车顶）
    let support = 0;
    for (const o of this.objs) {
      if (o.kind !== 'train') continue;
      if (Math.abs(p.x - o.x) > o.hw + 0.30) continue;
      if (this.travel + 0.35 < o.worldZ || this.travel - 0.35 > o.worldZ + o.len) continue;
      if (p.y >= o.h - 0.32) support = Math.max(support, o.h);
    }
    p.supportY = support;

    if (jetOn) {
      p.vy = 0;
      p.y = Utils.lerp(p.y, 3.35, 1 - Math.pow(0.02, dt));
      p.state = 'fly'; p.grounded = false;
      if (Math.random() < 0.5) this.spawnJetCoin(dt);
    } else {
      p.vy -= CFG.GRAVITY * dt;
      p.y += p.vy * dt;
      if (p.y <= support && p.vy <= 0) {
        if (!p.grounded && p.vy < -6) { this.landFx(); }
        p.y = support; p.vy = 0; p.grounded = true; p.squash = Math.min(1, Math.abs(p.vy) / 14 + 0.25);
        if (p.rollT > 0) p.state = 'roll'; else p.state = 'run';
      } else {
        p.grounded = false;
        if (p.rollT > 0) p.state = 'roll';
        else p.state = p.vy > 0.4 ? 'jump' : 'fall';
      }
      if (support === 0 && p.y <= 0) { p.y = 0; }
    }
    p.squash = Math.max(0, p.squash - dt * 3.2);

    /* ---- 摄像机 ---- */
    const camXTarget = p.x * CFG.CAM_FOLLOW;
    this.camera.x = Utils.lerp(this.camera.x, camXTarget, 1 - Math.pow(0.002, dt));
    const camY = CFG.CAM_Y + Utils.clamp(p.y * 0.55, 0, 2.2);
    Renderer.setCamera(this.camera.x, camY);
    this.shake = Math.max(0, this.shake - dt * 5);
    if (this.shake > 0) {
      Renderer.camX += (Math.random() - 0.5) * this.shake * 0.35;
      Renderer.camY += (Math.random() - 0.5) * this.shake * 0.28;
    }
    this.hurtFlash = Math.max(0, this.hurtFlash - dt * 2.2);
    if (this.invuln > 0) this.invuln -= dt;

    /* ---- 检查员追逐 ---- */
    const chs = this.chaser;
    if (chs.on && chs.mode === 'intro') {
      chs.dist = Math.min(9.5, chs.dist + dt * 2.4);
      if (chs.dist >= 9.5) chs.on = false;
    } else if (chs.on && chs.mode === 'idle') {
      chs.dist = Math.min(9.5, chs.dist + dt * 1.6);
      if (chs.dist >= 9.5) chs.on = false;
    }

    /* ---- 道具效果：磁铁 ---- */
    if (this.powers.magnet > 0) this.applyMagnet(dt);

    /* ---- 生成 ---- */
    while (this.nextZ < this.travel + CFG.FAR * 0.85) this.genNext();

    /* ---- 清理 ---- */
    const cut = this.travel - CFG.CAM_BACK - 14;
    if (this.objs.length > 0 && this.objs[0].worldZ + (this.objs[0].len || 0) < cut) {
      this.objs = this.objs.filter(o => o.worldZ + (o.len || 0) > cut);
    } else if (this.objs.length > 260) {
      this.objs = this.objs.filter(o => o.worldZ + (o.len || 0) > cut);
    }

    /* ---- 移动列车 / 碰撞 ---- */
    for (let i = 0; i < this.objs.length; i++) {
      const o = this.objs[i];
      if (o.vz) o.worldZ -= o.vz * dt;
      if (o.kind === 'coin') { o.spin += dt * 4.2; if (o.magnetized) this.magnetMove(o, dt); }
      if (o.kind === 'power') o.t += dt;
      this.collide(o);
    }

    /* ---- 粒子 ---- */
    this.updateParticles(dt);

    /* ---- 主题切换 ---- */
    this.themeTimer -= dt;
    if (this.themeTimer <= 0) {
      this.themeTimer = Utils.rand(34, 52);
      const order = ['day', 'dusk', 'night', 'rain', 'night', 'day'];
      this.themeFrom = this.theme;
      this.themeTo = THEMES[Utils.pick(['day', 'dusk', 'night', 'rain'])];
      this.themeT = 0;
      UI.toast('天气变化：' + this.themeTo.name);
    }
    if (this.themeT < 1) {
      this.themeT = Math.min(1, this.themeT + dt / 2.4);
      this.theme = mixTheme(this.themeFrom, this.themeTo, this.themeT);
    }

    /* ---- 任务进度 ---- */
    Missions.progress('dist', this.speed * dt);
    Missions.progress('single', Math.floor(this.score), true);
    if (this.powers.board > 0) Missions.progress('boardrun', this.speed * dt);

    UI.updateHUD(this);
  },

  /* ================= 输入动作 ================= */
  moveLane(dir) {
    if (this.state !== 'run' || this.dying > 0) return;
    const p = this.player;
    const nl = Utils.clamp(p.lane + dir, 0, CFG.LANES - 1);
    if (nl === p.lane) return;
    p.lane = nl;
    Sound.whoosh();
    this.spawnDust(4);
  },
  jump() {
    if (this.state !== 'run' || this.dying > 0) return;
    const p = this.player;
    if (!p.grounded && !(this.powers.jet > 0)) return;
    if (p.rollT > 0) p.rollT = 0;
    const ch = this.charDef();
    let v = CFG.JUMP_V * (1 + (ch && ch.p.jump ? ch.p.jump : 0));
    if (this.powers.shoe > 0) v = CFG.JUMP_V_SHOE * (1 + (ch && ch.p.jump ? ch.p.jump : 0));
    p.vy = v;
    p.grounded = false;
    p.state = 'jump';
    this.runStats.jumps++;
    Missions.progress('jump', 1);
    Sound.jump();
    this.spawnDust(8);
    if (Store.data.settings.vibe && navigator.vibrate) navigator.vibrate(8);
  },
  roll() {
    if (this.state !== 'run' || this.dying > 0) return;
    const p = this.player;
    if (!p.grounded) {                       // 空中下滑 → 快速落地
      p.vy = Math.min(p.vy, -12);
      p.state = 'roll';
    }
    p.rollT = CFG.ROLL_TIME;
    p.state = 'roll';
    this.runStats.rolls++;
    Missions.progress('roll', 1);
    Sound.roll();
    this.spawnDust(10);
  },
  useBoard() {
    if (this.state !== 'run' || this.dying > 0) return;
    const p = this.player;
    if (p.boardT > 0) return;
    if (Store.data.boardCount <= 0) {
      UI.toast('悬浮板已用完，捡道具补给吧');
      Sound.deny();
      return;
    }
    Store.data.boardCount--;
    Store.save();
    this.startBoard();
    Sound.board();
    UI.updateHUD(this);
  },
  startBoard() {
    const p = this.player;
    p.boardT = this.powerDur('board');
    p.y = Math.max(p.y, 0.28);
    this.runStats.boards++;
    Missions.progress('board', 1);
    this.spawnBurst(p.x, p.y + 0.3, 16, '#ff8ad0');
  },
  breakBoard(silent) {
    const p = this.player;
    if (p.boardT <= 0 && silent) return;
    p.boardT = 0;
    this.invuln = CFG.BOOST_BOARD_SAVE + (this.charDef().p.iframe || 0);
    this.shake = 1.2;
    if (!silent) {
      Sound.boardBreak();
      this.spawnBurst(p.x, p.y + 0.4, 22, '#ff6bd0');
      UI.toast('悬浮板碎了！无敌 1.6 秒');
    }
  },

  powerDur(kind) {
    const table = { magnet: 1.6, jet: 0.9, shoe: 1.2, board: 3 };
    let t = CFG.POWER_TIME[kind] + (Store.data.skills[kind] || 0) * (table[kind] || 0);
    const ch = this.charDef();
    if (ch && ch.p[kind]) t *= (1 + ch.p[kind]);
    return t;
  },
  grantPower(kind, silent) {
    const idx = POWERS.findIndex(x => x.id === kind);
    const info = POWERS[idx] || POWERS[0];
    if (kind === 'board') { this.startBoard(); }
    else { this.powers[kind] = Math.max(this.powers[kind], this.powerDur(kind)); }
    Store.data.powerUses++;
    Missions.progress(kind === 'board' ? 'board' : kind, 1);
    if (!silent) {
      UI.toast('获得 ' + info.name);
      Sound.power();
      this.spawnBurst(this.player.x, this.player.y + 1.0, 20, info.color);
    }
    UI.updateHUD(this);
  },
  onPowerEnd(kind) {
    if (kind === 'jet') UI.toast('喷射结束');
  },

  /* ================= 磁铁 ================= */
  applyMagnet(dt) {
    const p = this.player;
    const range = 6.0 * (1 + (this.charDef().p.magnetRange || 0));
    for (const o of this.objs) {
      if (o.kind !== 'coin' || o.taken) continue;
      const dz = o.worldZ - this.travel;
      if (dz < -3 || dz > range * 2.2) continue;
      if (Math.abs(o.x - p.x) > range) continue;
      o.magnetized = true;
    }
  },
  magnetMove(o, dt) {
    const p = this.player;
    const k = 1 - Math.pow(0.0015, dt);
    o.x = Utils.lerp(o.x, p.x, k);
    o.y = Utils.lerp(o.y, p.y + 0.85, k);
    o.worldZ = Utils.lerp(o.worldZ, this.travel + 0.2, k * 0.85);
  },

  /* ================= 碰撞 ================= */
  collide(o) {
    const p = this.player;
    if (o.taken) return;
    const dzNear = this.travel + 0.42, dzFar = this.travel - 0.42;
    if (o.kind === 'coin') {
      if (Math.abs(o.worldZ - this.travel) > 1.3) return;
      if (Math.abs(o.x - p.x) > 1.05) return;
      if (Math.abs(o.y - (p.y + 0.85)) > 1.9) return;
      this.collectCoin(o);
      return;
    }
    if (o.kind === 'power') {
      if (Math.abs(o.worldZ - this.travel) > 1.4) return;
      if (Math.abs(o.x - p.x) > 1.15) return;
      if (Math.abs(o.y - (p.y + 0.9)) > 2.1) return;
      o.taken = true;
      this.grantPower(o.kind2, false);
      return;
    }
    if (this.dying > 0) return;
    // 障碍 / 车厢
    const len = o.len || 0.6;
    if (dzNear < o.worldZ || dzFar > o.worldZ + len) {
      // 记录擦身而过（用于连击提示）
      return;
    }
    const half = (o.hw || 0.95);
    if (Math.abs(o.x - p.x) > half + 0.40) return;
    const py = p.y, ph = p.rollT > 0 ? CFG.ROLL_H : CFG.PLAYER_H;

    // 弹跳垫：把你送上云霄
    if (o.spring) {
      if (this.powers.jet > 0) return;
      if (py < (o.y1 || 0.42) + 0.15) {
        p.vy = o.launch || 14;
        p.grounded = false;
        p.state = 'jump';
        p.rollT = 0;
        this.springs++;
        Sound.jump();
        this.spawnBurst(p.x, 0.4, 14, '#c9a7ff', 0.9);
      }
      return;
    }
    const top = o.kind === 'train' ? o.h : (o.y1 || 1.05);
    const bottom = o.kind === 'train' ? 0 : (o.y0 || 0);
    if (o.kind === 'train' && py >= o.h - 0.32) {
      // 站在车顶 → 计数 + 车顶金币提示
      if (!o.roofCounted && py >= o.h - 0.2) {
        o.roofCounted = true;
        this.runStats.roofs++;
        Missions.progress('roof', 1);
        UI.toast('车顶跑酷 +' + Math.round(50 * this.mult));
        this.score += 50 * this.mult;
        Sound.land();
      }
      return;
    }
    if (py < top && py + ph > bottom) {
      if (this.invuln > 0) {
        // 无敌时撞开障碍（视觉反馈）
        if (o.kind !== 'train') { o.taken = true; this.spawnBurst(o.x, 0.8, 18, '#ffd34d'); UI.toast('撞碎！'); }
        return;
      }
      this.crash(o);
    } else if (!o.kind || o.kind !== 'train') {
      // 成功跨越 → 擦身奖励
      this.nearMiss(o);
    }
  },
  nearMiss(o) {
    if (this.nearMissCd > 0) return;
    this.nearMissCd = 0.6;
    const bonus = CFG.NEAR_MISS_SCORE * this.mult;
    this.score += bonus;
    this.coinStreak++;
    if (this.coinStreak % 5 === 0) UI.combo('漂亮！x' + this.coinStreak);
    Sound.whoosh();
    this.spawnBurst(o.x, 1.0, 6, '#ffffff');
  },

  collectCoin(o) {
    o.taken = true;
    const ch = this.charDef();
    const bonus = 1 + (ch && ch.p.coin ? ch.p.coin : 0);
    const gain = Math.round(CFG.COIN_VALUE * bonus * (this.powers.x2 > 0 ? 2 : 1));
    this.runCoins += gain;
    this.runStats.coins += gain;
    this.score += CFG.COIN_SCORE * this.mult * (this.powers.x2 > 0 ? 2 : 1);
    this.coinStreak++;
    const now = this.time;
    if (now - this.lastCoinAt < 0.8) { /* streak continues */ } else this.coinStreak = Math.max(1, this.coinStreak);
    this.lastCoinAt = now;
    if (this.coinSndCd <= 0) { Sound.coin(this.coinStreak); this.coinSndCd = 0.045; }
    Missions.progress('coins', gain);
    Missions.progress('coinRun', gain);
    if (Renderer.fxLow !== true || this.parts.length < 60) this.spawnBurst(o.x, o.y, 4, '#ffe9a8', 0.28);
  },

  crash(o) {
    if (this.god) return;                    // 调试模式：无敌
    const p = this.player;
    if (p.boardT > 0) {                     // 悬浮板挡一命
      this.breakBoard(false);
      p.vy = Math.max(p.vy, 6.5);
      this.shake = 1.0;
      return;
    }
    Sound.laugh();
    Sound.crash();
    this.dying = 0.95;
    this.hurtFlash = 1;
    this.shake = 1.8;
    this.spawnBurst(p.x, p.y + 0.9, 26, '#ff5d55', 0.8);
    UI.toast(Utils.pick(QUOTES.crash));
    if (Store.data.settings.vibe && navigator.vibrate) navigator.vibrate([30, 40, 60]);
  },

  landFx() {
    Sound.land();
    this.player.squash = 1;
    this.spawnDust(10);
    this.shake = Math.max(this.shake, 0.25);
  },

  /* ================= 粒子 ================= */
  spawnBurst(x, y, n, color, spread) {
    spread = spread || 0.6;
    for (let i = 0; i < n; i++) {
      this.parts.push({
        x: x + Utils.rand(-0.25, 0.25), y: y + Utils.rand(-0.2, 0.2), z: this.travel + Utils.rand(-0.3, 0.5),
        vx: Utils.rand(-spread, spread) * 3, vy: Utils.rand(0.4, 2.4) * spread * 2, vz: Utils.rand(-1, 2.2),
        r: Utils.rand(0.05, 0.12), life: Utils.rand(0.3, 0.7), max: 0.7, color: color, shape: 'dot',
      });
    }
  },
  spawnDust(n) {
    const p = this.player;
    if (p.y > 0.4) return;
    for (let i = 0; i < n; i++) {
      this.parts.push({
        x: p.x + Utils.rand(-0.3, 0.3), y: 0.05, z: this.travel - 0.4 + Utils.rand(-0.3, 0.3),
        vx: Utils.rand(-1, 1), vy: Utils.rand(0.6, 1.8), vz: Utils.rand(-2.5, -0.5),
        r: Utils.rand(0.05, 0.1), life: 0.35, max: 0.35, color: 'rgba(220,215,200,.85)', shape: 'dot',
      });
    }
  },
  spawnJetCoin() {
    const p = this.player;
    this._jetT = (this._jetT || 0) + 1;
    if (this._jetT % 8 !== 0) return;
    this.addCoin(this.travel + 26, p.x, 3.4);
  },
  updateParticles(dt) {
    const ps = this.parts;
    for (let i = ps.length - 1; i >= 0; i--) {
      const pt = ps[i];
      pt.life -= dt;
      if (pt.life <= 0) { ps.splice(i, 1); continue; }
      pt.x += pt.vx * dt; pt.y += pt.vy * dt; pt.z += pt.vz * dt;
      pt.vy -= 3.2 * dt;
      if (pt.y < 0.02) { pt.y = 0.02; pt.vy *= -0.3; }
    }
    if (ps.length > 260) ps.splice(0, ps.length - 260);
  },

  /* ================= 关卡生成 ================= */
  genNext() {
    const z = this.nextZ;
    const d = Utils.clamp(this.travel / 2600, 0, 1);
    const r = Math.random();
    const G = Gen;
    G.z = z;
    let guard = 0;
    const before = this.objs.length;
    do {
      G.z = z;
      G.diff = d;
      Gen.pickPattern(d);
      guard++;
    } while (this.objs.length === before && guard < 6);   // 保证每段都产出东西
    this.nextZ = G.z + Utils.rand(4, 12);
  },

  addCoin(worldZ, x, y) {
    this.objs.push({ kind: 'coin', worldZ: worldZ, x: x, y: y, spin: Math.random() * 6.28, taken: false });
  },
  addPower(worldZ, x, y, kind) {
    this.objs.push({ kind: 'power', worldZ: worldZ, x: x, y: y || 1.1, kind2: kind, t: Math.random() * 6, seed: Math.random() * 6, taken: false });
  },
  addObstacle(type, lane, extra) {
    const base = { kind: 'obstacle', otype: type, worldZ: this.nextZ, x: Utils.laneX(lane) };
    const D = {
      barrier: { hw: 0.95, len: 0.55, y0: 0, y1: 1.05 },
      dumpster: { hw: 0.84, len: 1.55, y0: 0, y1: 1.30 },
      highbar: { hw: 1.15, len: 0.30, y0: 1.35, y1: 2.55 },
      cone: { hw: 0.42, len: 0.5, y0: 0, y1: 0.66 },
      spring: { hw: 0.85, len: 1.1, y0: 0, y1: 0.42, spring: true },
    }[type];
    Object.assign(base, D, extra || {});
    this.objs.push(base);
    return base;
  },
  addTrain(worldZ, lane, len, h, opts) {
    const colors = ['#d94f3d', '#3f7fd9', '#dfae2b', '#4fae6b', '#8a5fd9', '#b9c2cc', '#e0703f'];
    const o = Object.assign({
      kind: 'train', worldZ: worldZ, x: Utils.laneX(lane), hw: 1.07, len: len, h: h,
      color: Utils.pick(colors),
    }, opts || {});
    this.objs.push(o);
    return o;
  },
};

/* =========================================================
   关卡段落生成器
   ========================================================= */
const Gen = {
  z: 0, diff: 0,
  laneX: (l) => Utils.laneX(l),

  /* 每条段落都必须保证至少一条车道可通过 */
  patterns: [
    { id: 'coinLine', w: () => 12, fn: (G) => {
      const lane = Utils.irand(0, 2), n = Utils.irand(6, 10);
      for (let i = 0; i < n; i++) Game.addCoin(G.z + i * 2.1, G.laneX(lane), 0.85);
      G.z += n * 2.1 + 7;
    } },
    { id: 'coinArc', w: () => 10, fn: (G) => {
      const lane = Utils.irand(0, 2), n = 8;
      for (let i = 0; i < n; i++) Game.addCoin(G.z + i * 2.0, G.laneX(lane), 0.9 + Math.sin(i / (n - 1) * Math.PI) * 1.7);
      G.z += n * 2.0 + 7;
    } },
    { id: 'barrier', w: () => 12, fn: (G) => {
      const lane = Utils.irand(0, 2);
      Game.addObstacle(Utils.pick(['barrier', 'barrier', 'cone', 'dumpster']), lane, { worldZ: G.z });
      const other = (lane + 1) % 3;
      for (let i = 0; i < 4; i++) Game.addCoin(G.z + i * 2.0, G.laneX(other), 0.85);
      G.z += 12;
    } },
    { id: 'doubleBlock', w: () => 6 + Gen.diffGuess * 8, fn: (G) => {
      const free = Utils.irand(0, 2);
      for (let l = 0; l < 3; l++) {
        if (l === free) continue;
        Game.addObstacle(Utils.pick(['barrier', 'dumpster', 'cone']), l, { worldZ: G.z + Utils.rand(-0.4, 0.4) });
      }
      for (let i = 0; i < 5; i++) Game.addCoin(G.z + i * 2.2, G.laneX(free), 0.85);
      G.z += 15;
    } },
    { id: 'highbar', w: () => 10, fn: (G) => {
      const lane = Utils.irand(0, 2);
      Game.addObstacle('highbar', lane, { worldZ: G.z });
      if (Math.random() < 0.6) Game.addObstacle('highbar', (lane + 1) % 3, { worldZ: G.z });
      G.z += 13;
    } },
    { id: 'slideJump', w: () => 6 + Gen.diffGuess * 6, fn: (G) => {
      const lane = Utils.irand(0, 2);
      Game.addObstacle('highbar', lane, { worldZ: G.z });
      Game.addObstacle('barrier', lane, { worldZ: G.z + 11 });
      for (let i = 0; i < 6; i++) Game.addCoin(G.z + i * 2.1, G.laneX(lane), 0.85);
      G.z += 20;
    } },
    { id: 'lowTrain', w: () => 10, fn: (G) => {
      const lane = Utils.irand(0, 2), len = Utils.irand(16, 28);
      Game.addTrain(G.z, lane, len, 1.35);
      for (let i = 0; i < Math.floor(len / 2.4); i++) Game.addCoin(G.z + 3 + i * 2.4, G.laneX(lane), 1.9);
      const other = (lane + 2) % 3;
      for (let i = 0; i < 4; i++) Game.addCoin(G.z + 4 + i * 2.2, G.laneX(other), 0.85);
      G.z += len + 11;
    } },
    { id: 'tallTrain', w: () => 12, fn: (G) => {
      const lane = Utils.irand(0, 2), len = Utils.irand(14, 26);
      Game.addTrain(G.z, lane, len, 3.3);
      const other = (lane + 1) % 3;
      for (let i = 0; i < Math.floor(len / 2.4); i++) Game.addCoin(G.z + 3 + i * 2.4, G.laneX(other), 0.85);
      G.z += len + 10;
    } },
    { id: 'trainCorridor', w: () => 3 + Gen.diffGuess * 9, fn: (G) => {
      const free = Utils.irand(0, 2);
      const len = Utils.irand(16, 26);
      for (let l = 0; l < 3; l++) if (l !== free) Game.addTrain(G.z, l, len, 3.3);
      for (let i = 0; i < Math.floor(len / 2.4); i++) Game.addCoin(G.z + 3 + i * 2.4, G.laneX(free), 0.85);
      G.z += len + 12;
    } },
    { id: 'springRoof', w: () => Gen.diffGuess > 0.1 ? 9 : 0, fn: (G) => {
      const lane = Utils.irand(0, 2);
      Game.addObstacle('spring', lane, { worldZ: G.z, spring: true, launch: 15.5 });
      const len = Utils.irand(18, 26);
      Game.addTrain(G.z + 4.5, lane, len, 2.25);
      for (let i = 0; i < Math.floor(len / 2.3); i++) Game.addCoin(G.z + 8 + i * 2.3, G.laneX(lane), 2.8);
      G.z += len + 14;
    } },
    { id: 'coneLine', w: () => 7, fn: (G) => {
      const lane = Utils.irand(0, 2), n = Utils.irand(3, 6);
      for (let i = 0; i < n; i++) Game.addObstacle('cone', lane, { worldZ: G.z + i * 3.2 });
      if (Math.random() < 0.6) Game.addObstacle('barrier', (lane + 1) % 3, { worldZ: G.z + 4 });
      G.z += n * 3.2 + 8;
    } },
    { id: 'oncoming', w: () => Gen.diffGuess > 0.12 ? 10 : 0, fn: (G) => {
      const lane = Utils.irand(0, 2);
      const t = Game.addTrain(G.z + 105, lane, 22, 3.3, { vz: 19 + 12 * Gen.diffGuess, headlight: true });
      t.oncoming = true;
      UI.warn('⚠ ' + (lane === 0 ? '左侧' : lane === 1 ? '中间' : '右侧') + '车道有列车驶来！');
      Sound.deny();
      G.z += 16;
    } },
    { id: 'reward', w: () => 6, fn: (G) => {
      const lane = Utils.irand(0, 2);
      Game.addPower(G.z, G.laneX(lane), 1.15, Utils.pick(POWERS).id);
      for (let i = 0; i < 6; i++) Game.addCoin(G.z + 4 + i * 2.1, G.laneX(lane), 0.9);
      G.z += 20;
    } },
    { id: 'powerPair', w: () => 5, fn: (G) => {
      Game.addPower(G.z, G.laneX(Utils.irand(0, 2)), 1.15, Utils.pick(POWERS).id);
      Game.addPower(G.z + 26, G.laneX(Utils.irand(0, 2)), 1.15, Utils.pick(POWERS).id);
      G.z += 34;
    } },
    { id: 'roofLong', w: () => 8, fn: (G) => {
      const lane = Utils.irand(0, 2), len = Utils.irand(30, 44);
      Game.addTrain(G.z, lane, len, 1.35);
      Game.addObstacle('spring', (lane + 2) % 3, { worldZ: G.z - 4, spring: true, launch: 13.5 });
      for (let i = 0; i < Math.floor(len / 2.2); i++) Game.addCoin(G.z + 3 + i * 2.2, G.laneX(lane), 1.9);
      Game.addPower(G.z + len * 0.6, G.laneX(lane), 2.9, Utils.pick(POWERS).id);
      G.z += len + 12;
    } },
    { id: 'mixedLow', w: () => 6 + Gen.diffGuess * 6, fn: (G) => {
      const a = Utils.irand(0, 2), b = (a + 1) % 3;
      Game.addTrain(G.z, a, 18, 1.35);
      Game.addObstacle('highbar', b, { worldZ: G.z + 6 });
      for (let i = 0; i < 6; i++) Game.addCoin(G.z + 2 + i * 2.3, G.laneX(a), 1.9);
      G.z += 28;
    } },
  ],

  get diffGuess() { return this.diff; },

  pickPattern(diff) {
    const pool = [];
    let total = 0;
    for (const p of this.patterns) {
      const w = Math.max(0, p.w.call(this));
      if (w <= 0) continue;
      total += w; pool.push({ p: p, acc: total });
    }
    if (total <= 0) { this.fallback(); return; }
    let r = Math.random() * total;
    for (const it of pool) { if (r <= it.acc) { it.p.fn(this); return; } }
    pool[pool.length - 1].p.fn(this);
  },

  fallback() {
    for (let i = 0; i < 6; i++) Game.addCoin(this.z + i * 2.1, this.laneX(Utils.irand(0, 2)), 0.85);
    this.z += 20;
  },
};

/* =========================================================
   渲染 / 流程控制 / 输入
   ========================================================= */
Object.assign(Game, {

  /* ---------------- 渲染 ---------------- */
  render() {
    const th = this.theme;
    const c = Renderer.c;
    Renderer.drawSky(th, this.travel, this.time);
    Renderer.drawGround(th, this.travel);
    const rz = (wz) => wz - this.travel + CFG.CAM_BACK;
    const p = this.player;

    const showWorld = this.state !== 'menu';
    if (showWorld) {
      // 地面阴影
      const supportY = p.y;
      Renderer.drawShadow(p.x, CFG.CAM_BACK, 1, supportY > 0.25 ? 0.22 : 0.34);
      for (const o of this.objs) {
        if (o.taken || o.kind !== 'train') continue;
        const zr = rz(o.worldZ + o.len * 0.5);
        if (zr < 1 || zr > CFG.FAR * 0.7) continue;
        Renderer.drawShadow(o.x, zr, 1.5, 0.24);
      }
      if (this.chaser.on) {
        const zr = rz(this.travel - this.chaser.dist);
        if (zr > CFG.NEAR + 0.4) {
          Renderer.drawShadow(p.x + 0.95, zr, 1, 0.3);
          Renderer.drawShadow(p.x - 1.25, zr + 0.6, 0.7, 0.25);
        }
      }

      // 收集渲染队列（远近排序：远 → 近）
      const rq = this.rq;
      rq.length = 0;
      for (const o of this.objs) {
        if (o.taken) continue;
        // z 小于 2.6 的物体已经跑到摄像机与角色之间，放大后会糊满屏幕，直接剔除
        if (o.kind === 'train') {
          const z1 = rz(o.worldZ + o.len);
          if (z1 < 2.6 || rz(o.worldZ) > CFG.FAR) continue;
          rq.push({ z: z1, o: o });
        } else {
          const zr = rz(o.worldZ);
          if (zr < 2.6 || zr > CFG.FAR) continue;
          rq.push({ z: zr, o: o });
        }
      }
      // 角色
      rq.push({ z: CFG.CAM_BACK, player: true });
      if (this.chaser.on) {
        const zc = rz(this.travel - this.chaser.dist);
        if (zc > CFG.NEAR + 0.4) rq.push({ z: zc, chaser: true });
      }
      rq.sort((a, b) => b.z - a.z);

      for (const it of rq) {
        if (it.player) { this.drawPlayer(); continue; }
        if (it.chaser) { this.drawChaser(); continue; }
        const o = it.o;
        const zr = rz(o.worldZ);
        if (o.kind === 'train') {
          Renderer.drawTrain({ x0: o.x - o.hw, x1: o.x + o.hw, y0: 0, y1: o.h, z0: zr, z1: zr + o.len, color: o.color, headlight: o.headlight, h: o.h });
        } else if (o.kind === 'obstacle') {
          Renderer.drawObstacle({ type: o.otype, x: o.x, z: zr });
        } else if (o.kind === 'coin') {
          Renderer.drawCoin({ x: o.x, y: o.y, z: zr, spin: o.spin, scale: 1 });
        } else if (o.kind === 'power') {
          Renderer.drawPower({ x: o.x, y: o.y, z: zr, kind: o.kind2, t: o.t, seed: o.seed });
        }
      }

      // 粒子
      for (const pt of this.parts) {
        const q = Renderer.proj(pt.x, pt.y, rz(pt.z));
        if (!q) continue;
        Renderer.drawParticle({ x: pt.x, y: pt.y, z: rz(pt.z), r: pt.r, life: pt.life, max: pt.max, color: pt.color, shape: pt.shape });
      }
    }

    Renderer.drawFog(th);
    Renderer.drawWeather(th, this.time, Utils.clamp((this.speed - CFG.SPEED_START * 1.3) / (CFG.SPEED_MAX - CFG.SPEED_START * 1.3), 0, 1));

    // 受击红闪 / 无敌闪烁
    if (this.hurtFlash > 0.01) {
      c.globalAlpha = this.hurtFlash * 0.35;
      c.fillStyle = '#ff3b30';
      c.fillRect(0, 0, Renderer.W, Renderer.H);
      c.globalAlpha = 1;
    }
    if (this.invuln > 0 && this.state === 'run') {
      c.globalAlpha = 0.10 + Math.abs(Math.sin(this.time * 18)) * 0.12;
      c.fillStyle = '#9ad6ff';
      c.fillRect(0, 0, Renderer.W, Renderer.H);
      c.globalAlpha = 1;
    }
  },

  drawPlayer() {
    const p = this.player;
    const ch = this.charDef();
    const pose = {
      state: this.dying > 0 ? (this.dying > 0.45 ? 'jump' : 'crash') : (this.powers.jet > 0 ? 'fly' : p.state),
      t: p.phase % 1, lean: p.lean, squash: p.squash, front: false,
    };
    const zr = CFG.CAM_BACK;
    if (p.boardT > 0) {
      Renderer.drawHoverboard(p.x, p.y + 0.06, zr, 1.5, this.time, ['#ff9ade', '#e0348f']);
      Renderer.drawShadow(p.x, zr, 1.1, 0.3);
    }
    // 喷射背包尾焰
    if (this.powers.jet > 0) {
      const q = Renderer.proj(p.x, p.y + 0.55, zr);
      if (q) {
        const c = Renderer.c;
        const g = c.createLinearGradient(q.sx, q.sy, q.sx, q.sy + 70);
        g.addColorStop(0, 'rgba(255,214,110,.9)'); g.addColorStop(0.5, 'rgba(255,120,40,.55)'); g.addColorStop(1, 'rgba(255,80,20,0)');
        c.fillStyle = g;
        c.beginPath();
        c.moveTo(q.sx - 9, q.sy - 26); c.lineTo(q.sx + 9, q.sy - 26);
        c.lineTo(q.sx + 5 + Math.sin(this.time * 30) * 3, q.sy + 70);
        c.lineTo(q.sx - 5 - Math.sin(this.time * 24) * 3, q.sy + 70);
        c.closePath(); c.fill();
      }
    }
    Renderer.drawChar(ch.skin, p.x, p.y, zr, pose, CFG.PLAYER_H);
  },

  drawChaser() {
    const p = this.player;
    const zr = CFG.CAM_BACK - this.chaser.dist;
    const ph = (this.time * 3.4) % 1;
    Renderer.drawChar('inspector', p.x + 0.95, 0, zr, { state: 'run', t: ph, lean: 0.2, front: true }, CFG.PLAYER_H * 1.05);
    Renderer.drawChar('dog', p.x - 1.25, 0, zr + 0.6, { state: 'run', t: (ph + 0.5) % 1, lean: -0.2, front: true }, CFG.PLAYER_H * 0.62);
  },

  /* ---------------- 结束 / 复活 ---------------- */
  finishRun() {
    this.state = 'over';
    const save = Store.data;
    const st = this.runStats;
    const sc = Math.floor(this.score);
    const isBest = sc > save.best;
    if (isBest) save.best = sc;
    save.coins += this.runCoins;
    save.totalDist += Math.floor(this.travel);
    save.totalCoins += this.runCoins;
    save.roofCount += st.roofs;
    save.revives += this.reviveUsed;
    save.runs++;
    save.runs_log.push({ s: sc, d: Math.floor(this.travel), c: this.runCoins, t: Date.now() });
    save.runs_log.sort((a, b) => b.s - a.s);
    if (save.runs_log.length > 6) save.runs_log.length = 6;
    const newly = Achievements.check(save);
    Store.save();
    UI.showOver({
      score: sc, coins: this.runCoins, dist: Math.floor(this.travel),
      best: save.best, isBest: isBest, mult: this.maxMult,
      missions: Missions.snapshot(), achievements: newly,
      canRevive: this.reviveUsed < CFG.MAX_REVIVES && save.coins >= this.reviveCost(),
      reviveCost: this.reviveCost(),
    });
  },
  reviveCost() {
    const lv = Store.data.skills.revive || 0;
    return Math.max(60, CFG.REVIVE_COST - lv * 20);
  },
  revive() {
    const cost = this.reviveCost();
    const save = Store.data;
    if (this.reviveUsed >= CFG.MAX_REVIVES || save.coins < cost) { Sound.deny(); return false; }
    save.coins -= cost;
    save.revives++; this.reviveUsed++;
    Store.save();
    // 清理身边障碍
    const z0 = this.travel + CFG.CAM_BACK, z1 = this.travel + 26;
    this.objs = this.objs.filter(o => !(o.kind === 'obstacle' && o.worldZ > this.travel - 2 && o.worldZ < this.travel + 30));
    const p = this.player;
    p.y = Math.max(p.y, 0.2); p.vy = 0; p.rollT = 0; p.state = 'run';
    this.invuln = 3.4;
    this.dying = 0;
    this.speed = CFG.SPEED_START * 0.85;
    this.intro = 0.7;
    this.chaser = { on: true, dist: 5.0, mode: 'idle', t: 0 };
    this.state = 'run';
    Sound.revive();
    UI.hideAllScreens();
    UI.showHUD();
    UI.toast(Utils.pick(QUOTES.revive));
    this.spawnBurst(p.x, 1.0, 30, '#ffd34d', 1.6);
    return true;
  },
  pause() {
    if (this.state !== 'run' || this.dying > 0) return;
    this.pausedFrom = this.state;
    this.state = 'pause';
    Sound.stopMusic();
    UI.showPause(this);
  },
  resume() {
    if (this.state !== 'pause') return;
    this.state = 'run';
    this.last = performance.now();
    UI.hideAllScreens();
    UI.showHUD();
    if (Store.data.settings.music) Sound.startMusic();
  },
  restart() {
    UI.hideAllScreens();
    this.start();
  },
  quitToMenu() {
    this.state = 'menu';
    Sound.stopMusic();
    this.travel = 0;
    this.reset();
    UI.hideAllScreens();
    UI.showMenu();
  },

  /* ---------------- 输入 ---------------- */
  bindInput() {
    document.addEventListener('keydown', (e) => {
      const k = e.key.toLowerCase();
      if (k === 'arrowleft' || k === 'a') { this.moveLane(-1); e.preventDefault(); }
      else if (k === 'arrowright' || k === 'd') { this.moveLane(1); e.preventDefault(); }
      else if (k === 'arrowup' || k === 'w') { this.jump(); e.preventDefault(); }
      else if (k === 'arrowdown' || k === 's') { this.roll(); e.preventDefault(); }
      else if (k === ' ' || k === 'shift' || k === 'b') { this.useBoard(); e.preventDefault(); }
      else if (k === 'p' || k === 'escape') {
        if (this.state === 'run') this.pause();
        else if (this.state === 'pause') this.resume();
      } else if (k === 'r') {
        if (this.state === 'over') this.restart();
      } else if (k === 'enter') {
        if (this.state === 'menu') UI.hideAllScreens(), this.start();
        else if (this.state === 'over') this.restart();
      }
      Sound.resume();
    });

    // 触屏滑动
    let sx = 0, sy = 0, st = 0, moved = false, lastTap = 0;
    const el = document.getElementById('ui');
    el.addEventListener('touchstart', (e) => {
      const t = e.touches[0];
      sx = t.clientX; sy = t.clientY; st = performance.now(); moved = false;
      Sound.resume();
    }, { passive: true });
    el.addEventListener('touchmove', (e) => {
      if (this.state !== 'run') return;
      const t = e.touches[0];
      const dx = t.clientX - sx, dy = t.clientY - sy;
      if (Math.abs(dx) > 30 && Math.abs(dx) > Math.abs(dy)) {
        this.moveLane(dx > 0 ? 1 : -1); sx = t.clientX; moved = true;
      } else if (Math.abs(dy) > 30) {
        if (dy < 0) this.jump(); else this.roll();
        sy = t.clientY; moved = true;
      }
    }, { passive: true });
    el.addEventListener('touchend', (e) => {
      const dt = performance.now() - st;
      if (!moved && dt < 260 && this.state === 'run') {
        const now = performance.now();
        if (now - lastTap < 300) { this.useBoard(); lastTap = 0; }
        else { this.jump(); lastTap = now; }
      }
      moved = false;
    }, { passive: true });

    // 屏幕按钮
    const bind = (id, fn, repeat) => {
      const b = document.getElementById(id);
      if (!b) return;
      const fire = (e) => { e.preventDefault(); Sound.resume(); fn(); };
      b.addEventListener('touchstart', fire, { passive: false });
      b.addEventListener('mousedown', fire);
      if (repeat) {
        b.addEventListener('touchend', (e) => e.preventDefault(), { passive: false });
      }
    };
    bind('padLeft', () => this.moveLane(-1));
    bind('padRight', () => this.moveLane(1));
    bind('padJump', () => this.jump());
    bind('padRoll', () => this.roll());
    bind('btnBoard', () => this.useBoard());
    bind('btnPause', () => this.pause());
  },
});
