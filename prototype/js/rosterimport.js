/* 인원명부 일괄 갱신 (인사이동): 엑셀/CSV 붙여넣기·파일 → 표 파싱 → 기존 명부와 비교(신규·전보·정보변경·제외) 계획 생성.
 * 순수 함수만 둡니다(DOM·저장소 접근 없음). 실제 반영은 Store.applyRosterPlan 이 담당합니다. */
(function (g) {
  const COLS = [
    { key: 'org', re: /^(소속|센터|부서|근무지|근무처)/ },
    { key: 'rank', re: /^(계급|직급)/ },
    { key: 'name', re: /^(성명|이름)/ },
    { key: 'birth', re: /^(생년월일|생일)/ },
    { key: 'appointedAt', re: /^(임용일자|임용일|임용)/ },
    { key: 'phone', re: /^(연락처|전화|휴대|핸드폰)/ },
    { key: 'duty', re: /^(담당업무|업무|직책|보직)/ },
  ];
  const FIELDS = ['rank', 'birth', 'appointedAt', 'phone', 'duty'];
  const FIELD_LABEL = { orgId: '소속', rank: '계급', name: '성명', birth: '생년월일', appointedAt: '임용일자', phone: '연락처', duty: '담당업무' };

  /** 붙여넣은 텍스트(탭 구분 = 엑셀 복사, 쉼표 구분 = CSV) → 2차원 배열. 따옴표 안의 구분자·줄바꿈을 처리 */
  function parseDelimited(text) {
    const src = String(text || '').replace(/^﻿/, '');
    const d = src.includes('\t') ? '\t' : ',';
    const rows = [];
    let row = [], cur = '', q = false;
    for (let i = 0; i < src.length; i++) {
      const ch = src[i];
      if (q) {
        if (ch === '"') { if (src[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch;
      } else if (ch === '"' && cur === '') q = true;
      else if (ch === d) { row.push(cur); cur = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && src[i + 1] === '\n') i++;
        row.push(cur); cur = '';
        rows.push(row); row = [];
      } else cur += ch;
    }
    if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
    return rows.filter((r) => r.some((c) => String(c).trim() !== ''));
  }

  function normDate(v) {
    const s = String(v == null ? '' : v).trim();
    if (!s) return '';
    const pad = (x) => String(x).padStart(2, '0');
    let m = s.match(/^(\d{4})\s*[.\-/]\s*(\d{1,2})\s*[.\-/]\s*(\d{1,2})\.?$/);
    if (m) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
    m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    m = s.match(/^(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일?$/);
    if (m) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
    if (/^\d{5}$/.test(s) && +s > 20000 && +s < 80000) { // 엑셀 날짜 일련번호
      const dt = new Date(Math.round((+s - 25569) * 86400000));
      return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
    }
    return s;
  }

  function normPhone(v) {
    const s = String(v == null ? '' : v).trim();
    if (!s) return '';
    let d = s.replace(/\D/g, '');
    if (d.length === 10 && d.startsWith('10')) d = '0' + d; // 엑셀이 앞자리 0을 지운 경우
    if (/^01\d{9}$/.test(d)) return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;
    if (/^01\d{8}$/.test(d)) return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
    return s;
  }

  /** 2차원 배열 → {rows:[{line, orgText, rank, name, birth, appointedAt, phone, duty}], errors:[], mapped:[열이름]} */
  function parseTable(table) {
    let hi = -1, map = null;
    for (let i = 0; i < Math.min(table.length, 15); i++) {
      const m = {};
      table[i].forEach((c, ci) => {
        const t = String(c == null ? '' : c).replace(/\s+/g, '');
        const col = COLS.find((x) => x.re.test(t));
        if (col && !(col.key in m)) m[col.key] = ci;
      });
      if ('name' in m && Object.keys(m).length >= 2) { hi = i; map = m; break; }
    }
    if (hi < 0) return { rows: [], errors: ['머리글 행을 찾지 못했습니다. 첫 줄에 "소속, 계급, 성명 …" 열 제목이 포함되도록 붙여넣어 주세요.'], mapped: [] };
    const rows = [];
    for (let i = hi + 1; i < table.length; i++) {
      const r = table[i];
      const get = (k) => (k in map ? String(r[map[k]] == null ? '' : r[map[k]]).trim() : '');
      const name = get('name');
      if (!name && !get('org') && !get('rank')) continue;
      rows.push({
        line: i + 1, orgText: get('org'), rank: get('rank'), name,
        birth: normDate(get('birth')), appointedAt: normDate(get('appointedAt')), phone: normPhone(get('phone')), duty: get('duty'),
      });
    }
    return { rows, errors: [], mapped: Object.keys(map), hasOrg: 'org' in map };
  }

  /**
   * 기존 명부와 비교해 반영 계획을 만든다.
   * existing: 복호화된 기존 명부 [{id, orgId, rank, name, birth, appointedAt, phone, duty}]
   * opts: { resolveOrg(text)->orgId|undefined, defaultOrgId, canTouch(orgId)->bool, removeMissing, ranks[] }
   * 매칭 규칙: ① 성명+생년월일 일치 ② 파일에 생년월일이 없으면 성명이 명부에서 유일할 때 성명만으로 매칭.
   *            파일의 빈 칸은 기존 값을 지우지 않는다(유지).
   */
  function plan(existing, rows, opts) {
    const o = opts || {};
    const items = [], errors = [], warnings = [];
    const matched = new Set();
    const seen = new Set();
    const byName = new Map();
    existing.forEach((p) => { const a = byName.get(p.name) || []; a.push(p); byName.set(p.name, a); });
    const fileOrgs = new Set();
    const fileNameCount = new Map();
    rows.forEach((r) => fileNameCount.set(r.name, (fileNameCount.get(r.name) || 0) + 1));

    for (const r of rows) {
      const tag = `${r.line}행`;
      if (!r.name) { errors.push(`${tag}: 성명이 비어 있어 건너뜁니다.`); continue; }
      let orgId;
      if (r.orgText) {
        const res = o.resolveOrg ? o.resolveOrg(r.orgText) : undefined;
        if (res && res.error) { errors.push(`${tag} ${r.name}: ${res.error}`); continue; }
        orgId = res;
        if (!orgId) { errors.push(`${tag} ${r.name}: 소속 "${r.orgText}" 을(를) 조직도에서 찾을 수 없어 건너뜁니다.`); continue; }
      } else orgId = o.defaultOrgId;
      if (!orgId) { errors.push(`${tag} ${r.name}: 소속을 알 수 없어 건너뜁니다.`); continue; }
      if (o.canTouch && !o.canTouch(orgId)) { errors.push(`${tag} ${r.name}: 권한 범위 밖 소속이라 건너뜁니다.`); continue; }
      if (r.rank && o.ranks && !o.ranks.includes(r.rank)) warnings.push(`${tag} ${r.name}: 계급 "${r.rank}" 은(는) 목록에 없는 값입니다. (그대로 반영)`);
      const key = r.name + '|' + (r.birth || '') + '|' + orgId;
      if (seen.has(key)) { errors.push(`${tag} ${r.name}: 파일 안에서 중복된 인원이라 건너뜁니다.`); continue; }
      seen.add(key);
      fileOrgs.add(orgId);

      // 매칭
      let ex = null;
      const cands = byName.get(r.name) || [];
      if (r.birth) {
        const same = cands.filter((p) => p.birth === r.birth && !matched.has(p.id));
        ex = same.find((p) => p.orgId === orgId) || same[0] || null; // 같은 소속 우선
      }
      if (!ex && !r.birth) {
        const free = cands.filter((p) => !matched.has(p.id));
        const inOrg = free.filter((p) => p.orgId === orgId);
        if (inOrg.length === 1) ex = inOrg[0];
        else if (free.length === 1 && fileNameCount.get(r.name) === 1) ex = free[0];
        else if (free.length > 1 || (free.length && fileNameCount.get(r.name) > 1)) {
          // 모호하면 추측하지 않고 건너뛴다. 기존 동명 인원은 '제외 대상'이 되지 않도록 보호
          free.forEach((p) => matched.add(p.id));
          errors.push(`${tag} ${r.name}: 동명이인이라 생년월일 없이는 구분할 수 없어 건너뜁니다. 생년월일을 채워 다시 분석하세요.`);
          continue;
        }
      }
      if (!ex && r.birth) {
        const sameNameDiffBirth = cands.filter((p) => !matched.has(p.id) && p.birth && p.birth !== r.birth);
        if (sameNameDiffBirth.length) warnings.push(`${tag} ${r.name}: 같은 성명이 다른 생년월일(${sameNameDiffBirth.map((p) => p.birth).join(', ')})로 이미 있어 신규로 처리합니다. 오타라면 파일을 고쳐 다시 분석하세요.`);
      }

      if (!ex) { items.push({ kind: 'add', line: r.line, row: { ...r, orgId } }); continue; }
      if (o.canTouch && !o.canTouch(ex.orgId)) { errors.push(`${tag} ${r.name}: 현재 다른 소속(${o.orgName ? o.orgName(ex.orgId) : ex.orgId})에 등록된 인원이라 권한이 없어 건너뜁니다. (본부 담당자가 처리)`); matched.add(ex.id); continue; }
      matched.add(ex.id);
      const patch = {}, changes = [];
      if (orgId !== ex.orgId) { patch.orgId = orgId; changes.push({ f: 'orgId', from: ex.orgId, to: orgId }); }
      if (r.name !== ex.name) { patch.name = r.name; }
      FIELDS.forEach((f) => {
        if (r[f] && r[f] !== (ex[f] || '')) { patch[f] = r[f]; changes.push({ f, from: ex[f] || '', to: r[f] }); }
      });
      if (!changes.length) items.push({ kind: 'same', line: r.line, id: ex.id, row: { ...r, orgId }, ex });
      else items.push({ kind: patch.orgId ? 'transfer' : 'update', line: r.line, id: ex.id, patch, changes, row: { ...r, orgId }, ex });
    }

    // 파일에 없는 기존 인원 (파일에 등장한 소속에 한정)
    const missing = existing.filter((p) => !matched.has(p.id) && fileOrgs.has(p.orgId) && (!o.canTouch || o.canTouch(p.orgId)));
    if (o.removeMissing) missing.forEach((p) => items.push({ kind: 'remove', id: p.id, ex: p }));
    const count = { add: 0, transfer: 0, update: 0, same: 0, remove: 0 };
    items.forEach((i) => count[i.kind]++);
    return { items, errors, warnings, count, missing, fileOrgs: [...fileOrgs] };
  }

  const RosterImport = { parseDelimited, parseTable, plan, normDate, normPhone, FIELD_LABEL };
  g.RosterImport = RosterImport;
  if (typeof module !== 'undefined') module.exports = RosterImport;
})(typeof window !== 'undefined' ? window : globalThis);
