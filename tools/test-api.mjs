/* 云端接口回归测试（假 KV）
   KV 得用户在控制台绑，本地没有真 KV。所以这里用一个内存 Map 顶上，
   直接调 onRequest，把排行榜和存档的读写跑一遍。
   用完即删。 */
import fs from 'fs';
import os from 'os';
import path from 'path';

const SRC = 'D:/桌面/vibe coding/naiwa-parkour/functions/api';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kv-'));

/* 源文件是 .js（EdgeOne 要求），node 按 package.json 会当 CJS 处理，
   所以复制一份成 .mjs 再 import。 */
async function load(name) {
  const p = path.join(tmp, name + '.mjs');
  fs.copyFileSync(path.join(SRC, name + '.js'), p);
  return import('file://' + p.replace(/\\/g, '/'));
}

function mockKV() {
  const m = new Map();
  return {
    map: m,
    async get(k) { return m.has(k) ? m.get(k) : null; },
    async put(k, v) { m.set(k, String(v)); },
  };
}

const rank = await load('rank');
const save = await load('save');

let bad = 0;
const T = [];
const add = (n, expect, got) => {
  const pass = String(expect) === String(got);
  if (!pass) bad++;
  T.push({ n, expect, got, pass });
};

const call = (mod, ctx) => mod.onRequest(ctx).then(r => r.json());
const ctxOf = (url, method, body) => ({
  request: body
    ? new Request(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    : new Request(url, { method }),
  env: {},
});

/* ---------------- 排行榜 ---------------- */
{
  globalThis.KV = mockKV();
  const U = 'https://x/api/rank';

  let d = await call(rank, ctxOf(U, 'POST', { name: '刘昱善', score: 5000, dist: 900, map: 'city', diff: 'normal' }));
  add('提交成绩成功', 'true', String(d.ok));
  add('返回存档码', 'yes', d.code && d.code.length >= 3 ? 'yes' : 'no');
  const code1 = d.code;

  // 同名同图低分不该覆盖
  await call(rank, ctxOf(U, 'POST', { name: '刘昱善', score: 100, dist: 50, map: 'city', diff: 'normal' }));
  d = await call(rank, ctxOf(U + '?map=city&diff=normal', 'GET'));
  add('低分不覆盖高分', '5000', String(d.list[0].score));

  // 同名同图高分要覆盖
  await call(rank, ctxOf(U, 'POST', { name: '刘昱善', score: 9000, dist: 1500, map: 'city', diff: 'normal' }));
  d = await call(rank, ctxOf(U + '?map=city&diff=normal', 'GET'));
  add('高分覆盖低分', '9000', String(d.list[0].score));
  add('同名只留一条', '1', String(d.list.length));

  // 三档难度各存各的
  await call(rank, ctxOf(U, 'POST', { name: '甲', score: 700, dist: 100, map: 'city', diff: 'hard' }));
  d = await call(rank, ctxOf(U + '?diff=hard', 'GET'));
  add('困难难度单独成榜', '700', String(d.list[0].score));
  d = await call(rank, ctxOf(U + '?diff=normal', 'GET'));
  add('普通榜不受影响', '9000', String(d.list[0].score));

  // 按地图过滤
  await call(rank, ctxOf(U, 'POST', { name: '乙', score: 8000, dist: 1200, map: 'changan', diff: 'normal' }));
  d = await call(rank, ctxOf(U + '?map=city&diff=normal', 'GET'));
  add('按地图过滤', '1', String(d.list.length));
  d = await call(rank, ctxOf(U + '?diff=normal', 'GET'));
  add('total 含全部地图', '2', String(d.total));

  // 昵称注入
  await call(rank, ctxOf(U, 'POST', { name: '<script>x</script>', score: 10, dist: 1, map: 'city', diff: 'normal' }));
  d = await call(rank, ctxOf(U + '?diff=normal', 'GET'));
  const hasBad = d.list.some(r => /<script>/.test(r.name));
  add('昵称里的尖括号被清掉', 'no', hasBad ? 'yes' : 'no');

  // 非法分数
  d = await call(rank, ctxOf(U, 'POST', { name: '丙', score: 0, dist: 1, map: 'city', diff: 'normal' }));
  add('0 分被拒', 'invalid score', String(d.error));

  delete globalThis.KV;
}

/* ---------------- 云端存档 ---------------- */
{
  globalThis.KV = mockKV();
  const U = 'https://x/api/save';

  const data = {
    coins: 12345, char: 'ni', chars: ['ni', 'maoqiu'], best: 8888,
    bestByMap: { city: { normal: 8888 } }, skills: { magnet: 2 }, boardCount: 3,
    __evil: '这条不该进库',
  };
  let d = await call(save, ctxOf(U, 'POST', { data }));
  add('存档成功', 'true', String(d.ok));
  add('拿到 6 位存档码', '6', String((d.code || '').length));
  const code = d.code;

  d = await call(save, ctxOf(U + '?code=' + code, 'GET'));
  add('按码取回', 'true', String(d.ok));
  add('金币取回正确', '12345', String(d.data.coins));
  add('角色列表取回', 'ni,maoqiu', String(d.data.chars.join(',')));
  add('多余字段被过滤', 'no', d.data.__evil !== undefined ? 'yes' : 'no');

  // 用同一个码续存
  data.coins = 20000;
  d = await call(save, ctxOf(U, 'POST', { code, data }));
  add('同码续存返回同一个码', code, String(d.code));
  d = await call(save, ctxOf(U + '?code=' + code, 'GET'));
  add('续存后金币更新', '20000', String(d.data.coins));

  // 空存档
  d = await call(save, ctxOf(U, 'POST', { data: { nonsense: 1 } }));
  add('空存档被拒', '存档内容为空', String(d.error));

  // 超大存档
  d = await call(save, ctxOf(U, 'POST', { data: { coins: 'x'.repeat(60000) } }));
  add('超 48KB 被拒', '413', String(d.error).indexOf('太大') >= 0 ? '413' : 'no');

  // 码不存在
  d = await call(save, ctxOf(U + '?code=ZZZZZZ', 'GET'));
  add('取不存在的码', '没找到这个存档码', String(d.error));

  delete globalThis.KV;
}

/* ---------------- KV 未绑定时的降级 ---------------- */
{
  const U = 'https://x/api/rank';
  const d = await call(rank, ctxOf(U, 'GET'));
  add('没 KV 时 rank 不抛异常', 'KV 未绑定', String(d.error));
  add('没 KV 时 rank 返回空榜', '0', String(d.list.length));
  const s = await call(save, ctxOf('https://x/api/save', 'GET'));
  add('没 KV 时 save 不抛异常', 'KV 未绑定', String(s.error));
}

console.log('用例'.padEnd(28) + '期望'.padEnd(20) + '实际'.padEnd(20) + '结果');
for (const t of T) {
  console.log(t.n.padEnd(26) + String(t.expect).padEnd(20) + String(t.got).padEnd(20) + (t.pass ? 'PASS' : 'FAIL'));
}
console.log('\n' + (bad ? bad + ' 项未通过' : '全部通过（' + T.length + ' 项）'));
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(bad ? 1 : 0);
