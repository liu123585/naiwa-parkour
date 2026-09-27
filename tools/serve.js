/* 极简静态服务器（本地开发/验收用）
   用法: node tools/serve.js [端口]  → 打开 http://localhost:8123
   说明: AI 素材的抠图需要读取画布像素，file:// 下会被浏览器安全策略拦截，
        因此本地预览请用本服务器，不要直接双击 index.html。 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PORT = parseInt(process.argv[2] || '8123', 10);
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.json': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
};

http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const file = path.join(ROOT, path.normalize(p).replace(/^([/\\])+/, ''));
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end('forbidden'); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('404 ' + p); }
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(buf);
  });
}).listen(PORT, () => {
  console.log('奶蛙跑酷 本地服务: http://localhost:' + PORT);
});
