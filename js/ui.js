/* =========================================================
   捏捏跑酷 · 界面 / 商店 / 任务 / 成就
   ========================================================= */
'use strict';

/* ---------------- 每日任务 ---------------- */
const Missions = {
  _dirty: false,
  ensure() {
    const d = Utils.todayStr();
    if (!Store.data.missions || Store.data.missions.date !== d) {
      Store.data.missions = buildMissions(d);
      Store.save();
    }
    return Store.data.missions.list;
  },
  progress(id, amount, absolute) {
    const list = this.ensure();
    let changed = false, completed = null;
    for (const m of list) {
      if (m.id !== id || m.claimed) continue;
      if (absolute) { if (amount > m.progress) { m.progress = Math.min(m.target, amount); changed = true; } }
      else if (m.progress < m.target) { m.progress = Math.min(m.target, m.progress + amount); changed = true; }
      if (changed && !m.done && m.progress >= m.target) { m.done = true; completed = m; }
    }
    if (completed) { UI.toast('任务完成：' + completed.name); Sound.mission(); }
    if (changed) this._dirty = true;
    return changed;
  },
  flush() { if (this._dirty) { this._dirty = false; Store.save(); } },
  claim(idx) {
    const list = this.ensure();
    const m = list[idx];
    if (!m || !m.done || m.claimed) return false;
    m.claimed = true;
    Store.data.coins += m.reward;
    Store.data.coinsToday = (Store.data.coinsToday || 0) + m.reward;
    Store.save();
    Sound.buy();
    UI.toast('领取 ' + m.reward + ' 金币');
    UI.buildMissions();
    UI.refreshCoins();
    return true;
  },
  snapshot() {
    return this.ensure().map(m => ({
      name: m.name, done: m.done, claimed: m.claimed, progress: Math.floor(m.progress), target: m.target, reward: m.reward,
    }));
  },
};

/* ---------------- 成就 ---------------- */
const Achievements = {
  check(save) {
    const newly = [];
    for (const a of ACHIEVEMENTS) {
      if (save.achClaimed.indexOf(a.id) >= 0) continue;
      let ok = false;
      try { ok = a.check(save); } catch (e) { ok = false; }
      if (ok) {
        save.achClaimed.push(a.id);
        save.coins += a.reward;
        newly.push({ id: a.id, name: a.name, desc: a.desc, reward: a.reward });
      }
    }
    return newly;
  },
};

/* =========================================================
   UI
   ========================================================= */
const DOM = (id) => document.getElementById(id);

