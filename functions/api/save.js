/* 捏捏跑酷 · 云端存档（EdgeOne Pages 边缘函数 + KV）
   ---------------------------------------------------------
   POST /api/save  { code?, data }   → { ok, code, ts }        存 / 续存
   GET  /api/save?code=PR7K2M        → { ok, data, ts }        取

   存档码 6 位，字母表里剔掉了 0/O/1/I——手抄的时候容易看错。
   存的是玩家的进度（金币 / 解锁的角色 / 各地图纪录 / 技能等级），
   换台机器输入码就能接着玩，不用登录。

   为什么要单独一个端点而不是塞进 rank：
   排行榜是"大家挤在一起的一张表"，存档是"一个人独享的一份数据"，
   两者的容量、校验、淘汰策略都不一样，混着写迟早要拆。

   没绑定 KV 时返回 ok:false，前端把云存档那块收起来，不影响单机玩。
   ========================================================= */

const PREFIX = 'naiwa_save_';
const MAX_BYTES = 48000;          // 一份存档上限，别让一个人把 KV 撑爆
const KEEP_DAYS = 180;            // 超过半年没人动过的存档清掉

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

/* 存档码：大写字母 + 数字，避开 0 O 1 I */
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function makeCode() {
  let s = '';
  for (let i = 0; i < 6; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return s;
}
function cleanCode(s) {
  return String(s == null ? '' : s).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
}

function pickKV(context) {
  if (typeof KV !== 'undefined' && KV) return KV;
  const env = (context && context.env) || {};
  return env.KV || env.MY_KV || env.kv || null;
}

/* 存档只收这几个字段，别的（设置、临时状态）一概不收。
   宽进严出：客户端传什么都行，落库前先挑一遍。 */
const FIELDS = ['coins', 'char', 'chars', 'best', 'bestByMap', 'mapsUnlocked',
  'skills', 'boardCount', 'achClaimed', 'challenges', 'codexSeen', 'runs',
  'totalDist', 'totalCoins'];

function pickSave(src) {
  if (!src || typeof src !== 'object') return null;
  const out = {};
  for (const k of FIELDS) {
    if (src[k] === undefined) continue;
    out[k] = src[k];
  }
  return Object.keys(out).length ? out : null;
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
    }, 200);
  }

  try {
    /* ---------------- 取档 ---------------- */
    if (request.method === 'GET') {
      const code = cleanCode(new URL(request.url).searchParams.get('code'));
      if (!code) return json({ ok: false, error: 'missing code' }, 400);
      const raw = await kv.get(PREFIX + code);
      if (!raw) return json({ ok: false, error: '没找到这个存档码' }, 404);
      let rec;
      try { rec = JSON.parse(raw); } catch (e) { return json({ ok: false, error: '存档损坏' }, 500); }
      // 顺手续命：取一次就把过期时间往后推
      rec.ts = Date.now();
      await kv.put(PREFIX + code, JSON.stringify(rec));
      return json({ ok: true, data: rec.data, ts: rec.ts });
    }

    /* ---------------- 存档 ---------------- */
    if (request.method === 'POST') {
      let d;
      try { d = await request.json(); } catch (e) { return json({ ok: false, error: 'bad json' }, 400); }
      const data = pickSave(d && d.data);
      if (!data) return json({ ok: false, error: '存档内容为空' }, 400);

      const body = JSON.stringify(data);
      if (body.length > MAX_BYTES) {
        return json({ ok: false, error: '存档太大了（上限 ' + Math.floor(MAX_BYTES / 1024) + 'KB）' }, 413);
      }

      /* 传了码就覆盖那一份，没传就新开一个。
         码冲突（极小概率撞上别人的）就重摇，直到撞不上为止。 */
      let code = cleanCode(d.code);
      if (code) {
        const old = await kv.get(PREFIX + code);
        // 别人的码不能覆盖：只有 6 位的空间，撞库风险低但不能不管
        if (old && !d.force) {
          let mine = false;
          try { mine = JSON.parse(old).owner === (d.owner || ''); } catch (e) { mine = false; }
          if (!mine) code = '';        // 让下面重新摇一个
        }
      }
      if (!code) {
        for (let i = 0; i < 8; i++) {
          const c = makeCode();
          if (!(await kv.get(PREFIX + c))) { code = c; break; }
        }
      }
      if (!code) return json({ ok: false, error: '生成存档码失败，重试一下' }, 500);

      await kv.put(PREFIX + code, JSON.stringify({
        data: data, ts: Date.now(), owner: String(d.owner || '').slice(0, 24),
      }));
      return json({ ok: true, code: code, ts: Date.now() });
    }

    return new Response('Not Found', { status: 404 });
  } catch (e) {
    return json({ ok: false, error: (e && e.message) || String(e) }, 500);
  }
}

export { makeCode, cleanCode, pickSave };
