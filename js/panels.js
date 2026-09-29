/* =========================================================
   捏捏跑酷 · 面板系统（出逃路线 / 障碍图鉴 / 挑战之路 / 服装商城 / 排行榜 / 加入我们）
   ========================================================= */
'use strict';

const Panels = {
  el: {},
  init() {
    const q = (id) => document.getElementById(id);
    this.el = {
      diffPick: q('diffPick'), modePick: q('modePick'), menuNow: q('menuNow'),
      mapsBody: q('mapsBody'), mapsCoins: q('mapsCoins'),
      codexBody: q('codexBody'), codexCount: q('codexCount'),
      pathBody: q('pathBody'), pathCoins: q('pathCoins'),
      outfitBody: q('outfitBody'), outfitCoins: q('outfitCoins'), outfitTabs: q('outfitTabs'),
      rankBody: q('rankBody'), joinBody: q('joinBody'),
    };
    this.outfitSkin = Store.data.char || (typeof DEFAULT_SKIN !== 'undefined' ? DEFAULT_SKIN : 'ni');
    this.buildModePick();
    this.buildDiffPick();
    this.refreshMenuNow();
    this.bindNav();
  },

  /* ---------------- 导航绑定 ---------------- */
  bindNav() {
    document.querySelectorAll('[data-open]').forEach(btn => {
      btn.addEventListener('click', () => {
        const which = btn.dataset.open;
        Sound.click();
        if (which === 'chars' || which === 'missions' || which === 'settings') UI.openPanel(which);
        else this.open(which);
      });
    });
    const p2 = document.getElementById('btnPlay2');
    if (p2) p2.addEventListener('click', () => { Sound.click(); UI.hideAllScreens(); Game.start(); });
  },

  open(which) {
    UI.hideAllScreens();
    UI.el.hud.classList.add('hidden');
    const map = { maps: 'maps', codex: 'codex', path: 'path', outfits: 'outfits', rank: 'rank', join: 'join' };
    const id = map[which] || which;
    if (UI.el[id]) UI.el[id].classList.remove('hidden');
    if (which === 'maps') this.buildMaps();
    if (which === 'codex') this.buildCodex();
    if (which === 'path') this.buildPath();
    if (which === 'outfits') this.buildOutfits();
    if (which === 'rank') this.buildRank();
    if (which === 'join') this.buildJoin();
  },

  /* ---------------- 菜单：难度与当前地图 ---------------- */
  buildDiffPick() {
    const box = this.el.diffPick;
    if (!box) return;
    box.innerHTML = '';
    DIFFICULTIES.forEach(d => {
      const b = document.createElement('button');
      b.className = 'diff-btn' + (Store.data.difficulty === d.id ? ' active' : '');
      b.innerHTML = d.name + '<small>' + d.tag + '</small>';
      b.addEventListener('click', () => {
        Store.data.difficulty = d.id;
        Store.save();
        Sound.click();
        this.buildDiffPick();
        this.refreshMenuNow();
        UI.toast('难度：' + d.name + '　' + d.desc);
      });
      box.appendChild(b);
    });
  },
  buildModePick() {
    const box = this.el.modePick;
    if (!box) return;
    box.innerHTML = '';
    MODES.forEach(md => {
      const b = document.createElement('button');
      b.className = 'diff-btn mode' + ((Store.data.mode || 'endless') === md.id ? ' active' : '');
      b.innerHTML = md.name;
      b.title = md.desc;
      b.addEventListener('click', () => {
        Store.data.mode = md.id;
        if (md.map) Store.data.map = md.map;          // 限时挑战会锁定到指定地图
        Store.save();
        Sound.click();
        this.buildModePick();
        this.refreshMenuNow();
        UI.toast(md.name + '：' + md.desc);
      });
      box.appendChild(b);
    });
  },
  refreshMenuNow() {
    if (!this.el.menuNow) return;
    const m = World.map(Store.data.map), d = World.diff(Store.data.difficulty);
    const md = MODES.filter(x => x.id === (Store.data.mode || 'endless'))[0] || MODES[0];
    const best = ((Store.data.bestByMap[m.id] || {})[d.id]) || 0;
    /* 地图名统一四字，一行能放下：模式 · 地图 · 难度 · 纪录 */
    this.el.menuNow.innerHTML = md.name + ' · <b>' + m.name + '</b> · ' + d.name +
      ' · 纪录 ' + best;
  },

  /* ---------------- 出逃路线 ---------------- */
  buildMaps() {
    const box = this.el.mapsBody;
    if (!box) return;
    this.el.mapsCoins.textContent = Store.data.coins;
    box.innerHTML = '';
    const grid = document.createElement('div');
    grid.className = 'map-grid';
    MAPS.forEach(m => {
      const owned = Store.data.mapsUnlocked.indexOf(m.id) >= 0;
      const active = Store.data.map === m.id;
      const card = document.createElement('button');
      card.className = 'map-card' + (active ? ' active' : '') + (owned ? '' : ' locked');
      const cv = document.createElement('canvas');
      cv.width = 300; cv.height = 130;
      this.paintMapPreview(cv.getContext('2d'), 300, 130, m);
      card.appendChild(cv);
      const nm = document.createElement('span');
      nm.className = 'mname';
      nm.innerHTML = m.name + (owned ? '' : '<span class="map-lock">🔒 ' + m.unlock + '</span>');
      card.appendChild(nm);
      const sub = document.createElement('span');
      const bd = Store.data.bestByMap[m.id] || {};
      sub.className = 'msub';
      sub.textContent = m.sub + ' · 最好 ' + Math.max(bd.easy || 0, bd.normal || 0, bd.hard || 0);
      card.appendChild(sub);
      card.addEventListener('click', () => {
        if (!owned) {
          if (Store.data.coins < m.unlock) { Sound.deny(); UI.toast('金币不够，还差 ' + (m.unlock - Store.data.coins)); return; }
          Store.data.coins -= m.unlock;
          Store.data.mapsUnlocked.push(m.id);
          Store.save();
          Sound.buy();
          UI.toast('解锁地图：' + m.name);
        } else {
          Sound.click();
        }
        Store.data.map = m.id;
        Store.save();
        this.buildMaps();
        this.refreshMenuNow();
        UI.refreshCoins();
        Game.previewMap = m;                 // 让菜单背景立刻换色
      });
      grid.appendChild(card);
    });
    box.appendChild(grid);
  },
  paintMapPreview(c, w, h, m) {
    const pal = World.applyMap(THEMES.day, m);
    const g = c.createLinearGradient(0, 0, 0, h * 0.62);
    g.addColorStop(0, pal.skyTop); g.addColorStop(1, pal.skyBot);
    c.fillStyle = g; c.fillRect(0, 0, w, h * 0.62);
    // 远景楼群
    c.fillStyle = pal.bldg ? pal.bldg[0] : '#999';
    for (let i = 0; i < 9; i++) {
      const bw = 18 + (i * 13) % 22, bh = 12 + (i * 29) % 34;
      c.fillRect(10 + i * (w - 20) / 9, h * 0.62 - bh, bw, bh);
    }
    // 地面与轨道
    c.fillStyle = pal.ballast; c.fillRect(0, h * 0.62, w, h * 0.38);
    c.fillStyle = pal.wall;
    c.beginPath(); c.moveTo(0, h * 0.62); c.lineTo(w * 0.34, h * 0.62); c.lineTo(0, h); c.closePath(); c.fill();
    c.beginPath(); c.moveTo(w, h * 0.62); c.lineTo(w * 0.66, h * 0.62); c.lineTo(w, h); c.closePath(); c.fill();
    c.strokeStyle = pal.railTop; c.lineWidth = 2;
    [-0.18, 0, 0.18].forEach(o => {
      c.beginPath();
      c.moveTo(w * (0.5 + o * 0.35), h * 0.63);
      c.lineTo(w * (0.5 + o * 1.5), h);
      c.stroke();
    });
  },

  /* ---------------- 障碍图鉴 ---------------- */
  buildCodex() {
    const box = this.el.codexBody;
    if (!box) return;
    const seen = Store.data.codexSeen || [];
    this.el.codexCount.textContent = seen.length;
    box.innerHTML = '';
    CODEX.forEach(item => {
      const got = seen.indexOf(item.id) >= 0;
      const row = document.createElement('div');
      row.className = 'codex-item' + (got ? '' : ' locked');
      const cv = document.createElement('canvas');
      cv.width = 108; cv.height = 108;
      this.paintCodexIcon(cv.getContext('2d'), 108, item.icon);
      row.appendChild(cv);
      const info = document.createElement('div');
      info.innerHTML = '<div><span class="codex-name">' + (got ? item.name : '？？？') +
        '</span><span class="codex-kind">' + item.kind + '</span></div>' +
        '<div class="codex-desc">' + (got ? item.desc : '还没遇到过，跑一局就会点亮') + '</div>';
      row.appendChild(info);
      box.appendChild(row);
    });
  },
  paintCodexIcon(c, s, kind) {
    c.clearRect(0, 0, s, s);
    const u = s / 100;
    const box = (x, y, w, h, col, r) => {
      c.fillStyle = col;
      c.beginPath();
      const rr = (r || 4) * u;
      c.moveTo(x * u + rr, y * u);
      c.arcTo((x + w) * u, y * u, (x + w) * u, (y + h) * u, rr);
      c.arcTo((x + w) * u, (y + h) * u, x * u, (y + h) * u, rr);
      c.arcTo(x * u, (y + h) * u, x * u, y * u, rr);
      c.arcTo(x * u, y * u, (x + w) * u, y * u, rr);
      c.fill();
    };
    c.save();
    switch (kind) {
      case 'barrier':
        box(12, 46, 76, 12, '#e8e4dc');
        for (let i = 0; i < 4; i++) box(14 + i * 20, 46, 10, 12, '#e6423c', 2);
        box(16, 40, 6, 26, '#b9b3a6'); box(78, 40, 6, 26, '#b9b3a6');
        break;
      case 'cone':
        c.fillStyle = '#ff7a1a';
        c.beginPath(); c.moveTo(50 * u, 24 * u); c.lineTo(70 * u, 78 * u); c.lineTo(30 * u, 78 * u); c.closePath(); c.fill();
        box(22, 76, 56, 8, '#e2620f', 3);
        box(34, 50, 32, 7, '#fff', 2);
        break;
      case 'dumpster':
        box(18, 34, 64, 40, '#4f8a4a', 6);
        box(14, 28, 72, 10, '#3f7440', 4);
        box(28, 44, 44, 6, '#8fc48a', 2);
        break;
      case 'highbar':
        box(14, 34, 72, 12, '#c94b3d', 4);
        box(18, 46, 8, 34, '#9aa1a8'); box(74, 46, 8, 34, '#9aa1a8');
        break;
      case 'train':
        box(12, 30, 76, 46, '#3f7fd9', 7);
        box(20, 38, 18, 14, '#bfe0ff', 3); box(44, 38, 18, 14, '#bfe0ff', 3);
        box(12, 70, 76, 8, '#2a5aa0', 3);
        break;
      case 'spring':
        box(16, 62, 68, 14, '#a06bff', 6);
        box(22, 48, 56, 12, '#c9a6ff', 5);
        break;
      case 'ramp':
        c.fillStyle = '#9aa1a8';
        c.beginPath(); c.moveTo(16 * u, 76 * u); c.lineTo(84 * u, 40 * u); c.lineTo(84 * u, 76 * u); c.closePath(); c.fill();
        c.fillStyle = '#ffd34d';
        for (let i = 0; i < 3; i++) {
          const t = i / 3;
          c.fillRect((16 + t * 50) * u, (72 - t * 26) * u, 12 * u, 5 * u);
        }
        break;
      case 'coin':
        c.fillStyle = '#ffc233'; c.beginPath(); c.arc(50 * u, 50 * u, 28 * u, 0, 6.29); c.fill();
        c.strokeStyle = '#e39b00'; c.lineWidth = 4 * u; c.beginPath(); c.arc(50 * u, 50 * u, 20 * u, 0, 6.29); c.stroke();
        break;
      case 'tunnel':
        c.fillStyle = '#5b626d';
        c.beginPath(); c.moveTo(10 * u, 80 * u); c.lineTo(10 * u, 44 * u); c.arc(50 * u, 44 * u, 40 * u, Math.PI, 0); c.lineTo(90 * u, 80 * u); c.closePath(); c.fill();
        c.fillStyle = '#2b303a';
        c.beginPath(); c.moveTo(24 * u, 80 * u); c.lineTo(24 * u, 48 * u); c.arc(50 * u, 48 * u, 26 * u, Math.PI, 0); c.lineTo(76 * u, 80 * u); c.closePath(); c.fill();
        break;
      case 'signal':
        box(46, 40, 8, 40, '#7d858f');
        box(36, 26, 28, 20, '#2b303a', 5);
        c.fillStyle = '#ff4d4d'; c.beginPath(); c.arc(50 * u, 33 * u, 5 * u, 0, 6.29); c.fill();
        c.fillStyle = '#7cd44a'; c.beginPath(); c.arc(50 * u, 40 * u, 5 * u, 0, 6.29); c.fill();
        break;
      case 'puddle':
        c.fillStyle = '#5ba8d9';
        c.beginPath(); c.ellipse(50 * u, 64 * u, 34 * u, 14 * u, 0, 0, 6.29); c.fill();
        c.fillStyle = 'rgba(255,255,255,.55)';
        c.beginPath(); c.ellipse(42 * u, 60 * u, 12 * u, 5 * u, 0, 0, 6.29); c.fill();
        break;
      case 'gantry':
        box(10, 30, 8, 50, '#8d949c'); box(82, 30, 8, 50, '#8d949c'); box(10, 30, 80, 9, '#8d949c', 2);
        break;
      default:
        box(20, 30, 60, 40, '#c9ccd2', 6);
    }
    c.restore();
  },

  /* ---------------- 挑战之路 ---------------- */
  buildPath() {
    const box = this.el.pathBody;
    if (!box) return;
    this.el.pathCoins.textContent = Store.data.coins;
    box.innerHTML = '';
    const done = Store.data.challenges || [];
    CHALLENGES.forEach((c, i) => {
      const isDone = done.indexOf(c.id) >= 0;
      const row = document.createElement('div');
      row.className = 'path-item' + (isDone ? ' done' : '');
      row.innerHTML = '<span class="path-no">' + (isDone ? '✓' : (i + 1)) + '</span>' +
        '<div><div class="path-name">' + c.name + '</div><div class="path-goal">' + c.goal + '</div></div>' +
        '<span class="path-reward">' + (isDone ? '已领' : '+' + c.reward) + '</span>';
      box.appendChild(row);
    });
    const tip = document.createElement('div');
    tip.className = 'panel-note';
    tip.style.margin = '4px 0 0';
    tip.textContent = '已完成 ' + done.length + ' / ' + CHALLENGES.length + ' 项挑战';
    box.appendChild(tip);
  },

  /* ---------------- 服装商城 ---------------- */
  buildOutfits() {
    const tabs = this.el.outfitTabs, box = this.el.outfitBody;
    if (!tabs || !box) return;
    this.el.outfitCoins.textContent = Store.data.coins;
    if (typeof ART !== 'undefined') { ART.ensure(this.outfitSkin); ART.ensure(Store.data.char); }
    tabs.innerHTML = '';
    CHARS.forEach(ch => {
      const b = document.createElement('button');
      b.className = 'tab' + (this.outfitSkin === ch.skin ? ' active' : '');
      b.textContent = ch.name;
      b.addEventListener('click', () => { this.outfitSkin = ch.skin; Sound.click(); this.buildOutfits(); });
      tabs.appendChild(b);
    });
    box.innerHTML = '';
    const grid = document.createElement('div');
    grid.className = 'outfit-grid';
    const worn = (Store.data.outfits || {})[this.outfitSkin] || 'origin';
    outfitsOf(this.outfitSkin).forEach(o => {
      const owned = World.outfitOwned(this.outfitSkin, o.id);
      const card = document.createElement('button');
      card.className = 'outfit-card' + (worn === o.id ? ' active' : '');
      const cv = document.createElement('canvas');
      cv.width = 200; cv.height = 168;
      const c = cv.getContext('2d');
      try {
        if (o.filter && o.filter !== 'none') c.filter = o.filter;
        const port = ART.portrait(this.outfitSkin);
        if (port) {
          const hp = 150, w2 = hp * (port.width / port.height);
          c.drawImage(port, (200 - w2) / 2, 158 - hp, w2, hp);
        } else {
          CharArtAPI.thumb(cv, this.outfitSkin, 1.1);
        }
      } catch (e) { /* 忽略 */ }
      card.appendChild(cv);
      const nm = document.createElement('div');
      nm.className = 'outfit-name';
      nm.textContent = o.name.split('·')[0];
      card.appendChild(nm);
      const pr = document.createElement('div');
      pr.className = 'outfit-price';
      pr.textContent = worn === o.id ? '使用中' : (owned ? '已拥有' : o.price + ' 金币');
      card.appendChild(pr);
      card.addEventListener('click', () => {
        if (!owned) {
          if (Store.data.coins < o.price) { Sound.deny(); UI.toast('金币不够，还差 ' + (o.price - Store.data.coins)); return; }
          Store.data.coins -= o.price;
          if (!Store.data.outfitOwned[this.outfitSkin]) Store.data.outfitOwned[this.outfitSkin] = [];
          Store.data.outfitOwned[this.outfitSkin].push(o.id);
          Sound.buy();
          UI.toast('已购买：' + o.name);
        } else {
          Sound.click();
        }
        if (!Store.data.outfits) Store.data.outfits = {};
        Store.data.outfits[this.outfitSkin] = o.id;
        Store.save();
        this.buildOutfits();
        UI.refreshCoins();
      });
      grid.appendChild(card);
    });
    box.appendChild(grid);
    const note = document.createElement('div');
    note.className = 'panel-note';
    note.style.margin = '6px 0 0';
    note.textContent = '当前角色：' + (CHAR_MAP[this.outfitSkin] ? CHAR_MAP[this.outfitSkin].name : this.outfitSkin) +
      '　共 ' + outfitsOf(this.outfitSkin).length + ' 套';
    box.appendChild(note);
  },

  /* ---------------- 云端排行榜接口 ---------------- */
  cloud: {
    base: '/api/rank',
    ok: null,                     // null=未知 true=可用 false=不可用
    submit(entry) {
      if (typeof fetch !== 'function') return Promise.resolve(null);
      const ctl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
      const timer = ctl ? setTimeout(() => ctl.abort(), 6000) : null;
      return fetch(this.base, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(entry),
        signal: ctl ? ctl.signal : undefined,
      }).then(r => r.json()).then(d => {
        if (timer) clearTimeout(timer);
        this.ok = !!(d && d.ok);
        return d;
      }).catch(() => { if (timer) clearTimeout(timer); this.ok = false; return null; });
    },
    list(map, diff) {
      if (typeof fetch !== 'function') return Promise.resolve(null);
      const ctl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
      const timer = ctl ? setTimeout(() => ctl.abort(), 6000) : null;
      const q = '?map=' + encodeURIComponent(map || '') + '&diff=' + encodeURIComponent(diff || '') + '&limit=20';
      return fetch(this.base + q, { signal: ctl ? ctl.signal : undefined })
        .then(r => r.json())
        .then(d => { if (timer) clearTimeout(timer); this.ok = !!(d && d.ok); return d; })
        .catch(() => { if (timer) clearTimeout(timer); this.ok = false; return null; });
    },
  },

  /* ---------------- 云端存档接口 ----------------
     排行榜是"大家的"，存档是"自己的"。
     玩家拿到一个 6 位取件码，换台机器输进去就能把进度取回来，不用注册登录。 */
  cloudSave: {
    base: '/api/save',
    ok: null,
    /* 从本机存档里挑出该上云的那部分（设置、每日任务这些不上） */
    payload() {
      const d = Store.data;
      return {
        coins: d.coins, char: d.char, chars: d.chars, best: d.best,
        bestByMap: d.bestByMap, mapsUnlocked: d.mapsUnlocked,
        skills: d.skills, boardCount: d.boardCount, achClaimed: d.achClaimed,
        challenges: d.challenges, codexSeen: d.codexSeen,
        runs: d.runs, totalDist: d.totalDist, totalCoins: d.totalCoins,
      };
    },
    push() {
      if (typeof fetch !== 'function') return Promise.resolve(null);
      const ctl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
      const timer = ctl ? setTimeout(() => ctl.abort(), 8000) : null;
      return fetch(this.base, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: Store.data.cloudSaveCode || '', data: this.payload() }),
        signal: ctl ? ctl.signal : undefined,
      }).then(r => r.json()).then(d => {
        if (timer) clearTimeout(timer);
        this.ok = !!(d && d.ok);
        return d;
      }).catch(() => { if (timer) clearTimeout(timer); this.ok = false; return null; });
    },
    pull(code) {
      if (typeof fetch !== 'function') return Promise.resolve(null);
      const ctl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
      const timer = ctl ? setTimeout(() => ctl.abort(), 8000) : null;
      return fetch(this.base + '?code=' + encodeURIComponent(code), { signal: ctl ? ctl.signal : undefined })
        .then(r => r.json())
        .then(d => { if (timer) clearTimeout(timer); this.ok = !!(d && d.ok); return d; })
        .catch(() => { if (timer) clearTimeout(timer); this.ok = false; return null; });
    },
    /* 取回来的进度并进本机存档。
       数值型字段取"更大的那个"（换设备不该把进度往回退），
       列表型字段取并集，地图纪录逐条比大小。 */
    apply(data) {
      if (!data || typeof data !== 'object') return false;
      const d = Store.data;
      const num = ['coins', 'best', 'boardCount', 'runs', 'totalDist', 'totalCoins'];
      num.forEach(k => { if (typeof data[k] === 'number') d[k] = Math.max(d[k] || 0, data[k]); });
      ['chars', 'mapsUnlocked', 'achClaimed', 'challenges', 'codexSeen'].forEach(k => {
        if (!Array.isArray(data[k])) return;
        d[k] = (Array.isArray(d[k]) ? d[k] : []).concat(data[k]).filter((v, i, a) => a.indexOf(v) === i);
      });
      if (data.bestByMap && typeof data.bestByMap === 'object') {
        for (const m in data.bestByMap) {
          d.bestByMap[m] = d.bestByMap[m] || {};
          for (const q in data.bestByMap[m]) {
            d.bestByMap[m][q] = Math.max(d.bestByMap[m][q] || 0, data.bestByMap[m][q] || 0);
          }
        }
      }
      if (data.skills && typeof data.skills === 'object') {
        for (const s in data.skills) d.skills[s] = Math.max(d.skills[s] || 0, data.skills[s] || 0);
      }
      /* 存档里可能有已经下线的角色 id，过一遍再落地 */
      d.chars = (d.chars || []).filter(id => !!CHAR_MAP[id]);
      if (!d.chars.length) d.chars = [DEFAULT_SKIN];
      if (!CHAR_MAP[d.char] && data.char && CHAR_MAP[data.char]) d.char = data.char;
      if (!CHAR_MAP[d.char]) d.char = DEFAULT_SKIN;
      Store.save();
      return true;
    },
  },

  /* ---------------- 云存档卡片 ---------------- */
  buildCloudSave(box) {
    const card = document.createElement('div');
    card.className = 'join-card';
    const code = Store.data.cloudSaveCode || '';
    const when = Store.data.cloudSavedAt
      ? new Date(Store.data.cloudSavedAt).toLocaleDateString('zh-CN') : '';
    const st = document.createElement('div');
    st.innerHTML = '<b>云存档</b><span class="cs-st">' +
      (code ? '取件码 ' + code + (when ? ' · 存于 ' + when : '') : '还没存过') + '</span>';
    card.appendChild(st);

    const btnUp = document.createElement('button');
    btnUp.className = 'join-copy';
    btnUp.textContent = '存到云端';
    btnUp.addEventListener('click', () => {
      st.querySelector('.cs-st').textContent = '正在存…';
      btnUp.disabled = true;
      this.cloudSave.push().then(r => {
        btnUp.disabled = false;
        if (!r || !r.ok) {
          st.querySelector('.cs-st').textContent = r && r.error === 'KV 未绑定'
            ? '云端没开（后端 KV 未绑定）' : ('存失败：' + ((r && r.error) || '网络问题'));
          return;
        }
        Store.data.cloudSaveCode = r.code;
        Store.data.cloudSavedAt = Date.now();
        Store.save();
        st.querySelector('.cs-st').textContent = '取件码 ' + r.code + '（换设备用它取回）';
        this.buildRank();
      });
    });
    card.appendChild(btnUp);

    const btnDown = document.createElement('button');
    btnDown.className = 'join-copy';
    btnDown.style.marginLeft = '6px';
    btnDown.style.background = '#dfe7f5';
    btnDown.style.color = '#2c3a52';
    btnDown.style.boxShadow = '0 3px 0 #b9c4d8';
    btnDown.textContent = '取回来';
    btnDown.addEventListener('click', () => {
      const v = window.prompt('输入 6 位取件码', Store.data.cloudSaveCode || '');
      if (!v) return;
      const c = String(v).toUpperCase().replace(/[^A-Z0-9]/g, '');
      st.querySelector('.cs-st').textContent = '正在取…';
      btnDown.disabled = true;
      this.cloudSave.pull(c).then(r => {
        btnDown.disabled = false;
        if (!r || !r.ok) {
          st.querySelector('.cs-st').textContent = (r && r.error) || '取档失败';
          return;
        }
        if (!this.cloudSave.apply(r.data)) { st.querySelector('.cs-st').textContent = '这份存档是空的'; return; }
        Store.data.cloudSaveCode = c;
        Store.save();
        UI.toast('进度已取回：' + Store.data.coins + ' 铜扣');
        this.buildRank();
      });
    });
    card.appendChild(btnDown);
    box.appendChild(card);

    const tip = document.createElement('div');
    tip.className = 'codex-desc';
    tip.textContent = '取件码只有 6 位，抄下来收好。取回是"往多了并"，不会把你现有的进度冲掉。';
    box.appendChild(tip);
  },

  /* ---------------- 排行榜（云端 + 本机） ---------------- */
  buildRank() {
    const box = this.el.rankBody;
    if (!box) return;
    box.innerHTML = '';
    const rows = [];
    MAPS.forEach(m => {
      const bd = Store.data.bestByMap[m.id] || {};
      DIFFICULTIES.forEach(d => {
        if (bd[d.id]) rows.push({ map: m.name, diff: d.name, score: bd[d.id], id: m.id + ':' + d.id });
      });
    });
    rows.sort((a, b) => b.score - a.score);
    const nameRow = document.createElement('div');
    nameRow.className = 'join-card';
    nameRow.innerHTML = '<div><b>我的昵称</b><span>' + (Store.data.playerName || '未设置（点右侧修改）') + '</span></div>';
    const nb = document.createElement('button');
    nb.className = 'join-copy';
    nb.textContent = '修改';
    nb.addEventListener('click', () => {
      const v = window.prompt('输入昵称（最多 12 字）', Store.data.playerName || '');
      if (v != null) { Store.data.playerName = String(v).slice(0, 12); Store.save(); this.buildRank(); }
    });
    nameRow.appendChild(nb);
    box.appendChild(nameRow);

    /* 云存档 */
    this.buildCloudSave(box);

    /* 云端榜：跟着当前难度走，三档各有各的榜 */
    const dif = World.diff ? World.diff(Store.data.difficulty) : null;
    const difName = dif ? dif.name : '普通';
    const cloudBox = document.createElement('div');
    cloudBox.className = 'rank-cloud';
    cloudBox.style.marginTop = '10px';
    cloudBox.innerHTML = '<div class="codex-desc">云端榜（' + difName + '难度）加载中…</div>';
    box.appendChild(cloudBox);
    this.cloud.list(Store.data.map, Store.data.difficulty).then(d => {
      cloudBox.innerHTML = '';
      if (!d || !d.ok) {
        cloudBox.innerHTML = '<div class="codex-desc">云端没开：' + ((d && d.error) || '连不上') +
          '。当前只显示本机记录。（在 EdgeOne 控制台给项目绑定 KV 命名空间到变量名 <b>KV</b> 即可开启）</div>';
        return;
      }
      if (!d.list || !d.list.length) {
        cloudBox.innerHTML = '<div class="codex-desc">云端还没有这条地图的成绩，来抢第一！</div>';
        return;
      }
      const title = document.createElement('div');
      title.className = 'rank-title';
      title.textContent = '云端榜 · ' + World.map(Store.data.map).name + ' · ' + difName + '难度';
      cloudBox.appendChild(title);
      d.list.forEach((r, i) => {
        const row = document.createElement('div');
        row.className = 'rank-row' + (i === 0 ? ' top1' : '');
        row.innerHTML = '<span class="rk">' + (i + 1) + '</span><span>' + String(r.name || '路过的') +
          '<span style="opacity:.6"> · ' + Math.floor(r.dist || 0) + 'm</span></span><b>' + r.score + '</b>';
        cloudBox.appendChild(row);
      });
    });

    if (!rows.length) {
      const empty = document.createElement('div');
      empty.className = 'codex-desc';
      empty.textContent = '还没有成绩，跑一局就会出现在榜单里。';
      box.appendChild(empty);
      return;
    }
    rows.slice(0, 20).forEach((r, i) => {
      const row = document.createElement('div');
      row.className = 'rank-row' + (i === 0 ? ' top1' : '');
      row.innerHTML = '<span class="rk">' + (i + 1) + '</span><span>' + r.map +
        '<span style="opacity:.6"> · ' + r.diff + '</span></span><b>' + r.score + '</b>';
      box.appendChild(row);
    });
    const tip = document.createElement('div');
    tip.className = 'codex-desc';
    tip.style.marginTop = '6px';
    tip.textContent = '本机共记录 ' + rows.length + ' 条成绩';
    box.appendChild(tip);
  },

  /* ---------------- 加入我们 ---------------- */
  buildJoin() {
    const box = this.el.joinBody;
    if (!box) return;
    box.innerHTML = '';
    const items = [
      { t: '联系邮箱', v: '3507423452@qq.com', b: '复制' },
      { t: '抖音号', v: '70440770676', b: '复制' },
      { t: '本地运行', v: 'node tools/serve.js 然后访问 localhost:8123', b: '复制' },
    ];
    items.forEach(it => {
      const card = document.createElement('div');
      card.className = 'join-card';
      card.innerHTML = '<div><b>' + it.t + '</b><span>' + it.v + '</span></div>';
      const b = document.createElement('button');
      b.className = 'join-copy';
      b.textContent = it.b;
      b.addEventListener('click', () => {
        try {
          if (navigator.clipboard) navigator.clipboard.writeText(it.v);
          else {
            const ta = document.createElement('textarea');
            ta.value = it.v; document.body.appendChild(ta); ta.select();
            document.execCommand('copy'); document.body.removeChild(ta);
          }
          UI.toast('已复制');
        } catch (e) { UI.toast(it.v); }
      });
      card.appendChild(b);
      box.appendChild(card);
    });
    const info = document.createElement('div');
    info.className = 'codex-desc';
    info.style.marginTop = '8px';
    info.textContent = '捏捏跑酷 · Three.js 渲染；角色与场景全部由代码程序化生成，不含任何外部素材。';
    box.appendChild(info);
  },
};