const UI = {
  el: {},
  _s: -1, _c: -1, _d: -1, _powerKey: '', _powerEls: {}, _tipIdx: 0, _tipT: 0,
  _reviveTimer: null, _cardTick: null, _tab: 'chars', _mtab: 'daily',

  init() {
    const q = (id) => document.getElementById(id);
    this.el = {
      hud: q('hud'), hudScore: q('hudScore'), hudCoins: q('hudCoins'), hudDist: q('hudDist'),
      hudSpeed: q('hudSpeed'), hudMult: q('hudMult'), hudTimer: q('hudTimer'), hudShield: q('hudShield'), chipTimer: q('chipTimer'), chipShield: q('chipShield'),
      powerBar: q('powerBar'), comboTag: q('comboTag'), toast: q('toast'),
      menu: q('screenMenu'), chars: q('screenChars'), missions: q('screenMissions'),
      settings: q('screenSettings'), pause: q('screenPause'), over: q('screenOver'),
      maps: q('screenMaps'), codex: q('screenCodex'), path: q('screenPath'),
      outfits: q('screenOutfits'), rank: q('screenRank'), join: q('screenJoin'),
      hero: q('heroCanvas'), menuBest: q('menuBest'), menuCoins: q('menuCoins'), menuTotal: q('menuTotal'),
      charsBody: q('charsBody'), charsCoins: q('charsCoins'), missionsBody: q('missionsBody'), missionCoins: q('missionCoins'),
      boot: q('boot'), countdown: q('countdown'), menuTip: q('menuTip'), pad: document.querySelector('.pad'),
      pauseScore: q('pauseScore'), pauseCoins: q('pauseCoins'), pauseDist: q('pauseDist'),
      overTitle: q('overTitle'), overQuote: q('overQuote'), overScore: q('overScore'), overBestTag: q('overBestTag'),
      overDist: q('overDist'), overCoins: q('overCoins'), overBest: q('overBest'), overCombo: q('overCombo'),
      overMissions: q('overMissions'),
    };
    this.bind();
    this.ensureMissionsTab();
    this.buildDust();
    this.refreshCoins();
    this.buildChars();
    this.buildMissions();
    this.buildSettings();
    setTimeout(() => { this.el.boot.classList.add('hide'); setTimeout(() => this.el.boot.classList.add('hidden'), 500); }, 520);
    if (this.isTouch()) this.el.pad.classList.add('show');
  },

  isTouch() { return ('ontouchstart' in window) || navigator.maxTouchPoints > 0; },

  /* ---------------- 屏幕切换 ---------------- */
  hideAllScreens() {
    ['menu', 'chars', 'missions', 'settings', 'pause', 'over',
      'maps', 'codex', 'path', 'outfits', 'rank', 'join'].forEach(k => {
      if (this.el[k]) this.el[k].classList.add('hidden');
    });
    this.stopCardAnim();
  },
  showMenu() {
    this.hideAllScreens();
    this.el.hud.classList.add('hidden');
    this.el.menu.classList.remove('hidden');
    if (typeof Panels !== 'undefined' && Panels.el.diffPick) {
      Panels.buildDiffPick();
      Panels.refreshMenuNow();
    }
    this.refreshCoins();
    this.el.menuBest.textContent = Utils.fmt(Store.data.best);
    this.el.menuTotal.textContent = Utils.fmt(Store.data.totalDist);
    /* 提示立刻给一条，别让那块地方空着等 5 秒 */
    if (!this.el.menuTip.textContent) {
      this.el.menuTip.textContent = QUOTES.menu[this._tipIdx % QUOTES.menu.length];
    }
  },
  showHUD() { this.el.hud.classList.remove('hidden'); },
  showPause(g) {
    this.el.pauseScore.textContent = Utils.fmt(g.score);
    this.el.pauseCoins.textContent = Utils.fmt(g.runCoins);
    this.el.pauseDist.textContent = Math.floor(g.travel) + ' m';
    this.el.pause.classList.remove('hidden');
  },
  showOver(d) {
    this.hideAllScreens();
    Missions.flush();
    this.el.hud.classList.add('hidden');
    this.el.over.classList.remove('hidden');
    const titles = d.isBest ? '新纪录！' : '被抓住了！';
    this.el.overTitle.textContent = titles;
    this.el.overQuote.textContent = d.isBest ? Utils.pick(QUOTES.high) : Utils.pick(QUOTES.crash);
    this.el.overScore.textContent = Utils.fmt(d.score);
    this.el.overBestTag.classList.toggle('hidden', !d.isBest);
    this.el.overDist.textContent = d.dist + ' m';
    this.el.overCoins.textContent = Utils.fmt(d.coins);
    this.el.overBest.textContent = Utils.fmt(d.best);
    this.el.overCombo.textContent = 'x' + (Math.round(d.mult * 100) / 100);
    // 任务 & 成就
    let html = '';
    (d.achievements || []).forEach(a => {
      html += '<div class="om">解锁成就「' + a.name + '」 +' + a.reward + ' 金币</div>';
    });
    (d.missions || []).forEach(m => {
      if (m.done && !m.claimed) html += '<div class="om">任务「' + m.name + '」已完成，去任务页领奖</div>';
    });
    this.el.overMissions.innerHTML = html;
    // 复活按钮
    const btn = DOM('btnRevive');
    clearInterval(this._reviveTimer);
    if (d.canRevive) {
      btn.classList.remove('hidden');
      DOM('reviveCost').textContent = d.reviveCost;
      let left = 5;
      DOM('reviveTimer').textContent = left;
      this._reviveTimer = setInterval(() => {
        left--;
        DOM('reviveTimer').textContent = Math.max(0, left);
        if (left <= 0) { clearInterval(this._reviveTimer); btn.classList.add('hidden'); }
      }, 1000);
    } else {
      btn.classList.add('hidden');
    }
    this.refreshCoins();
  },
  countdown(text, ms) {
    const el = this.el.countdown;
    el.innerHTML = '<b>' + text + '</b>';
    el.classList.remove('hidden');
    const b = el.querySelector('b');
    b.style.animation = 'none'; void b.offsetWidth; b.style.animation = '';
    clearTimeout(this._cdT);
    this._cdT = setTimeout(() => el.classList.add('hidden'), ms || 700);
  },
  toast(text) {
    const el = this.el.toast;
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => el.classList.remove('show'), 1500);
  },
  warn(text) {
    const el = this.el.toast;
    el.textContent = text;
    el.style.color = '#ff8b8b';
    el.classList.add('show');
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => { el.classList.remove('show'); el.style.color = ''; }, 2200);
  },
  combo(text) {
    const el = this.el.comboTag;
    el.textContent = text;
    el.classList.add('show');
    el.style.animation = 'none'; void el.offsetWidth; el.style.animation = '';
    clearTimeout(this._comboT);
    this._comboT = setTimeout(() => el.classList.remove('show'), 900);
  },

  /* ---------------- HUD ---------------- */
  updateHUD(g) {
    const s = Math.floor(g.score), c = g.runCoins, d = Math.floor(g.travel);
    if (s !== this._s) { this.el.hudScore.textContent = Utils.fmt(s); this._s = s; }
    if (c !== this._c) { this.el.hudCoins.textContent = Utils.fmt(c); this._c = c; }
    if (d !== this._d) { this.el.hudDist.textContent = Utils.fmt(d); this._d = d; }
    // 速度（参考游戏 HUD 也会显示当前 m/s）
    if (this.el.hudSpeed) {
      const sp = Math.round(g.speed);
      if (sp !== this._sp) { this.el.hudSpeed.textContent = sp; this._sp = sp; }
    }
    // 实时得分倍率
    if (this.el.hudMult) {
      const m = Math.round((g.mult || 1) * 100) / 100;
      if (m !== this._m) { this.el.hudMult.textContent = 'x' + m; this._m = m; }
    }
    // 限时挑战倒计时
    if (this.el.hudTimer && this.el.chipTimer) {
      if (g.timeLeft > 0) {
        this.el.chipTimer.classList.remove('hidden');
        const tl = Math.ceil(g.timeLeft);
        if (tl !== this._tl) { this.el.hudTimer.textContent = tl; this._tl = tl; }
      } else {
        this.el.chipTimer.classList.add('hidden');
      }
    }
    if (this.el.hudShield && this.el.chipShield) {
      const sh = g.powers.shield > 0 ? Math.ceil(g.powers.shield) : 0;
      if (sh !== this._sh) {                 // 变了才写 DOM
        this._sh = sh;
        if (sh > 0) { this.el.chipShield.classList.remove('hidden'); this.el.hudShield.textContent = sh; }
        else this.el.chipShield.classList.add('hidden');
      }
    }

    // 道具条
    const items = [];
    const pw = g.powers, p = g.player;
    if (pw.magnet > 0) items.push(['magnet', '磁铁', pw.magnet / g.powerDur('magnet')]);
    if (pw.jet > 0) items.push(['jet', '喷射背包', pw.jet / g.powerDur('jet')]);
    if (pw.x2 > 0) items.push(['x2', '双倍金币', pw.x2 / g.powerDur('x2')]);
    if (pw.shoe > 0) items.push(['shoe', '超级跑鞋', pw.shoe / g.powerDur('shoe')]);
    if (p.boardT > 0) items.push(['board', '悬浮板', p.boardT / g.powerDur('board')]);
    if (pw.shield > 0) items.push(['shield', '护盾', pw.shield / g.powerDur('shield')]);
    if (pw.dash > 0) items.push(['dash', '无敌冲刺', pw.dash / g.powerDur('dash')]);
    if (pw.slow > 0) items.push(['slow', '时间减速', pw.slow / g.powerDur('slow')]);
    const key = items.map(i => i[0]).join(',');
    if (key !== this._powerKey) {
      this._powerKey = key;
      this.el.powerBar.innerHTML = items.map(i =>
        '<div class="power-item p-' + i[0] + '"><i class="ico ico-' + i[0] + '"></i><span>' + i[1] +
        '</span><div class="bar"><i style="width:100%"></i></div></div>').join('');
      this._powerEls = {};
      items.forEach((it, i) => {
        const bars = this.el.powerBar.querySelectorAll('.power-item .bar > i');
        if (bars[i]) this._powerEls[it[0]] = bars[i];
      });
    }
    // 道具条 / 悬浮板按钮：12Hz 更新一次就够。
    // 每帧写 style 与 class 会让浏览器每帧重算样式，手机上白白吃掉帧。
    if ((g.time || 0) - (this._hudT || 0) < 0.08) return;
    this._hudT = g.time || 0;
    items.forEach(it => {
      const b = this._powerEls[it[0]];
      if (b) b.style.width = Utils.clamp(it[2], 0, 1) * 100 + '%';
    });
    // 悬浮板按钮（元素缓存下来，别每帧 getElementById）
    if (!this._bbEl) this._bbEl = document.getElementById('btnBoard');
    const bb = this._bbEl;
    if (bb) {
      const usable = Store.data.boardCount > 0 && p.boardT <= 0;
      const sig = (usable ? '1' : '0') + Store.data.boardCount;
      if (sig !== this._bbSig) {
        this._bbSig = sig;
        bb.classList.toggle('dead', !usable);
        bb.dataset.count = String(Store.data.boardCount);
      }
    }
  },

  /* ---------------- 菜单英雄展示 ----------------
     优先走 Chars3D.renderHero()：每帧真渲染一遍场上同款 3D 模型，
     角色会呼吸、会慢慢转身。任何一步失败就回落到静态缩略图。
     clientWidth 只量一次并缓存——它是强制布局读取，每帧调一次
     等于每帧逼浏览器重算一遍样式。 */
  _heroW: 0, _heroH: 0,

  /* 菜单里飘的灰尘：纯 CSS 动画，8 个点随机 left / 时长 / 延迟。
     加这一层是为了让静态排版"有空气"，不然背景一动它就露馅。 */
  buildDust() {
    const box = document.getElementById('menuDust');
    if (!box) return;
    box.innerHTML = '';
    for (let i = 0; i < 8; i++) {
      const d = document.createElement('i');
      d.style.left = (4 + Math.random() * 92).toFixed(1) + '%';
      d.style.animationDuration = (11 + Math.random() * 11).toFixed(1) + 's';
      d.style.animationDelay = (-Math.random() * 18).toFixed(1) + 's';
      d.style.opacity = (0.30 + Math.random() * 0.5).toFixed(2);
      const px = (2 + Math.random() * 2.6).toFixed(1);
      d.style.width = px + 'px'; d.style.height = px + 'px';
      box.appendChild(d);
    }
  },

  animateMenu(time) {
    if (this.el.menu.classList.contains('hidden')) return;
    this._artWarm = true;   // 封面用真 3D 模型，不需要再下载 AI 立绘
    const ch = CHAR_MAP[Store.data.char] || CHAR_MAP[DEFAULT_SKIN];
    const cv = this.el.hero;
    if (!this._heroW) {
      this._heroW = cv.clientWidth || 300;
      this._heroH = cv.clientHeight || 300;
    }
    const w = this._heroW, h = this._heroH;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (cv.width !== Math.floor(w * dpr)) { cv.width = Math.floor(w * dpr); cv.height = Math.floor(h * dpr); }

    /* 首选：实时 3D（内部自己清画布并 drawImage） */
    if (typeof Chars3D !== 'undefined' && Chars3D.renderHero &&
        Chars3D.renderHero(cv, ch.skin, time)) {
      this.menuTips(time);
      return;
    }

    const c = cv.getContext('2d');
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, w, h);
    const bounce = Math.sin(time * 2.2) * 0.02;
    const hp = h * 0.80;
    const laughing = (Math.sin(time * 0.7) > 0.55) ? 1 : 0;
    const port = (typeof ART !== 'undefined' && ART.portrait) ? ART.portrait(ch.skin) : null;
    const t3 = (typeof Chars3D !== 'undefined' && Chars3D.thumbs) ? Chars3D.thumbs[ch.skin] : null;
    if (t3 && !port) {
      // 场上同款 3D 模型（保证封面就是游戏里那只）
      const s = Math.min(w * 0.98 / t3.width, h * 1.0 / t3.height);
      const dw = t3.width * s, dh = t3.height * s;
      c.save();
      c.translate(w / 2 + Math.sin(time * 1.3) * 3, h * 0.99 + bounce * h);
      c.drawImage(t3, -dw / 2, -dh, dw, dh);
      c.restore();
    } else if (port) {
      // AI 立绘：轻微呼吸 + 摇摆
      const w2 = hp * (port.width / port.height);
      const sway = Math.sin(time * 1.6) * 0.012;
      const dy = Math.sin(time * 2.2) * 0.01;
      c.save();
      c.translate(w / 2, h * 0.96);
      c.rotate(sway);
      c.scale(1 + dy * 0.5, 1 + dy);
      c.drawImage(port, -w2 / 2, -hp, w2, hp);
      c.restore();
    } else {
      c.save();
      c.translate(w / 2 + Math.sin(time * 1.3) * 4, h * 0.94);
      c.scale(hp, -hp);
      const pose = { state: 'idle', t: (time * 1.1) % 1, lean: Math.sin(time * 1.3) * 0.25, squash: bounce, front: true };
      CharArtAPI.draw(c, ch.skin, pose);
      c.restore();
    }
    // 站久了会扬起两粒黏土粉尘（原来飘「齁」字那套已经拿掉，跟世界观不搭）
    if (laughing) {
      c.save();
      c.fillStyle = '#f2cda2';
      for (let i = 0; i < 3; i++) {
        const t2 = (time * 0.55 + i * 0.34) % 1;
        const px = w * (0.24 + i * 0.26) + Math.sin(time * 1.4 + i * 2) * 7;
        const py = h * 0.74 - t2 * h * 0.30;
        c.globalAlpha = 0.45 * (1 - t2);
        c.beginPath();
        c.arc(px, py, 2.4 * (1 - t2) + 0.9, 0, Math.PI * 2);
        c.fill();
      }
      c.restore();
    }
    this.menuTips(time);
  },

  /* 底部提示轮播。用真实时间差而不是"每帧加 0.016"——
     后者在 120Hz 屏幕上会快一倍。 */
  _tipLast: 0,
  menuTips(time) {
    if (!this._tipLast) this._tipLast = time;
    this._tipT += Math.min(0.25, time - this._tipLast);
    this._tipLast = time;
    if (this._tipT > 5) {
      this._tipT = 0;
      this._tipIdx = (this._tipIdx + 1) % QUOTES.menu.length;
      this.el.menuTip.textContent = QUOTES.menu[this._tipIdx];
    }
  },

  /* ---------------- 角色商店 ---------------- */
  buildChars() {
    const body = this.el.charsBody;
    if (this._tab === 'chars') {
      const save = Store.data;
      body.innerHTML = '<div class="char-grid">' + CHARS.map(ch => {
        const owned = save.chars.indexOf(ch.id) >= 0;
        const active = save.char === ch.id;
        const can = save.coins >= ch.price;
        return '<div class="char-card' + (owned ? ' owned' : ' locked') + (active ? ' active' : '') + (!owned && !can ? ' cant' : '') + '" data-id="' + ch.id + '">' +
          '<canvas data-skin="' + ch.skin + '"></canvas>' +
          '<div class="cname">' + ch.name + '<span style="font-size:10px;color:#9aa0aa;font-weight:700"> · ' + ch.tag + '</span></div>' +
          '<div class="cdesc">' + ch.desc + '</div>' +
          '<div class="cperk">' + ch.perk + '</div>' +
          '<div class="cprice">' + (owned ? (active ? '使用中' : '点击使用') : '<i class="ico ico-coin"></i>' + Utils.fmt(ch.price)) + '</div>' +
          '</div>';
      }).join('') + '</div>';
    } else {
      const save = Store.data;
      body.innerHTML = SKILLS.map(s => {
        const lv = save.skills[s.id] || 0;
        const max = lv >= s.max;
        const cost = skillCost(s, lv);
        const can = save.coins >= cost;
        let bars = '';
        for (let i = 0; i < s.max; i++) bars += '<i class="' + (i < lv ? 'on' : '') + '"></i>';
        return '<div class="skill-row">' +
          '<div class="sico"><i class="ico ' + s.ico + '"></i></div>' +
          '<div class="sinfo"><div class="sname">' + s.name + ' <span style="color:#8a9099;font-size:12px">Lv.' + lv + '</span></div>' +
          '<div class="sdesc">' + s.desc + '</div><div class="skill-bar">' + bars + '</div></div>' +
          (max
            ? '<button class="sbtn max">已满级</button>'
            : '<button class="sbtn' + (can ? '' : ' cant') + '" data-skill="' + s.id + '"><i class="ico ico-coin"></i>' + Utils.fmt(cost) + '</button>') +
          '</div>';
      }).join('');
    }
    this.startCardAnim();
  },
  startCardAnim() {
    this.stopCardAnim();
    if (typeof ART !== 'undefined') ART.preloadAll(CHARS.map(c => c.skin));
    const tick = () => {
      /* 面板不可见时不要自杀。
         以前这里是 `_cardTick = null; return;`——而 UI.init() 会在面板还藏着的
         时候先跑一次 buildChars()，那个 tick 一执行就死在隐藏态上，
         之后没有任何代码会重启它，卡片就一直是空的。
         现在改成"看不见就把节奏放慢、继续排队"，面板一显示自动接着画。 */
      if (this.el.chars && !this.el.chars.classList.contains('hidden')) {
        const t = performance.now() / 1000;
        this.el.charsBody.querySelectorAll('canvas[data-skin]').forEach(cv => CharArtAPI.thumb(cv, cv.dataset.skin, t));
        this._cardTick = setTimeout(tick, 60);
      } else {
        this._cardTick = setTimeout(tick, 400);
      }
    };
    this._cardTick = setTimeout(tick, 30);
  },
  stopCardAnim() { if (this._cardTick) { clearTimeout(this._cardTick); this._cardTick = null; } },

  buyChar(id) {
    const ch = CHAR_MAP[id]; if (!ch) return;
    const save = Store.data;
    if (save.chars.indexOf(id) >= 0) { save.char = id; Store.save(); Sound.ui(); this.buildChars(); this.refreshCoins(); UI.toast('已选择 ' + ch.name); return; }
    if (save.coins < ch.price) { Sound.deny(); UI.toast('金币不足，还差 ' + (ch.price - save.coins)); return; }
    // 未解锁：先弹购买确认，确认后再扣金币（无 confirm 环境——如自动化测试——直接放行）
    if (typeof confirm === 'function' && confirm('花 ' + ch.price + ' 金币解锁皮肤「' + ch.name + '」？') === false) {
      Sound.ui(); return;
    }
    save.coins -= ch.price;
    save.chars.push(id);
    save.char = id;
    Store.save();
    Sound.buy();
    this.buildChars(); this.refreshCoins();
    UI.toast('解锁 ' + ch.name + '！');
  },
  buySkill(id) {
    const s = SKILL_MAP[id]; if (!s) return;
    const save = Store.data;
    const lv = save.skills[id] || 0;
    if (lv >= s.max) return;
    const cost = skillCost(s, lv);
    if (save.coins < cost) { Sound.deny(); UI.toast('金币不足'); return; }
    save.coins -= cost;
    save.skills[id] = lv + 1;
    Store.save();
    Sound.buy();
    this.buildChars(); this.refreshCoins();
    UI.toast(s.name + ' 升到 Lv.' + (lv + 1));
  },

  /* ---------------- 任务面板 ---------------- */
  ensureMissionsTab() {
    const tabs = this.el.missions.querySelector('.panel-tabs');
    if (!tabs || tabs.querySelector('[data-tab="log"]')) return;
    const b = document.createElement('button');
    b.className = 'tab'; b.dataset.tab = 'log'; b.textContent = '最佳记录';
    tabs.appendChild(b);
  },
  buildMissions() {
    const body = this.el.missionsBody;
    if (this._mtab === 'daily') {
      const list = Missions.ensure();
      body.innerHTML = list.map((m, i) => {
        const pct = Math.min(100, m.progress / m.target * 100);
        return '<div class="mission' + (m.done ? ' done' : '') + (m.claimed ? ' claimed' : '') + '">' +
          '<div class="mico">' + m.icon + '</div>' +
          '<div class="minfo"><div class="mname">' + m.name + '</div>' +
          '<div class="mprog">' + Math.floor(m.progress) + ' / ' + m.target + '</div>' +
          '<div class="mbar"><i style="width:' + pct + '%"></i></div></div>' +
          (m.claimed
            ? '<div class="mreward">已领取</div>'
            : m.done
              ? '<button class="sbtn" data-claim="' + i + '"><i class="ico ico-coin"></i>' + m.reward + '</button>'
              : '<div class="mreward"><i class="ico ico-coin"></i>' + m.reward + '</div>') +
          '</div>';
      }).join('');
    } else if (this._mtab === 'ach') {
      const save = Store.data;
      body.innerHTML = ACHIEVEMENTS.map(a => {
        const got = save.achClaimed.indexOf(a.id) >= 0;
        return '<div class="mission' + (got ? ' done' : '') + '">' +
          '<div class="mico">' + (got ? '★' : '☆') + '</div>' +
          '<div class="minfo"><div class="mname">' + a.name + '</div><div class="mprog">' + a.desc + '</div></div>' +
          '<div class="mreward"><i class="ico ico-coin"></i>' + a.reward + '</div></div>';
      }).join('');
    } else {
      const logs = Store.data.runs_log || [];
      body.innerHTML = logs.length ? logs.map((l, i) =>
        '<div class="mission"><div class="mico">' + (i + 1) + '</div>' +
        '<div class="minfo"><div class="mname">' + Utils.fmt(l.s) + ' 分</div>' +
        '<div class="mprog">' + l.d + ' 米 · ' + l.c + ' 金币</div></div>' +
        '<div class="mreward">' + new Date(l.t).toLocaleDateString('zh-CN') + '</div></div>'
      ).join('') : '<div class="about-text" style="text-align:center;padding:22px 0">还没有记录，快去跑一局吧</div>';
    }
  },

  /* ---------------- 设置 ---------------- */
  buildSettings() {
    const s = Store.data.settings;
    const set = (id, on) => document.getElementById(id).classList.toggle('on', !!on);
    set('setSfx', s.sfx); set('setMusic', s.music); set('setVibe', s.vibe); set('setTips', s.tips);
    document.querySelectorAll('#setQuality button').forEach(b => b.classList.toggle('on', b.dataset.q === s.quality));
    /* 音源档位：显示的是"实际会响的那个"。浏览器不支持 MP3 时
       即便存档里选着 file，也要如实显示成八音盒，别骗玩家。 */
    const src = (typeof Sound !== 'undefined' && Sound.activeSrc) ? Sound.activeSrc() : 'synth';
    document.querySelectorAll('#setMusicSrc button').forEach(b => b.classList.toggle('on', b.dataset.ms === src));
  },

  refreshCoins() {
    const c = Utils.fmt(Store.data.coins);
    ['menuCoins', 'charsCoins', 'missionCoins'].forEach(id => { const e = document.getElementById(id); if (e) e.textContent = c; });
    const mb = document.getElementById('menuBest');
    if (mb) mb.textContent = Utils.fmt(Store.data.best);
  },

  openPanel(which) {
    this.hideAllScreens();
    this.el.hud.classList.add('hidden');
    this.el[which].classList.remove('hidden');
    if (which === 'chars') { this.buildChars(); }
    if (which === 'missions') { this.buildMissions(); }
    if (which === 'settings') { this.buildSettings(); }
    this.refreshCoins();
    Sound.ui();
  },

  /* ---------------- 事件绑定 ---------------- */
  bind() {
    const q = (id) => document.getElementById(id);
    q('btnPlay').onclick = () => { Sound.ui(); Sound.resume(); Game.start(); };
    /* 主菜单上的快捷入口已收敛到顶/底导航；这几个 id 若不存在则跳过绑定 */
    [['btnChars', 'chars'], ['btnMissions', 'missions'], ['btnSettings', 'settings']].forEach(([id, w]) => {
      const b = q(id);
      if (b) b.onclick = () => this.openPanel(w);
    });
    q('btnResume').onclick = () => { Sound.ui(); Game.resume(); };
    q('btnRestart').onclick = () => { Sound.ui(); Game.restart(); };
    q('btnQuit').onclick = () => { Sound.ui(); Game.quitToMenu(); };
    q('btnAgain').onclick = () => { Sound.ui(); Game.restart(); };
    q('btnMenu2').onclick = () => { Sound.ui(); Game.quitToMenu(); };
    q('btnRevive').onclick = () => {
      clearInterval(this._reviveTimer);
      const ok = Game.revive();
      if (!ok) this.toast('金币不足或已用过复活');
    };
    q('btnShare').onclick = () => {
      const txt = '【捏捏跑酷】跑了 ' + Math.floor(Game.travel) + ' 米，' +
        Math.floor(Game.score) + ' 分，捡了 ' + Game.runCoins + ' 个纽扣。手还热着，来比？';
      const done = () => this.toast('成绩已复制，去粘贴分享吧');
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(txt).then(done).catch(() => this.toast(txt));
      } else this.toast('本局 ' + Math.floor(Game.score) + ' 分！');
      Sound.ui();
    };
    // 关闭按钮 / 点击空白
    document.querySelectorAll('.panel-close').forEach(b => b.onclick = () => { Sound.ui(); this.hideAllScreens(); this.showMenu(); });
    ['chars', 'missions', 'settings', 'maps', 'codex', 'path', 'outfits', 'rank', 'join'].forEach(k => {
      this.el[k].addEventListener('click', (e) => {
        if (e.target === this.el[k]) { Sound.ui(); this.hideAllScreens(); this.showMenu(); }
      });
    });
    // 标签
    document.querySelectorAll('.panel-tabs').forEach(tabs => {
      tabs.addEventListener('click', (e) => {
        const b = e.target.closest('.tab'); if (!b) return;
        tabs.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
        b.classList.add('active');
        if (tabs.closest('#screenChars')) { this._tab = b.dataset.tab; this.buildChars(); }
        else { this._mtab = b.dataset.tab; this.buildMissions(); }
        Sound.ui();
      });
    });
    // 角色卡 / 技能 / 领奖
    this.el.charsBody.addEventListener('click', (e) => {
      const card = e.target.closest('.char-card');
      if (card) { this.buyChar(card.dataset.id); return; }
      const sk = e.target.closest('[data-skill]');
      if (sk) this.buySkill(sk.dataset.skill);
    });
    this.el.missionsBody.addEventListener('click', (e) => {
      const c = e.target.closest('[data-claim]');
      if (c) Missions.claim(parseInt(c.dataset.claim, 10));
    });
    // 设置
    const tog = (id, key) => {
      q(id).onclick = () => {
        const on = !q(id).classList.contains('on');
        q(id).classList.toggle('on', on);
        Store.data.settings[key] = on;
        Store.save();
        Game.applySettings();
        Sound.ui();
      };
    };
    tog('setSfx', 'sfx'); tog('setMusic', 'music'); tog('setVibe', 'vibe'); tog('setTips', 'tips');
    document.querySelectorAll('#setQuality button').forEach(b => {
      b.onclick = () => {
        Store.data.settings.quality = b.dataset.q;
        Store.save();
        Game.applySettings();
        Renderer.dprScale = 1; Renderer.fxLow = false; Game.fps.dprStep = 0;
        this.buildSettings();
        Sound.ui();
      };
    });
    q('btnWipe').onclick = () => {
      if (confirm('确定要清空所有存档吗？（金币、角色、记录都会消失）')) {
        Store.wipe();
        Store.save();
        this.refreshCoins();
        this.buildChars(); this.buildMissions(); this.buildSettings();
        this.showMenu();
        this.toast('存档已清空');
      }
    };
    document.querySelectorAll('#setMusicSrc button').forEach(b => {
      b.onclick = () => {
        if (b.dataset.ms === 'file' && !Sound.bgmSupported()) {
          Sound.deny();
          this.toast('当前浏览器不支持 MP3，只能听八音盒');
          return;
        }
        Store.data.settings.musicSrc = b.dataset.ms;
        Store.save();
        Game.applySettings();
        this.buildSettings();
        Sound.ui();
        this.toast(b.dataset.ms === 'file' ? 'BGM：原声' : 'BGM：八音盒');
      };
    });
  },
};
