/* 새 자료 요청 만들기: 서식 업로드·분석 → 컬럼/예시(필수) → 기본정보 → 요청 대상 체크 → 알림 채널 → 발송 */
(function (g) {
  const DAY = 86400000;
  let W = null;

  const TYPES = { text: '텍스트', number: '숫자', date: '날짜' };

  function init(fromId) {
    const user = Store.user();
    W = {
      title: '', desc: '', deadline: U.toInputDate(Date.now() + 7 * DAY), retention: 90,
      kinds: { text: false, file: false, excel: true },
      columns: [], templateName: '', wb: null, analysis: null,
      mode: user.role === 'station' ? 'level3' : 'level2', targets: new Set(), persons: [],
      channels: { app: true, sms: false }, parentId: null, open: new Set(['g']), fromTitle: '',
      prefillRoster: Store.prefillRosterEnabled(),
    };
    if (fromId) {
      const p = Store.request(fromId);
      if (p) {
        W.parentId = p.id; W.fromTitle = p.title;
        W.title = `[재요청] ${p.title}`; W.desc = p.desc;
        W.kinds = { ...p.kinds };
        W.columns = p.columns.map((c) => ({ ...c, examples: c.examples.slice() }));
        W.retention = p.retentionDays; W.mode = 'level3';
        if (typeof p.prefillRoster === 'boolean') W.prefillRoster = p.prefillRoster;
        const d = Math.max(Date.now() + DAY, p.deadline - DAY);
        W.deadline = U.toInputDate(d);
      }
    }
  }

  const blankCol = () => ({ name: '', type: 'text', required: false, pii: false, examples: ['', ''] });

  const PRESETS = {
    '기관': { name: '기관', type: 'text', required: true, pii: false, examples: ['부산소방재난본부 사하소방서', '부산소방재난본부 사하소방서'] },
    '소속': { name: '소속', type: 'text', required: true, pii: false, examples: ['신평119안전센터', '감천119안전센터'] },
    '계급': { name: '계급', type: 'text', required: true, pii: false, examples: ['소방교', '소방장'] },
    '성명': { name: '성명', type: 'text', required: true, pii: true, examples: ['홍길동', '김소방'] },
    '생년월일': { name: '생년월일', type: 'date', required: false, pii: true, examples: ['1992-04-15', '1988-11-20'] },
    '임용일자': { name: '임용일자', type: 'date', required: false, pii: false, examples: ['2014-03-10', '2018-07-01'] },
    '연락처': { name: '연락처', type: 'text', required: false, pii: true, examples: ['010-1234-5678', '010-9876-5432'] },
    '담당업무': { name: '담당업무', type: 'text', required: false, pii: false, examples: ['구급대원', '화재진압'] },
    '교육희망기수': { name: '교육희망기수', type: 'text', required: true, pii: false, examples: ['1기(12.01.)', '2기(12.08.)'] },
    '교육이수일자': { name: '교육이수일자', type: 'date', required: true, pii: false, examples: ['2026-10-15', '2026-10-16'] },
    '참석여부': { name: '참석여부', type: 'text', required: true, pii: false, examples: ['참석', '불참'] },
    '배치지역': { name: '배치지역', type: 'text', required: true, pii: false, examples: ['광안대교 하판', '삼익비치 방파제'] },
    '비고': { name: '비고', type: 'text', required: false, pii: false, examples: ['-', '-'] },
  };
  const STD4 = ['기관', '소속', '계급', '성명'];
  const isMetaName = (n) => /^(기관|소속|기관명|소속부서|소속센터|계급|직급|성명|이름|생년월일|임용일자|최초임용일|연락처|휴대전화|전화번호|담당업무)$/.test(String(n).trim());
  const presetCol = (k) => ({ ...PRESETS[k], examples: PRESETS[k].examples.slice() });

  function missingEx() { return W.columns.filter((c) => !String(c.examples[0] || '').trim()).length; }
  function colNameIssue() {
    const names = W.columns.map((c) => c.name.trim());
    return names.some((n) => !n) || new Set(names).size !== names.length;
  }
  function targetCount() { return W.targets.size + W.persons.length; }

  function checks() {
    const k = W.kinds;
    const excelOk = !k.excel || (W.columns.length > 0 && missingEx() === 0 && !colNameIssue());
    const dl = W.deadline && U.fromInputDate(W.deadline) >= Date.now();
    const list = [
      { ok: k.text || k.file || k.excel, t: '제출 방식 선택' },
      { ok: excelOk, t: k.excel ? (W.columns.length === 0 ? '엑셀 컬럼 정의 필요' : colNameIssue() ? '컬럼명 비어 있음/중복' : missingEx() ? `예시 데이터 미입력 컬럼 ${missingEx()}개` : '컬럼·예시 데이터 입력') : '엑셀 서식 없음(해당 없음)' },
      { ok: !!W.title.trim(), t: '건명(제목) 입력' },
      { ok: !!dl, t: '마감일 (오늘 이후)' },
      { ok: targetCount() > 0, t: `요청 대상 선택 (${targetCount()}곳)` },
    ];
    if (W.persons.length) list.push({ ok: W.channels.app || W.channels.sms, t: '개인 대상 알림 채널 선택' });
    return list;
  }

  // ---------- 섹션 렌더 ----------
  function sec1() {
    const a = W.analysis;
    let h = `<h2><span class="num">1</span> 자료 제출 서식 업로드</h2>
      <div class="drop" id="dz">자료제출 서식 <b>엑셀 파일을 여기로 드래그</b>하거나 클릭하여 선택<br><span class="small">컬럼(머리글)을 자동 분석하여 필요한 자료 항목을 파악합니다 (xlsx, xls, csv)</span></div>
      <div class="alert info small" style="margin-top:8px">
        <b>💡 왜 서식의 머리글(컬럼) 행을 인식하나요?</b><br>
        담당자가 배포한 엑셀 서식에 각 센터가 내용을 적어 제출하면, 나중에 <b>12개 소방서·60여 개 센터 파일을 1개 엑셀로 합칠(취합) 때</b> 각 파일 상단의 문서 제목·표 머리글이 60번 중복해서 들어가지 않고 <b>실제 작성된 데이터 행만 깔끔하게 이어 붙이기 위해서</b>입니다. (성명·연락처 등 개인정보 열 자동 마스킹에도 사용됩니다.)
      </div>
      <label class="small" style="display:inline-flex;gap:6px;margin-top:8px"><input type="checkbox" id="k-noexcel" ${W.kinds.excel ? '' : 'checked'}> 엑셀 서식 없이 텍스트/파일만 요청</label>`;
    if (a) {
      h += `<div class="alert ok" style="margin-top:10px"><b>${U.esc(W.templateName)}</b> 분석 완료 — 컬럼 ${a.columns.length}개, 기존 데이터 행 ${a.dataRowCount}개${a.title ? `, 문서 제목 "${U.esc(a.title)}"` : ''}
        <div class="small" style="margin-top:6px;display:flex;gap:12px;flex-wrap:wrap;align-items:center">
        ${a.sheetNames.length > 1 ? `시트 <select id="an-sheet">${a.sheetNames.map((s) => `<option ${s === a.sheetName ? 'selected' : ''}>${U.esc(s)}</option>`).join('')}</select>` : ''}
        컬럼명 행 <input type="number" id="an-hr" min="1" max="30" value="${a.headerRow + 1}" style="width:64px">행
        <button class="btn sm" id="an-re">다시 분석</button>
        <span class="mut">컬럼명 행이 잘못 인식되면 번호를 바꿔 다시 분석하세요.</span></div></div>`;
    }
    return h;
  }

  function sec2() {
    if (!W.kinds.excel) return `<h2><span class="num">2</span> 항목(컬럼) · 예시 데이터</h2><p class="mut">엑셀 서식 없이 텍스트/파일만 요청합니다. (제출 방식은 3번에서 선택)</p>`;
    const cols = W.columns;
    const has = (k) => cols.some((c) => c.name.trim() === k);
    const stdOn = STD4.every(has);
    const chip = (k, label) => `<button type="button" class="tog ${has(k) ? 'on' : ''}" data-preset="${k}" aria-pressed="${has(k)}">${label || k}</button>`;
    const head = cols.map((c, i) => `<th class="col-h" draggable="true" data-drag="${i}" title="마우스로 끌어다 놓아 컬럼 순서 변경">
        <span class="grip" aria-hidden="true">⋮⋮</span><span class="col-no">${i + 1}. ${U.esc(c.name || '새 항목')}</span>${isMetaName(c.name) ? '<span class="lbl">자동기재</span>' : '<span class="lbl" style="background:#fef3c7;color:#92400e">센터빈칸</span>'}
        <button type="button" class="x-btn" data-del="${i}" title="컬럼 삭제" aria-label="컬럼 삭제">✕</button></th>`).join('');
    const row = (label, fn, cls) => `<tr class="${cls || ''}"><td class="lab">${label}</td>${cols.map((c, i) => `<td data-col="${i}">${fn(c, i)}</td>`).join('')}</tr>`;
    return `<h2><span class="num">2</span> 항목(컬럼) · 예시 데이터</h2>
      <p class="hint" style="margin:-4px 0 12px"><b>① 기존 보유 인사항목</b>(기관·소속·계급·성명·생년월일·임용일자·연락처 등)은 각 센터 서식에 <b>자기 센터 인원만 미리 채워져서 배포</b>되고, <b>② 추가 조사 항목</b>은 <b>빈칸으로 배포</b>되어 센터 작성자가 빈칸만 채워 올리게 됩니다.</p>
      <div class="presets">
        <div class="presets-h"><span>① 기존 보유 인사항목 (센터별 자동 사전기재 · 타 센터 인원 완벽 분리)</span><span class="hint" style="margin:0">누르면 추가, 다시 누르면 삭제</span></div>
        <div class="presets-b">
          <button type="button" class="tog strong ${stdOn ? 'on' : ''}" id="preset-std" aria-pressed="${stdOn}">표준 4종 (기관·소속·계급·성명)</button>
          <span class="vsep"></span>
          ${chip('기관')}${chip('소속')}${chip('계급')}${chip('성명')}${chip('생년월일')}${chip('임용일자')}${chip('연락처')}${chip('담당업무')}
        </div>
        <div class="presets-h" style="border-top:1px solid var(--line);margin-top:4px;padding-top:8px"><span>② 센터에서 작성할 추가 빈칸 항목</span><span class="hint" style="margin:0">센터에 빈칸으로 배부되어 작성자가 입력할 항목</span></div>
        <div class="presets-b">
          ${chip('교육희망기수')}${chip('교육이수일자')}${chip('참석여부')}${chip('배치지역')}${chip('비고')}
        </div>
        <div class="presets-f">
          <label class="ck"><input type="checkbox" id="prefill-roster" ${W.prefillRoster ? 'checked' : ''}> <span><b>센터별 분리 사전 기재(필수 보안)</b> — 각 센터 담당자는 <b>자기 센터 인원만 적힌 서식 파일</b>만 내려받을 수 있으며, 타 센터 인원의 전화번호·임용일자 등은 절대 섞이지 않습니다.</span></label>
          <a href="#/org" class="small">센터별 인원명부·인사이동 관리 →</a>
        </div>
      </div>
      ${cols.length ? `<div class="grid-wrap"><table class="colgrid" id="colgrid"><thead><tr><th class="lab"></th>${head}</tr></thead><tbody>
        ${row('컬럼명', (c, i) => `<input type="text" data-c="${i}" data-f="name" value="${U.esc(c.name)}" placeholder="컬럼명">`)}
        ${row('필수 입력', (c, i) => `<label class="ck"><input type="checkbox" data-c="${i}" data-f="required" ${c.required ? 'checked' : ''}> 필수</label>`)}
        ${row('개인정보', (c, i) => `<label class="ck"><input type="checkbox" data-c="${i}" data-f="pii" ${c.pii ? 'checked' : ''}> 개인정보</label>`)}
        ${row('예시 1 *', (c, i) => `<input type="text" data-c="${i}" data-f="ex0" value="${U.esc(c.examples[0])}" class="${String(c.examples[0]).trim() ? '' : 'bad-input'}" placeholder="필수">`, 'ex ex1')}
        ${row('예시 2', (c, i) => `<input type="text" data-c="${i}" data-f="ex1" value="${U.esc(c.examples[1])}" placeholder="권장">`, 'ex')}
        </tbody></table></div>
        <div class="hint">컬럼 머리(번호 칸)를 끌어다 놓으면 순서가 바뀝니다. 내려받는 엑셀 서식도 이 순서를 따릅니다.</div>` : '<div class="empty">엑셀 서식을 올리거나, 위의 자주 쓰는 항목을 눌러 추가하세요.</div>'}
      <div style="margin-top:10px"><button class="btn" id="add-col">컬럼 직접 추가</button> ${missingEx() ? '<button class="btn" id="fill-default-ex" style="margin-left:6px">빈 예시 자동 채우기</button> ' : ''}<span class="hint">예시에는 실제 개인정보 대신 가상 값(홍길동, 010-0000-0000 등)을 쓰세요.</span></div>`;
  }

  function sec3() {
    const k = W.kinds;
    return `<h2><span class="num">3</span> 요청 기본 정보</h2>
      ${W.parentId ? `<div class="alert info small">상위 요청 <b>"${U.esc(W.fromTitle)}"</b>의 하위 재요청입니다. 하위 제출이 승인되면 취합하여 상위 요청에 제출할 수 있습니다.</div>` : ''}
      <label class="fld"><span class="req">건명(제목)</span><input type="text" id="f-title" value="${U.esc(W.title)}" maxlength="100"></label>
      <label class="fld"><span>요청 내용 · 작성 안내</span><textarea id="f-desc" rows="3">${U.esc(W.desc)}</textarea></label>
      <div class="row">
        <label class="fld"><span class="req">제출 마감일</span><input type="date" id="f-dl" value="${W.deadline}"></label>
        <label class="fld"><span>보관기간 (경과 후 자동 파기 대상)</span><select id="f-ret">${[30, 60, 90, 180, 365].map((d) => `<option value="${d}" ${W.retention === d ? 'selected' : ''}>${d}일</option>`).join('')}</select></label>
      </div>
      <div class="fld"><span>제출 방식</span>
        <label style="margin-right:14px"><input type="checkbox" id="k-text" ${k.text ? 'checked' : ''}> 텍스트</label>
        <label style="margin-right:14px"><input type="checkbox" id="k-file" ${k.file ? 'checked' : ''}> 파일 업로드</label>
        <label><input type="checkbox" id="k-excel" ${k.excel ? 'checked' : ''}> 엑셀 서식</label></div>
      ${k.excel && W.columns.some((c) => c.pii) ? `<div class="alert warn small">개인정보 컬럼(${W.columns.filter((c) => c.pii).map((c) => U.esc(c.name)).join(', ')}) 포함 요청 — 제출 값은 별도 암호화 저장소에 분리되고, 취합 파일은 기본 <b>마스킹본</b>으로 내려받습니다.</div>` : ''}`;
  }

  function treeHtml() {
    const user = Store.user();
    const lvl3 = W.mode === 'level3';
    let roots;
    if (user.role === 'station') roots = [{ name: Org.name(user.orgId), id: user.orgId, children: Org.node(user.orgId).children, station: true }];
    else roots = Org.root.children;
    const cb = (id, label, extra) => `<label class="it"><input type="checkbox" data-t="${id}" ${W.targets.has(id) ? 'checked' : ''}> <span>${U.esc(label)}</span>${extra || ''}</label>`;
    let h = '';
    roots.forEach((grp) => {
      if (grp.station) {
        h += `<div class="grp"><b>${U.esc(grp.name)} 관할</b></div>` + grp.children.map((c) => cb(c.id, c.name)).join('');
        return;
      }
      const units = grp.children;
      const leafIds = lvl3 ? units.flatMap((u) => u.children.map((c) => c.id)) : units.map((u) => u.id);
      const allOn = leafIds.length && leafIds.every((i) => W.targets.has(i));
      h += `<details open><summary><span class="grp"><input type="checkbox" data-grp="${leafIds.join(',')}" ${allOn ? 'checked' : ''}> ${U.esc(grp.name)} <span class="mut small">(${leafIds.length})</span></span></summary>`;
      if (!lvl3) h += units.map((u) => cb(u.id, u.name)).join('');
      else {
        h += units.map((u) => {
          const ids = u.children.map((c) => c.id);
          const on = ids.every((i) => W.targets.has(i));
          return `<details ${W.open.has(u.id) ? 'open' : ''} data-open="${u.id}"><summary><span class="grp"><input type="checkbox" data-grp="${ids.join(',')}" ${on ? 'checked' : ''}> ${U.esc(u.name)} <span class="mut small">(${ids.length})</span></span></summary>${u.children.map((c) => cb(c.id, c.name)).join('')}</details>`;
        }).join('');
      }
      h += '</details>';
    });
    return h;
  }

  function sec4() {
    const user = Store.user();
    return `<h2><span class="num">4</span> 요청 대상 선택 <span class="badge b-info" id="tcount">${targetCount()}곳</span></h2>
      ${user.role === 'station' ? `<p class="hint" style="margin-top:-4px">소방서 담당자는 <b>관할 센터/팀</b>에게만 요청할 수 있습니다.</p>` : `<div class="fld" style="margin-bottom:8px"><span>요청 단위</span>
        <label style="margin-right:14px"><input type="radio" name="mode" value="level2" ${W.mode === 'level2' ? 'checked' : ''}> 소방서 · 본부 부서 단위</label>
        <label><input type="radio" name="mode" value="level3" ${W.mode === 'level3' ? 'checked' : ''}> 센터 · 계/팀 단위</label>
        <div class="hint">소방서 단위로 요청하면 소방서 담당자가 하위 센터/팀에 다시 요청(재요청)한 뒤 취합하여 제출할 수 있습니다.</div></div>`}
      <div style="display:flex;gap:8px;margin-bottom:8px;flex-wrap:wrap"><input type="text" id="t-q" placeholder="조직 검색 (예: 해운대, 구급)" style="flex:1;min-width:200px"><button class="btn sm" id="t-all">전체 선택</button><button class="btn sm" id="t-none">선택 해제</button></div>
      <div class="tree" id="tree">${treeHtml()}</div>
      <details class="more" ${W.persons.length ? 'open' : ''}><summary>＋ 개인에게 요청 (일회용 제출 링크 발급)</summary>
        <div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap"><input type="text" id="p-name" placeholder="이름" style="width:140px"><input type="text" id="p-contact" placeholder="연락처/메신저 ID" style="width:200px"><button class="btn sm" id="p-add">추가</button></div>
        <div id="plist">${personsHtml()}</div>
        <div class="hint">개인에게는 <b>1회용·기한 제한 링크</b>가 발급됩니다. 링크는 내부망에서만 열리며, 메신저에는 링크만 보냅니다.</div></details>`;
  }
  function personsHtml() {
    return W.persons.map((p, i) => `<div class="file-row"><span>👤 <b>${U.esc(p.name)}</b> <span class="mut small">${U.esc(p.contact)}</span></span><button class="btn sm ghost" data-prm="${i}">삭제</button></div>`).join('');
  }

  function sec5() {
    return `<h2><span class="num">5</span> 알림 채널</h2>
      <label style="display:block"><input type="checkbox" checked disabled> 시스템 대시보드 알림 (기본) · 마감 D-3 / D-1 / 당일 자동 알림</label>
      <label style="display:block"><input type="checkbox" id="c-app" ${W.channels.app ? 'checked' : ''}> 📱 <b>소방 모바일 어플(APK) 푸시 알림</b> (교대근무자 스마트폰에서 즉시 확인 및 제출)</label>
      <label style="display:block"><input type="checkbox" id="c-sms" ${W.channels.sms ? 'checked' : ''}> 💬 소방 내부 행정망 문자(SMS) / 메신저 쪽지 연동</label>
      <div class="alert info small" style="margin-top:8px">※ <b>보안 강화</b>: 디스코드·텔레그램 등 해외 외부 메신저는 소방 보안 지침에 따라 완전 차단되며, <b>소방 내부망 IP 기반의 공식 모바일 어플</b> 및 행정망 SMS만 활용됩니다.</div>`;
  }

  function side() {
    const list = checks();
    const ok = list.every((c) => c.ok);
    return `<div class="card sticky"><h3>발송 전 점검</h3><ul class="check">${list.map((c) => `<li class="${c.ok ? 'ok' : 'ng'}">${U.esc(c.t)}</li>`).join('')}</ul>
      <button class="btn primary" id="send" style="width:100%" ${ok ? '' : 'disabled'}>요청 발송</button>
      <p class="hint">${ok ? '모든 항목이 준비되었습니다.' : '모든 항목이 충족되면 활성화됩니다.'}</p></div>`;
  }

  /** 업로드 서식의 기존 명단(분석 당시 열 순서)을 현재 컬럼 구성(삭제·순서변경·추가 반영)에 맞춰 재배열 */
  function alignPrefill(analysis, columns) {
    return analysis.prefillRows.map((row) => columns.map((c) => (c.src != null && row[c.src] != null ? row[c.src] : '')));
  }

  // ---------- 렌더/바인딩 ----------
  const Wizard = {
    render(view, fromId) {
      init(fromId);
      view.innerHTML = `<div class="page-h"><div><h1>새 자료 요청</h1><div class="mut">서식을 올리면 필요한 항목을 분석하고, 예시 데이터와 요청 대상을 지정해 발송합니다.</div></div></div>
        <div class="two"><div>
          <div class="card" id="s1"></div><div class="card" id="s2"></div><div class="card" id="s3"></div><div class="card" id="s4"></div><div class="card" id="s5"></div>
        </div><div id="side"></div></div>`;
      this.paint(['s1', 's2', 's3', 's4', 's5']);
    },

    paint(ids) {
      const map = { s1: sec1, s2: sec2, s3: sec3, s4: sec4, s5: sec5 };
      ids.forEach((id) => { document.getElementById(id).innerHTML = map[id](); });
      this.bind(ids);
      this.side();
    },

    side() {
      const el = document.getElementById('side');
      if (!el) return;
      el.innerHTML = side();
      document.getElementById('send').addEventListener('click', () => this.send());
    },

    bind(ids) {
      const $ = (s) => document.querySelector(s);
      if (ids.includes('s1')) {
        U.dropzone($('#dz'), (fs) => this.onTemplate(fs[0]), { accept: '.xlsx,.xls,.csv' });
        $('#k-noexcel').addEventListener('change', (e) => {
          W.kinds.excel = !e.target.checked;
          if (!W.kinds.excel) { W.kinds.text = true; }
          this.paint(['s2', 's3']);
        });
        const re = $('#an-re');
        if (re) re.addEventListener('click', () => {
          const sheet = $('#an-sheet') ? $('#an-sheet').value : W.analysis.sheetName;
          this.analyze({ sheetName: sheet, headerRow: Math.max(0, (+$('#an-hr').value || 1) - 1) });
        });
      }
      if (ids.includes('s2')) {
        document.querySelectorAll('#s2 [data-f]').forEach((el) => {
          const h = () => {
            const c = W.columns[+el.dataset.c], f = el.dataset.f;
            const v = el.type === 'checkbox' ? el.checked : el.value;
            if (f === 'ex0') { c.examples[0] = v; el.classList.toggle('bad-input', !String(v).trim()); }
            else if (f === 'ex1') c.examples[1] = v;
            else c[f] = v;
            if (f === 'pii') this.paint(['s3']);
            this.side();
          };
          el.addEventListener(el.type === 'checkbox' || el.tagName === 'SELECT' ? 'change' : 'input', h);
        });
        document.querySelectorAll('#s2 [data-f=name]').forEach((el) => el.addEventListener('change', () => this.paint(['s2'])));
        document.querySelectorAll('#s2 [data-del]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); W.columns.splice(+b.dataset.del, 1); this.paint(['s2', 's3']); }));
        const add = $('#add-col');
        if (add) add.addEventListener('click', () => { W.columns.push(blankCol()); this.paint(['s2']); });
        const fillEx = $('#fill-default-ex');
        if (fillEx) fillEx.addEventListener('click', () => {
          W.columns.forEach((c) => { if (!String(c.examples[0] || '').trim()) c.examples[0] = '-'; });
          this.paint(['s2']);
        });
        const idxOf = (k) => W.columns.findIndex((c) => c.name.trim() === k);
        // 자주 쓰는 항목: 누르면 추가, 다시 누르면 삭제 (토글)
        document.querySelectorAll('#s2 [data-preset]').forEach((b) => b.addEventListener('click', () => {
          const k = b.dataset.preset;
          const i = idxOf(k);
          if (i >= 0) W.columns.splice(i, 1); else if (PRESETS[k]) W.columns.push(presetCol(k));
          this.paint(['s2', 's3']);
        }));
        const std = $('#preset-std');
        if (std) std.addEventListener('click', () => {
          const allOn = STD4.every((k) => idxOf(k) >= 0);
          if (allOn) W.columns = W.columns.filter((c) => !STD4.includes(c.name.trim()));
          else STD4.forEach((k) => { if (idxOf(k) < 0) W.columns.push(presetCol(k)); });
          this.paint(['s2', 's3']);
        });
        const pf = $('#prefill-roster');
        if (pf) pf.addEventListener('change', (e) => {
          W.prefillRoster = e.target.checked;
          Store.setPrefillRoster(W.prefillRoster);
        });
        // 컬럼 순서 변경: 컬럼 머리를 끌어다 놓기
        const grid = $('#colgrid');
        if (grid) {
          let from = -1;
          const clear = () => grid.querySelectorAll('.drop-l,.drop-r,.dragging').forEach((x) => x.classList.remove('drop-l', 'drop-r', 'dragging'));
          const cellsOf = (i) => grid.querySelectorAll(`[data-drag="${i}"], td[data-col="${i}"]`);
          grid.querySelectorAll('th[data-drag]').forEach((th) => {
            th.addEventListener('dragstart', (e) => {
              from = +th.dataset.drag;
              e.dataTransfer.effectAllowed = 'move';
              try { e.dataTransfer.setData('text/plain', String(from)); } catch (err) { /* 일부 브라우저 */ }
              cellsOf(from).forEach((x) => x.classList.add('dragging'));
            });
            th.addEventListener('dragover', (e) => {
              e.preventDefault();
              const to = +th.dataset.drag;
              grid.querySelectorAll('.drop-l,.drop-r').forEach((x) => x.classList.remove('drop-l', 'drop-r'));
              if (to !== from) cellsOf(to).forEach((x) => x.classList.add(to < from ? 'drop-l' : 'drop-r'));
            });
            th.addEventListener('drop', (e) => {
              e.preventDefault();
              const src = from >= 0 ? from : +e.dataTransfer.getData('text/plain');
              const to = +th.dataset.drag;
              clear();
              if (src < 0 || src === to || Number.isNaN(src)) return;
              const [m] = W.columns.splice(src, 1);
              W.columns.splice(to, 0, m);
              from = -1;
              this.paint(['s2']);
            });
            th.addEventListener('dragend', () => { from = -1; clear(); });
          });
        }
      }
      if (ids.includes('s3')) {
        $('#f-title').addEventListener('input', (e) => { W.title = e.target.value; this.side(); });
        $('#f-desc').addEventListener('input', (e) => { W.desc = e.target.value; });
        $('#f-dl').addEventListener('input', (e) => { W.deadline = e.target.value; this.side(); });
        $('#f-ret').addEventListener('change', (e) => { W.retention = +e.target.value; });
        ['text', 'file', 'excel'].forEach((k) => $('#k-' + k).addEventListener('change', (e) => {
          W.kinds[k] = e.target.checked;
          if (k === 'excel') { $('#k-noexcel') && ($('#k-noexcel').checked = !W.kinds.excel); this.paint(['s2']); }
          this.side();
        }));
      }
      if (ids.includes('s4')) this.bindTree();
      if (ids.includes('s5')) ['app', 'sms'].forEach((c) => { const el = $('#c-' + c); if (el) el.addEventListener('change', (e) => { W.channels[c] = e.target.checked; this.side(); }); });
    },

    bindTree() {
      const $ = (s) => document.querySelector(s);
      const count = () => { $('#tcount').textContent = targetCount() + '곳'; this.side(); };
      document.querySelectorAll('input[name=mode]').forEach((r) => r.addEventListener('change', () => { W.mode = r.value; W.targets.clear(); this.paint(['s4']); this.side(); }));
      const tree = $('#tree');
      this.bindTree2();
      $('#t-q').addEventListener('input', (e) => {
        const q = e.target.value.trim();
        tree.querySelectorAll('label.it').forEach((l) => { l.style.display = !q || l.textContent.includes(q) ? '' : 'none'; });
        if (q) tree.querySelectorAll('details').forEach((d) => { d.open = true; });
      });
      const allIds = () => (Store.user().role === 'station' ? Org.node(Store.user().orgId).children.map((c) => c.id) : Org.unitsAtLevel(W.mode === 'level3' ? 3 : 2).map((n) => n.id));
      $('#t-all').addEventListener('click', () => { allIds().forEach((i) => W.targets.add(i)); $('#tree').innerHTML = treeHtml(); this.bindTree2(); count(); });
      $('#t-none').addEventListener('click', () => { W.targets.clear(); $('#tree').innerHTML = treeHtml(); this.bindTree2(); count(); });
      const add = $('#p-add');
      add.addEventListener('click', () => {
        const n = $('#p-name').value.trim(), c = $('#p-contact').value.trim();
        if (!n) return U.toast('이름을 입력하세요.', 'warn');
        W.persons.push({ name: n, contact: c }); $('#p-name').value = ''; $('#p-contact').value = '';
        $('#plist').innerHTML = personsHtml(); this.bindPersons(); count();
      });
      this.bindPersons();
    },
    bindTree2() {
      const tree = document.getElementById('tree');
      const count = () => { document.getElementById('tcount').textContent = targetCount() + '곳'; this.side(); };
      tree.querySelectorAll('input[data-t]').forEach((c) => { c.onchange = () => { c.checked ? W.targets.add(c.dataset.t) : W.targets.delete(c.dataset.t); const keep = [...tree.querySelectorAll('details[data-open][open]')].map((d) => d.dataset.open); keep.forEach((k) => W.open.add(k)); tree.innerHTML = treeHtml(); this.bindTree2(); count(); }; });
      tree.querySelectorAll('input[data-grp]').forEach((c) => {
        c.onclick = (e) => e.stopPropagation();
        c.onchange = () => {
          c.dataset.grp.split(',').forEach((i) => (c.checked ? W.targets.add(i) : W.targets.delete(i)));
          const keep = [...tree.querySelectorAll('details[data-open][open]')].map((d) => d.dataset.open);
          keep.forEach((k) => W.open.add(k));
          tree.innerHTML = treeHtml(); this.bindTree2(); count();
        };
      });
    },
    bindPersons() {
      document.querySelectorAll('#plist [data-prm]').forEach((b) => b.addEventListener('click', () => {
        W.persons.splice(+b.dataset.prm, 1);
        document.getElementById('plist').innerHTML = personsHtml(); this.bindPersons();
        document.getElementById('tcount').textContent = targetCount() + '곳'; this.side();
      }));
    },

    async onTemplate(file) {
      if (file.size > 10 * 1024 * 1024) return U.toast('서식 파일은 10MB 이하여야 합니다.', 'bad');
      try { W.wb = Excel.read(await U.readFile(file)); } catch (e) { return U.toast('엑셀 파일을 읽을 수 없습니다.', 'bad'); }
      W.templateName = file.name;
      W.kinds.excel = true;
      this.analyze({});
      if (!W.title.trim()) { W.title = (W.analysis.title || file.name.replace(/\.[^.]+$/, '')).replace(/_?서식.*$/, '').trim(); }
      this.paint(['s1', 's2', 's3']);
    },
    analyze(opts) {
      W.analysis = Excel.analyze(W.wb, opts);
      W.columns = W.analysis.columns.map((c, i) => ({ name: c.name, type: c.type, required: c.required, pii: c.pii, examples: c.examples.slice(), src: i }));
      if (!W.columns.length) U.toast('컬럼을 찾지 못했습니다. 컬럼명 행 번호를 지정해 보세요.', 'warn');
      this.paint(['s1', 's2']);
      const n = missingEx();
      if (W.columns.length) U.toast(`컬럼 ${W.columns.length}개 분석 완료${n ? ` · 예시 입력이 필요한 컬럼 ${n}개` : ''}`, n ? 'warn' : 'ok');
    },

    async send() {
      const list = checks();
      if (!list.every((c) => c.ok)) return;
      const orgT = [...W.targets];
      const msg = `"${W.title}"\n대상: 조직 ${orgT.length}곳${W.persons.length ? ` + 개인 ${W.persons.length}명` : ''}\n마감: ${W.deadline}\n\n요청을 발송합니다.`;
      if (!(await U.confirm(msg, '발송'))) return;
      const kinds = { ...W.kinds };
      // 업로드한 서식의 기존 명단(타 센터 인원 포함)도 개인정보 열은 Vault로 분리 저장하고 요청 메타에는 토큰만 남긴다
      let prefillRows = (W.analysis && Array.isArray(W.analysis.prefillRows) && W.analysis.prefillRows.length > 2) ? alignPrefill(W.analysis, W.columns) : [];
      if (prefillRows.length) {
        const piiIdx = new Set(W.columns.map((c, i) => (c.pii ? i : -1)).filter((i) => i >= 0));
        prefillRows = await Promise.all(prefillRows.map((row) => Promise.all(row.map(async (cell, i) => (cell && (piiIdx.has(i) || PII.scan(cell).length) ? Vault.putText(cell, { prefill: true }) : cell)))));
      }
      const req = Store.createRequest({
        title: W.title.trim(), desc: W.desc.trim(), deadline: U.fromInputDate(W.deadline), retentionDays: W.retention,
        kinds, columns: kinds.excel ? W.columns.map((c) => ({ name: c.name.trim(), type: c.type, required: !!c.required, pii: !!c.pii, examples: [String(c.examples[0]).trim(), String(c.examples[1] || '').trim()] })) : [],
        templateName: W.templateName, targetMode: W.mode, prefillRoster: W.prefillRoster,
        prefillRows,
        targets: orgT.map((id) => ({ kind: 'org', id })).concat(W.persons.map((p) => ({ kind: 'person', id: U.uid('pp'), name: p.name, contact: p.contact }))),
        channels: { app: true, ...W.channels }, parentId: W.parentId,
      });
      U.toast('요청이 발송되었습니다.', 'ok');
      location.hash = '#/r/' + req.id;
    },
  };

  Wizard.alignPrefill = alignPrefill;
  g.Wizard = Wizard;
})(window);
