/* 순수 로직(엑셀 분석/검증, 개인정보 탐지, 공문서 생성) 검증: node tools/test_logic.js */
const path = require('path');
const fs = require('fs');
const assert = require('assert');
globalThis.XLSX = require('../prototype/vendor/xlsx.full.min.js');
globalThis.JSZip = require('../prototype/vendor/jszip.min.js');
const PII = require('../prototype/js/pii.js');
const Excel = require('../prototype/js/excel.js');
const Doc = require('../prototype/js/docgen.js');
const { Org } = require('../prototype/js/data.js');
globalThis.Org = Org;
const { DOMParser } = require('@xmldom/xmldom');

const S = path.join(__dirname, '..', 'samples');
const TMP = path.join(require('os').tmpdir(), 'fire-collect-test-out');
const read = (f) => Excel.read(fs.readFileSync(path.join(S, f)));
let pass = 0;
const t = (name, fn) => Promise.resolve().then(fn).then(() => { pass++; console.log('  ✓', name); }, (e) => { console.error('  ✗', name, '\n   ', e.message); process.exitCode = 1; });

(async () => {
  console.log('[엑셀 서식 분석]');
  await t('2단 머리글 + 제목행 인식', () => {
    const a = Excel.analyze(read('01_서식예시_장비보유현황(2단머리글).xlsx'));
    assert.deepStrictEqual(a.columns.map((c) => c.name), ['장비명', '규격', '보유 현황/수량', '보유 현황/보유부서', '도입일자', '비고']);
    assert.strictEqual(a.headerRow, 3);
    assert.strictEqual(a.title, '소방장비 보유현황 조사표');
    assert.strictEqual(a.columns.find((c) => c.name === '도입일자').type, 'date');
    assert.strictEqual(a.columns.find((c) => c.name.endsWith('수량')).type, 'number');
  });
  await t('필수(*) 표시·개인정보 컬럼 추정·예시 자동 채움', () => {
    const a = Excel.analyze(read('02_서식예시_교육이수자명단.xlsx'));
    const by = Object.fromEntries(a.columns.map((c) => [c.name, c]));
    assert.deepStrictEqual(a.columns.map((c) => c.name), ['성명', '생년월일', '연락처', '소속', '교육 이수일자', '비고']);
    assert.ok(by['성명'].required && by['성명'].pii && by['연락처'].pii && by['생년월일'].pii);
    assert.ok(!by['소속'].pii && !by['비고'].pii);
    assert.strictEqual(by['성명'].examples[0], '홍길동');
    assert.strictEqual(by['생년월일'].type, 'date');
  });

  const cols = [
    { name: '장비명', type: 'text', required: true, examples: ['소방펌프차', '고가사다리차'] },
    { name: '규격', type: 'text', required: false, examples: ['3,000L급', '35m급'] },
    { name: '수량', type: 'number', required: true, examples: ['3', '1'] },
    { name: '보유부서', type: 'text', required: true, examples: ['A', 'B'] },
    { name: '도입일자', type: 'date', required: false, examples: ['2021-03-15', ''] },
    { name: '비고', type: 'text', required: false, examples: ['', ''] },
  ];
  console.log('[제출 엑셀 검증]');
  await t('정상 파일 통과', () => {
    const v = Excel.validate(read('04_제출예시_장비보유현황.xlsx'), cols);
    assert.strictEqual(v.missing.length, 0);
    assert.strictEqual(v.errors.length, 0, JSON.stringify(v.errors));
    assert.strictEqual(v.rows.length, 3);
    assert.strictEqual(v.rows[0][4], '2021-03-15');
  });
  await t('텍스트 유형 상관없이 원문 보존(업로드 차단 방지) 및 경고 검출', () => {
    const v = Excel.validate(read('05_제출예시_장비보유현황(오류포함).xlsx'), cols);
    // 숫자 컬럼에 한글('다섯 대'), 비정형 날짜('2020/13/45')가 있어도 오류로 차단되지 않고 원문 그대로 수용
    assert.strictEqual(v.errors.length, 0);
    assert.strictEqual(v.rows[0][2], '다섯 대'); // 수량
    assert.strictEqual(v.rows[1][4], '2020/13/45'); // 도입일자
    assert.ok(v.warnings.some((w) => w.col === '장비명' && w.msg.includes('필수 항목')));
  });
  await t('컬럼 누락 검출', () => {
    const v = Excel.validate(read('03_제출예시_교육이수자명단(가상개인정보).xlsx'), cols);
    assert.ok(v.missing.includes('장비명'));
  });
  await t('예시 행 그대로 제출 시 경고', () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([cols.map((c) => c.name), ['소방펌프차', '3,000L급', '3', 'A', '2021-03-15', ''], ['신규', 'x', '2', 'C', '2024-01-01', '']]), 'S');
    const v = Excel.validate(wb, cols);
    assert.ok(v.warnings.some((w) => w.includes('예시 행')));
  });
  await t('서식 생성(예시 행 포함) 후 재분석', () => {
    const wb = Excel.buildTemplate({ columns: cols });
    const a = Excel.analyze(Excel.read(Excel.toBytes(wb)));
    assert.deepStrictEqual(a.columns.map((c) => c.name), cols.map((c) => c.name));
    assert.strictEqual(a.columns[0].examples[0], '소방펌프차');
  });
  await t('사하소방서/신평·감천119안전센터 맞춤형 서식(표 테두리·인원명부 ON/OFF·자동 사전 기재) 검증', async () => {
    const sinpyeong = Org.byName('신평119안전센터');
    const gamcheon = Org.byName('감천119안전센터');
    const cols2 = [
      { name: '연번', type: 'number', required: false, examples: ['1', '2'] },
      { name: '기관', type: 'text', required: true, examples: ['부산소방재난본부 사하소방서', '부산소방재난본부 사하소방서'] },
      { name: '소속', type: 'text', required: true, examples: ['신평119안전센터', '감천119안전센터'] },
      { name: '계급', type: 'text', required: true, examples: ['소방교', '소방장'] },
      { name: '성명', type: 'text', required: true, examples: ['홍길동', '김소방'] },
    ];
    const req = { title: '불꽃축제 동원 명단 제출', columns: cols2 };

    // 1) 인원명부 자동기재 ON (기본값): 신평119안전센터 인원(기관, 소속, 계급, 성명)까지 모두 기재
    const bytesOn = await Excel.templateBytes(req, { id: sinpyeong.id }, { prefillRoster: true });
    const zipOn = await JSZip.loadAsync(bytesOn);
    const stylesXml = await zipOn.file('xl/styles.xml').async('string');
    const sheet1Xml = await zipOn.file('xl/worksheets/sheet1.xml').async('string');
    assert.ok(stylesXml.includes('<borders count="3">') && sheet1Xml.includes('state="frozen"'), '실제 엑셀 표 테두리(borders) 및 틀 고정(frozen) 스타일 포함');

    const wbOn = Excel.read(bytesOn);
    const sOn = XLSX.utils.sheet_to_json(wbOn.Sheets['제출서식'], { header: 1 });
    assert.strictEqual(sOn[0][0], '[사하소방서] 불꽃축제 동원 명단 제출');
    assert.strictEqual(sOn[2][0], '요청 기관');
    assert.strictEqual(sOn[3][0], '제출 대상');
    assert.ok(sOn[3][1].includes('부산소방재난본부 사하소방서 > 신평119안전센터'));
    // 10행(index 10)부터 신평119안전센터 인원명부 자동 기재 확인
    const rosterSin = Org.rosterOf(sinpyeong.id);
    assert.ok(rosterSin.length >= 4);
    assert.strictEqual(sOn[10][1], '부산소방재난본부 사하소방서');
    assert.strictEqual(sOn[10][2], '신평119안전센터');
    assert.strictEqual(sOn[10][3], rosterSin[0].rank);
    assert.strictEqual(sOn[10][4], rosterSin[0].name);

    // 2) 인원명부 자동기재 OFF: 기관·소속만 기재되고 계급·성명은 빈칸
    const wbOff = Excel.buildTemplate(req, { id: gamcheon.id }, { prefillRoster: false });
    const sOff = XLSX.utils.sheet_to_json(wbOff.Sheets['제출서식'], { header: 1 });
    const prefilledRows = sOff.slice(10, 18);
    assert.strictEqual(prefilledRows.length, 8);
    prefilledRows.forEach((r, idx) => {
      assert.strictEqual(r[0], String(idx + 1)); // 연번
      assert.strictEqual(r[1], '부산소방재난본부 사하소방서'); // 기관
      assert.strictEqual(r[2], '감천119안전센터'); // 소속
      assert.strictEqual(r[3], ''); // 계급 (작성란 빈칸)
      assert.strictEqual(r[4], ''); // 성명 (작성란 빈칸)
    });
    // 대원이 1행만 입력하고 나머지 행은 빈 채로 제출했을 때 검증 통과(미작성 행 자동 스킵) 확인
    sOff[10][3] = '소방사';
    sOff[10][4] = '이순신';
    const testWs = XLSX.utils.aoa_to_sheet(sOff);
    const testWb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(testWb, testWs, '제출서식');
    const v = Excel.validate(testWb, cols2);
    assert.strictEqual(v.errors.length, 0);
    // 예시 2행 + 실제 입력 1행 = 3행만 수용
    assert.strictEqual(v.rows.length, 3);
    assert.strictEqual(v.rows[2][4], '이순신');
    assert.strictEqual(v.warnings.filter((w) => w.msg && w.msg.includes('필수')).length, 0);
  });

  console.log('[개인정보 탐지]');
  await t('주민번호·휴대폰·이메일·유선전화·카드', () => {
    const f = PII.scan('주민 900101-1234567, 휴대폰 010-1234-5678, 051-123-4567, a.b@sample.go.kr, 카드 4111 1111 1111 1111');
    const types = f.map((x) => x.type);
    ['주민/외국인등록번호', '휴대전화번호', '유선전화번호', '이메일', '카드번호'].forEach((x) => assert.ok(types.includes(x), x + ' 미탐지: ' + types));
    assert.ok(!types.includes('계좌번호(추정)'), '전화번호가 계좌로 중복 탐지됨');
  });
  await t('일반 문장·날짜·수량은 오탐 없음', () => {
    assert.strictEqual(PII.scan('2026-11-07 소방펌프차 120대 3,000L급 관리번호 12345').length, 0);
  });
  await t('마스킹', () => {
    assert.strictEqual(PII.redact('010-1234-5678'), '010-****-5678');
    assert.strictEqual(PII.maskValue('홍길동'), '홍*동');
    assert.ok(PII.redact('900101-1234567').includes('900101-*******'));
  });

  console.log('[공문서 생성]');
  const d = {
    orgName: '부산소방재난본부', receiver: '부산소방재난본부장', via: '', title: '소방장비 보유현황 조사 결과 보고',
    body: '1. 관련: 소방행정과-1234(2026. 11. 3.)\n2. 위 호와 관련하여 12개 소방서의 제출 결과를 아래와 같이 보고합니다.\n  가. 제출률: 100%\n  나. 특이사항: 없음',
    attachments: ['장비보유현황 취합표 1부.', '소방서별 제출 현황 1부.'], sender: '부산소방재난본부장',
    signLine: '주무관 김행정  팀장 ○○○  과장 ○○○  본부장 전결 ○○○', cooperator: '', docNo: '소방행정과-2345', date: '2026. 11. 7.', receiptNo: '',
    zip: '47545', addr: '부산광역시 연제구 중앙대로 1001', tel: '051-000-0000', fax: '051-000-0001', email: 'sample@korea.kr', publicType: '공개',
  };
  const wellFormed = (xml, name) => {
    const errs = [];
    new DOMParser({ onError: (lvl, msg) => errs.push(msg) }).parseFromString(xml, 'text/xml');
    assert.strictEqual(errs.length, 0, `${name}: ${errs.join('; ')}`);
  };
  await t('ODT: mimetype 첫 항목·무압축, XML 정상', async () => {
    const buf = await Doc.buildOdt(d, 'nodebuffer');
    const zip = await JSZip.loadAsync(buf);
    assert.strictEqual(Object.keys(zip.files)[0], 'mimetype');
    assert.strictEqual(await zip.file('mimetype').async('string'), 'application/vnd.oasis.opendocument.text');
    assert.strictEqual(buf.slice(30, 38).toString(), 'mimetype');
    for (const n of ['content.xml', 'styles.xml', 'meta.xml', 'META-INF/manifest.xml']) wellFormed(await zip.file(n).async('string'), n);
    assert.ok((await zip.file('content.xml').async('string')).includes('소방장비 보유현황 조사 결과 보고'));
    fs.mkdirSync(TMP, { recursive: true });
    fs.writeFileSync(path.join(TMP, 'test.odt'), buf);
  });
  await t('ODT: 입력한 본문·붙임이 반영되고 예시 문안은 남지 않음', async () => {
    const buf = await Doc.buildOdt({ ...d, body: '1. 첫째 줄 시험 문구\n2. 둘째 줄 시험 문구', attachments: ['시험 붙임파일 1부.'] }, 'uint8array');
    const xml = await (await JSZip.loadAsync(buf)).file('content.xml').async('string');
    const text = xml.replace(/<[^>]+>/g, '');
    assert.ok(text.includes('1. 첫째 줄 시험 문구') && text.includes('2. 둘째 줄 시험 문구'), '본문 반영');
    assert.ok(text.includes('붙임') && text.includes('시험 붙임파일 1부.'), '붙임 반영');
    assert.ok(!text.includes('명단을 없음') && !text.includes('5524호'), '예시 본문 잔존 없음');
    wellFormed(xml, 'content.xml');
    const one = await Doc.buildOdt({ ...d, body: '단일 줄', attachments: [] }, 'uint8array');
    const t2 = (await (await JSZip.loadAsync(one)).file('content.xml').async('string')).replace(/<[^>]+>/g, '');
    assert.ok(/단일 줄\s*끝\./.test(t2), '붙임이 없으면 본문 끝에 끝. 표시');
  });
  await t('HWPX: 필수 파트 존재, XML 정상', async () => {
    const buf = await Doc.buildHwpx(d, 'nodebuffer');
    const zip = await JSZip.loadAsync(buf);
    assert.strictEqual(Object.keys(zip.files)[0], 'mimetype');
    assert.strictEqual(await zip.file('mimetype').async('string'), 'application/hwp+zip');
    for (const n of ['version.xml', 'META-INF/container.xml', 'Contents/content.hpf', 'Contents/header.xml', 'Contents/section0.xml']) wellFormed(await zip.file(n).async('string'), n);
    const sec = await zip.file('Contents/section0.xml').async('string');
    assert.ok(sec.includes('<hp:secPr') && sec.includes('붙임') && sec.includes('끝.'));
    fs.writeFileSync(path.join(TMP, 'test.hwpx'), buf);
  });
  await t('HWPX: 표준기안문 양식(로고·표) 유지, 표지 문자열/개인정보 잔존 없음, 본문 여러 줄·특수문자 반영', async () => {
    const buf = await Doc.buildHwpx({ ...d, body: '1. 첫째 & <둘째>\n2. 셋째 줄', attachments: ['붙임파일 가', '붙임파일 나'] }, 'uint8array');
    const zip = await JSZip.loadAsync(buf);
    assert.strictEqual(Object.keys(zip.files)[0], 'mimetype');
    assert.ok(zip.file('BinData/image1.PNG'), '로고 이미지');
    assert.ok(!Object.keys(zip.files).some((n) => n.startsWith('Preview/')), '미리보기 파일 없음');
    const sec = await zip.file('Contents/section0.xml').async('string');
    wellFormed(sec, 'section0.xml');
    assert.ok(!sec.includes('@@'), '표지 문자열 잔존 없음');
    assert.ok(sec.includes('1. 첫째 &amp; &lt;둘째&gt;') && sec.includes('2. 셋째 줄'), '본문 반영 및 이스케이프');
    assert.ok(sec.includes('붙임  1. 붙임파일 가') && sec.includes('2. 붙임파일 나  끝.'), '붙임 여러 개');
    assert.strictEqual((sec.match(/<hp:fieldEnd /g) || []).length, 1, '본문 필드 끝 1개');
    assert.ok(sec.includes('<hp:tbl') && sec.includes('<hp:pic'), '기관정보 표·로고 포함');
    const hpf = await zip.file('Contents/content.hpf').async('string');
    wellFormed(hpf, 'content.hpf');
    assert.ok(hpf.includes('<opf:title>' + d.title) && !hpf.includes('정민규'), '문서 제목 메타, 개인 이름 없음');
    const single = await Doc.buildHwpx({ ...d, body: '한 줄', attachments: [] }, 'uint8array');
    const sec2 = await (await JSZip.loadAsync(single)).file('Contents/section0.xml').async('string');
    assert.ok(/한 줄  끝\./.test(sec2) && (sec2.match(/<hp:fieldEnd /g) || []).length === 1, '붙임 없으면 본문 끝에 끝.');
  });
  await t('끝 표시: 붙임 없으면 본문 끝, 있으면 붙임 끝', () => {
    const a = Doc.layout({ ...d, attachments: [] }).map((l) => l.t);
    assert.ok(a.some((l) => l.endsWith('나. 특이사항: 없음  끝.')));
    const b = Doc.layout(d).map((l) => l.t);
    assert.ok(b.some((l) => l.includes('2. 소방서별 제출 현황 1부.  끝.')));
  });
  console.log('[취합 보고서 서식]');
  const reportSheets = () => [
    {
      name: '취합', title: '시험 요청 — 취합 결과', note: '취합일시 2026-01-01 00:00  |  총 4행',
      header: ['연번', '기관', '비고', '수량'], rows: [[1, '사하소방서', '-', 3], [2, '사하소방서', '=1+1', 4], [3, '동래소방서', '긴 내용 '.repeat(8), 5], [4, '동래소방서', '', 6]],
      groups: [0, 0, 1, 1],
    },
    {
      name: '제출현황', title: '제출 현황', freeze: false, info: [['요청 기관', '소방행정과']],
      header: ['제출조직', '상태'], rows: [['사하소방서', '승인'], ['동래소방서', '검토 대기'], ['중부소방서', '미제출']], statusCol: 1,
      statusStyle: (v) => ({ '승인': 'ok', '검토 대기': 'info', '반려': 'bad' }[v] || 'none'),
    },
  ];
  await t('보고서 xlsx: 값 보존(앞 아포스트로피 없음)·숫자 셀·읽기 가능', async () => {
    const bytes = await Excel.reportBytes(reportSheets());
    const wb = globalThis.XLSX.read(bytes, { type: 'array' });
    assert.deepStrictEqual(wb.SheetNames, ['취합', '제출현황']);
    const aoa = globalThis.XLSX.utils.sheet_to_json(wb.Sheets['취합'], { header: 1, defval: '' });
    const hr = aoa.findIndex((r) => r[0] === '연번');
    assert.ok(hr >= 2, '제목·요약 아래에 머리글');
    assert.strictEqual(aoa[hr + 1][2], '-');
    assert.strictEqual(aoa[hr + 2][2], '=1+1', '수식처럼 보이는 문자열도 그대로(텍스트 셀)');
    assert.strictEqual(typeof aoa[hr + 1][3], 'number');
    assert.ok(wb.Sheets['취합']['!merges'].length >= 2, '제목·요약 병합');
  });
  await t('보고서 xlsx: 스타일/시트 XML 정상, 필터·틀 고정·상태 색상', async () => {
    const zip = await JSZip.loadAsync(await Excel.reportBytes(reportSheets()));
    const styles = await zip.file('xl/styles.xml').async('string');
    const s1 = await zip.file('xl/worksheets/sheet1.xml').async('string');
    const s2 = await zip.file('xl/worksheets/sheet2.xml').async('string');
    for (const [n, x] of [['styles', styles], ['sheet1', s1], ['sheet2', s2]]) wellFormed(x, n);
    assert.ok(styles.includes('FF1F3A68') && styles.includes('FFDCFCE7') && styles.includes('FFFEE2E2'), '머리글·상태 색상');
    assert.ok(/<autoFilter ref="A\d+:D\d+"\/>/.test(s1), '자동 필터');
    assert.ok(s1.includes('state="frozen"') && !s2.includes('state="frozen"'), '데이터 시트만 머리글 고정');
    assert.ok(s2.includes('s="9"') && s2.includes('s="10"') && s2.includes('s="12"'), '승인/검토대기/미제출 색상 스타일');
    assert.ok(!/<mergeCell ref="([A-Z]+\d+):\1"/.test(s1 + s2), '1칸짜리 병합 없음');
  });
  await t('보고서 xlsx: 기관별 줄무늬(같은 기관은 같은 배경)', async () => {
    const zip = await JSZip.loadAsync(await Excel.reportBytes(reportSheets()));
    const s1 = await zip.file('xl/worksheets/sheet1.xml').async('string');
    const styleOf = (ref) => (s1.match(new RegExp('<c r="' + ref + '" s="(\\d+)"')) || [])[1];
    // 머리글은 5행(제목·여백·요약·여백 다음), 데이터는 6행부터
    assert.strictEqual(styleOf('B6'), styleOf('B7'));
    assert.notStrictEqual(styleOf('B7'), styleOf('B8'));
    assert.strictEqual(styleOf('B8'), styleOf('B9'));
  });

  console.log('[인원명부 일괄 갱신]');
  const RI = require('../prototype/js/rosterimport.js');
  const A = Org.byName('신평119안전센터').id, B = Org.byName('감천119안전센터').id;
  const resolveOrg = (x) => { const n = Org.byName(x); return n && Org.unitLevel(n) === 3 ? n.id : undefined; };
  const ex = [
    { id: 'p1', orgId: A, rank: '소방교', name: '홍길동', birth: '1990-01-01', appointedAt: '2015-03-02', phone: '010-0000-0000', duty: '구급' },
    { id: 'p2', orgId: A, rank: '소방사', name: '이퇴직', birth: '1995-02-02', appointedAt: '2020-03-02', phone: '', duty: '' },
    { id: 'p3', orgId: A, rank: '소방사', name: '박동명', birth: '1996-01-01', appointedAt: '', phone: '', duty: '' },
    { id: 'p4', orgId: A, rank: '소방사', name: '박동명', birth: '1997-01-01', appointedAt: '', phone: '', duty: '' },
  ];
  await t('붙여넣기(탭)/CSV(따옴표) 파싱·날짜·전화 정규화', async () => {
    const tab = RI.parseTable(RI.parseDelimited('소속\t계급\t성명\t생년월일\t연락처\n감천119안전센터\t소방장\t홍길동\t1990.1.1\t1012345678'));
    assert.strictEqual(tab.rows.length, 1);
    assert.strictEqual(tab.rows[0].birth, '1990-01-01');
    assert.strictEqual(tab.rows[0].phone, '010-1234-5678');
    const csv = RI.parseTable(RI.parseDelimited('﻿"소속","계급","성명","담당업무"\r\n"감천119안전센터","소방교","김,가상","구급, 화재"\r\n'));
    assert.strictEqual(csv.rows[0].name, '김,가상');
    assert.strictEqual(csv.rows[0].duty, '구급, 화재');
    assert.ok(RI.parseTable([['a', 'b']]).errors.length, '머리글 없으면 오류');
    assert.strictEqual(RI.normDate('20160302'), '2016-03-02');
  });
  await t('전보·승진·신규 분류, 빈 칸은 기존값 유지', async () => {
    const rows = RI.parseTable(RI.parseDelimited(`소속\t계급\t성명\t생년월일\t연락처\n감천119안전센터\t소방장\t홍길동\t1990-01-01\t\n감천119안전센터\t소방사\t신입\t2000-05-05\t010-1111-2222`)).rows;
    const p = RI.plan(ex, rows, { resolveOrg, canTouch: () => true });
    const kinds = p.items.map((i) => i.kind).sort().join();
    assert.strictEqual(kinds, 'add,transfer');
    const tr = p.items.find((i) => i.kind === 'transfer');
    assert.strictEqual(tr.patch.orgId, B); assert.strictEqual(tr.patch.rank, '소방장');
    assert.ok(!('phone' in tr.patch), '빈 연락처는 기존 값 유지');
    assert.strictEqual(p.count.remove, 0, '제외 옵션 꺼짐');
  });
  await t('파일에 없는 인원 제외(옵션), 동명이인은 생년월일 없으면 신규+경고', async () => {
    const rows = RI.parseTable(RI.parseDelimited('소속\t계급\t성명\t생년월일\n신평119안전센터\t소방교\t홍길동\t1990-01-01\n신평119안전센터\t소방사\t박동명\t')).rows;
    const off = RI.plan(ex, rows, { resolveOrg, canTouch: () => true });
    assert.strictEqual(off.missing.length, 1); assert.strictEqual(off.missing[0].name, '이퇴직');
    assert.ok(off.errors.some((w) => w.includes('동명이인')) && off.count.add === 0, '동명이인은 건너뜀');
    const on = RI.plan(ex, rows, { resolveOrg, canTouch: () => true, removeMissing: true });
    assert.strictEqual(on.count.remove, 1);
  });
  await t('권한 밖 소속·모르는 소속명·파일 내 중복은 건너뜀', async () => {
    const rows = RI.parseTable(RI.parseDelimited('소속\t계급\t성명\t생년월일\n감천119안전센터\t소방사\t가나다\t2000-01-01\n없는센터\t소방사\t라마바\t2000-01-01\n신평119안전센터\t소방사\t사아자\t2000-01-01\n신평119안전센터\t소방사\t사아자\t2000-01-01')).rows;
    const p = RI.plan(ex, rows, { resolveOrg, canTouch: (id) => id === A });
    assert.strictEqual(p.count.add, 1);
    assert.strictEqual(p.errors.length, 3);
  });

  console.log(`\n통과 ${pass}건${process.exitCode ? ' (실패 있음)' : ''}`);
})();
