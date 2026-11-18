/* Vercel 등 정적 호스팅용 빌드: prototype/ 을 dist/ 로 복사하고 samples/ 를 dist/samples/ 로 합칩니다.
 * (로컬 serve.js 는 /samples/ 를 별도 폴더에서 내려주지만, 정적 호스팅은 한 폴더만 서비스하므로 합쳐야 합니다) */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const out = path.join(root, 'dist');

fs.rmSync(out, { recursive: true, force: true });
fs.cpSync(path.join(root, 'prototype'), out, { recursive: true });
fs.cpSync(path.join(root, 'samples'), path.join(out, 'samples'), { recursive: true });

const count = (d) => fs.readdirSync(d, { withFileTypes: true }).reduce((n, e) => n + (e.isDirectory() ? count(path.join(d, e.name)) : 1), 0);
console.log(`dist 생성 완료: 파일 ${count(out)}개 → ${out}`);
