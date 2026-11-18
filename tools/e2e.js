/* 브라우저 E2E 스모크 테스트 (Edge 사용): node tools/e2e.js */
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { chromium } = require('playwright-core');
const XLSX = require('../prototype/vendor/xlsx.full.min.js');
const JSZip = require('../prototype/vendor/jszip.min.js');

const ROOT = path.join(__dirname, '..');
const S = (f) => path.join(ROOT, 'samples', f);
const PORT = 8099;
const URL = `http://localhost:${PORT}/`;
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓', m); } else { fail++; console.error('  ✗', m); } };

(async () => {
  const srv = spawn('node', ['serve.js'], { cwd: ROOT, env: { ...process.env, PORT } });
  await new Promise((r) => setTimeout(r, 800));
  const browser = await chromium.launch({ executablePath: EDGE, headless: true });
  const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 1400, height: 1000 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  const text = () => page.locator('#view').innerText();
  const asUser = async (id) => { await page.selectOption('#user-sel', id); await page.waitForTimeout(150); };
  const go = async (h) => { await page.evaluate((x) => { location.hash = x; }, h); await page.waitForTimeout(250); };
  const dl = async (fn) => { const [d] = await Promise.all([page.waitForEvent('download'), fn()]); const p = await d.path(); return { name: d.suggestedFilename(), buf: fs.readFileSync(p) }; };

  try {
    console.log('[1] 대시보드/초기 데이터');
    await page.goto(URL);
    await page.evaluate(() => { localStorage.clear(); indexedDB.deleteDatabase('119_col_vault'); });
    await page.reload();
    await page.waitForSelector('.kpis');
    let t = await text();
    ok(t.includes('2026년 하반기 소방장비 보유현황 조사'), '본부 담당자 대시보드에 시드 요청 표시');
    ok(t.includes('보낸 요청'), '보낸/받은 요청 탭');

    console.log('[2] 요청 상세 · 제출 현황 (본부)');
    await go('#/r/r-seed1');
    t = await text();
    ok(t.includes('제출 현황') && t.includes('부산진소방서') && t.includes('검토 대기'), '12개 소방서 현황 표');
    ok((await page.locator('#rows tr').count()) === 12, '대상 12곳 행');
    await page.click('.chip[data-f=rejected]');
    ok((await page.locator('#rows tr').count()) === 1, '반려 필터');
    await page.click('.chip[data-f=all]');

    console.log('[3] 센터 담당자: 개인정보 엑셀 제출 → 분리 저장');
    await asUser('u4');
    await go('#/r/r-seed2');
    ok((await text()).includes('내 제출'), '센터 담당자 제출 영역');
    ok(!(await text()).includes('제출 현황 (요청 대상 전체)'), '센터 담당자는 타 조직 현황 미표시');
    await page.setInputFiles('#dz-x input[type=file]', S('03_제출예시_교육이수자명단(가상개인정보).xlsx'));
    await page.waitForSelector('#xres .alert.ok');
    t = await page.locator('#xres').innerText();
    ok(t.includes('검증 통과') && t.includes('4행'), '엑셀 검증 통과(4행)');
    ok(t.includes('개인정보로 의심되는 값'), '비-개인정보 컬럼(소속)에서 개인정보 탐지');
    ok(!t.includes('김가상') && t.includes('김*상'), '미리보기는 마스킹 표시');
    await page.check('#agree');
    await page.click('#go');
    await page.waitForSelector('.alert.info:has-text("제출 완료")', { timeout: 8000 });
    ok(true, '제출 완료 → 검토 대기');
    const meta = await page.evaluate(() => JSON.stringify(Store.state));
    ok(!meta.includes('김가상') && !meta.includes('010-1234-5678') && !meta.includes('900101-1234567'), '메타 DB(localStorage)에 개인정보 원문 없음');
    ok(meta.includes('TKN-'), '메타 DB에는 토큰만 저장');
    const vc = await page.evaluate(() => Vault.count());
    ok(vc >= 16, `Vault에 개인정보 분리 저장 (${vc}건)`);

    console.log('[4] 요청자: 검토/승인, 취합 마스킹·원본');
    await asUser('u2');
    await go('#/r/r-seed2');
    await page.click('[data-view]');
    await page.waitForSelector('.modal');
    t = await page.locator('.modal').innerText();
    ok(t.includes('김*상') && !t.includes('김가상'), '검토 화면은 마스킹 표시');
    await page.click('.modal .btn:has-text("승인")');
    await page.waitForTimeout(300);
    ok((await text()).includes('승인'), '승인 처리');
    let r = await dl(async () => { await page.click('#b-export'); await page.click('.modal-f .btn.primary'); });
    let wb = XLSX.read(r.buf, { type: 'buffer' });
    let csv = XLSX.utils.sheet_to_csv(wb.Sheets['취합']);
    ok(!csv.includes('제출조직') && csv.includes('김*상') && !csv.includes('김가상') && !csv.includes('010-1234-5678'), `취합 마스킹본 (${r.name})`);
    await page.waitForTimeout(200);
    r = await dl(async () => {
      await page.click('#b-export');
      await page.check('[name=mk][value=orig]');
      await page.click('.modal-f .btn.primary');
      await page.waitForSelector('#pr-t');
      await page.fill('#pr-t', '교육 이수자 현황 보고 작성');
      await page.click('.modal:has(#pr-t) .modal-f .btn.primary');
    });
    wb = XLSX.read(r.buf, { type: 'buffer' });
    csv = XLSX.utils.sheet_to_csv(wb.Sheets['취합']);
    ok(!csv.includes('제출조직') && csv.includes('김가상') && csv.includes('010-1234-5678'), `취합 원본(사유 입력 후, ${r.name})`);

    console.log('[5] 공문서 작성 (ODT/HWPX)');
    await asUser('u1');
    await go('#/r/r-seed1');
    await page.click('#b-doc');
    await page.waitForSelector('#d-body');
    ok((await page.inputValue('#d-body')).includes('제출 현황: 전체 12개 기관'), '본문 자동 작성(제출 현황 반영)');
    r = await dl(() => page.click('.modal-f .btn:has-text("ODT로 작성")'));
    let z = await JSZip.loadAsync(r.buf);
    ok(r.name.endsWith('.odt') && (await z.file('mimetype').async('string')) === 'application/vnd.oasis.opendocument.text', `ODT 생성 (${r.name})`);
    ok((await z.file('content.xml').async('string')).includes('소방장비 보유현황 조사'), 'ODT 본문 포함');
    await page.waitForTimeout(200);
    r = await dl(() => page.click('.modal-f .btn:has-text("HWPX로 작성")'));
    z = await JSZip.loadAsync(r.buf);
    ok(r.name.endsWith('.hwpx') && !!z.file('Contents/section0.xml'), `HWPX 생성 (${r.name})`);
    await page.click('.modal .x');

    console.log('[6] 새 요청: 서식 분석 → 예시 필수 → 대상 체크 → 발송');
    await go('#/new');
    await page.setInputFiles('#dz input[type=file]', S('01_서식예시_장비보유현황(2단머리글).xlsx'));
    await page.waitForSelector('table.colgrid');
    ok((await page.locator('table.colgrid thead th:not(.lab)').count()) === 6, '컬럼 6개 자동 분석');
    ok(await page.locator('#send').isDisabled(), '예시 미입력 시 발송 불가');
    t = await page.locator('#side').innerText();
    ok(t.includes('예시 데이터 미입력 컬럼'), '점검 목록에 예시 미입력 안내');
    const ex0 = page.locator('input[data-f=ex0]');
    for (let i = 0; i < 6; i++) await ex0.nth(i).fill(['소방펌프차', '3,000L급', '3', '범일센터', '2021-03-15', '-'][i]);
    await page.fill('#f-dl', '2030-01-01');
    await page.check('#tree input[data-grp]:near(:text("소방서"))').catch(() => {});
    await page.locator('#t-all').click();
    t = await page.locator('#side').innerText();
    ok(!(await page.locator('#send').isDisabled()), '모든 항목 충족 시 발송 활성화: ' + t.replace(/\n/g, ' | '));
    const lvl2Cnt = await page.evaluate(() => Org.unitsAtLevel(2).length);
    ok((await page.locator('#tcount').innerText()).includes(`${lvl2Cnt}곳`), `소방서·본부부서·소방학교 단위 ${lvl2Cnt}곳 선택`);
    await page.click('#send');
    await page.click('.modal-f .btn.primary');
    await page.waitForSelector('#rows');
    ok((await page.locator('#rows tr').count()) === lvl2Cnt, `발송 후 상세 화면 ${lvl2Cnt}곳 현황`);

    console.log('[7] 소방서 담당자 권한 · 하위 재요청');
    await asUser('u3');
    await go('#/r/r-seed1');
    t = await text();
    ok(t.includes('내 제출'), '소방서 담당자는 본인 소방서 제출 영역');
    ok((await page.locator('#rows tr').count()) === 1, '관할 조직(부산진소방서)만 조회');
    await page.click('a:has-text("하위 재요청")');
    await page.waitForSelector('table.colgrid');
    ok((await page.inputValue('#f-title')).startsWith('[재요청]'), '재요청 제목/서식 상속');
    ok(!(await page.locator('input[name=mode]').count()), '소방서 담당자는 관할 센터만 선택');
    await page.locator('#t-all').click();
    const cnt = await page.evaluate(() => Org.subtree(Org.byName('부산진소방서').id).filter(id => Org.byId[id].type === 'center').length);
    ok((await page.locator('#tcount').innerText()).includes(`${cnt}곳`), `관할 센터 ${cnt}곳`);
    await page.click('#send');
    await page.click('.modal-f .btn.primary');
    await page.waitForSelector('#rows');
    ok((await page.locator('#rows tr:not(.sub-h)').count()) === cnt, '재요청 발송');
    await asUser('u5');
    await go('#/new');
    await page.waitForSelector('#tree');
    const cnt5 = await page.evaluate(() => Org.subtree(Org.byName('부산해운대소방서').id).filter(id => Org.byId[id].type === 'center').length);
    ok((await page.locator('#tree label.it').count()) === cnt5, '타 소방서 담당자도 자기 관할만 노출');

    console.log('[8] 개인 일회용 링크 제출');
    await asUser('u1');
    const token = await page.evaluate(() => {
      const req = Store.createRequest({ title: '개인 의견 제출', desc: '테스트', deadline: Date.now() + 86400000 * 3, retentionDays: 30, kinds: { text: true, file: false, excel: false }, columns: [], templateName: '', targetMode: 'level2', targets: [{ kind: 'person', id: 'pp-test', name: '김시민', contact: '메신저ID' }], channels: { app: true, discord: true, telegram: false, sms: false }, parentId: null });
      return req.targets[0].token;
    });
    await go('#/p/' + token);
    await page.fill('#tx', '전화번호는 010-9999-8888 입니다.');
    ok((await page.locator('#txres').innerText()).includes('휴대전화번호'), '텍스트 개인정보 자동 탐지');
    ok(await page.locator('#txp').isDisabled(), '탐지 시 개인정보 표시 강제');
    await page.check('#agree');
    await page.click('#go');
    await page.waitForSelector('.alert.ok:has-text("1회용")');
    ok(true, '제출 후 링크 사용 불가 안내');
    ok(!(await page.evaluate(() => JSON.stringify(Store.state))).includes('010-9999-8888'), '텍스트 원문은 메타에 없음(마스킹 저장)');

    console.log('[9] 보안담당자: 감사 로그 / 보안 구조');
    await asUser('u6');
    await go('#/audit');
    t = await text();
    ok(t.includes('개인정보 원문') || t.includes('취합(원본)'), '감사 로그에 원본 열람/취합 기록');
    ok(t.includes('외부 제출자'), '개인 제출 이력');
    await go('#/r/r-seed2');
    ok(!(await page.locator('[data-view]').count()), '보안담당자는 제출 내용 열람 버튼 없음');
    await go('#/security');
    await page.waitForSelector('.flow');
    ok((await text()).includes('토큰'), '보안 구조 화면(토큰/암호문 비교)');

    console.log('[10] 파기');
    await asUser('u2');
    await go('#/r/r-seed2');
    const vBefore = await page.evaluate(async () => ({ all: await Vault.count(), r2: (await Vault.all()).filter((x) => x.meta && x.meta.req === 'r-seed2').length }));
    await page.click('#b-purge');
    await page.click('.modal-f .btn.primary');
    await page.waitForTimeout(600);
    const vAfter = await page.evaluate(async () => ({ all: await Vault.count(), r2: (await Vault.all()).filter((x) => x.meta && x.meta.req === 'r-seed2').length }));
    ok(vBefore.r2 > 0 && vAfter.r2 === 0, `파기 후 Vault에서 해당 요청 개인정보 삭제 (${vBefore.r2}건 → ${vAfter.r2}건)`);
    ok(vAfter.all === vBefore.all - vBefore.r2 && vAfter.all > 0, '다른 요청·인원명부의 Vault 항목은 유지');

    console.log('[11] 소방 모바일 어플 뷰 시뮬레이터 (교대근무자)');
    await asUser('u4');
    await go('#/mobile');
    await page.waitForSelector('.phone-device');
    t = await text();
    ok(t.includes('소방 모바일 어플') && t.includes('부산소방 포털 어플'), '스마트폰 외형 및 상단바 렌더링');
    ok(t.includes('최범일') && t.includes('범일119안전센터'), '모바일 프로필 표시');
    const cards = await page.locator('.phone-screen .m-card').count();
    ok(cards >= 1, `모바일 제출 대기 카드 ${cards}건 표시`);

    console.log('[12] 사하소방서 → 감천·신평119안전센터: 프리셋 토글 · 유형행 제거 · 드래그 순서변경 · 표 테두리 서식');
    await asUser('u7');
    await go('#/new');
    await page.waitForSelector('#preset-std');
    // 1) 표준 4종 토글: 누르면 4개 추가, 다시 누르면 0개로 삭제, 다시 누르면 4개 추가
    await page.click('#preset-std');
    await page.waitForTimeout(150);
    ok((await page.locator('table.colgrid thead th:not(.lab)').count()) === 4, '표준 4종(기관/소속/계급/성명) 클릭 시 4개 추가');
    await page.click('#preset-std');
    await page.waitForTimeout(150);
    ok((await page.locator('table.colgrid').count()) === 0, '표준 4종 다시 클릭 시 전체 해제(토글 삭제)');
    await page.click('#preset-std');
    await page.waitForTimeout(150);
    // 개별 프리셋 토글 확인
    await page.click('[data-preset="담당업무"]');
    await page.waitForTimeout(100);
    ok((await page.locator('table.colgrid thead th:not(.lab)').count()) === 5, '개별 프리셋(담당업무) 클릭 시 추가 (5개)');
    // 유형 탭(행)이 제거되었는지 확인
    const gridLabText = await page.locator('table.colgrid').innerText();
    ok(!gridLabText.includes('유형'), '컬럼 설정 표에서 유형 행 제거됨');

    await page.fill('#f-title', '불꽃축제 안전관리 동원 명단 제출');
    await page.click('#t-all');
    await page.waitForTimeout(200);
    await page.click('#send');
    await page.click('.modal-f .btn.primary');
    await page.waitForSelector('#rows', { timeout: 6000 });
    ok((await text()).includes('불꽃축제 안전관리'), '사하소방서 요청 발송 완료 (관할 센터 대상)');

    console.log('[13] 조직도 개편 확인 · 인사이동 반영 및 신평·감천119안전센터 인원명부 자동 기재 (ON/OFF 토글)');
    await go('#/org');
    await page.waitForSelector('#roster-tbl');
    const orgTreeCheck = await page.evaluate(() => {
      const hqNames = Org.root.children[0].children.map((d) => d.name);
      const school = Org.root.children[1].children[0];
      const sahaChildren = Org.byName('부산사하소방서').children.map((c) => c.name);
      return {
        hqOrderOk: hqNames.slice(5).join(',') === '소방감사담당관,회계장비담당관,인사담당관,119특수대응단,119안전체험관',
        schoolOk: school.name === '소방학교' && school.children.map((c) => c.name).join(',') === '교육지원과,인재양성과,교육훈련과',
        stationDeptsOk: sahaChildren.slice(0, 5).join(',') === '청문감사담당관,소방행정과,예방안전과,구조구급과,현장대응단' && sahaChildren.includes('신평119안전센터') && sahaChildren.includes('사하119구조대'),
      };
    });
    ok(orgTreeCheck.hqOrderOk, '소방재난본부: 소방감사담당관 → 회계장비담당관 → 인사담당관 → 119특수대응단 → 119안전체험관 순서 반영');
    ok(orgTreeCheck.schoolOk, '소방학교: 교육지원과 · 인재양성과 · 교육훈련과 반영');
    ok(orgTreeCheck.stationDeptsOk, '12개 소방서 산하: 청문감사담당관·소방행정과·예방안전과·구조구급과·현장대응단 + 각 센터 및 구조대 반영');

    const sinId = await page.evaluate(() => Org.byName('신평119안전센터').id);
    const gamId = await page.evaluate(() => Org.byName('감천119안전센터').id);
    await page.click(`.presets-b [data-pick-org="${gamId}"]`);
    await page.waitForTimeout(150);
    // 감천 첫 번째 인원(오감천)을 신평119안전센터로 인사이동(전보)
    const firstSelect = page.locator('#roster-tbl select[data-r-org]').first();
    await firstSelect.selectOption(sinId);
    await page.waitForTimeout(150);
    // 신평119안전센터 선택 후 신규 인원 추가
    await page.click(`.presets-b [data-pick-org="${sinId}"]`);
    await page.waitForTimeout(150);
    await page.fill('#r-add-name', '정신평');
    await page.fill('#r-add-duty', '화재진압');
    await page.click('#r-add-btn');
    await page.waitForTimeout(150);
    const sinRosterNames = await page.evaluate((id) => Store.rosterOf(id).map((p) => p.name), sinId);
    ok(sinRosterNames.includes('정신평') && sinRosterNames.includes('오감천'), '인사이동(감천 오감천 → 신평 전보) 및 신규 인원(정신평) 명부 반영 확인');

    // 신평119안전센터 담당자(u9)로 로그인하여 서식 다운로드 (인원명부 자동 기재 ON)
    await asUser('u9');
    await go('#/');
    await page.waitForSelector('text=불꽃축제 안전관리');
    await page.click('text=불꽃축제 안전관리');
    await page.waitForSelector('[data-a=tpl]');
    t = await text();
    ok(t.includes('신평119안전센터 맞춤 서식'), '신평119안전센터 맞춤 서식 안내 표시');
    const dlSinOn = await dl(() => page.click('[data-a=tpl]'));
    ok(dlSinOn.name.includes('(신평)') && dlSinOn.name.endsWith('.xlsx'), `(신평) 접두 파일명 다운로드 (${dlSinOn.name})`);
    const wbSinOn = XLSX.read(dlSinOn.buf, { type: 'buffer' });
    const aoaOn = XLSX.utils.sheet_to_json(wbSinOn.Sheets['제출서식'], { header: 1 });
    ok(aoaOn[0][0].includes('사하소방서'), '다운로드 엑셀 상단 표지 배너에 사하소방서 타이틀');
    const inRowsOn = aoaOn.slice(10);
    ok(
      inRowsOn[0][0] === '부산소방재난본부 사하소방서' &&
      inRowsOn[0][1] === '신평119안전센터' &&
      inRowsOn.some((r) => r[3] === '정신평') &&
      inRowsOn.some((r) => r[3] === '오감천'),
      '인원명부 ON: 기관·소속·계급·성명(전보 인원 오감천 및 추가 인원 정신평 포함) 모두 자동 기재됨'
    );

    // 인원명부 자동 기재 체크박스 OFF 후 다운로드 → 기관·소속만 기재되고 계급·성명은 빈칸인지 검증
    await page.uncheck('#tpl-roster-tog');
    await page.waitForTimeout(150);
    const dlSinOff = await dl(() => page.click('[data-a=tpl]'));
    const wbSinOff = XLSX.read(dlSinOff.buf, { type: 'buffer' });
    const aoaOff = XLSX.utils.sheet_to_json(wbSinOff.Sheets['제출서식'], { header: 1 });
    ok(
      aoaOff[10][0] === '부산소방재난본부 사하소방서' &&
      aoaOff[10][1] === '신평119안전센터' &&
      (aoaOff[10][2] || '') === '' &&
      (aoaOff[10][3] || '') === '',
      '인원명부 OFF: 기관·소속만 자동 기재되고 계급·성명은 빈칸으로 제공됨'
    );

    console.log('[14] 체크박스 선택 다운로드 · 원본 열람 사유 · 개인정보 Vault 분리 · 소유자 규칙 · 연락처 형식');
    const closeModals = async () => { for (let i = 0; i < 3; i++) { if (await page.locator('.modal .x').count()) await page.locator('.modal .x').last().click(); } };
    const stateJson = await page.evaluate(() => JSON.stringify(Store.state));
    ok(!stateJson.includes('010-3382-1002') && !stateJson.includes('1985-11-03') && !stateJson.includes('010-6111-2222'), '인원명부·시드 제출 개인정보가 localStorage 메타에 평문으로 없음');
    ok(await page.evaluate(() => Store.state.roster.every((p) => (!p.phone || Vault.isToken(p.phone)) && (!p.birth || Vault.isToken(p.birth)))), '인원명부 생년월일·연락처는 Vault 토큰으로만 보관');
    const tplBytes = await page.evaluate(async () => {
      const req = Store.request('r-seed9');
      const t = req.targets.find((x) => Org.name(x.id) === '신평119안전센터');
      return Array.from(await Excel.templateBytes(req, t, { prefillRoster: true }));
    });
    const tplCsv = XLSX.utils.sheet_to_csv(XLSX.read(Buffer.from(tplBytes), { type: 'buffer' }).Sheets['제출서식']);
    ok(tplCsv.includes('010-2145-1000') && tplCsv.includes('1973-05-14') && !tplCsv.includes('TKN-'), '서식 생성 시에만 Vault에서 복호화하여 사전 기재');

    await asUser('u2');
    await go('#/r/r-seed1');
    ok((await text()).includes('접근 권한 제한'), '다른 부서 본부 담당자는 타 부서 요청의 소유자가 아님');

    await asUser('u1');
    await go('#/r/r-seed1');
    await page.click('#b-dl-all-center-tpl');
    await page.waitForSelector('#pk-all');
    const pkN = await page.locator('[data-pk]').count();
    ok(pkN === 12 && (await page.locator('[data-pk]:checked').count()) === 12, `서식 선택 다운로드: 전체 선택 상태로 ${pkN}곳 표시`);
    await page.uncheck('#pk-all');
    ok((await page.locator('[data-pk]:checked').count()) === 0, '전체 선택 해제');
    await page.check('[data-pk="0"]'); await page.check('[data-pk="1"]');
    ok((await page.locator('#pk-n').innerText()).includes('2/12'), '체크박스 개별 선택 개수 표시');
    const got = [];
    const onDl = (d) => got.push(d.suggestedFilename());
    page.on('download', onDl);
    await page.click('.modal-f .btn.primary');
    for (let i = 0; i < 30 && got.length < 2; i++) await page.waitForTimeout(200);
    page.off('download', onDl);
    ok(got.length === 2 && got.every((n) => n.endsWith('_서식.xlsx')) && new Set(got).size === 2, '선택한 2곳만 개별 xlsx로 다운로드 (' + got.join(', ') + ')');
    await closeModals();

    await go('#/r/r-seed4');
    await page.click('#b-export-orig');
    await page.waitForSelector('#pr-t');
    await page.click('.modal:has(#pr-t) .modal-f .btn:has-text("취소")');
    await page.waitForTimeout(200);
    ok((await page.locator('.modal').count()) === 0, '원본 바로 취합: 사유 입력 창이 뜨고 취소하면 다운로드하지 않음');
    let r2 = await dl(async () => {
      await page.click('#b-export-orig');
      await page.waitForSelector('#pr-t');
      await page.fill('#pr-t', '불꽃축제 근무자 명단 보고');
      await page.click('.modal:has(#pr-t) .modal-f .btn.primary');
    });
    const csv2 = XLSX.utils.sheet_to_csv(XLSX.read(r2.buf, { type: 'buffer' }).Sheets['취합']);
    ok(/010-\d{4}-\d{4}/.test(csv2) && !csv2.includes('TKN-'), '사유 입력 후 원본 취합');
    ok((await page.evaluate(() => Store.state.audit[0].detail)).includes('사유: 불꽃축제 근무자 명단 보고'), '감사 로그에 입력한 사유 기록');

    await page.click('#b-export');
    await page.waitForSelector('.modal .tbl-wrap table.small');
    const prev = await page.locator('.modal .tbl-wrap').first().innerText();
    ok(!/010-\d{4}-\d{4}/.test(prev), '취합 미리보기는 개인정보 마스킹');
    await closeModals();

    await page.click('#b-export-xlsx-multi');
    await page.waitForSelector('#pk-all');
    await page.uncheck('#pk-all'); await page.check('[data-pk="0"]');
    r2 = await dl(async () => {
      await page.click('.modal-f .btn.primary');
      await page.waitForSelector('#pr-t');
      await page.fill('#pr-t', '선택 다운로드 검증');
      await page.click('.modal:has(#pr-t) .modal-f .btn.primary');
    });
    const csv3 = XLSX.utils.sheet_to_csv(XLSX.read(r2.buf, { type: 'buffer' }).Sheets['제출자료']);
    ok(r2.name.endsWith('_제출자료.xlsx') && /010-\d{4}-\d{4}/.test(csv3), '제출 엑셀 선택 다운로드: 개인정보 포함 시 사유 입력 후 원본 제공 (' + r2.name + ')');
    await closeModals();

    await page.click('#b-doc');
    await page.waitForSelector('#d-body');
    ok((await page.inputValue('#d-tel')) === '051-000-0000' && (await page.inputValue('#d-mail')) === '아이디@korea.kr', '공문 연락처 기본값은 형식만 표시');
    const odt = await dl(() => page.click('.modal-f .btn:has-text("ODT로 작성")'));
    const odtXml = await (await JSZip.loadAsync(odt.buf)).file('content.xml').async('string');
    ok(!odtXml.includes('honeyjeong') && !odtXml.includes('760-65') && odtXml.includes('아이디@korea.kr'), '생성된 공문에 실제 메일·전화 없음');
    await closeModals();

    console.log('[15] 보관기간 자동 파기 · 파기 임박 알림 · 업로드 명단 열 정렬');
    await asUser('u1');
    const pu = await page.evaluate(async () => {
      const DAY = 86400000;
      const r3 = Store.request('r-seed3'), r1 = Store.request('r-seed1');
      const before = (await Vault.all()).length;
      r3.deadline = Date.now() - (r3.retentionDays + 5) * DAY;      // 보관기간 경과
      r1.deadline = Date.now() - (r1.retentionDays - 3) * DAY;      // 3일 뒤 파기 예정
      const n = await Store.autoPurge();
      return { n, purged: r3.purged, r1purged: r1.purged, act: Store.state.audit[0].action, who: Store.state.audit[0].userName, notif: Store.state.notifications[0].title, before, after: (await Vault.all()).length };
    });
    ok(pu.n >= 1 && pu.purged && !pu.r1purged, `보관기간이 지난 요청만 자동 파기 (${pu.n}건)`);
    ok(pu.act === 'purge.auto' && pu.who.includes('시스템') && pu.notif.includes('[자동 파기]'), '자동 파기 감사 로그(시스템)·요청 조직 알림');
    await go('#/');
    ok((await text()).includes('보관기간 만료 임박'), '대시보드에 파기 임박 안내');
    const al = await page.evaluate(() => Wizard.alignPrefill({ prefillRows: [['1', '가', '나', '다']] }, [{ src: 2 }, { src: 0 }, {}, { src: 3 }]));
    ok(JSON.stringify(al) === JSON.stringify([['나', '1', '', '다']]), '업로드 명단은 컬럼 삭제·순서변경·추가 후에도 열 이름 기준으로 정렬');

    console.log('[16] 인원명부 일괄 갱신 (인사이동 엑셀·CSV 붙여넣기)');
    await asUser('u1');
    await go('#/org');
    await page.waitForSelector('#btn-roster-import');
    const rcnt = () => page.evaluate(() => ({ s: Store.rosterOf(Org.byName('신평119안전센터').id).length, g: Store.rosterOf(Org.byName('감천119안전센터').id).length, all: Store.state.roster.length }));
    const c0 = await rcnt();
    const who = await page.evaluate(() => { const p = Store.rosterOf(Org.byName('신평119안전센터').id)[0]; return Vault.getText(p.birth).then((b) => ({ n: p.name, b, rank: p.rank })); });
    await page.click('#btn-roster-import');
    await page.waitForSelector('#ri-text');
    // 1) 신평 첫 사람을 감천으로 전보+승진(생년월일로 동일인 매칭), 신입 1명 추가, 모르는 소속 1행
    const csv16 = `소속,계급,성명,생년월일,연락처\n감천119안전센터,소방위,${who.n},${who.b},\n감천119안전센터,소방사,신입가상,2001-02-03,01099998888\n없는센터,소방사,유령,2000-01-01,`;
    await page.fill("#ri-text", csv16);
    await page.click('#ri-run');
    await page.waitForSelector('#ri-out .alert');
    const ot = await page.locator('#ri-out').innerText();
    ok(/신규 1 · 전보 1 · 수정 0 · 제외 0/.test(ot) && ot.includes('없는센터'), '분석 결과: 신규1·전보1, 모르는 소속은 건너뜀 표시');
    const unchanged = await rcnt();
    ok(JSON.stringify(unchanged) === JSON.stringify(c0), '분석만으로는 명부가 바뀌지 않음(미리보기)');
    await page.click('.modal-f .btn.primary');
    await page.click('.modal-f .btn.primary:has-text("반영")');
    await page.waitForTimeout(500);
    const c1 = await rcnt();
    ok(c1.s === c0.s - 1 && c1.g === c0.g + 2 && c1.all === c0.all + 1, `반영 후 신평 -1, 감천 +2 (신평 ${c0.s}→${c1.s}, 감천 ${c0.g}→${c1.g})`);
    const after = await page.evaluate(async (nm) => {
      const p = Store.state.roster.find((x) => x.name === nm), n = Store.state.roster.find((x) => x.name === '신입가상');
      return { org: Org.name(p.orgId), rank: p.rank, tokenB: Vault.isToken(p.birth), newPhoneTok: Vault.isToken(n.phone), newPhone: await Vault.getText(n.phone), act: Store.state.audit.slice(0, 4).map((a) => a.action) };
    }, who.n);
    ok(after.org === '감천119안전센터' && after.rank === '소방위', '전보·승진이 한 번에 반영');
    ok(after.tokenB && after.newPhoneTok && after.newPhone === '010-9999-8888', '생년월일·연락처는 Vault 토큰으로 저장, 전화번호 형식 자동 정리');
    ok(after.act.includes('roster.import') && after.act.includes('roster.transfer'), '감사 로그에 일괄 갱신·전보 기록');
    // 2) 제외 옵션: 감천 센터만 포함한 파일에서 신입만 남기고 나머지 제외
    await page.click('#btn-roster-import');
    await page.fill('#ri-text', `소속\t계급\t성명\t생년월일\n감천119안전센터\t소방사\t신입가상\t2001-02-03`);
    await page.check('#ri-remove');
    await page.click('#ri-run');
    await page.waitForSelector('#ri-out .alert');
    const ot2 = await page.locator('#ri-out').innerText();
    ok(/제외 \d+/.test(ot2) && !/제외 0/.test(ot2), '"파일에 없는 인원 제외" 옵션 시 제외 건수 표시');
    await closeModals();
    // 3) 센터 담당자는 타 센터 행을 반영할 수 없음
    await asUser('u4');
    await go('#/org');
    await page.waitForSelector('#btn-roster-import');
    await page.click('#btn-roster-import');
    await page.fill('#ri-text', `소속\t계급\t성명\t생년월일\n감천119안전센터\t소방사\t침범시도\t2002-02-02`);
    await page.click('#ri-run');
    await page.waitForSelector('#ri-out .alert');
    ok((await page.locator('#ri-out').innerText()).includes('권한 범위 밖'), '센터 담당자는 본인 소속 외 행이 권한 범위 밖으로 거부됨');
    await closeModals();
    // 4) 내려받기 → 같은 파일을 다시 올리면 변동 없음
    await asUser('u1');
    await go('#/org');
    await page.waitForSelector('#btn-roster-export');
    const exl = await dl(() => page.click("#btn-roster-export"));
    const wbx = XLSX.read(exl.buf, { type: 'buffer' });
    const aoax = XLSX.utils.sheet_to_json(wbx.Sheets['인원명부'], { header: 1, raw: false, defval: '' });
    ok(aoax[0].join() === '소속,계급,성명,생년월일,임용일자,연락처,담당업무' && aoax.length - 1 === c1.all, `현재 명부 내려받기 (${aoax.length - 1}명)`);
    await page.click('#btn-roster-import');
    await page.fill('#ri-text', aoax.map((r) => r.join('\t')).join('\n'));
    await page.click('#ri-run');
    await page.waitForSelector('#ri-out .alert');
    const ot3 = await page.locator('#ri-out').innerText();
    ok(/신규 0 · 전보 0 · 수정 0 · 제외 0/.test(ot3), '내려받은 명부를 그대로 다시 올리면 변경 없음(왕복 일치)');
    await closeModals();
  } catch (e) {
    fail++; console.error('  ✗ 테스트 중단:', e.message.split('\n')[0]);
    fs.mkdirSync(path.join(__dirname, 'out'), { recursive: true });
    await page.screenshot({ path: path.join(__dirname, 'out', 'fail.png') }).catch(() => {});
  }
  const real = errors.filter((e) => !/favicon/.test(e) && !/Failed to load resource.*404/.test(e));
  ok(real.length === 0, '브라우저 콘솔/페이지 오류 없음' + (real.length ? ': ' + real.slice(0, 3).join(' | ') : ''));
  console.log(`\n통과 ${pass} / 실패 ${fail}`);
  await browser.close(); srv.kill();
  process.exit(fail ? 1 : 0);
})();
