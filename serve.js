/* 로컬 정적 서버 (의존성 없음): node serve.js  →  http://localhost:8080
 * localhost는 '보안 컨텍스트'라 WebCrypto/IndexedDB가 안정적으로 동작합니다. 외부 접속은 차단(127.0.0.1 바인딩). */
const http = require('http');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, 'prototype');
const samplesDir = path.join(__dirname, 'samples');
const port = +process.env.PORT || 8080;
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.xlsx': 'application/octet-stream', '.odt': 'application/vnd.oasis.opendocument.text' };

http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const isSample = p.startsWith('/samples/');
  const base = isSample ? samplesDir : root;
  const rel = isSample ? p.slice('/samples/'.length) : p;
  const f = path.normalize(path.join(base, rel));
  if (!f.startsWith(base)) { res.writeHead(403); return res.end('forbidden'); }
  fs.readFile(f, (err, data) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' });
    res.end(data);
  });
}).listen(port, '127.0.0.1', () => console.log(`프로토타입 실행 중: http://localhost:${port}  (종료: Ctrl+C)`));
