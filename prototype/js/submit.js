/* 제출 화면: 엑셀(서식 검증) / 텍스트 / 파일 제출 + 개인정보 탐지·분리 저장 */
(function (g) {
  const ALLOWED = ['xlsx', 'xls', 'csv', 'txt', 'hwp', 'hwpx', 'odt', 'ods', 'pdf', 'doc', 'docx', 'ppt', 'pptx', 'png', 'jpg', 'jpeg'];
  const MAX_FILE = 100 * 1024 * 1024;
  const SCANNABLE = ['xlsx', 'xls', 'csv', 'txt'];
  const ext = (n) => (String(n).split('.').pop() || '').toLowerCase();

  /** 드래그&드롭/클릭 업로드 영역 */
  U.dropzone = function (el, cb, opts) {
    opts = opts || {};
    const inp = document.createElement('input');
    inp.type = 'file'; inp.hidden = true;
    if (opts.multiple) inp.multiple = true;
    if (opts.accept) inp.accept = opts.accept;
    el.appendChild(inp);
    el.tabIndex = 0;
    el.addEventListener('click', (e) => { if (e.target !== inp) inp.click(); });
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inp.click(); } });
    inp.addEventListener('change', () => { const f = [...inp.files]; inp.value = ''; if (f.length) cb(f); });
    ['dragenter', 'dragover'].forEach((ev) => el.addEventListener(ev, (e) => { e.preventDefault(); el.classList.add('over'); }));
    ['dragleave', 'drop'].forEach((ev) => el.addEventListener(ev, (e) => { e.preventDefault(); el.classList.remove('over'); }));
    el.addEventListener('drop', (e) => { const f = [...(e.dataTransfer.files || [])]; if (f.length) cb(f); });
  };

  function decodeText(bytes) {
    let s = new TextDecoder('utf-8').decode(bytes);
    if (s.includes('\uFFFD')) { try { s = new TextDecoder('euc-kr').decode(bytes); } catch (e) { /* ignore */ } }
    return s;
  }

  /** 첨부 파일 내용 스캔 (xlsx/csv/txt만 가능) */
  async function scanFile(name, bytes) {
    const e = ext(name);
    if (!SCANNABLE.includes(e)) return null;
    try {
      let text;
      if (e === 'txt' || e === 'csv') text = decodeText(new Uint8Array(bytes));
      else {
        const wb = Excel.read(bytes);
        text = wb.SheetNames.map((s) => XLSX.utils.sheet_to_csv(wb.Sheets[s])).join('\n');
      }
      return PII.scan(text);
    } catch (err) { return null; }
  }

  function describe(v) {
    const p = [];
    if (v.rows && v.rows.length) p.push(`엑셀 ${v.rows.length}행`);
    if (v.text || v.textToken) p.push('텍스트');
    if (v.files && v.files.length) p.push(`파일 ${v.files.length}개`);
    if (v.piiCount) p.push(`개인정보 분리보관 ${v.piiCount}건`);
    return p.join(' · ') || '내용 없음';
  }

  const SubmitUI = {
    describe,
    ALLOWED,

    /**
     * container 안에 제출 폼 렌더링.
     * opts: {person: bool, onDone: fn, byName: string}
     */
    mount(container, req, target, opts) {
      opts = opts || {};
      const st = { excel: null, excelName: '', extra: new Set(), text: '', textPii: false, files: [], agree: false, busy: false, prefillRoster: typeof req.prefillRoster === 'boolean' ? req.prefillRoster : Store.prefillRosterEnabled() };
      const sub = Store.sub(req.id, target.id);
      const last = Store.lastVersion(sub);
      const hasTemplate = req.kinds.excel && req.columns.length > 0;
      const piiCols = req.columns.map((c, i) => (c.pii ? i : -1)).filter((i) => i >= 0);

      function head() {
        let h = '';
        if (req.purged) return '<div class="alert info">보관기간 경과 또는 수동 파기로 저장 자료가 삭제되었습니다. (메타정보만 남음)</div>';
        if (sub && sub.status === 'approved') h += `<div class="alert ok">✔ 승인된 제출입니다. (v${last.no}, ${U.fmt(last.at)}) — ${U.esc(describe(last))}</div>`;
        else if (sub && sub.status === 'rejected') {
          const rv = sub.reviews[sub.reviews.length - 1];
          h += `<div class="alert bad"><b>반려되었습니다.</b> 사유: ${U.esc(rv ? rv.reason : '')}<br><span class="small">${rv ? U.esc(rv.byName) + ' · ' + U.fmt(rv.at) : ''} — 보완 후 재제출해 주세요.</span></div>`;
        } else if (sub && sub.status === 'submitted') h += `<div class="alert info">제출 완료 (v${last.no}, ${U.fmt(last.at)}) — 검토 대기 중. 검토 전에는 수정하여 다시 제출할 수 있습니다.<br><span class="small">${U.esc(describe(last))}</span></div>`;
        return h;
      }

      function locked() {
        if (req.purged) return true;
        if (sub && sub.status === 'approved') return true;
        if (opts.person && target.used) return true;
        if (req.status !== 'open') return true;
        return false;
      }

      function render() {
        if (locked()) {
          container.innerHTML = head() + (opts.person && target.used ? '<div class="alert ok">제출이 완료되었습니다. 이 링크는 1회용이라 더 이상 사용할 수 없습니다.</div>' : '');
          return;
        }
        let h = head();
        h += '<div class="alert warn small">⚠ <b>개인정보가 포함된 자료</b>는 반드시 표시해 주세요. 표시되거나 자동 탐지된 개인정보는 일반 자료와 분리되어 <b>암호화 저장</b>되며, 열람 시 사유와 이력이 기록됩니다.</div>';

        if (hasTemplate) {
          const orgInfo = (Org && Org.resolveOrgDept) ? Org.resolveOrgDept(target, req) : null;
          const roster = (target && target.kind !== 'person' && Store.rosterOf) ? Store.rosterOf(target.id) : [];
          const prefillMsg = orgInfo && (orgInfo.org || orgInfo.dept) ? `<span class="badge b-info" style="font-size:11px;margin-left:6px">${U.esc(orgInfo.dept || orgInfo.org)} 맞춤 서식 (타 센터 인원 제외)</span>` : '';
          h += `<h3>① 엑셀 서식 제출 <span class="mut small">(필수)</span> ${prefillMsg}</h3>
            <div class="tpl-bar">
              <div>
                <div class="small" style="margin-bottom:4px">서식 컬럼: ${req.columns.map((c) => `<span class="tag">${U.esc(c.name)}${c.pii ? ' · 개인정보' : ''}</span>`).join(' ')}</div>
                ${target && target.kind !== 'person' ? `<div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-top:6px">
                  <label class="ck small"><input type="checkbox" id="tpl-roster-tog" ${st.prefillRoster ? 'checked' : ''}> <span><b>본인 센터(${U.esc(orgInfo ? orgInfo.dept : '')}) 인원명부 자동 기재</b> (기관·소속·계급·성명·생년월일·임용일자·연락처 ${roster.length}명 미리 채우기)</span></label>
                  <a class="small" href="#/org?org=${encodeURIComponent(target.id)}">내 센터 인원명부 확인/수정 →</a>
                </div>` : ''}
              </div>
              <button class="btn sm primary" data-a="tpl">📥 ${U.esc(orgInfo && orgInfo.dept ? orgInfo.dept + ' 전용 ' : '맞춤 ')}제출서식 다운로드(.xlsx)</button>
            </div>
            ${orgInfo && (orgInfo.org || orgInfo.dept) ? `<div class="alert info small" style="margin-bottom:8px">🔒 <b>센터별 파일 분리 보안 적용</b>: 다운로드하시는 엑셀 파일에는 <b>${U.esc(orgInfo.dept)} 소속 인원(${roster.length}명)의 기존 보유 정보만</b> 들어 있으며, <b>타 센터 인원의 전화번호·임용일자·생년월일은 일체 포함되지 않습니다.</b> 서식 안의 작성요령을 확인하시고 빈 칸 항목만 작성해 올려주세요.</div>` : ''}
            <div class="drop small" id="dz-x">작성한 엑셀 파일을 <b>여기로 드래그</b>하거나 클릭하여 선택</div>
            <div id="xres">${excelHtml()}</div>`;
        }
        if (req.kinds.text) {
          h += `<h3 style="margin-top:16px">${hasTemplate ? '②' : '①'} 텍스트 제출</h3>
            <textarea id="tx" rows="5" placeholder="내용을 입력하세요" maxlength="20000">${U.esc(st.text)}</textarea>
            <div id="txres">${textHtml()}</div>`;
        }
        if (req.kinds.file) {
          h += `<h3 style="margin-top:16px">${[hasTemplate, req.kinds.text].filter(Boolean).length === 2 ? '③' : hasTemplate || req.kinds.text ? '②' : '①'} 파일 첨부</h3>
            <div class="drop small" id="dz-f">파일들을 <b>드래그</b>하거나 클릭 (여러 개 동시 가능 · 개당 100MB 이하)</div>
            <div class="small mut" style="margin-top:4px">허용 형식: ${ALLOWED.join(', ')} — 실행파일·매크로 포함 형식은 차단됩니다.</div>
            <div id="fres">${filesHtml()}</div>`;
        }
        h += `<label style="display:flex;gap:8px;margin-top:16px;align-items:flex-start"><input type="checkbox" id="agree" ${st.agree ? 'checked' : ''}>
          <span>개인정보 포함 여부를 확인하여 표시했으며, 제출 자료가 요청 목적에 필요한 최소한의 정보임을 확인합니다.</span></label>
          <div style="margin-top:12px"><button class="btn primary" id="go" ${st.busy ? 'disabled' : ''}>${sub ? '재제출' : '제출'}</button></div>`;
        container.innerHTML = h;
        bind();
      }

      function excelHtml() {
        const v = st.excel;
        if (!v) return '';
        let h = `<div class="small" style="margin:8px 0"><b>${U.esc(st.excelName)}</b> (시트: ${U.esc(v.sheetName || '-')})</div>`;
        if (v.missing.length) return h + `<div class="alert bad">서식과 다른 파일입니다. 누락된 컬럼: <b>${v.missing.map(U.esc).join(', ')}</b><br><span class="small">제공된 서식 파일을 내려받아 작성해 주세요.</span></div>`;
        if (v.errors.length) {
          h += `<div class="alert bad"><b>오류 ${v.errors.length}건:</b><ul>${v.errors.slice(0, 12).map((e) => `<li>${e.row ? e.row + '행 ' : ''}${e.col ? '[' + U.esc(e.col) + '] ' : ''}${U.esc(e.msg)}</li>`).join('')}${v.errors.length > 12 ? `<li>… 외 ${v.errors.length - 12}건</li>` : ''}</ul></div>`;
        }
        if (v.warnings.length) h += `<div class="alert warn"><ul>${v.warnings.map((w) => `<li>${typeof w === 'string' ? U.esc(w) : `${w.row ? w.row + '행 ' : ''}${w.col ? '[' + U.esc(w.col) + '] ' : ''}${U.esc(w.msg)}`}</li>`).join('')}</ul></div>`;
        const pcols = Object.keys(v.pii);
        if (pcols.length) {
          h += `<div class="alert warn"><b>개인정보로 의심되는 값이 개인정보 컬럼이 아닌 곳에서 발견되었습니다.</b> 체크한 컬럼은 개인정보 컬럼과 같이 분리·암호화 저장됩니다.<ul style="list-style:none;margin-left:0">${pcols.map((c) => `<li><label><input type="checkbox" data-xp="${c}" ${st.extra.has(+c) ? 'checked' : ''}> <b>${U.esc(v.header[c])}</b> — ${U.esc(PII.summarize(v.pii[c]))} <span class="mut">(예: ${U.esc(v.pii[c][0].samples[0])})</span></label></li>`).join('')}</ul></div>`;
        }
        if (!v.missing.length && v.rows.length) {
          const pc = new Set([...piiCols, ...st.extra]);
          h += `<div class="alert ok small">✔ 검증 통과: <b>${v.rows.length}행</b> · 개인정보 컬럼 <b>${pc.size}개</b>(${[...pc].map((i) => U.esc(v.header[i])).join(', ') || '없음'})는 암호화 분리 저장됩니다.</div>`;
          h += `<div class="tbl-wrap"><table><thead><tr>${v.header.map((c, i) => `<th>${U.esc(c)}${pc.has(i) ? ' 🔒' : ''}</th>`).join('')}</tr></thead><tbody>${v.rows.slice(0, 5).map((r) => `<tr>${r.map((c, i) => `<td class="${pc.has(i) ? 'pii-cell' : ''}">${U.esc(pc.has(i) ? PII.maskValue(c) : c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div><div class="hint">미리보기는 처음 5행이며, 개인정보 컬럼은 마스킹되어 표시됩니다.</div>`;
        }
        return h;
      }

      function textHtml() {
        const f = PII.scan(st.text);
        const forced = f.length > 0;
        if (forced) st.textPii = true;
        return `${forced ? `<div class="alert warn small" style="margin-top:6px">개인정보로 보이는 값 탐지: <b>${U.esc(PII.summarize(f))}</b> → 암호화 분리 보관됩니다.</div>` : ''}
          <label class="small" style="display:block;margin-top:6px"><input type="checkbox" id="txp" ${st.textPii ? 'checked' : ''} ${forced ? 'disabled' : ''}> 개인정보 포함 (암호화 분리 보관)</label>`;
      }

      function filesHtml() {
        if (!st.files.length) return '';
        return st.files.map((f, i) => `<div class="file-row"><b>${U.esc(f.name)}</b> <span class="mut small">${U.size(f.size)}</span>
          <label class="small"><input type="checkbox" data-fp="${i}" ${f.pii ? 'checked' : ''} ${f.forced ? 'disabled' : ''}> 개인정보 포함</label>
          ${f.forced ? `<span class="badge b-pii">탐지: ${U.esc(PII.summarize(f.findings))}</span>` : f.scannable ? '<span class="badge b-ok">자동 검사: 이상 없음</span>' : '<span class="badge b-warn">자동 검사 불가 형식 — 직접 확인</span>'}
          <button class="btn sm ghost" data-frm="${i}">삭제</button></div>`).join('');
      }

      function bind() {
        const q = (s) => container.querySelector(s);
        const dzx = q('#dz-x');
        if (dzx) U.dropzone(dzx, (fs) => onExcel(fs[0]), { accept: '.xlsx,.xls,.csv' });
        const dzf = q('#dz-f');
        if (dzf) U.dropzone(dzf, onFiles, { multiple: true });
        const tx = q('#tx');
        if (tx) tx.addEventListener('input', () => { st.text = tx.value; q('#txres').innerHTML = textHtml(); bindText(); });
        bindText();
        q('#agree').addEventListener('change', (e) => { st.agree = e.target.checked; });
        q('#go').addEventListener('click', submit);
        container.querySelectorAll('[data-xp]').forEach((c) => c.addEventListener('change', () => { c.checked ? st.extra.add(+c.dataset.xp) : st.extra.delete(+c.dataset.xp); q('#xres').innerHTML = excelHtml(); bindX(); }));
        container.querySelectorAll('[data-fp]').forEach((c) => c.addEventListener('change', () => { st.files[+c.dataset.fp].pii = c.checked; }));
        container.querySelectorAll('[data-frm]').forEach((b) => b.addEventListener('click', () => { st.files.splice(+b.dataset.frm, 1); q('#fres').innerHTML = filesHtml(); bind2(); }));
        const rtog = q('#tpl-roster-tog');
        if (rtog) rtog.addEventListener('change', (e) => {
          st.prefillRoster = e.target.checked;
          Store.setPrefillRoster(st.prefillRoster);
          render();
        });
        const tpl = q('[data-a=tpl]');
        if (tpl) tpl.addEventListener('click', async () => {
          let orgShort = '';
          if (target) {
            const rawNm = target.kind === 'person' ? (target.name || '') : Org.name(target.id);
            orgShort = U.orgShort(rawNm);
          }
          const prefix = orgShort ? `(${orgShort})` : '';
          const fname = `${prefix}${req.title}_서식.xlsx`;
          const bytes = Excel.templateBytes ? await Excel.templateBytes(req, target, { prefillRoster: st.prefillRoster }) : Excel.toBytes(Excel.buildTemplate(req, target, { prefillRoster: st.prefillRoster }));
          U.download(bytes, fname, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
          Store.log('template.download', req.title, `파일명: ${fname} (인원명부 자동기재: ${st.prefillRoster ? 'ON' : 'OFF'})`);
        });
      }
      function bindText() { const c = container.querySelector('#txp'); if (c) c.addEventListener('change', () => { st.textPii = c.checked; }); }
      function bindX() {
        container.querySelectorAll('[data-xp]').forEach((c) => c.addEventListener('change', () => { c.checked ? st.extra.add(+c.dataset.xp) : st.extra.delete(+c.dataset.xp); container.querySelector('#xres').innerHTML = excelHtml(); bindX(); }));
      }
      function bind2() {
        container.querySelectorAll('[data-fp]').forEach((c) => c.addEventListener('change', () => { st.files[+c.dataset.fp].pii = c.checked; }));
        container.querySelectorAll('[data-frm]').forEach((b) => b.addEventListener('click', () => { st.files.splice(+b.dataset.frm, 1); container.querySelector('#fres').innerHTML = filesHtml(); bind2(); }));
      }

      async function onExcel(file) {
        if (file.size > MAX_FILE) return U.toast('파일이 너무 큽니다 (100MB 이하).', 'bad');
        if (!['xlsx', 'xls', 'csv'].includes(ext(file.name))) return U.toast('엑셀(xlsx, xls) 또는 csv 파일만 가능합니다.', 'bad');
        let wb;
        try { wb = Excel.read(await U.readFile(file)); } catch (e) { return U.toast('엑셀 파일을 읽을 수 없습니다.', 'bad'); }
        const v = Excel.validate(wb, req.columns);
        if (v.rows.length > Store.MAX_ROWS) { v.errors.push({ row: 0, col: '', msg: `프로토타입은 ${Store.MAX_ROWS}행까지 지원합니다. (${v.rows.length}행)` }); }
        v.pii = PII.scanRows(v.header, v.rows, piiCols);
        st.excel = v; st.excelName = file.name; st.extra = new Set(Object.keys(v.pii).map(Number));
        container.querySelector('#xres').innerHTML = excelHtml();
        bindX();
      }

      async function onFiles(list) {
        for (const f of list) {
          const e = ext(f.name);
          if (!ALLOWED.includes(e)) { U.toast(`${f.name}: 허용되지 않는 형식입니다.`, 'bad'); continue; }
          if (f.size > MAX_FILE) { U.toast(`${f.name}: 100MB를 초과했습니다.`, 'bad'); continue; }
          const bytes = await U.readFile(f);
          const findings = await scanFile(f.name, bytes);
          const forced = !!(findings && findings.length);
          st.files.push({ name: f.name, size: f.size, bytes, pii: forced || /명단|주민|개인|연락처|환자/.test(f.name), forced, findings: findings || [], scannable: findings !== null });
        }
        container.querySelector('#fres').innerHTML = filesHtml();
        bind2();
      }

      async function submit() {
        if (st.busy) return;
        const hasX = !!(st.excel && !st.excel.missing.length && st.excel.rows.length);
        if (hasTemplate && !hasX) return U.toast('엑셀 서식 제출이 필요합니다 (누락된 컬럼이 없어야 합니다).', 'warn');
        const hasText = req.kinds.text && st.text.trim();
        if (!hasX && !hasText && !st.files.length) return U.toast('제출할 내용이 없습니다.', 'warn');
        if (!st.agree) return U.toast('개인정보 확인 항목에 체크해 주세요.', 'warn');
        st.busy = true; container.querySelector('#go').disabled = true; container.querySelector('#go').textContent = '암호화 저장 중…';
        try {
          const v = { text: '', textToken: null, files: [], header: [], rows: [], maskedRows: [], piiCols: [], piiCount: 0, warnings: [] };
          const meta = { req: req.id };
          if (hasX) {
            const ex = st.excel;
            const pc = new Set([...piiCols, ...st.extra]);
            v.header = ex.header.slice();
            v.piiCols = [...pc].map((i) => ex.header[i]);
            v.warnings = ex.warnings.slice();
            for (const r of ex.rows) {
              const row = r.slice(), mrow = r.slice();
              await Promise.all([...pc].map(async (c) => {
                if (r[c] === '' || r[c] == null) return;
                row[c] = await Vault.putText(r[c], { ...meta, col: ex.header[c] });
                mrow[c] = PII.maskValue(r[c]);
                v.piiCount++;
              }));
              v.rows.push(row); v.maskedRows.push(mrow);
            }
          }
          if (hasText) {
            if (st.textPii || PII.scan(st.text).length) {
              v.textToken = await Vault.putText(st.text, meta);
              v.text = PII.redact(st.text) || '';
              if (v.text === st.text) v.text = '(개인정보 포함 표시 — 본문은 암호화 분리 보관)';
              v.piiCount++;
            } else v.text = st.text;
          }
          for (const f of st.files) {
            const store = f.pii || f.forced ? 'vault' : 'main';
            const ref = store === 'vault' ? await Vault.putFile(f.bytes, { ...meta, name: f.name }) : await Files.putFile(f.bytes, { ...meta, name: f.name });
            if (store === 'vault') v.piiCount++;
            v.files.push({ name: f.name, size: f.size, store, ref, findings: f.forced ? PII.summarize(f.findings) : '' });
          }
          const byName = opts.byName || `${Store.user().name}(${Org.name(Store.user().orgId)})`;
          Store.saveSubmission(req, target, v, byName);
          U.toast('제출되었습니다.', 'ok');
        } catch (e) {
          console.error(e);
          U.toast('제출 중 오류가 발생했습니다: ' + e.message, 'bad');
          st.busy = false;
          render();
          return;
        }
        if (opts.onDone) opts.onDone(); else render();
      }

      render();
    },

    /** 소방서 담당자: 하위 재요청 취합본을 상위 요청에 제출 (토큰은 그대로 유지: 개인정보 재복제 없음) */
    async submitMerged(child) {
      const parent = Store.request(child.parentId);
      const user = Store.user();
      const target = parent && Store.myTarget(parent, user);
      if (!target) return U.toast('상위 요청의 제출 대상이 아닙니다.', 'bad');
      const subs = child.targets.map((t) => Store.sub(child.id, t.id)).filter((s) => s && s.status === 'approved');
      if (!subs.length) return U.toast('승인된 하위 제출이 없습니다.', 'warn');
      const header = parent.columns.map((c) => c.name);
      const v = { text: `하위 ${subs.length}개 조직 제출분 취합`, textToken: null, files: [], header, rows: [], maskedRows: [], piiCols: parent.columns.filter((c) => c.pii).map((c) => c.name), piiCount: 0, warnings: [`하위 재요청 "${child.title}" 승인분 ${subs.length}/${child.targets.length}건 취합`] };
      subs.forEach((s) => {
        const lv = Store.lastVersion(s);
        (lv.rows || []).forEach((r, i) => { v.rows.push(r); v.maskedRows.push(lv.maskedRows[i]); });
        v.piiCount += lv.piiCount || 0;
      });
      if (!v.rows.length && !parent.kinds.text) return U.toast('취합할 엑셀 데이터가 없습니다.', 'warn');
      Store.saveSubmission(parent, target, v, `${user.name}(${Org.name(user.orgId)}) 취합 제출`);
      U.toast('상위 요청에 취합본을 제출했습니다.', 'ok');
    },
  };

  g.SubmitUI = SubmitUI;
})(window);
