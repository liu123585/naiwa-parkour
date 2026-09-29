/* 捏捏跑酷 · 云端排行榜（EdgeOne Pages 边缘函数 + KV）
   ---------------------------------------------------------
   GET  /api/rank?map=city&diff=normal&limit=20   → { ok, list:[...], total }
   POST /api/rank  {name,score,dist,map,diff}     → { ok, rank, code, total }

   开启方式：EdgeOne 控制台 → 这个项目 → KV → 绑定命名空间，
   变量名填 **KV**（大小写敏感）。没绑定时这里返回 ok:false，
   前端会自动退回本机记录，不会报错。

   改动记录：
   · 从前只有普通难度能上榜，三档难度各存一张榜（key 带 diff）
   · GET 带 total，前端好显示"共多少条"
   ========================================================= */

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Cache-Control': 'no-store',
    },
  });
}

const PREFIX = 'naiwa_rank_v2_';
const MAX_KEEP = 300;
const DIFFS = ['easy', 'normal', 'hard'];

/* 昵称：去掉控制字符和尖括号，截断到 12 字。空了就给个默认的。 */
function cleanName(s) {
  const t = String(s == null ? '' : s).replace(/[\u0000-\u001f<>&]/g, '').trim();
  return t.slice(0, 12) || '路过的';
}

function cleanMap(s) {
  const t = String(s == null ? '' : s).replace(/[^a-z0-9_-]/gi, '').slice(0, 16);
  return t || 'city';
}

/* 把 submit 合并进已有榜单。
   同名玩家只留最好成绩，然后按分数降序、截断到 MAX_KEEP。
   单独抽成一个纯函数，好用 node 拿假 KV 跑测试（见 tools/_kvtest.mjs）。 */
function mergeInto(list, item) {
  const out = Array.isArray(list) ? list.slice() : [];
  const exist = out.find(x => x.name === item.name && x.map === item.map);
  if (exist) {
    if (item.score > exist.score) {
      exist.score = item.score;
      exist.dist = item.dist;
      exist.ts = item.ts;
      exist.code = exist.code || item.code;
    }
  } else {
    out.push(item);
  }
  out.sort((a, b) => b.score - a.score);
  return out.length > MAX_KEEP ? out.slice(0, MAX_KEEP) : out;
}

async function readList(kv, key) {
  const raw = await kv.get(key);
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v : [];
  } catch (e) {
    return [];        // 里头存了坏数据就当空榜，别让整个接口挂掉
  }
}

/* KV 在 EdgeOne 里是绑定成全局变量进来的；不同版本绑出来的名字不一样，
   几个常见的都试一遍。 */
function pickKV(context) {
  if (typeof KV !== 'undefined' && KV) return KV;
  const env = (context && context.env) || {};
  return env.KV || env.MY_KV || env.kv || null;
}

export async function onRequest(context) {
  const { request } = context;

  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    });
  }

  const kv = pickKV(context);
  if (!kv) {
    return json({
      ok: false,
      error: 'KV 未绑定',
      howto: 'EdgeOne 控制台 → 本项目 → KV → 绑定命名空间，变量名填 KV',
      list: [],
    }, 200);
  }

  try {
    const url = new URL(request.url);

    /* ---------------- 取榜 ---------------- */
    if (request.method === 'GET') {
      const diff = DIFFS.indexOf(url.searchParams.get('diff')) >= 0 ? url.searchParams.get('diff') : 'normal';
      const map = cleanMap(url.searchParams.get('map'));
      const onlyMap = url.searchParams.has('map');
      const limit = Math.min(50, parseInt(url.searchParams.get('limit') || '20', 10) || 20);

      const all = await readList(kv, PREFIX + diff);
      const list = onlyMap ? all.filter(x => x.map === map) : all;
      return json({ ok: true, list: list.slice(0, limit), total: all.length });
    }

    /* ---------------- 上传成绩 ---------------- */
    if (request.method === 'POST') {
      let d;
      try { d = await request.json(); } catch (e) { return json({ ok: false, error: 'bad json' }, 400); }

      const diff = DIFFS.indexOf(d.diff) >= 0 ? d.diff : 'normal';
      const name = cleanName(d.name);
      const score = Math.max(0, Math.min(99999999, Math.floor(Number(d.score) || 0)));
      const dist = Math.max(0, Math.min(999999, Math.floor(Number(d.dist) || 0)));
      const map = cleanMap(d.map);
      if (score <= 0) return json({ ok: false, error: 'invalid score' }, 400);

      const key = PREFIX + diff;
      const list = await readList(kv, key);
      const exist = list.find(x => x.name === name && x.map === map);
      const code = exist && exist.code ? exist.code
        : 'PR' + Math.random().toString(36).slice(2, 6).toUpperCase().replace(/[01]/g, 'X');

      const merged = mergeInto(list, {
        name: name, score: score, dist: dist, map: map, code: code, ts: Date.now(),
      });
      await kv.put(key, JSON.stringify(merged));

      const rank = merged.findIndex(x => x.name === name && x.map === map) + 1;
      return json({ ok: true, rank: rank, code: code, total: merged.length });
    }

    return new Response('Not Found', { status: 404 });
  } catch (e) {
    return json({ ok: false, error: (e && e.message) || String(e), list: [] }, 500);
  }
}

export { mergeInto, cleanName, cleanMap };
