/* =========================================================
   奶蛙跑酷 · 面板系统（世界地图 / 障碍图鉴 / 挑战之路 / 服装商城 / 排行榜 / 加入我们）
   ========================================================= */
'use strict';

const Panels = {
  el: {},
  init() {
    const q = (id) => document.getElementById(id);
    this.el = {
      diffPick: q('diffPick'), menuNow: q('menuNow'),
      mapsBody: q('mapsBody'), mapsCoins: q('mapsCoins'),
      codexBody: q('codexBody'), codexCount: q('codexCount'),
      pathBody: q('pathBody'), pathCoins: q('pathCoins'),
      outfitBody: q('outfitBody'), outfitCoins: q('outfitCoins'), outfitTabs: q('outfitTabs'),
      rankBody: q('rankBody'), joinBody: q('joinBody'),
    };
    this.outfitSkin = Store.data.char || 'naiwa';
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
  refreshMenuNow() {
    if (!this.el.menuNow) return;
    const m = World.map(Store.data.map), d = World.diff(Store.data.difficulty);
    const best = ((Store.data.bestByMap[m.id] || {})[d.id]) || 0;
    this.el.menuNow.innerHTML = '当前地图：<b>' + m.name + '</b> · 难度 <b>' + d.name +
      '</b> · 记录 ' + best + '　<span style="opacity:.7">（点上方「世界地图」切换）</span>';
  },

  /* ---------------- 世界地图 ---------------- */
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

  /* ---------------- 排行榜（本机） ---------------- */
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
    info.textContent = '奶蛙跑酷 · 自研引擎版本；角色形象为卡通戏仿演绎，仅供娱乐。';
    box.appendChild(info);
  },
};
