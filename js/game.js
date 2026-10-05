/* =========================================================
   捏捏跑酷 · 游戏主逻辑
   ========================================================= */
'use strict';

const Game = {
  state: 'boot',
  time: 0, elapsed: 0, travel: 0, speed: 0,
  score: 0, runCoins: 0, mult: 1, maxMult: 1, coinStreak: 0, lastCoinAt: 0,
  objs: [], parts: [], rq: [], nextZ: 0, springs: 0,
  invuln: 0, dying: 0, hurtFlash: 0, shake: 0, hitStop: 0, bounce: 0,
  nearMissCd: 0, coinSndCd: 0,
  themeFrom: THEMES.day, themeTo: THEMES.day, themeT: 1, theme: THEMES.day, themeTimer: 0,
  runStats: null, ranRevive: 0, reviveUsed: 0, pausedFrom: 'run',
  fps: { samples: [], avg: 60, quality: 'mid', lowFrames: 0, goodFrames: 0, dprStep: 0 },

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
    Sound.setSfx(s.sfx);
    /* 音源要先设，setMusic 内部的 applyMusic 会按它决定放合成还是原声 */
    Sound.setMusicSrc(s.musicSrc || 'synth');
    Sound.setMusic(s.music);
    Renderer.quality = s.quality;
    /* 画质档变了，描边/颗粒这些"锦上添花"的开合也要跟着重判一次 */
    if (Renderer.applyDetail) Renderer.applyDetail();
    Renderer.resize();
  },

  charDef() { return CHAR_MAP[Store.data.char] || CHAR_MAP[DEFAULT_SKIN]; },

  /* ================= 开局 / 重置 ================= */
  reset() {
    // 难度 + 出逃路线（三档难度、多地巡游）
    const dm = (typeof World !== 'undefined') ? World.cur() : { diff: { speedStart: 28, speedMax: 48, accel: 0.53, obstacleRate: 1, coinRate: 1, scoreMul: 1, name: '普通' }, map: null };
    this.mode = (typeof MODES !== 'undefined' && Store.data.mode) ? Store.data.mode : 'endless';
    const modeDef = (typeof MODES !== 'undefined') ? MODES.filter(m => m.id === this.mode)[0] : null;
    this.diff = dm.diff;
    this.mapDef = (modeDef && modeDef.map && typeof World !== 'undefined') ? World.map(modeDef.map) : dm.map;
    this.timeLeft = (modeDef && modeDef.time) ? modeDef.time : 0;   // 限时挑战倒计时
    this.challengeWin = false;
    this.time = 0; this.elapsed = 0; this.travel = 0; this.speed = 0;
    this._prevTravel = 0;
    this.score = 0; this.runCoins = 0; this.mult = 1; this.maxMult = 1;
    this.coinStreak = 0; this.objs = []; this.parts = []; this.nextZ = 46;
    this.invuln = 0; this.dying = 0; this.hurtFlash = 0; this.shake = 0;
    this.hitStop = 0; this.bounce = 0;
    this.nearMissCd = 0; this.coinSndCd = 0;
    this.reviveUsed = 0; this.springs = 0;
    this.powers = { magnet: 0, jet: 0, x2: 0, shoe: 0, board: 0, shield: 0, dash: 0, slow: 0 };
    this.player = {
      x: 0, y: 0, vy: 0, lane: 1, state: 'run', phase: 0,
      rollT: 0, grounded: true, supportY: 0, squash: 0, lean: 0, boardT: 0,
    };
    this.camera.x = 0; this.camera.shake = 0;
    this.runStats = { coins: 0, jumps: 0, rolls: 0, roofs: 0, boardDist: 0, magnet: 0, jet: 0, boards: 0, best: 0, near: 0, powers: 0, hits: 0 };
    this.chase = { hits: 0, grace: 0, active: false };     // 第一次撞击引来追兵，7 秒内再撞被抓
    this.themeTimer = 26;
    const base = (this.mapDef && this.mapDef.forceNight) ? THEMES.night : THEMES.day;
    this.themeFrom = this.themeTo = this.theme = base;
    this.themeT = 1;
    this.intro = 1.25;
    this.chaser = { on: false, dist: 9.0, mode: 'idle', t: 0 };
  },

  start() {
    this.reset();
    this.state = 'run';
    // 角色自带的"开局道具"（见 CHARS 里的 starter 标记）
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
    /* 这一层管的是画布分辨率（dprScale），2D / 3D 两条路都吃得到。
       同样必须两头都能走：旧版只有降档分支，dprStep 一旦加过就再也回不去，
       设备启动时抖一下，之后整局都是糊的。回升要求"明显高于阈值"（>56fps）
       并持续 180 帧，迟滞拉够，免得在 52fps 上下反复 resize。 */
    /* 降档阈值从 52fps 放到 46fps：52 太高了，很多手机稳定在 50fps 左右，
       本来玩着不卡，却被判成"性能不足"降到糊画质 —— 用户感知到的就是
       "明明挺流畅，画面却像打了马赛克"。
       两档降幅也从 0.84/0.68 收到 0.90/0.82：0.68 太狠，
       而且它和 pinch3d 的 resScale 是相乘关系，两个一起降会糊到没法看。 */
    if (f.avg < 46) {
      f.goodFrames = 0;
      f.lowFrames++;
      if (f.lowFrames > 50 && f.dprStep < 2) {
        f.dprStep++;
        Renderer.dprScale = f.dprStep === 1 ? 0.90 : 0.82;
        if (f.dprStep >= 2) Renderer.fxLow = true;
        Renderer.resize(); f.lowFrames = 0;
      }
    } else {
      f.lowFrames = Math.max(0, f.lowFrames - 1);
      if (f.avg > 56) {
        f.goodFrames = (f.goodFrames || 0) + 1;
        if (f.goodFrames > 180 && f.dprStep > 0) {
          f.dprStep--;
          Renderer.dprScale = f.dprStep === 0 ? 1 : 0.90;
          if (f.dprStep < 2) Renderer.fxLow = false;
          Renderer.resize(); f.goodFrames = 0;
        }
      } else f.goodFrames = 0;
    }
  },

  /* 菜单背景用一点慢速卷动，看起来更活 */
  updateMenuScene(dt) {
    this.travel += dt * 6;
    this.theme = THEMES.day;
  },

  /* ================= 更新 ================= */
  update(dt) {
    if (this.devFreeze) return;             // 调试截图用：冻结世界只保留渲染
    /* 撞击定格（hit stop）：撞上的头 0.1 秒，时间、粒子、镜头全部停住。
       没有这一下，撞击就是"滑过去"，而不是"撞上去"。 */
    if (this.hitStop > 0) { this.hitStop -= dt; return; }
    this.elapsed += dt;
    const p = this.player;
    /* 碰撞要做扫掠检测，得知道这一帧从哪儿跑到哪儿。
       放在所有 travel 自增之前取，见 collide() 开头的说明。 */
    this._prevTravel = this.travel;

    /* ---- 死亡演出：撞上去当场刹住 ----
       地铁跑酷里撞到车厢是"啪"一下定住，人被撞飞、画面立刻停，
       不会还带着速度往前滑十几米。所以速度直接归零、travel 只往后弹一点点，
       剩下的时间留给追兵扑上来和角色摔倒。 */
    if (this.dying > 0) {
      this.dying -= dt;
      this.speed = 0;
      this.hurtFlash = Math.max(0, this.hurtFlash - dt * 1.3);
      if (this.bounce > 0) {                 // 被撞得往后弹（纯视觉，不足半米）
        const b = Math.min(this.bounce, dt * 2.4);
        this.travel -= b; this.bounce -= b;
      }
      if (!p.grounded) {                     // 撞飞 → 落地 → 摔成 crash 姿势
        p.vy -= 26 * dt;
        p.y += p.vy * dt;
        if (p.y <= 0) { p.y = 0; p.vy = 0; p.grounded = true; this.spawnDust(8); }
      }
      this.chaser.dist = Utils.lerp(this.chaser.dist, 1.5, 1 - Math.pow(0.001, dt));
      this.chaser.on = true; this.chaser.mode = 'catch';
      this.updateParticles(dt);
      this.shake = Math.max(0, this.shake - dt * 6);
      if (this.dying <= 0) this.finishRun();
      return;
    }

    /* ---- 开场加速（速度曲线按难度：先陡后平） ---- */
    const D = this.diff || { speedStart: 28, speedMax: 48, accel: 0.53 };
    if (this.intro > 0) {
      this.intro -= dt;
      this.speed = Math.min(D.speedStart, this.speed + dt * 30);
    }
    const ch = this.charDef();
    const jetOn = this.powers.jet > 0;
    let target = Math.min(D.speedMax, D.speedStart + this.elapsed * D.accel + this.travel * 0.0011);
    if (jetOn) target = Math.max(target, CFG.SPEED_JET);
    if (this.powers.dash > 0) target *= 1.32;      // 无敌冲刺：跑得更快
    if (this.powers.slow > 0) target *= 0.60;      // 时间减速：世界变慢，好躲
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
    if (p.supportY > 0.25) this.runStats.roofDist = (this.runStats.roofDist || 0) + this.speed * dt;

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

    /* ---- 支撑面（车顶） ----
       三处和旧版不一样，都是为了"别把玩家吸到车顶上"：
       1) z 用扫掠区间（上一帧→这一帧），旧版 ±0.35 在高速下一帧就跨过去了，
          会在车顶上一脚踩空；
       2) 只有下落中（vy ≤ 0）才认车顶。旧版无条件吸附，起跳经过车顶高度时
          会突然被拽下来，手感像撞墙；
       3) 容差从 0.32 收到 0.18。旧版 0.32 意味着贴着车厢侧面跑也算站车顶，
          人会在车旁边凭空浮起来。 */
    let support = 0;
    const supA = Math.min(this._prevTravel, this.travel) - 0.42;
    const supB = Math.max(this._prevTravel, this.travel) + 0.42;
    for (const o of this.objs) {
      if (o.kind !== 'train') continue;
      if (Math.abs(p.x - o.x) > o.hw + 0.22) continue;
      if (supB < o.worldZ || supA > o.worldZ + o.len) continue;
      if (p.vy <= 0.01 && p.y >= o.h - 0.18) support = Math.max(support, o.h);
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
    /* 两个冷却计时器以前只赋初值、从来没人减，结果都是"一局只生效一次"：
       nearMissCd 卡在 0.6 之后擦身奖励就再也不给了，
       coinSndCd 卡在 0.045 之后金币音效也只响第一下。 */
    if (this.nearMissCd > 0) this.nearMissCd -= dt;
    if (this.coinSndCd > 0) this.coinSndCd -= dt;

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

    /* ---- 清理（就地回收进对象池，不新建数组） ---- */
    const cut = this.travel - CFG.CAM_BACK - 14;
    if ((this.objs.length > 0 && this.objs[0].worldZ + (this.objs[0].len || 0) < cut) || this.objs.length > 260) {
      this._sweepObjs(cut);
    }

    /* ---- 移动列车 / 碰撞 ---- */
    for (let i = 0; i < this.objs.length; i++) {
      const o = this.objs[i];
      if (o.vz) o.worldZ -= o.vz * dt;
      /* 横扫杆：在两条车道之间来回摆动，撞到边界反向 */
      if (o.vx) {
        o.x += o.vx * dt;
        if (o.x < o.xMin) { o.x = o.xMin; o.vx = -o.vx; }
        else if (o.x > o.xMax) { o.x = o.xMax; o.vx = -o.vx; }
      }
      if (o.kind === 'coin') { o.spin += dt * 4.2; if (o.magnetized) this.magnetMove(o, dt); }
      if (o.kind === 'power') o.t += dt;
      this.collide(o);
    }

    /* ---- 粒子 ---- */
    this.updateParticles(dt);

    /* ---- 主题切换（叠加当前世界地图色调） ---- */
    this.themeTimer -= dt;
    if (this.themeTimer <= 0 && !(this.mapDef && this.mapDef.forceNight)) {
      this.themeTimer = Utils.rand(34, 52);
      this.themeFrom = this.theme;
      this.themeTo = THEMES[Utils.pick(['day', 'dusk', 'night', 'rain'])];
      this.themeT = 0;
      UI.toast('天气变化：' + this.themeTo.name);
    }
    const cycle = (this.themeT < 1) ? mixTheme(this.themeFrom, this.themeTo, Math.min(1, this.themeT + dt / 2.4)) : this.themeTo;
    if (this.themeT < 1) this.themeT = Math.min(1, this.themeT + dt / 2.4);
    this.theme = (typeof World !== 'undefined') ? World.applyMap(cycle, this.mapDef) : cycle;

    /* ---- 追逐容错倒计时（高仿：7 秒内再次撞击就被抓） ---- */
    const cs = this.chase;
    if (cs && cs.active) {
      cs.grace -= dt;
      this.chaser.on = true;
      this.chaser.mode = 'chase';
      this.chaser.dist = Utils.lerp(this.chaser.dist, 2.6, 1 - Math.pow(0.4, dt));
      if (cs.grace <= 0) {           // 撑过去了：追兵放弃
        cs.active = false; cs.hits = 0;
        this.chaser.dist = 9.5;
        UI.toast('甩掉检票员了！');
      }
    } else if (this.chaser && this.chaser.on && this.chaser.mode !== 'catch') {
      this.chaser.dist = Utils.lerp(this.chaser.dist, 9.5, 1 - Math.pow(0.5, dt));
      if (this.chaser.dist > 9.2) this.chaser.on = false;
    }
    if (this.runStats && cs && cs.active) this.runStats.chaseLeft = Math.ceil(cs.grace);

    /* ---- 障碍图鉴：经过即记录 ---- */
    for (const o of this.objs) {
      if (o.seen || o.kind === 'coin' || o.kind === 'power') continue;
      if (o.worldZ + (o.len || 0) < this.travel) { o.seen = true; this.markCodex(o); }
    }

    /* ---- 限时挑战倒计时 ---- */
    if (this.timeLeft > 0) {
      this.timeLeft -= dt;
      if (this.timeLeft <= 0) {
        this.timeLeft = 0;
        this.challengeWin = true;
        this.finishRun();
        return;
      }
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
    const table = { magnet: 1.6, jet: 0.9, shoe: 1.2, board: 3, dash: 0.8, slow: 0.7 };
    let t = CFG.POWER_TIME[kind] + (Store.data.skills[kind] || 0) * (table[kind] || 0);
    const ch = this.charDef();
    if (ch && ch.p[kind]) t *= (1 + ch.p[kind]);
    return t;
  },
  grantPower(kind, silent) {
    const idx = POWERS.findIndex(x => x.id === kind);
    const info = POWERS[idx] || POWERS[0];
    if (kind === 'board') { this.startBoard(); }
    else {
      this.powers[kind] = Math.max(this.powers[kind], this.powerDur(kind));
      /* 无敌冲刺：期间撞上障碍直接撞碎（复用 invuln 的撞碎逻辑） */
      if (kind === 'dash') this.invuln = Math.max(this.invuln, this.powers.dash);
    }
    Store.data.powerUses++;
    if (this.runStats) this.runStats.powers = (this.runStats.powers || 0) + 1;
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
    else if (kind === 'dash') UI.toast('冲刺结束');
    else if (kind === 'slow') UI.toast('时间恢复正常');
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

  /* ================= 碰撞 =================
     旧版只拿 travel ± 0.42 这一个"瞬时窗口"去和障碍的 z 区间比大小，窗口总宽 0.84 米。
     可最高速 47 m/s 时一帧（1/60s）就走 0.78 米，掉一帧（1/30s）走 1.57 米，
     迎面列车相对速度 78 m/s 时一帧走 1.3 米 —— 整段障碍直接从窗口里跳过去，撞不上。
     这就是"明明撞上了却没反应"的来源。

     现在改成扫掠检测（swept AABB）：把玩家这一帧走过的 z 区间 [上一帧, 这一帧]
     前后各撑开半个身位，再和障碍区间求交。不管一帧跑多远都漏不掉。 */
  collide(o) {
    const p = this.player;
    if (o.taken) return;

    const PREV = this._prevTravel == null ? this.travel : this._prevTravel;
    const halfD = 0.42;                                   // 玩家在 z 方向上的半厚
    const zA = Math.min(PREV, this.travel) - halfD;
    const zB = Math.max(PREV, this.travel) + halfD;

    /* 判定用的身体尺寸。模型比判定框大一点是刻意的：
       判定小一圈，玩家才会觉得"擦着边过去了"，而不是"明明躲开了还算撞"。 */
    const PR = 0.38;                                      // 玩家横向半径
    const pTop = p.y + (p.rollT > 0 ? CFG.ROLL_H : CFG.PLAYER_H) * 0.92;

    if (o.kind === 'coin') {
      /* 金币不吃扫掠，改成"这一帧有没有从它旁边经过"。
         高度容差从 1.9 收到 1.4：旧版人跳到一米高还能捡地上的铜扣，很假。 */
      if (o.worldZ < zA - 1.3 || o.worldZ > zB + 1.3) return;
      if (Math.abs(o.x - p.x) > 1.05) return;
      if (Math.abs(o.y - (p.y + 0.85)) > 1.4) return;
      this.collectCoin(o);
      return;
    }
    if (o.kind === 'power') {
      if (o.worldZ < zA - 1.4 || o.worldZ > zB + 1.4) return;
      if (Math.abs(o.x - p.x) > 1.15) return;
      if (Math.abs(o.y - (p.y + 0.9)) > 1.5) return;
      o.taken = true;
      this.grantPower(o.kind2, false);
      return;
    }
    if (this.dying > 0) return;

    /* ---- 纯装饰（信号灯 / 水洼 / 龙门架）：不挡路，只用来点亮图鉴 ---- */
    if (o.decor) {
      if (!o.seen) { o.seen = true; this.markCodex(o); }
      return;
    }

    /* ---- 障碍 / 车厢 ---- */
    const len = o.len || 0.6;
    const oz0 = o.worldZ, oz1 = o.worldZ + len;
    if (zB < oz0 || zA > oz1) return;                     // 这一帧没扫到它

    const half = (o.hw || 0.95);
    if (Math.abs(o.x - p.x) > half + PR) return;          // 横向不在一条道上

    const py = p.y;

    /* 弹跳垫：把你送上云霄 */
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

    /* ---- 车厢：踩在顶上就不算撞 ---- */
    const ROOF_TOL = 0.18;
    if (o.kind === 'train' && py >= o.h - ROOF_TOL) {
      if (!o.roofCounted && py >= o.h - 0.10) {
        o.roofCounted = true;
        this.runStats.roofs++;
        Missions.progress('roof', 1);
        UI.toast('车顶跑酷 +' + Math.round(50 * this.mult));
        this.score += 50 * this.mult;
        Sound.land();
      }
      return;
    }

    /* ---- 竖直方向：判定框比模型小 8%，边缘就不会那么"玄学" ---- */
    const top = o.kind === 'train' ? o.h : (o.y1 || 1.05) - 0.06;
    const bottom = o.kind === 'train' ? 0 : (o.y0 || 0) + 0.04;
    if (py < top && pTop > bottom) {
      if (this.invuln > 0) {
        // 无敌时撞开障碍（视觉反馈）
        if (o.kind !== 'train') { o.taken = true; this.spawnBurst(o.x, 0.8, 18, '#ffd34d'); UI.toast('撞碎！'); }
        return;
      }
      this.crash(o);
    } else if (o.kind !== 'train') {
      // 成功跨越 → 擦身奖励
      this.nearMiss(o);
    }
  },
  nearMiss(o) {
    if (this.nearMissCd > 0) return;
    this.nearMissCd = 0.6;
    const bonus = CFG.NEAR_MISS_SCORE * this.mult;
    this.score += bonus;
    if (this.runStats) this.runStats.near = (this.runStats.near || 0) + 1;
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
    const now = this.time;
    if (now - this.lastCoinAt > 0.8) this.coinStreak = 0;   // 超过 0.8 秒没吃到金币，连击中断
    this.coinStreak++;
    this.lastCoinAt = now;
    if (this.coinStreak > 0 && this.coinStreak % 10 === 0) UI.combo('连吃 ' + this.coinStreak + ' 枚！');
    if (this.coinSndCd <= 0) { Sound.coin(this.coinStreak); this.coinSndCd = 0.045; }
    Missions.progress('coins', gain);
    Missions.progress('coinRun', gain);
    /* 图鉴：金币路线 / 车顶金币 靠收集行为点亮 */
    this.markCodex({ otype: this.player.y > 0.35 ? 'roof_coins' : 'coin_line' });
    if (Renderer.fxLow !== true || this.parts.length < 60) this.spawnBurst(o.x, o.y, 4, '#ffe9a8', 0.28);
  },

  /* 障碍图鉴：记录见过的障碍 */
  markCodex(o) {
    try {
      /* 注意：障碍的字段是 otype（旧代码误写成 o.type，导致图鉴几乎点不亮） */
      let id;
      if (o.kind === 'train') {
        if (o.oncoming) id = 'oncoming';
        else if (o.h <= 1.6) id = 'train_low';
        else if (o.h <= 2.6) id = 'train_mid';
        else id = 'train_high';
      } else {
        id = CODEX_MAP[o.otype || o.type] || null;
      }
      if (!id) return;
      if (Store.data.codexSeen.indexOf(id) < 0) {
        Store.data.codexSeen.push(id);
        Store.save();
      }
    } catch (e) { /* 忽略 */ }
  },

  crash(o) {
    if (this.god) return;                    // 调试模式：无敌
    const p = this.player;
    if (this.powers.shield > 0) {           // 蓝色护盾：抵挡一次碰撞
      this.powers.shield = 0;
      this.invuln = Math.max(this.invuln, 2.2);
      this.shake = 1.1;
      this.spawnBurst(p.x, p.y + 0.9, 24, '#2ee6d6', 1.1);
      Sound.boardBreak();
      UI.toast('护盾挡下了这一下！');
      UI.updateHUD(this);
      return;
    }
    this.markCodex(o);
    /* 悬浮板：替你挨这一下。
       菜单提示里写过"悬浮板能替你挡一次撞击"，但 breakBoard(true) 这条保命路径
       之前从来没被调用过——板子只是会自然到期，撞了照样死。这里补上。 */
    if (p.boardT > 0) { this.breakBoard(false); return; }
    /* 高仿失败机制：第一次撞击引来追兵，7 秒内再次撞击就被抓住。
       但**撞车厢没有第二次机会**——地铁跑酷里正面撞火车就是当场结束，
       所以这里把 train 单独拎出来当致命伤。 */
    const cs = this.chase || (this.chase = { hits: 0, grace: 0, active: false });
    if (o.kind !== 'train' && cs.hits === 0) {
      cs.hits = 1; cs.grace = 7; cs.active = true;
      this.chaser.on = true; this.chaser.mode = 'chase'; this.chaser.dist = 3.4;
      this.invuln = Math.max(this.invuln, 1.5);
      this.speed *= 0.45;                    // 踉跄一下：撞了要掉速，不然完全没有撞感
      this.hitStop = 0.07;
      this.hurtFlash = 0.8; this.shake = 1.3;
      this.runStats.hits++;
      Sound.crash();
      UI.toast('检票员追上来了！7 秒内别再撞');
      if (Store.data.settings.vibe && navigator.vibrate) navigator.vibrate([30, 40]);
      return;
    }
    Sound.laugh();
    Sound.crash();
    /* 当场刹住：速度归零 + 0.1 秒定格 + 往后弹，然后才播摔倒 */
    this.dying = 0.78;
    this.hitStop = 0.10;
    this.bounce = 0.42;
    this.speed = 0;
    this.hurtFlash = 1;
    this.shake = 1.8;
    p.vy = 3.6; p.grounded = false;          // 被撞得弹起来一下（滞空 ≈ 0.28s，正好摔在 crash 姿势上）
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

  /* ================= 对象池 =================
     障碍 / 金币 / 道具 / 粒子全部复用，避免长时间跑图时频繁分配回收造成抖动 */
  _pool: { objs: [], parts: [] },
  _take(kind) {
    const p = this._pool[kind];
    const o = p.length ? p.pop() : {};
    for (const k in o) delete o[k];
    return o;
  },
  _give(kind, o) {
    const p = this._pool[kind];
    if (p.length < 800) p.push(o);
  },
  /* 就地回收过期物体（替代 filter，不产生新数组） */
  _sweepObjs(cut) {
    const a = this.objs; let w = 0;
    for (let i = 0; i < a.length; i++) {
      const o = a[i];
      if (o.worldZ + (o.len || 0) > cut) a[w++] = o;
      else this._give('objs', o);
    }
    a.length = w;
  },
  /* 按条件回收（复活时清理身边障碍用） */
  _removeObjs(pred) {
    const a = this.objs; let w = 0;
    for (let i = 0; i < a.length; i++) {
      const o = a[i];
      if (pred(o)) this._give('objs', o);
      else a[w++] = o;
    }
    a.length = w;
  },

  /* ================= 粒子 ================= */
  spawnBurst(x, y, n, color, spread) {
    spread = spread || 0.6;
    for (let i = 0; i < n; i++) {
      const pt = this._take('parts');
      pt.x = x + Utils.rand(-0.25, 0.25); pt.y = y + Utils.rand(-0.2, 0.2); pt.z = this.travel + Utils.rand(-0.3, 0.5);
      pt.vx = Utils.rand(-spread, spread) * 3; pt.vy = Utils.rand(0.4, 2.4) * spread * 2; pt.vz = Utils.rand(-1, 2.2);
      pt.r = Utils.rand(0.05, 0.12); pt.life = Utils.rand(0.3, 0.7); pt.max = 0.7; pt.color = color; pt.shape = 'dot';
      this.parts.push(pt);
    }
  },
  spawnDust(n) {
    const p = this.player;
    if (p.y > 0.4) return;
    for (let i = 0; i < n; i++) {
      const pt = this._take('parts');
      pt.x = p.x + Utils.rand(-0.3, 0.3); pt.y = 0.05; pt.z = this.travel - 0.4 + Utils.rand(-0.3, 0.3);
      pt.vx = Utils.rand(-1, 1); pt.vy = Utils.rand(0.6, 1.8); pt.vz = Utils.rand(-2.5, -0.5);
      /* 颜色给纯色，透明度交给 life 去算。
         写成 rgba(...) 的话 3D 那边 new THREE.Color() 会吞掉 alpha 并报警告。 */
      pt.r = Utils.rand(0.05, 0.1); pt.life = 0.35; pt.max = 0.35; pt.color = '#dcd7c8'; pt.shape = 'dot';
      this.parts.push(pt);
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
      if (pt.life <= 0) { this._give('parts', pt); ps.splice(i, 1); continue; }
      pt.x += pt.vx * dt; pt.y += pt.vy * dt; pt.z += pt.vz * dt;
      pt.vy -= 3.2 * dt;
      if (pt.y < 0.02) { pt.y = 0.02; pt.vy *= -0.3; }
    }
    if (ps.length > 260) {
      const over = ps.length - 260;
      for (let i = 0; i < over; i++) this._give('parts', ps[i]);
      ps.splice(0, over);
    }
  },

  /* ================= 关卡生成 ================= */
  genNext() {
    const z = this.nextZ;
    /* 难度曲线从 2600 米收到 1900 米。老曲线太慢：跑了一分多钟，
       地图还是"一段障碍 + 一段空"的节奏，玩家根本感觉不到在变难。
       提前把复杂段落放出来，才有"越跑越吃紧"的体感。 */
    const d = Utils.clamp(this.travel / 1900, 0, 1);
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
    /* 段落间距随难度收一点：早期松、后期紧，给玩家喘气的时间越来越少。
       但保底 4 米 —— 再小两个段落就会叠在一起，变成没得选的必死局。 */
    this.nextZ = G.z + Utils.rand(4, 12 - d * 3);
  },

  addCoin(worldZ, x, y) {
    const o = this._take('objs');
    o.kind = 'coin'; o.worldZ = worldZ; o.x = x; o.y = y; o.spin = Math.random() * 6.28; o.taken = false;
    this.objs.push(o);
  },
  addPower(worldZ, x, y, kind) {
    const o = this._take('objs');
    o.kind = 'power'; o.worldZ = worldZ; o.x = x; o.y = y || 1.1; o.kind2 = kind;
    o.t = Math.random() * 6; o.seed = Math.random() * 6; o.taken = false;
    this.objs.push(o);
  },
  addObstacle(type, lane, extra) {
    const base = this._take('objs');
    base.kind = 'obstacle'; base.otype = type; base.worldZ = this.nextZ; base.x = Utils.laneX(lane);
    const D = {
      barrier: { hw: 0.95, len: 0.55, y0: 0, y1: 1.05 },
      dumpster: { hw: 0.84, len: 1.55, y0: 0, y1: 1.30 },
      highbar: { hw: 1.15, len: 0.30, y0: 1.35, y1: 2.55 },
      cone: { hw: 0.42, len: 0.5, y0: 0, y1: 0.66 },
      spring: { hw: 0.85, len: 1.1, y0: 0, y1: 0.42, spring: true },
      /* ---- 新增障碍 ---- */
      tunnel: { hw: 1.18, len: 3.0, y0: 1.30, y1: 2.60 },                       // 限高隧道：必须滑铲
      turnstile: { hw: 0.72, len: 0.45, y0: 0, y1: 2.20 },                      // 闸机：跳不过也滑不过，只能变道
      ramp: { hw: 0.90, len: 2.2, y0: 0, y1: 0.50, spring: true, ramp: true, launch: 12 },  // 斜坡：冲上去正好落到矮车厢顶
      sweeper: { hw: 0.55, len: 0.5, y0: 0, y1: 1.00, sweep: true },            // 横扫杆：左右摆动，掐时机跳过
      /* ---- 纯装饰：只出现不挡路（decor 标记在 collide 里直接放行） ---- */
      signal: { hw: 0.30, len: 0.30, y0: 0, y1: 2.60, decor: true },
      puddle: { hw: 0.90, len: 0.70, y0: 0, y1: 0.05, decor: true },
      gantry: { hw: 1.60, len: 0.30, y0: 0, y1: 4.00, decor: true },
    }[type];
    Object.assign(base, D, extra || {});
    this.objs.push(base);
    return base;
  },
  addTrain(worldZ, lane, len, h, opts) {
    const colors = ['#d94f3d', '#3f7fd9', '#dfae2b', '#4fae6b', '#8a5fd9', '#b9c2cc', '#e0703f'];
    const o = this._take('objs');
    o.kind = 'train'; o.worldZ = worldZ; o.x = Utils.laneX(lane); o.hw = 1.07; o.len = len; o.h = h;
    o.color = Utils.pick(colors);
    Object.assign(o, opts || {});
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
      Game.markCodex({ otype: 'barrier_double' });
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
      Game.markCodex({ otype: 'gap_train' });
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
    /* 迎面列车：从远处朝玩家冲过来，必须提前变道。
       老版门槛是 diffGuess > 0.12（要跑够约 312 米才开始出现）、权重只有 10，
       结果很多玩家整局都没见过一次"火车朝我开来"——
       反馈里那句"对面的火车为啥不会朝我驶来"就是这么来的。
       现在门槛压到 0.03（约 78 米就能遇到）、权重提到 15，让它变成常规戏码；
       生成距离从 105 拉到 120 米、迎面速度从 19~31 降到 17~27，
       把反应窗口从最紧的 1.3 秒放宽到 1.8 秒左右 —— 有压迫感，但不冤死。 */
    { id: 'oncoming', w: () => Gen.diffGuess > 0.03 ? 15 : 0, fn: (G) => {
      const lane = Utils.irand(0, 2);
      const t = Game.addTrain(G.z + 120, lane, 22, 3.3, { vz: 17 + 10 * Gen.diffGuess, headlight: true });
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
    /* ---------- 新增段落 ---------- */
    /* 隧道：限高，必须滑铲通过 */
    { id: 'tunnel', w: () => 9, fn: (G) => {
      const lane = Utils.irand(0, 2);
      Game.addObstacle('tunnel', lane, { worldZ: G.z });
      const other = (lane + 1) % 3;
      for (let i = 0; i < 5; i++) Game.addCoin(G.z + 1 + i * 2.0, G.laneX(other), 0.85);
      if (Math.random() < 0.45) Game.addObstacle('tunnel', other, { worldZ: G.z });
      G.z += 16;
    } },
    /* 闸机：齐人高，跳不过也滑不过，只能变道 */
    { id: 'turnstile', w: () => 7 + Gen.diffGuess * 8, fn: (G) => {
      const free = Utils.irand(0, 2);
      let n = 0;
      for (let l = 0; l < 3; l++) {
        if (l === free) continue;
        if (n === 1 && Math.random() < 0.5) continue;   // 保证留出可通行车道
        Game.addObstacle('turnstile', l, { worldZ: G.z + Utils.rand(-0.3, 0.3) });
        n++;
      }
      for (let i = 0; i < 5; i++) Game.addCoin(G.z + i * 2.1, G.laneX(free), 0.85);
      G.z += 15;
    } },
    /* 斜坡：冲上去正好落在矮车厢顶上 */
    { id: 'rampRoof', w: () => 8, fn: (G) => {
      const lane = Utils.irand(0, 2), len = Utils.irand(14, 22);
      Game.addObstacle('ramp', lane, { worldZ: G.z });
      Game.addTrain(G.z + 2.6, lane, len, 1.35);
      for (let i = 0; i < Math.floor(len / 2.3); i++) Game.addCoin(G.z + 6 + i * 2.3, G.laneX(lane), 1.9);
      G.z += len + 13;
    } },
    /* 横扫杆：在两条车道之间来回摆，掐时机跳过 */
    { id: 'sweeper', w: () => 6 + Gen.diffGuess * 7, fn: (G) => {
      const ls = [0, 1, 2].sort(() => Math.random() - 0.5);
      const a = Math.min(ls[0], ls[1]), b = Math.max(ls[0], ls[1]);
      const o = Game.addObstacle('sweeper', a, { worldZ: G.z });
      o.xMin = G.laneX(a) - 0.35; o.xMax = G.laneX(b) + 0.35;
      o.x = o.xMin; o.vx = 2.4 + 1.8 * Gen.diffGuess;
      const free = [0, 1, 2].filter((l) => l !== a && l !== b)[0];
      for (let i = 0; i < 5; i++) Game.addCoin(G.z + i * 2.1, G.laneX(free), 0.85);
      G.z += 14;
    } },
    /* 连续错位：三段障碍各自换一条道，逼玩家"左→右→左"连着甩。
       单个障碍都能站桩躲过去，连着来三下才真正考验随机应变 ——
       反馈里"地图随机程度不强、需要更复杂"指的就是缺这种段落。 */
    { id: 'zigzag', w: () => 4 + Gen.diffGuess * 9, fn: (G) => {
      let prev = Utils.irand(0, 2);
      const segs = 3;
      for (let i = 0; i < segs; i++) {
        let l = Utils.irand(0, 2);
        while (l === prev) l = Utils.irand(0, 2);          // 每段都必须换道
        Game.addObstacle(Utils.pick(['barrier', 'cone', 'turnstile']), l, { worldZ: G.z + i * 7.5 });
        for (let c = 0; c < 3; c++) Game.addCoin(G.z + i * 7.5 + c * 1.7, G.laneX(prev), 0.85);
        prev = l;
      }
      G.z += segs * 7.5 + 10;
    } },
    /* 交替封锁：两条道轮流被长条车体堵死，只留一条缝，玩家得一路切过去。
       和 zigzag 的区别是用"长封锁"代替"点障碍"，走位容错更小。 */
    { id: 'slalom', w: () => 3 + Gen.diffGuess * 8, fn: (G) => {
      let free = Utils.irand(0, 2);
      const segs = 2 + (Math.random() < 0.5 ? 1 : 0);
      for (let i = 0; i < segs; i++) {
        for (let l = 0; l < 3; l++) {
          if (l === free) continue;
          if (Math.random() < 0.22) continue;              // 留点变数，别每次封满
          Game.addTrain(G.z + i * 13, l, 9, 3.3);
        }
        for (let c = 0; c < 4; c++) Game.addCoin(G.z + i * 13 + c * 1.9, G.laneX(free), 0.85);
        free = (free + (Math.random() < 0.5 ? 1 : 2)) % 3; // 缝换到另一条道
      }
      G.z += segs * 13 + 10;
    } },
    /* 纯装饰：信号灯 / 水洼 / 龙门架，路过即可点亮图鉴，不阻挡 */
    { id: 'decor', w: () => 5, fn: (G) => {
      const k = Utils.pick(['signal', 'puddle', 'gantry']);
      Game.addObstacle(k, Utils.irand(0, 2), { worldZ: G.z, decor: true });
      G.z += 18;
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
      /* 接地影：再叠一层更小更实的影，角色才像真的踩在地上（之前只有一层大软影） */
      Renderer.drawShadow(p.x, CFG.CAM_BACK, 0.52, supportY > 0.25 ? 0.10 : 0.26);
      for (const o of this.objs) {
        if (o.taken || o.kind !== 'train') continue;
        const zr = rz(o.worldZ + o.len * 0.5);
        if (zr < 1 || zr > CFG.FAR * 0.7) continue;
        Renderer.drawShadow(o.x, zr, 1.5, 0.24);
      }
      if (this.chaser.on) {
        const zr = rz(this.travel - this.chaser.dist);
        if (zr > CFG.NEAR + 0.4) {
          /* 检票员个子高，影子摊大一圈；狗矮，影子收窄压扁 */
          Renderer.drawShadow(p.x + 0.85, zr, 1.15, 0.34);
          Renderer.drawShadow(p.x - 1.05, zr + 1.0, 0.62, 0.26);
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
          Renderer.drawObstacle({ type: o.otype, x: o.x, z: zr, hw: o.hw, len: o.len, y0: o.y0, y1: o.y1, ramp: o.ramp });
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
    // 护盾泡泡
    if (this.powers.shield > 0) {
      const q = Renderer.proj(p.x, p.y + 0.92, zr);
      if (q) {
        const c = Renderer.c;
        const r = CFG.PLAYER_H * 0.78 * q.s;
        const pulse = 1 + Math.sin(this.time * 6) * 0.04;
        const g = c.createRadialGradient(q.sx, q.sy, r * 0.55, q.sx, q.sy, r * pulse);
        g.addColorStop(0, 'rgba(46,230,214,0)');
        g.addColorStop(0.75, 'rgba(46,230,214,.20)');
        g.addColorStop(1, 'rgba(120,255,246,.55)');
        c.fillStyle = g;
        c.beginPath(); c.arc(q.sx, q.sy, r * pulse, 0, Math.PI * 2); c.fill();
        c.strokeStyle = 'rgba(180,255,250,.75)'; c.lineWidth = Math.max(1, r * 0.05);
        c.beginPath(); c.arc(q.sx, q.sy, r * pulse, 0, Math.PI * 2); c.stroke();
        if (this.powers.shield < 3.2) {   // 快失效时闪烁
          c.globalAlpha = 0.3 + Math.abs(Math.sin(this.time * 12)) * 0.4;
          c.strokeStyle = '#fff';
          c.beginPath(); c.arc(q.sx, q.sy, r * pulse, 0, Math.PI * 2); c.stroke();
          c.globalAlpha = 1;
        }
      }
    }
  },

  drawChaser() {
    const p = this.player;
    const zr = CFG.CAM_BACK - this.chaser.dist;
    const catching = this.chaser.mode === 'catch';
    const ph = (this.time * (catching ? 4.6 : 3.4)) % 1;
    /* 追上来的是铁皮发条检票员和他那只铁皮狗。
       狗跑在前面一点，检票员在后头压着——一前一后才看出纵深，
       两个并排摆着就只是两块色斑了。 */
    Renderer.drawChar('bull', p.x + 0.85, 0, zr, {
      state: 'run', t: ph, lean: catching ? 0.5 : 0.2, front: false,
    }, CFG.PLAYER_H * 1.02);
    Renderer.drawChar('dog', p.x - 1.05, 0, zr + 1.0, {
      state: 'run', t: (ph + 0.5) % 1, lean: -0.2, front: false,
    }, CFG.PLAYER_H * 0.72);
  },

  /* ---------------- 结束 / 复活 ---------------- */
  finishRun() {
    this.state = 'over';
    const save = Store.data;
    const st = this.runStats;
    const D = this.diff || { scoreMul: 1, id: 'normal' };
    const sc = Math.floor(this.score * (D.scoreMul || 1));
    const isBest = sc > save.best;
    if (isBest) save.best = sc;
    /* 分地图 / 分难度成绩 */
    const mapId = (this.mapDef && this.mapDef.id) || 'city';
    if (!save.bestByMap[mapId]) save.bestByMap[mapId] = { easy: 0, normal: 0, hard: 0 };
    if (sc > (save.bestByMap[mapId][D.id] || 0)) save.bestByMap[mapId][D.id] = sc;
    save.playCount[mapId] = (save.playCount[mapId] || 0) + 1;
    /* 挑战之路 */
    const justDone = [];
    if (typeof CHALLENGES !== 'undefined') {
      const stat = {
        dist: Math.floor(this.travel), coins: this.runCoins, jumps: st.jumps, rolls: st.rolls,
        roof: Math.floor(st.roofDist || 0), combo: Math.floor(this.maxMult * 20),
        near: st.near || 0, nodist: st.hits > 0 ? 0 : Math.floor(this.travel),
        powers: st.powers || 0,
      };
      for (const c of CHALLENGES) {
        if (save.challenges.indexOf(c.id) >= 0) continue;
        if ((stat[c.type] || 0) >= c.val) {
          save.challenges.push(c.id);
          save.coins += c.reward;
          justDone.push(c);
        }
      }
    }
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
    /* 云端后端：三档难度各有一张榜，所以都上传。
       有取件码的顺手把进度也存一份——每局结束存一次，不用玩家记得点。 */
    if (sc > 0 && typeof Panels !== 'undefined' && Panels.cloud) {
      if (!save.playerName) {
        save.playerName = '路过的' + Math.floor(1000 + Math.random() * 9000);
        Store.save();
      }
      Panels.cloud.submit({
        name: save.playerName, score: sc, dist: Math.floor(this.travel), map: mapId, diff: D.id,
      }).then(r => {
        if (r && r.ok && r.rank) UI.toast('云端排名第 ' + r.rank + ' 名（' + save.playerName + '）');
      });
      if (save.cloudSaveCode && Panels.cloudSave) {
        Panels.cloudSave.push().then(r => {
          if (r && r.ok) { save.cloudSavedAt = Date.now(); Store.save(); }
        });
      }
    }
    UI.showOver({
      score: sc, coins: this.runCoins, dist: Math.floor(this.travel),
      best: save.best, isBest: isBest, mult: this.maxMult,
      missions: Missions.snapshot(), achievements: newly,
      // 对齐参考玩法：不做金币复活，撞两次就被抓，结算只有「再跑一次 / 返回车站」
      canRevive: false,
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
    // 清理身边障碍（回收进对象池）
    const z0 = this.travel + CFG.CAM_BACK, z1 = this.travel + 26;
    this._removeObjs(o => o.kind === 'obstacle' && o.worldZ > this.travel - 2 && o.worldZ < this.travel + 30);
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
