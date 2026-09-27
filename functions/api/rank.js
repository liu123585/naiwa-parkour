/* 奶蛙跑酷 · 云端排行榜（EdgeOne Pages 边缘函数 + KV）
   GET  /api/rank?map=city&diff=normal&limit=20   → { list: [...], ok:true }
   POST /api/rank  {name, score, dist, map, diff} → { ok:true, rank:n, code:'XXXX' }
   说明：KV 未绑定时返回 ok:false，前端自动退回本机记录。 */

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

const KEY = 'naiwa_rank_v1';
const MAX_KEEP = 300;

function cleanName(s) {
  return String(s == null ? '' : s).replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 12) || '奶蛙玩家';
}

export async function onRequest(context) {
  const { request } = context;
  const kv = (typeof KV !== 'undefined' && KV) || (context.env && (context.env.KV || context.env.MY_KV));
  const url = new URL(request.url);

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
  if (!kv) return json({ ok: false, error: 'KV 未绑定', list: [] }, 200);

  try {
    if (request.method === 'GET') {
      const map = url.searchParams.get('map') || '';
      const diff = url.searchParams.get('diff') || '';
      const limit = Math.min(50, parseInt(url.searchParams.get('limit') || '20', 10) || 20);
      const raw = await kv.get(KEY);
      let list = raw ? JSON.parse(raw) : [];
      if (map) list = list.filter(x => x.map === map);
      if (diff) list = list.filter(x => x.diff === diff);
      list.sort((a, b) => b.score - a.score);
      return json({ ok: true, list: list.slice(0, limit) });
    }

    if (request.method === 'POST') {
      let d;
      try { d = await request.json(); } catch (e) { return json({ ok: false, error: 'bad json' }, 400); }
      const name = cleanName(d.name);
      const score = Math.max(0, Math.min(99999999, Math.floor(Number(d.score) || 0)));
      const dist = Math.max(0, Math.min(999999, Math.floor(Number(d.dist) || 0)));
      const map = String(d.map || 'city').slice(0, 16);
      const diff = ['easy', 'normal', 'hard'].indexOf(d.diff) >= 0 ? d.diff : 'normal';
      if (diff !== 'normal') return json({ ok: false, error: '仅普通难度计入云端榜' }, 200);
      if (score <= 0) return json({ ok: false, error: 'invalid score' }, 400);

      const raw = await kv.get(KEY);
      let list = raw ? JSON.parse(raw) : [];
      // 同名玩家只保留最好成绩
      const exist = list.find(x => x.name === name);
      const code = 'NW' + Math.random().toString(36).slice(2, 6).toUpperCase();
      if (exist) {
        if (score > exist.score) { exist.score = score; exist.dist = dist; exist.map = map; exist.ts = Date.now(); }
      } else {
        list.push({ name: name, score: score, dist: dist, map: map, diff: diff, code: code, ts: Date.now() });
      }
      list.sort((a, b) => b.score - a.score);
      if (list.length > MAX_KEEP) list = list.slice(0, MAX_KEEP);
      await kv.put(KEY, JSON.stringify(list));
      const rank = list.findIndex(x => x.name === name) + 1;
      const mine = list.find(x => x.name === name);
      return json({ ok: true, rank: rank, code: (mine && mine.code) || code, total: list.length });
    }

    return new Response('Not Found', { status: 404 });
  } catch (e) {
    return json({ ok: false, error: (e && e.message) || String(e), list: [] }, 500);
  }
}
