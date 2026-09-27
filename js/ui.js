/* =========================================================
   奶蛙跑酷 · 界面 / 商店 / 任务 / 成就
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

    // 道具条
    const items = [];
    const pw = g.powers, p = g.player;
    if (pw.magnet > 0) items.push(['magnet', '磁铁', pw.magnet / g.powerDur('magnet')]);
    if (pw.jet > 0) items.push(['jet', '喷射背包', pw.jet / g.powerDur('jet')]);
    if (pw.x2 > 0) items.push(['x2', '双倍金币', pw.x2 / g.powerDur('x2')]);
    if (pw.shoe > 0) items.push(['shoe', '超级跑鞋', pw.shoe / g.powerDur('shoe')]);
    if (p.boardT > 0) items.push(['board', '悬浮板', p.boardT / g.powerDur('board')]);
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
    items.forEach(it => {
      const b = this._powerEls[it[0]];
      if (b) b.style.width = Utils.clamp(it[2], 0, 1) * 100 + '%';
    });
    // 悬浮板按钮
    const bb = document.getElementById('btnBoard');
    if (bb) {
      const usable = Store.data.boardCount > 0 && p.boardT <= 0;
      bb.classList.toggle('dead', !usable);
      bb.dataset.count = String(Store.data.boardCount);
    }
  },

  /* ---------------- 菜单英雄展示 ---------------- */
  animateMenu(time) {
    if (this.el.menu.classList.contains('hidden')) return;
    // 首次进菜单时后台预热 AI 素材
    if (!this._artWarm) {
      this._artWarm = true;
      if (typeof ART !== 'undefined') {
        ART.ensure(Store.data.char);
        ART.preloadAll(CHARS.map(c => c.skin));
      }
    }
    const ch = CHAR_MAP[Store.data.char] || CHAR_MAP.naiwa;
    const cv = this.el.hero;
    const w = cv.clientWidth || 300, h = cv.clientHeight || 300;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (cv.width !== Math.floor(w * dpr)) { cv.width = Math.floor(w * dpr); cv.height = Math.floor(h * dpr); }
    const c = cv.getContext('2d');
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, w, h);
    const bounce = Math.sin(time * 2.2) * 0.02;
    const hp = h * 0.80;
    const laughing = (Math.sin(time * 0.7) > 0.55) ? 1 : 0;
    const port = (typeof ART !== 'undefined' && ART.portrait) ? ART.portrait(ch.skin) : null;
    if (port) {
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
    // 飘出的音符/笑声
    if (laughing) {
      c.globalAlpha = 0.85;
      c.font = 'bold 22px sans-serif';
      c.fillStyle = '#fff';
      c.fillText('齁', w * 0.72, h * 0.34 - ((time * 30) % 30));
      c.fillText('齁', w * 0.20, h * 0.44 - ((time * 26) % 26));
      c.globalAlpha = 1;
    }
    // 提示轮播
    this._tipT += 0.016;
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
      if (this.el.chars.classList.contains('hidden')) { this._cardTick = null; return; }
      const t = performance.now() / 1000;
      this.el.charsBody.querySelectorAll('canvas[data-skin]').forEach(cv => CharArtAPI.thumb(cv, cv.dataset.skin, t));
      this._cardTick = setTimeout(tick, 60);
    };
    this._cardTick = setTimeout(tick, 30);
  },
  stopCardAnim() { if (this._cardTick) { clearTimeout(this._cardTick); this._cardTick = null; } },

  buyChar(id) {
    const ch = CHAR_MAP[id]; if (!ch) return;
    const save = Store.data;
    if (save.chars.indexOf(id) >= 0) { save.char = id; Store.save(); Sound.ui(); this.buildChars(); this.refreshCoins(); UI.toast('已选择 ' + ch.name); return; }
    if (save.coins < ch.price) { Sound.deny(); UI.toast('金币不足，还差 ' + (ch.price - save.coins)); return; }
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
    q('btnChars').onclick = () => this.openPanel('chars');
    q('btnMissions').onclick = () => this.openPanel('missions');
    q('btnSettings').onclick = () => this.openPanel('settings');
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
      const txt = '我在【奶蛙跑酷】跑了 ' + Math.floor(Game.travel) + ' 米，拿到 ' +
        Math.floor(Game.score) + ' 分，收集 ' + Game.runCoins + ' 金币。齁齁齁，来比比？';
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
  },
};
