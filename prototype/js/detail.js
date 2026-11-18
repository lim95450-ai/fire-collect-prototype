/* 요청 상세: 제출 현황 · 검토(승인/반려) · 독촉 · 엑셀 취합 · 공문서 작성 · 파기 */
(function (g) {
  const $ = (s, r) => (r || document).querySelector(s);
  const KIND = { text: '텍스트', file: '파일', excel: '엑셀 서식' };
  const safeName = (s) => String(s).replace(/[\\/:*?"<>|]/g, '_').slice(0, 80);
  let filter = 'all', query = '';

  const badge = (req, st) => {
    if (Store.isOverdue(req, st)) return `<span class="badge b-overdue">기한 초과${st === 'rejected' ? '(반려)' : ''}</span>`;
    return `<span class="badge b-${st}">${Store.STATUS_LABEL[st]}</span>`;
  };
  const userOf = (id) => USERS.find((u) => u.id === id);

  function progBar(c) {
    const t = c.total || 1;
    return `<div class="prog" title="승인 ${c.approved} / 검토대기 ${c.submitted} / 반려 ${c.rejected} / 미제출 ${c.none}"><i class="p-approved" style="width:${c.approved / t * 100}%"></i><i class="p-submitted" style="width:${c.submitted / t * 100}%"></i><i class="p-rejected" style="width:${c.rejected / t * 100}%"></i></div>`;
  }

  // ---------- 하위 재요청 집계 ----------
  function childRollup(req, t) {
    const kids = Store.children(req).filter((c) => c.createdOrgId === t.id);
    if (!kids.length) return '';
    return `<div class="small mut">↳ 하위 재요청 ${kids.map((k) => { const p = Store.progress(k, k.targets); return `<a href="#/r/${k.id}">${U.esc(k.title)} (${p.done}/${p.total}곳 제출)</a>`; }).join(', ')}</div>`;
  }

  const Detail = {
    render(view, id) {
      const req = Store.request(id);
      if (!req) { view.innerHTML = '<div class="card">요청을 찾을 수 없습니다. <a href="#/">목록으로</a></div>'; return; }
      const user = Store.user();
      const owner = Store.isOwner(req, user);
      const auditor = user.role === 'auditor';
      const targets = Store.visibleTargets(req, user);
      const myT = auditor ? null : Store.myTarget(req, user);
      if (!owner && !auditor && !myT && !targets.length) {
        view.innerHTML = `<div class="card"><div class="alert bad">🔒 <b>접근 권한 제한 (센터별 정보 분리 보호)</b><br>본인 소속 센터(${U.esc(Org.name(user.orgId))})가 제출 대상인 요청만 열람 및 서식 다운로드가 가능합니다. 타 센터 대상 자료에는 접근할 수 없습니다.</div><a class="btn" href="#/">← 대시보드로 돌아가기</a></div>`;
        return;
      }
      const prog = Store.progress(req, targets);
      const creator = userOf(req.createdBy);
      const parent = req.parentId ? Store.request(req.parentId) : null;
      const showTable = owner || auditor || user.role === 'station' || (targets.length > 0 && !(targets.length === 1 && myT));
      filter = 'all'; query = '';

      const pending = targets.filter((t) => t.kind === 'org' && ['none', 'rejected'].includes(Store.statusOf(req.id, t.id)));
      const btns = [];
      if (owner && req.status === 'open') {
        btns.push(`<button class="btn" id="b-remind" ${pending.length ? '' : 'disabled'}>미제출·반려 독촉 (${pending.length})</button>`);
      }
      if (owner) {
        btns.push(`<button class="btn primary" id="b-export" style="font-weight:600">파일(엑셀) 취합</button>`);
        if (req.kinds.excel) btns.push(`<button class="btn" id="b-export-orig" title="마스킹 없이 성명·생년월일·연락처 원본 그대로 1클릭 병합 다운로드">원본 바로 취합(.xlsx)</button>`);
        if (req.kinds.excel) btns.push(`<button class="btn" id="b-export-xlsx-multi" title="체크박스로 선택한 기관의 제출 엑셀을 개별 파일로 내려받습니다">제출 엑셀 선택 다운로드</button>`);
        if (req.kinds.file) btns.push(`<button class="btn" id="b-export-zip" title="체크박스로 선택한 첨부파일을 개별 파일로 내려받습니다">첨부파일 선택 다운로드</button>`);
      }
      if (owner || myT) {
        btns.push(`<button class="btn" id="b-doc">공문서 작성</button>`);
      }
      if (!owner && myT && req.status === 'open' && !req.purged && (user.role === 'station' || user.role === 'hq')) {
        btns.push(`<a class="btn" href="#/new?from=${req.id}">하위 재요청</a>`);
      }
      if (owner && parent && !req.purged) btns.push(`<button class="btn" id="b-merge-up">승인분 취합하여 상위 요청에 제출</button>`);
      if (owner && !req.purged) btns.push(`<button class="btn danger" id="b-purge" title="보관기간 경과 시 자동 파기 대상 — 시연용 수동 파기">자료 파기</button>`);

      const kids = Store.children(req).filter((k) => Store.isOwner(k, user) || owner);
      const myKids = !owner && myT ? Store.state.requests.filter((k) => k.parentId === req.id && Store.isOwner(k, user)) : [];

      view.innerHTML = `
        <div class="page-h"><div><a href="#/" class="small">← 목록</a>
          <h1>${U.esc(req.title)} ${req.purged ? '<span class="badge b-none">파기됨</span>' : ''}</h1>
          <div class="mut">${U.esc(Org.name(req.createdOrgId))}${creator ? ' · ' + U.esc(creator.name) : ''} 요청 · ${U.fmtD(req.createdAt)}${parent ? ` · <a href="#/r/${parent.id}">상위 요청: ${U.esc(parent.title)}</a>` : ''}</div></div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">${btns.join('')}</div></div>

        <div class="card"><div class="row">
          <dl class="kv grow">
            <dt>마감</dt><dd><b>${U.fmtD(req.deadline)}</b> <span class="badge ${U.dday(req.deadline) < 0 ? 'b-overdue' : U.dday(req.deadline) <= 3 ? 'b-warn' : 'b-info'}">${U.ddayLabel(req.deadline)}</span></dd>
            <dt>제출 방식</dt><dd>${Object.keys(KIND).filter((k) => req.kinds[k]).map((k) => `<span class="tag">${KIND[k]}</span>`).join(' ')}</dd>
            <dt>보관기간</dt><dd>마감 후 ${req.retentionDays}일 (${U.fmtD(req.deadline + req.retentionDays * 86400000)}까지, 경과 시 자동 파기)</dd>
            <dt>알림 채널</dt><dd>시스템 알림${req.channels.app ? ' · 소방 모바일 어플 푸시' : ''}${req.channels.sms ? ' · 문자/내부메신저' : ''}</dd>
          </dl>
          <div class="grow"><b class="small mut">요청 내용</b><div style="white-space:pre-wrap">${U.esc(req.desc) || '<span class="mut">-</span>'}</div></div>
        </div></div>

        ${req.columns.length ? `<div class="card">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;flex-wrap:wrap;gap:8px">
            <h2 style="margin:0">필요한 자료 항목 <span class="mut small">(서식 컬럼 · 예시 데이터)</span></h2>
            <div style="display:flex;gap:6px;flex-wrap:wrap">
              ${owner && targets.filter((t) => t.kind === 'org').length > 1 ? `<button class="btn sm primary" id="b-dl-all-center-tpl" title="각 센터별 인원명부(계급·성명·생년월일·임용일자·연락처)가 미리 작성된 엑셀 서식을 전 센터별로 분리 생성합니다. 체크박스(전체 선택 가능)로 고른 센터만 개별 파일로 내려받습니다">📥 센터별 사전기재 서식 선택 다운로드</button>` : ''}
              <button class="btn sm" id="b-dl-base-tpl">${!owner && myT ? `📥 ${U.esc(Org.name(myT.id))} 전용 서식 다운로드(.xlsx)` : '서식 파일 다운로드(.xlsx)'}</button>
            </div>
          </div>
          <div class="grid-wrap"><table><thead><tr>${req.columns.map((c) => `<th>${U.esc(c.name)} ${c.pii ? '<span class="badge b-pii">개인정보</span>' : ''}<div class="small mut" style="font-weight:400">${c.required ? '필수 입력' : '선택 입력'}</div></th>`).join('')}</tr></thead>
          <tbody><tr class="dummy-row">${req.columns.map((c) => `<td><span>${U.esc(c.examples[0])}</span></td>`).join('')}</tr><tr class="dummy-row">${req.columns.map((c) => `<td><span>${U.esc(c.examples[1])}</span></td>`).join('')}</tr></tbody></table></div>
          <div class="hint">회색 이탤릭체 행은 입력 참고용 예시입니다. 서식 다운로드 시 각 센터별 기존 보유 인원정보(기관·소속·계급·성명·생년월일·임용일자·연락처)가 미리 작성되어 제공되므로 작성자는 필요한 빈 칸만 입력하면 됩니다.</div></div>` : ''}

        ${myT ? `<div class="card" id="mysub-card"><h2>내 제출 <span class="mut small">— ${U.esc(Store.targetName(myT))}</span></h2><div id="mysub"></div>
          ${myKids.length ? `<div class="alert info small" style="margin-top:10px">하위 재요청: ${myKids.map((k) => `<a href="#/r/${k.id}">${U.esc(k.title)}</a>`).join(', ')}</div>` : (user.role === 'station' && req.status === 'open' ? '<div class="hint">직접 제출하거나, [하위 재요청]으로 관할 센터/팀에서 자료를 받아 취합한 뒤 제출할 수 있습니다.</div>' : '')}
        </div>` : ''}

        ${auditor ? '<div class="alert info">보안담당자는 <b>메타정보(제출 현황)만</b> 조회할 수 있고 제출 자료 내용은 열람할 수 없습니다. (직무 분리)</div>' : ''}

        ${showTable ? `<div class="card"><h2>제출 현황 <span class="mut small">${owner ? '(요청 대상 전체)' : '(관할 조직만 표시)'}</span></h2>
          <div class="row" style="align-items:center;margin-bottom:10px"><div class="grow">${progBar(prog)}<div class="small mut" style="margin-top:4px">제출 ${prog.done}/${prog.total} · 승인 ${prog.approved} · 검토대기 ${prog.submitted} · 반려 ${prog.rejected} · 미제출 ${prog.none}</div></div>
          <input type="text" id="q" placeholder="조직 검색" style="width:180px"></div>
          <div class="chips" id="chips">${[['all', '전체'], ['none', '미제출'], ['submitted', '검토 대기'], ['approved', '승인'], ['rejected', '반려'], ['overdue', '기한 초과']].map(([k, l]) => `<button class="chip ${k === 'all' ? 'on' : ''}" data-f="${k}">${l}</button>`).join('')}</div>
          <div class="tbl-wrap"><table><thead><tr><th>조직 / 대상</th><th>상태</th><th>제출 내용</th><th>작업</th></tr></thead><tbody id="rows"></tbody></table></div></div>` : ''}

        ${kids.length && owner ? `<div class="card"><h2>하위 재요청</h2>${kids.map((k) => { const p = Store.progress(k, k.targets); return `<div class="file-row"><a href="#/r/${k.id}"><b>${U.esc(k.title)}</b></a> <span class="small mut">${U.esc(Org.name(k.createdOrgId))} · 제출 ${p.done}/${p.total}</span></div>`; }).join('')}</div>` : ''}`;

      if (myT) {
        SubmitUI.mount($('#mysub'), req, myT, { onDone: () => this.render(view, id) });
      }
      if (showTable) this.bindTable(view, req, targets, owner, auditor);
      const on = (sel, fn) => { const e = $(sel); if (e) e.addEventListener('click', fn); };
      on('#b-remind', async () => {
        if (await U.confirm(`미제출·반려 ${pending.length}개 조직에 독촉 알림을 보냅니다.\n(선택한 외부 채널에는 건명·마감일·링크만 전송)`, '독촉 보내기')) {
          Store.remind(req, pending); U.toast('독촉 알림을 보냈습니다.', 'ok');
        }
      });
      on('#b-export', () => this.exportModal(req));
      on('#b-export-orig', async () => {
        const reason = await this.askExportReason(req);
        if (reason === null) return;
        const r = await this.buildExport(req, 'all', true);
        if (!r.count) return U.toast('취합할 제출 데이터가 없습니다.', 'warn');
        U.download(new Blob([await Excel.reportBytes(r.sheets)]), `${safeName(req.title)}_취합(원본).xlsx`);
        Store.log('export.original', req.title, `${r.count}개 조직, ${r.rowCount}행${reason ? ` / 사유: ${reason}` : ''}`);
        U.toast(`${r.count}개 조직 · ${r.rowCount}행 원본 그대로 취합 완료`, 'ok');
      });
      on('#b-export-zip', () => this.pickAttachments(req));
      on('#b-export-xlsx-multi', () => this.pickExcels(req, owner));
      on('#b-doc', () => this.docModal(req));
      on('#b-dl-base-tpl', async () => {
        const sampleTarget = myT || (owner ? null : (targets.length ? targets[0] : null));
        const rawNm = sampleTarget && sampleTarget.id ? Org.name(sampleTarget.id) : '';
        const orgShort = rawNm ? U.orgShort(rawNm) : '';
        const prefix = orgShort ? `(${orgShort})` : '';
        const bytes = Excel.templateBytes ? await Excel.templateBytes(req, sampleTarget) : Excel.toBytes(Excel.buildTemplate(req, sampleTarget));
        U.download(bytes, `${prefix}${req.title}_서식.xlsx`, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        Store.log('template.download', req.title, `${rawNm || '표준'} 서식 다운로드`);
      });
      on('#b-dl-all-center-tpl', () => this.pickTemplates(req, targets));
      on('#b-merge-up', async () => {
        const subs = req.targets.map((t) => Store.sub(req.id, t.id)).filter((s) => s && s.status === 'approved');
        if (subs.length < req.targets.length && !(await U.confirm(`승인된 하위 제출이 ${subs.length}/${req.targets.length}곳입니다. 승인분만 취합하여 상위 요청에 제출할까요?`, '제출'))) return;
        await SubmitUI.submitMerged(req);
        this.render(view, id);
      });
      on('#b-purge', async () => {
        if (!(await U.confirm('이 요청의 제출 자료(일반 저장소 + 개인정보 Vault)를 모두 삭제합니다. 되돌릴 수 없습니다.\n(메타정보와 감사 로그는 남습니다)', '파기'))) return;
        const n = await Store.purge(req);
        U.toast(`${n}건 파기 완료`, 'ok');
        this.render(view, id);
      });
    },

    bindTable(view, req, targets, owner, auditor) {
      const sorted = targets.slice().sort((a, b) => {
        const ia = a.kind === 'org' ? Org.all.indexOf(Org.node(a.id)) : 99999;
        const ib = b.kind === 'org' ? Org.all.indexOf(Org.node(b.id)) : 99999;
        return ia - ib;
      });
      const rows = () => {
        let lastG = null, h = '';
        const q = query.trim();
        sorted.forEach((t) => {
          const st = Store.statusOf(req.id, t.id);
          const over = Store.isOverdue(req, st);
          if (filter === 'overdue' ? !over : filter !== 'all' && st !== filter) return;
          const name = Store.targetName(t);
          if (q && !name.includes(q)) return;
          if (t.kind === 'org') {
            const g = Org.level2Of(t.id);
            if (g && g !== t.id && g !== lastG && req.targetMode === 'level3') { h += `<tr class="sub-h"><td colspan="4">${U.esc(Org.name(g))}</td></tr>`; lastG = g; }
          }
          const sub = Store.sub(req.id, t.id);
          const lv = Store.lastVersion(sub);
          const acts = [];
          if (sub && !auditor) {
            acts.push(`<button class="btn sm" data-view="${t.id}">보기${owner && st === 'submitted' ? '·검토' : ''}</button>`);
            if (lv && lv.rows && lv.rows.length) {
              acts.push(`<button class="btn sm" data-dlx="${t.id}" title="제출 엑셀 다운로드">엑셀 다운로드</button>`);
            }
            if (lv && lv.files && lv.files.length) {
              lv.files.forEach((f, fi) => {
                acts.push(`<button class="btn sm" data-dlf="${t.id}:${fi}" title="${U.esc(f.name)} 직접 다운로드">${U.esc(f.name.length > 9 ? f.name.slice(0, 8) + '…' : f.name)}</button>`);
              });
            }
          }
          if (owner && t.kind === 'org' && ['none', 'rejected'].includes(st) && req.status === 'open' && !req.purged) acts.push(`<button class="btn sm" data-rem="${t.id}">독촉</button>`);
          if (owner && t.kind === 'person' && !t.used) acts.push(`<button class="btn sm" data-link="${t.id}">1회용 링크 복사</button>`);
          h += `<tr><td>${t.kind === 'person' ? '👤 ' : ''}${U.esc(name)}${t.kind === 'person' ? `<div class="small mut">${U.esc(t.contact || '')}${t.used ? ' · 링크 사용됨' : ' · 링크 만료 ' + U.fmtD(t.expires)}</div>` : ''}${t.kind === 'org' ? childRollup(req, t) : ''}</td>
            <td>${badge(req, st)}${lv && lv.no > 1 ? ` <span class="badge b-info">v${lv.no}</span>` : ''}</td>
            <td class="small">${lv ? `${U.fmt(lv.at)}<div class="mut">${U.esc(SubmitUI.describe(lv))}</div>` : '<span class="mut">-</span>'}</td>
            <td>${acts.join(' ')}</td></tr>`;
        });
        $('#rows').innerHTML = h || '<tr><td colspan="4" class="mut" style="text-align:center;padding:20px">해당하는 항목이 없습니다.</td></tr>';
        $('#rows').querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => this.openSubmission(view, req, targets.find((t) => t.id === b.dataset.view), owner)));
        $('#rows').querySelectorAll('[data-rem]').forEach((b) => b.addEventListener('click', () => { Store.remind(req, [targets.find((t) => t.id === b.dataset.rem)]); U.toast('독촉 알림을 보냈습니다.', 'ok'); }));
        $('#rows').querySelectorAll('[data-link]').forEach((b) => b.addEventListener('click', async () => {
          const t = targets.find((x) => x.id === b.dataset.link);
          const link = `${location.href.split('#')[0]}#/p/${t.token}`;
          try { await navigator.clipboard.writeText(link); U.toast('링크를 복사했습니다. (1회용, 기한 제한)', 'ok'); } catch (e) { U.modal('1회용 제출 링크', `<p class="mono">${U.esc(link)}</p>`); }
        }));
        // 제출 엑셀 개별 직접 다운로드 (소유자가 개인정보 원본을 받을 때는 사유 입력 필수)
        $('#rows').querySelectorAll('[data-dlx]').forEach((b) => b.addEventListener('click', async () => {
          const t = targets.find((x) => x.id === b.dataset.dlx);
          const v = Store.lastVersion(Store.sub(req.id, t.id));
          if (!v || !v.rows) return;
          const rawNm = t.kind === 'person' ? t.name : Org.name(t.id);
          const r = await this.askRestore(v, owner, rawNm);
          if (!r) return;
          U.download(new Blob([await Excel.reportBytes([this.oneSheet(req, rawNm, v, r)])]), `(${U.orgShort(rawNm)})${req.title}_제출자료.xlsx`);
          Store.log(r.reason ? 'pii.restore' : 'submission.download_excel', req.title, `${rawNm} 제출 엑셀 직접 다운로드${r.reason ? ' / 사유: ' + r.reason : ''}`);
        }));
        // 제출 첨부파일 개별 직접 다운로드
        $('#rows').querySelectorAll('[data-dlf]').forEach((b) => b.addEventListener('click', async () => {
          const [tid, fi] = b.dataset.dlf.split(':');
          const t = targets.find((x) => x.id === tid);
          const s = Store.sub(req.id, t.id);
          const v = Store.lastVersion(s);
          if (v && v.files && v.files[+fi]) await this.download(req, t, v, +fi);
        }));
      };
      rows();
      $('#chips').querySelectorAll('.chip').forEach((c) => c.addEventListener('click', () => {
        filter = c.dataset.f;
        $('#chips').querySelectorAll('.chip').forEach((x) => x.classList.toggle('on', x === c));
        rows();
      }));
      $('#q').addEventListener('input', (e) => { query = e.target.value; rows(); });
    },

    // ---------- 제출물 보기 / 검토 ----------
    openSubmission(view, req, target, owner) {
      const sub = Store.sub(req.id, target.id);
      if (!sub) return;
      let vno = sub.versions.length;
      const m = U.modal(`${Store.targetName(target)} — 제출 내용`, '<div id="sv"></div>', { wide: true, buttons: [{ label: '닫기' }] });
      const foot = m.el.querySelector('.modal-f');
      const closeBtn = foot.firstChild;

      const draw = () => {
        const v = sub.versions[vno - 1];
        const piiSet = new Set(v.piiCols || []);
        const canOrig = owner;
        let h = `<div class="row" style="align-items:center;margin-bottom:8px">
          <div>${badge(req, sub.status)} <span class="small mut">제출자 ${U.esc(v.byName)} · ${U.fmt(v.at)}</span></div>
          ${sub.versions.length > 1 ? `<label class="small right">버전 <select id="vsel">${sub.versions.map((x) => `<option value="${x.no}" ${x.no === vno ? 'selected' : ''}>v${x.no} (${U.fmt(x.at)})</option>`).join('')}</select></label>` : ''}</div>`;
        if (v.purged) h += '<div class="alert info">파기된 자료입니다.</div>';
        if (v.warnings && v.warnings.length) h += `<div class="alert warn small"><ul>${v.warnings.map((w) => `<li>${typeof w === 'string' ? U.esc(w) : `${w.row ? w.row + '행 ' : ''}${w.col ? '[' + U.esc(w.col) + '] ' : ''}${U.esc(w.msg)}`}</li>`).join('')}</ul></div>`;
        if (v.text || v.textToken) {
          h += `<h3>텍스트</h3><div class="card" style="padding:10px 14px;white-space:pre-wrap">${U.esc(v.text)}</div>${v.textToken ? `<div class="small"><span class="badge b-pii">🔒 원문은 암호화 분리 보관</span> ${canOrig ? '<button class="btn sm" id="un-text">원문 확인(사유 입력)</button>' : '<span class="mut">열람 권한 없음(요청 조직만 가능)</span>'}</div>` : ''}`;
        }
        if (v.files && v.files.length) {
          h += `<h3 style="margin-top:12px">첨부 파일 (${v.files.length}개)</h3>${v.files.map((f, i) => `<div class="file-row"><b>${U.esc(f.name)}</b> <span class="mut small">${U.size(f.size)}</span>
            ${f.store === 'vault' ? `<span class="badge b-pii">🔒 개인정보 Vault 저장${f.findings ? ' · ' + U.esc(f.findings) : ''}</span>` : '<span class="badge b-info">일반 저장소</span>'}
            ${f.ref ? (f.store === 'vault' && !canOrig ? '<span class="mut small">다운로드 권한 없음</span>' : `<button class="btn sm" data-dl="${i}">📥 다운로드${f.store === 'vault' ? '(사유 입력)' : ''}</button>`) : ''}</div>`).join('')}`;
        }
        if (v.rows && v.rows.length) {
          h += `<div style="display:flex;justify-content:space-between;align-items:center;margin-top:12px">
            <h3 style="margin:0">엑셀 제출 데이터 <span class="mut small">${v.rows.length}행 · 개인정보 컬럼은 마스킹 표시</span></h3>
            <button class="btn sm" id="m-dl-excel">📥 제출 엑셀 다운로드</button>
          </div>
            <div class="tbl-wrap" style="max-height:300px;overflow:auto;margin-top:8px"><table><thead><tr><th>#</th>${v.header.map((c) => `<th>${U.esc(c)}${piiSet.has(c) ? ' 🔒' : ''}</th>`).join('')}</tr></thead>
            <tbody id="xrows">${v.maskedRows.slice(0, 100).map((r, ri) => `<tr><td class="mut">${ri + 1}</td>${r.map((c, ci) => `<td class="${piiSet.has(v.header[ci]) ? 'pii-cell' : ''}">${U.esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
            ${v.rows.length > 100 ? '<div class="hint">처음 100행만 표시됩니다.</div>' : ''}
            ${v.piiCount ? `<div style="margin-top:6px">${canOrig ? '<button class="btn sm" id="un-rows">개인정보 원본 확인(사유 입력)</button>' : '<span class="small mut">개인정보 원본은 요청 조직의 담당자만 사유 입력 후 열람할 수 있습니다.</span>'}</div>` : ''}`;
        }
        if (sub.reviews.length) h += `<h3 style="margin-top:12px">검토 이력</h3>${sub.reviews.map((r) => `<div class="small"><span class="badge b-${r.result}">${Store.STATUS_LABEL[r.result]}</span> v${r.versionNo} · ${U.esc(r.byName)} · ${U.fmt(r.at)}${r.reason ? ' — ' + U.esc(r.reason) : ''}</div>`).join('')}`;
        $('#sv', m.el).innerHTML = h;

        const vs = $('#vsel', m.el);
        if (vs) vs.addEventListener('change', () => { vno = +vs.value; draw(); });
        m.el.querySelectorAll('[data-dl]').forEach((b) => b.addEventListener('click', () => this.download(req, target, v, +b.dataset.dl)));
        const mdx = $('#m-dl-excel', m.el);
        if (mdx) mdx.addEventListener('click', async () => {
          const rawNm = target.kind === 'person' ? target.name : Org.name(target.id);
          const r = await this.askRestore(v, owner, rawNm);
          if (!r) return;
          U.download(new Blob([await Excel.reportBytes([this.oneSheet(req, rawNm, v, r)])]), `(${U.orgShort(rawNm)})${req.title}_제출자료.xlsx`);
          Store.log(r.reason ? 'pii.restore' : 'submission.download_excel', req.title, `${rawNm} 제출 엑셀 다운로드 (${r.rows.length}행)${r.reason ? ' / 사유: ' + r.reason : ''}`);
        });
        const ut = $('#un-text', m.el);
        if (ut) ut.addEventListener('click', async () => {
          const reason = await U.prompt('원문 열람 사유', '열람 사유를 입력하세요', { note: '열람 사실과 사유가 감사 로그에 기록됩니다.' });
          if (!reason) return;
          const t = await Vault.getText(v.textToken);
          Store.log('pii.restore', req.title, `${Store.targetName(target)} 텍스트 원문 열람 / 사유: ${reason}`);
          U.modal('텍스트 원문 (개인정보 포함)', `<div class="alert warn small">열람 이력이 기록되었습니다.</div><div style="white-space:pre-wrap">${U.esc(t)}</div>`);
        });
        const ur = $('#un-rows', m.el);
        if (ur) ur.addEventListener('click', async () => {
          const reason = await U.prompt('개인정보 원본 열람 사유', '열람 사유를 입력하세요', { note: '열람 사실과 사유가 감사 로그에 기록됩니다.' });
          if (!reason) return;
          const rows = await Promise.all(v.rows.slice(0, 100).map((r) => Promise.all(r.map((c) => (Vault.isToken(c) ? Vault.getText(c) : c)))));
          Store.log('pii.restore', req.title, `${Store.targetName(target)} v${v.no} 개인정보 ${v.piiCount}건 원본 열람(상위 100행) / 사유: ${reason}`);
          $('#xrows', m.el).innerHTML = rows.map((r, ri) => `<tr><td class="mut">${ri + 1}</td>${r.map((c, ci) => `<td class="${piiSet.has(v.header[ci]) ? 'pii-cell' : ''}">${U.esc(c)}</td>`).join('')}</tr>`).join('');
          ur.replaceWith(Object.assign(document.createElement('span'), { className: 'badge b-warn', textContent: '원본 표시 중 — 열람 이력 기록됨' }));
        });
      };
      draw();

      // [3] 반려와 승인 위치 서로 변경: 승인이 왼쪽(primary), 반려가 오른쪽(danger)
      if (owner && sub.status === 'submitted') {
        const mk = (label, cls, fn) => { const b = document.createElement('button'); b.className = 'btn ' + cls; b.textContent = label; b.onclick = fn; foot.insertBefore(b, closeBtn); };
        mk('승인', 'primary', () => { Store.review(req, target, 'approved'); m.close(); U.toast('승인했습니다.', 'ok'); this.render(view, req.id); });
        mk('반려', 'danger', async () => {
          const reason = await U.prompt('반려 사유', '제출자에게 전달할 반려 사유를 입력하세요', { placeholder: '예: 서식 내용 보완 필요' });
          if (!reason) return;
          Store.review(req, target, 'rejected', reason); m.close(); U.toast('반려했습니다.', 'warn'); this.render(view, req.id);
        });
      }
    },

    async download(req, target, v, i) {
      const f = v.files[i];
      let reason = '';
      if (f.store === 'vault') {
        reason = await U.prompt('개인정보 파일 다운로드 사유', '다운로드 사유를 입력하세요', { note: '다운로드 사실과 사유가 감사 로그에 기록됩니다.' });
        if (!reason) return;
      }
      const rec = await (f.store === 'vault' ? Vault : Files).get(f.ref);
      if (!rec) return U.toast('파일을 찾을 수 없습니다.', 'bad');
      Store.log(f.store === 'vault' ? 'pii.download' : 'file.download', req.title, `${Store.targetName(target)} / ${f.name}${reason ? ' / 사유: ' + reason : ''}`);
      U.download(new Blob([rec.bytes]), f.name);
    },

    // ---------- 파일(엑셀) 취합 ----------
    async exportModal(req) {
      const subs = Store.state.submissions.filter((s) => s.requestId === req.id && s.versions && s.versions.length && (s.versions[s.versions.length - 1].rows || []).length);
      const appSubs = subs.filter((s) => s.status === 'approved');
      const allSubs = subs.filter((s) => s.status === 'approved' || s.status === 'submitted');
      const appRows = appSubs.reduce((a, s) => a + s.versions[s.versions.length - 1].rows.length, 0);
      const allRows = allSubs.reduce((a, s) => a + s.versions[s.versions.length - 1].rows.length, 0);
      const withPii = req.columns.some((c) => c.pii) || Store.state.submissions.some((s) => s.requestId === req.id && s.versions.some((v) => v.piiCount));
      const previewRows = [];
      for (const s of allSubs) {
        const lv = s.versions[s.versions.length - 1];
        for (const r of (lv.maskedRows || lv.rows || [])) {
          if (previewRows.length < 8) previewRows.push(r.map((c) => String(c ?? '')));
        }
      }
      const isSeqCol0 = req.columns.length && /^(연번|순|순번|No)$/i.test(req.columns[0].name.trim());
      if (isSeqCol0) previewRows.forEach((r, idx) => { r[0] = String(idx + 1); });
      const previewHtml = previewRows.length ? `<div style="margin-top:12px"><div class="small" style="font-weight:700;margin-bottom:4px">취합 미리보기 — ${allSubs.length}개 기관 · 총 ${allRows}행 (상위 ${previewRows.length}행 · 개인정보 마스킹 미리보기)</div>
        <div class="tbl-wrap" style="max-height:210px"><table class="small"><thead><tr>${req.columns.map((c) => `<th>${U.esc(c.name)}</th>`).join('')}</tr></thead><tbody>
        ${previewRows.map((r) => `<tr>${req.columns.map((_, i) => `<td>${U.esc(r[i] || '')}</td>`).join('')}</tr>`).join('')}
        </tbody></table></div></div>` : '';
      const body = `<p class="small mut" style="margin-top:0">각 소방서·센터에서 제출한 엑셀 데이터를 <b>원본 서식 컬럼 그대로 하나의 파일로 자동 병합(취합)</b>합니다. (상단 제목·표 머리글은 1번만 유지되고 데이터 행만 깔끔하게 이어 붙여집니다.)</p>
        <div class="fld"><span>취합 대상</span>
          <label style="display:block"><input type="radio" name="inc" value="approved" ${appSubs.length ? 'checked' : ''}> 승인된 제출만 (${appSubs.length}곳 · ${appRows}행)</label>
          <label style="display:block"><input type="radio" name="inc" value="all" ${!appSubs.length ? 'checked' : ''}> 검토 대기 포함 전체 (${allSubs.length}곳 · ${allRows}행)</label>
          <label style="display:block;margin-top:6px"><input type="checkbox" name="withorg"> 맨 앞에 <b>제출기관 열</b> 추가 (어느 기관이 낸 행인지 구분)</label>
        </div>
        ${withPii ? `<div class="fld"><span>개인정보 표시 방식</span>
          <label style="display:block"><input type="radio" name="mk" value="masked" checked> <b>마스킹본</b> (공개·타부서 공유용 · 예: 홍*동, 010-****-1234)</label>
          <label style="display:block"><input type="radio" name="mk" value="orig"> <b>원본 그대로</b> (실무 보고·명단 등록용 · 성명·연락처·생년월일 전체 표시)</label>
        </div>` : ''}
        <div class="alert info small" style="margin-top:8px">💡 <b>서버 저장 없이 내 PC 폴더에서 바로 합치려면?</b> 좌측 메뉴의 <a href="#/vba" id="go-vba-link"><b>[VBA · 로컬 폴더 취합기]</b></a>에서 엑셀 VBA 매크로나 무서버 로컬 병합을 사용하실 수 있습니다.</div>
        ${previewHtml}`;
      const mdl = U.modal('파일(엑셀) 취합 다운로드', body, {
        wide: true,
        buttons: [
          { label: '취소' },
          {
            label: '원본 바로 취합(전체·마스킹없음)', cls: '', onClick: async () => {
              const reason = await this.askExportReason(req);
              if (reason === null) return false;
              const r = await this.buildExport(req, 'all', true);
              if (!r.count) { U.toast('취합할 제출 데이터가 없습니다.', 'warn'); return false; }
              U.download(new Blob([await Excel.reportBytes(r.sheets)]), `${safeName(req.title)}_취합(원본).xlsx`);
              Store.log('export.original', req.title, `${r.count}개 조직, ${r.rowCount}행${reason ? ` / 사유: ${reason}` : ''}`);
              U.toast(`${r.count}개 조직 · ${r.rowCount}행 원본 그대로 취합 완료`, 'ok');
            },
          },
          {
            label: '취합 다운로드', cls: 'primary', onClick: async (el) => {
              const inc = el.querySelector('[name=inc]:checked').value;
              const mk = el.querySelector('[name=mk]:checked');
              const unmask = !!(mk && mk.value === 'orig');
              let reason = '';
              if (unmask) {
                reason = await U.prompt('원본 복원 사유', '개인정보 원본이 포함된 파일을 내려받는 사유', { note: '이력이 감사 로그에 기록됩니다. 내려받은 파일은 보안 규정에 따라 관리해야 합니다.' });
                if (!reason) return false;
              }
              const withOrg = !!el.querySelector('[name=withorg]:checked');
              const r = await this.buildExport(req, inc, unmask, withOrg);
              if (!r.count) { U.toast('취합할 제출 데이터가 없습니다.', 'warn'); return false; }
              U.download(new Blob([await Excel.reportBytes(r.sheets)]), `${safeName(req.title)}_취합(${unmask ? '원본-개인정보포함' : '마스킹본'}).xlsx`);
              Store.log(unmask ? 'export.original' : 'export.masked', req.title, `${r.count}개 조직, ${r.rowCount}행${unmask ? ` / 사유: ${reason}` : ''}`);
              U.toast(`${r.count}개 조직 · ${r.rowCount}행 취합 완료`, 'ok');
            },
          },
        ],
      });
      const vbaLnk = mdl.el.querySelector('#go-vba-link');
      if (vbaLnk) vbaLnk.addEventListener('click', () => mdl.close());
    },

    // ---------- 개인정보 원본 접근 (사유 입력 필수) ----------
    hasPii(req) {
      return req.columns.some((c) => c.pii) || Store.state.submissions.some((x) => x.requestId === req.id && x.versions.some((v) => v.piiCount));
    },
    /** 개인정보가 있는 요청의 원본 취합 사유 입력. 개인정보가 없으면 '' , 취소하면 null */
    async askExportReason(req) {
      if (!this.hasPii(req)) return '';
      const reason = await U.prompt('원본 취합 사유', '개인정보 원본이 포함된 파일을 내려받는 사유', { note: '이력이 감사 로그에 기록됩니다. 내려받은 파일은 보안 규정에 따라 관리해야 합니다.' });
      return reason || null;
    },
    async restoreRows(v) {
      return Promise.all((v.rows || []).map((r) => Promise.all(r.map((c) => (Vault.isToken(c) ? Vault.getText(c) : c)))));
    },
    /** 제출 엑셀 다운로드용 행: 소유자는 개인정보가 있으면 사유 입력 후 원본, 그 외는 마스킹본. 취소하면 null */
    async askRestore(v, owner, who) {
      if (!owner) return { rows: v.maskedRows, reason: '' };
      const hasTok = (v.rows || []).some((r) => r.some((c) => Vault.isToken(c)));
      if (!hasTok) return { rows: v.rows, reason: '' };
      const reason = await U.prompt('개인정보 원본 다운로드 사유', `${who} 제출 엑셀에는 개인정보가 포함되어 있습니다. 다운로드 사유를 입력하세요.`, { note: '다운로드 사실과 사유가 감사 로그에 기록됩니다.' });
      if (!reason) return null;
      return { rows: await this.restoreRows(v), reason };
    },

    // ---------- 체크박스 선택 다운로드 (ZIP 대신 파일별 개별 다운로드) ----------
    pickDownload(title, intro, items, runLabel, run) {
      if (!items.length) return U.toast('내려받을 항목이 없습니다.', 'warn');
      const body = `<p class="small mut" style="margin-top:0">${intro}</p>
        <label class="ck" style="display:flex;gap:6px;align-items:center;margin-bottom:8px"><input type="checkbox" id="pk-all" checked> <b>전체 선택</b> <span class="mut small" id="pk-n"></span></label>
        <div class="tbl-wrap" style="max-height:340px;overflow:auto"><table><tbody>${items.map((it, i) => `<tr><td style="width:34px"><input type="checkbox" data-pk="${i}" checked aria-label="${U.esc(it.label)} 선택"></td><td>${U.esc(it.label)}${it.sub ? `<div class="small mut">${U.esc(it.sub)}</div>` : ''}</td></tr>`).join('')}</tbody></table></div>
        <div class="hint">선택한 항목이 파일별로 하나씩 내려받아집니다. 브라우저에서 '여러 파일 다운로드' 허용 확인이 나오면 허용해 주세요.</div>`;
      U.modal(title, body, {
        wide: true,
        buttons: [{ label: '취소' }, {
          label: runLabel, cls: 'primary', onClick: async (el) => {
            const picked = [...el.querySelectorAll('[data-pk]:checked')].map((c) => items[+c.dataset.pk]);
            if (!picked.length) { U.toast('다운로드할 항목을 선택하세요.', 'warn'); return false; }
            return run(picked);
          },
        }],
        onMount: (el) => {
          const boxes = () => [...el.querySelectorAll('[data-pk]')];
          const upd = () => {
            const n = boxes().filter((c) => c.checked).length;
            el.querySelector('#pk-n').textContent = `(${n}/${items.length}개 선택)`;
            el.querySelector('#pk-all').checked = n === items.length;
          };
          el.querySelector('#pk-all').addEventListener('change', (e) => { boxes().forEach((c) => { c.checked = e.target.checked; }); upd(); });
          boxes().forEach((c) => c.addEventListener('change', upd));
          upd();
        },
      });
    },

    pickTemplates(req, targets) {
      const items = targets.filter((t) => t.kind === 'org').map((t) => ({ label: Store.targetName(t), sub: `인원명부 ${Store.rosterOf(t.id).length}명 사전기재`, t }));
      this.pickDownload('센터별 사전기재 서식 다운로드', '내려받을 센터를 선택하세요. 각 파일에는 해당 센터 인원 정보만 들어 있습니다.', items, '선택 다운로드', async (picked) => {
        for (const it of picked) {
          const bytes = await Excel.templateBytes(req, it.t, { prefillRoster: true });
          U.download(bytes, `(${U.orgShort(Org.name(it.t.id))})${safeName(req.title)}_서식.xlsx`, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
          await U.sleep(400);
        }
        Store.log('template.download_all', req.title, `센터별 사전기재 서식 ${picked.length}곳 선택 다운로드`);
        U.toast(`${picked.length}곳의 사전기재 서식을 내려받았습니다.`, 'ok');
      });
    },

    pickAttachments(req) {
      const items = [];
      req.targets.forEach((t) => {
        const lv = Store.lastVersion(Store.sub(req.id, t.id));
        ((lv && lv.files) || []).forEach((f) => {
          if (f.ref) items.push({ label: `${Store.targetName(t)} — ${f.name}`, sub: `${U.size(f.size)} · ${f.store === 'vault' ? '🔒 개인정보 Vault (다운로드 시 사유 입력)' : '일반 저장소'}`, t, f });
        });
      });
      this.pickDownload('첨부파일 선택 다운로드', '내려받을 첨부파일을 선택하세요.', items, '선택 다운로드', async (picked) => {
        let reason = '';
        if (picked.some((p) => p.f.store === 'vault')) {
          reason = await U.prompt('개인정보 파일 다운로드 사유', '선택한 파일에 개인정보 Vault 파일이 포함되어 있습니다. 다운로드 사유를 입력하세요.', { note: '다운로드 사실과 사유가 감사 로그에 기록됩니다.' });
          if (!reason) return false;
        }
        let n = 0;
        for (const it of picked) {
          const rec = await (it.f.store === 'vault' ? Vault : Files).get(it.f.ref);
          if (!rec) continue;
          const nm = it.t.kind === 'person' ? it.t.name : Org.name(it.t.id);
          U.download(new Blob([rec.bytes]), `[${U.orgShort(nm)}]_${it.f.name}`);
          n++;
          await U.sleep(400);
        }
        Store.log(reason ? 'pii.download' : 'export.zip', req.title, `첨부파일 ${n}건 선택 다운로드${reason ? ' / 사유: ' + reason : ''}`);
        U.toast(`첨부파일 ${n}건을 내려받았습니다.`, 'ok');
      });
    },

    pickExcels(req, owner) {
      const items = [];
      req.targets.forEach((t) => {
        const sub = Store.sub(req.id, t.id);
        const lv = Store.lastVersion(sub);
        if (lv && lv.rows && lv.rows.length) items.push({ label: Store.targetName(t), sub: `${Store.STATUS_LABEL[sub.status]} · ${lv.rows.length}행 · v${lv.no}`, t, lv });
      });
      this.pickDownload('제출 엑셀 선택 다운로드', `내려받을 기관을 선택하세요. ${owner ? '개인정보가 포함된 경우 사유 입력 후 원본이 제공됩니다.' : '개인정보는 마스킹되어 제공됩니다.'}`, items, '선택 다운로드', async (picked) => {
        let reason = '';
        if (owner && picked.some((p) => p.lv.rows.some((r) => r.some((c) => Vault.isToken(c))))) {
          reason = await U.prompt('개인정보 원본 다운로드 사유', '선택한 제출 엑셀에 개인정보가 포함되어 있습니다. 다운로드 사유를 입력하세요.', { note: '다운로드 사실과 사유가 감사 로그에 기록됩니다.' });
          if (!reason) return false;
        }
        for (const it of picked) {
          const rows = owner ? await this.restoreRows(it.lv) : it.lv.maskedRows;
          const nm = it.t.kind === 'person' ? it.t.name : Org.name(it.t.id);
          U.download(new Blob([await Excel.reportBytes([this.oneSheet(req, nm, it.lv, { rows, reason })])]), `(${U.orgShort(nm)})${safeName(req.title)}_제출자료.xlsx`);
          await U.sleep(400);
        }
        Store.log(reason ? 'pii.restore' : 'export.xlsx_selected', req.title, `제출 엑셀 ${picked.length}곳 선택 다운로드${reason ? ' / 사유: ' + reason : ''}`);
        U.toast(`제출 엑셀 ${picked.length}곳을 내려받았습니다.`, 'ok');
      });
    },

    /** 개별 제출 1건용 보고서 시트 명세 */
    oneSheet(req, nm, v, r) {
      const piiLabel = r.reason ? '원본 (사유 기록됨)' : (v.piiCols && v.piiCols.length ? '마스킹' : '해당 없음');
      return {
        name: '제출자료', title: `${req.title} — ${nm} 제출 자료`,
        note: `제출일시 ${U.fmt(v.at)}  |  v${v.no}  |  ${r.rows.length}행  |  개인정보 ${piiLabel}`,
        header: v.header, rows: r.rows,
      };
    },

    async buildExport(req, include, unmask, withOrg) {
      const header = req.columns.map((c) => c.name);
      const items = [], status = [], texts = [];
      let rowCount = 0;
      const conv = (c, ci) => {
        const col = req.columns[ci];
        return col && col.type === 'number' && Excel.isNum(c) && c !== '' ? Number(String(c).replace(/,/g, '')) : c;
      };
      for (const t of req.targets) {
        const sub = Store.sub(req.id, t.id);
        const nm = Store.targetName(t);
        if (!sub) { status.push([nm, '미제출', '', '', '']); continue; }
        const lv = Store.lastVersion(sub);
        status.push([nm, Store.STATUS_LABEL[sub.status], U.fmt(lv.at), 'v' + lv.no, (lv.rows || []).length]);
        if (!(sub.status === 'approved' || (include === 'all' && sub.status === 'submitted'))) continue;
        if (lv.rows && lv.rows.length) {
          const rows = unmask ? await Promise.all(lv.rows.map((r) => Promise.all(r.map((c) => (Vault.isToken(c) ? Vault.getText(c) : c))))) : lv.maskedRows;
          items.push({ orgName: nm, rows: rows.map((r) => r.map(conv)) });
          rowCount += rows.length;
        }
        if (lv.text || lv.textToken) texts.push([nm, U.fmt(lv.at), (unmask && lv.textToken ? await Vault.getText(lv.textToken) : lv.text)]);
      }
      const p = Store.progress(req, req.targets);
      const sheets = [];
      if (items.length) {
        const aoa = Excel.merge(header, items, !!withOrg);
        const off = withOrg ? 1 : 0;
        if (header.length && /^(연번|순|순번|No)$/i.test(header[0].trim())) {
          for (let i = 1; i < aoa.length; i++) aoa[i][off] = i;
        }
        const groups = [];
        items.forEach((it, gi) => it.rows.forEach(() => groups.push(gi)));
        sheets.push({
          name: '취합', title: `${req.title} — 취합 결과`,
          note: `취합일시 ${U.fmt(Date.now())}  |  ${include === 'all' ? '검토 대기 포함' : '승인분만'} ${items.length}곳 취합 (전체 ${p.total}곳)  |  총 ${rowCount}행  |  개인정보 ${unmask ? '원본' : '마스킹'}`,
          header: aoa[0], rows: aoa.slice(1), groups,
        });
      }
      sheets.push({
        name: '제출현황', title: `${req.title} — 제출 현황`, freeze: false,
        info: [
          ['요청 기관', Org.name(req.createdOrgId)],
          ['마감', `${U.fmtD(req.deadline)} (${U.ddayLabel(req.deadline)})`],
          ['제출 현황', `전체 ${p.total}곳 중 제출 ${p.done}곳 — 승인 ${p.approved} · 검토 대기 ${p.submitted} · 반려 ${p.rejected} · 미제출 ${p.none}`],
        ],
        header: ['제출조직', '상태', '제출일시', '버전', '행수'], rows: status, statusCol: 1,
        statusStyle: (v) => ({ '승인': 'ok', '검토 대기': 'info', '반려': 'bad' }[v] || 'none'),
      });
      if (texts.length) sheets.push({ name: '텍스트 제출', title: `${req.title} — 텍스트 제출`, header: ['제출조직', '제출일시', '텍스트'], rows: texts, widths: [30, 18, 90] });
      return { sheets, count: items.length || texts.length, rowCount };
    },

    // ---------- 공문서 작성 ----------
    docModal(req) {
      const user = Store.user();
      const owner = Store.isOwner(req, user);
      const st = Store.state;
      const dd = st.docDefaults || {};
      const reqOrgNode = Org.node(req.createdOrgId);
      const myNode = Org.node(user.orgId);
      const myStId = Org.stationOf(user.orgId);
      const myStName = myStId ? Org.name(myStId).replace(/^부산/, '') : '';
      const myShort = (myNode ? myNode.name : '').replace(/119안전센터|안전센터|119구조대|구조대|소방서|119소방정대|소방정대/g, '').trim() || '신평';

      // 1) 센터·부서 결과 보고 양식 (실제 신평119안전센터 ODT 공문 예시와 동일한 문안)
      const centerPreset = {
        orgName: myStName && myNode && myNode.type === 'center' ? `${myStName}${myNode.name}` : '사하소방서신평119안전센터',
        receiver: myStName ? `부산광역시${myStName}장(${reqOrgNode ? reqOrgNode.name : '소방행정과'}장)` : (dd.receiver || ''),
        via: '',
        title: `(${myShort})${req.title} 결과 보고`,
        body: [
          `1. ${reqOrgNode ? reqOrgNode.name : '소방행정과'}-10821(${U.fmtKoDoc(req.createdAt)})호 "${req.title} 계획 알림"과 관련됩니다.`,
          `2. ${myNode && myNode.type === 'center' ? myNode.name : '신평119안전센터'}에서 ${req.title} 결과를 붙임과 같이 보고합니다.`,
        ].join('\n'),
        att: `(${myShort})${req.title} 1부.`,
        sender: '',
        docNo: '',
      };

      // 2) 본부·소방서 전체 취합 결과 보고 양식
      const top = Org.stationOf(req.createdOrgId);
      const rollupOrgName = top ? Org.name(top) : Org.root.name;
      const p = Store.progress(req, req.targets);
      const names = req.targets.filter((t) => Store.statusOf(req.id, t.id) === 'none').map((t) => Store.targetName(t));
      const rowsTotal = req.targets.reduce((a, t) => { const s = Store.sub(req.id, t.id); const lv = Store.lastVersion(s); return a + (s && s.status === 'approved' && lv ? (lv.rows || []).length : 0); }, 0);
      const rollupPreset = {
        orgName: rollupOrgName,
        receiver: dd.receiver || '내부결재',
        via: '',
        title: `${req.title} 결과 보고`,
        body: [
          `1. 관련: ${dd.relDoc || `${reqOrgNode ? reqOrgNode.name : '소방행정과'}-10821(${U.fmtKoDoc(req.createdAt)})`}`,
          `2. 위 호와 관련하여 「${req.title}」 자료 제출 요청 결과를 다음과 같이 보고합니다.`,
          `  가. 요청 기간: ${U.fmtKoDoc(req.createdAt)} ~ ${U.fmtKoDoc(req.deadline)}`,
          `  나. 제출 현황: 전체 ${p.total}개 기관 중 ${p.done}개 기관 제출(${p.total ? (p.done / p.total * 100).toFixed(1) : 0}%) — 승인 ${p.approved}, 검토 대기 ${p.submitted}, 반려 ${p.rejected}, 미제출 ${p.none}`,
          names.length ? `  다. 미제출 기관: ${names.slice(0, 12).join(', ')}${names.length > 12 ? ` 외 ${names.length - 12}개` : ''}` : '  다. 미제출 기관: 없음',
          req.columns.length ? `  라. 취합 내용: 승인된 제출 자료 ${rowsTotal}건(행)을 취합함 (붙임 참조)` : '  라. 취합 내용: 붙임 참조',
          `3. 제출 자료에 포함된 개인정보는 암호화하여 분리 보관 중이며, 보관기간 경과(${U.fmtKoDoc(req.deadline + req.retentionDays * 86400000)}) 후 파기할 예정입니다.`,
        ].join('\n'),
        att: `${req.title} 취합표 1부.|제출 현황 1부.`,
        sender: `${rollupOrgName}장`,
        docNo: `${reqOrgNode ? reqOrgNode.name : ''}-`,
      };

      const initP = (!owner && user.role === 'center') ? centerPreset : rollupPreset;
      const f = (id, label, val, wide) => `<label class="fld" style="${wide ? 'grid-column:1/3' : ''}"><span>${label}</span><input type="text" id="${id}" value="${U.esc(val || '')}"></label>`;
      const html = `<div class="alert info small">업로드해주신 <b>부산소방 표준기안문(.odt) 실제 양식(로고·머리말·결재선·하단 기관정보 표 포함)</b>을 그대로 사용하여 생성합니다.</div>
        <div class="presets" style="margin-bottom:12px">
          <div class="presets-h"><span>공문 문안 자동 채우기 선택</span><span class="hint" style="margin:0">클릭 시 아래 입력란이 해당 양식으로 자동 전환됩니다</span></div>
          <div class="presets-b">
            <button type="button" class="tog ${initP === centerPreset ? 'on' : ''}" id="doc-mode-center">센터·부서 제출 보고문 (예: 신평119안전센터 보고 양식)</button>
            <button type="button" class="tog ${initP === rollupPreset ? 'on' : ''}" id="doc-mode-rollup">본부·소방서 전체 취합 결과 보고문</button>
          </div>
        </div>
        <div class="doc-grid">
        ${f('d-org', '기관명(머리글)', initP.orgName, true)}
        ${f('d-recv', '수신', initP.receiver)}${f('d-via', '(경유)', initP.via)}
        ${f('d-title', '제목', initP.title, true)}
        <label class="fld" style="grid-column:1/3"><span>본문</span><textarea id="d-body" rows="7" style="font-family:inherit">${U.esc(initP.body)}</textarea></label>
        ${f('d-att', '붙임 (줄바꿈 대신 | 로 구분, 비우면 본문 끝에 끝. 표시)', initP.att, true)}
        ${f('d-sender', '발신 명의', initP.sender)}${f('d-coop', '협조자', '')}
        ${f('d-dr', '기안자 (직급 성명)', `${user.rank} ${user.name}`)}${f('d-rv', '검토자', dd.reviewer || '')}
        ${f('d-ap', '결재권자', dd.approver || '')}${f('d-no', '시행(문서)번호', initP.docNo)}
        ${f('d-date', '시행일자', U.fmtKoDoc(Date.now()))}${f('d-rc', '접수번호', '')}
        ${f('d-zip', '우편번호', dd.zip || '49442')}${f('d-addr', '주소', dd.addr || '부산광역시 사하구 장평로 270, (신평동)')}
        ${f('d-tel', '전화번호', dd.tel || '051-000-0000')}${f('d-fax', '팩스번호(전송)', dd.fax || '051-000-0000')}
        ${f('d-mail', '전자우편', dd.email || '아이디@korea.kr')}${f('d-pub', '공개구분', dd.pub || '대국민 공개')}
        </div>`;
      const collect = (el) => {
        const v = (id) => el.querySelector('#' + id).value;
        const d = {
          orgName: v('d-org'), receiver: v('d-recv'), via: v('d-via'), title: v('d-title'), body: v('d-body'),
          attachments: v('d-att').split('|').map((s) => s.trim()).filter(Boolean), sender: v('d-sender'), cooperator: v('d-coop'),
          drafter: v('d-dr'), reviewer: v('d-rv'), approver: v('d-ap'),
          signLine: `기안자 ${v('d-dr')}  검토자 ${v('d-rv')}  결재권자 ${v('d-ap')}`, docNo: v('d-no'), date: v('d-date'), receiptNo: v('d-rc'),
          zip: v('d-zip'), addr: v('d-addr'), tel: v('d-tel'), fax: v('d-fax'), email: v('d-mail'), publicType: v('d-pub'),
        };
        st.docDefaults = { receiver: d.receiver, reviewer: v('d-rv'), approver: v('d-ap'), zip: d.zip, addr: d.addr, tel: d.tel, fax: d.fax, email: d.email, pub: d.publicType };
        Store.save();
        return d;
      };
      const gen = (kind) => async (el) => {
        const d = collect(el);
        if (!d.title.trim()) { U.toast('제목을 입력하세요.', 'warn'); return false; }
        try {
          const blob = kind === 'hwpx' ? await Doc.buildHwpx(d) : await Doc.buildOdt(d);
          U.download(blob, `${safeName(d.title)}_공문(갑지).${kind}`);
          Store.log('doc.create', req.title, `공문서 ${kind} 생성`);
          U.toast(`${kind.toUpperCase()} 공문서를 생성했습니다.`, 'ok');
        } catch (e) { console.error(e); U.toast('생성 실패: ' + e.message, 'bad'); }
        return false;
      };
      const m = U.modal('공문서 작성 — 부산소방 표준기안문(갑지)', html, {
        wide: true,
        buttons: [{ label: '닫기' }, { label: 'ODT로 작성', cls: 'primary', onClick: gen('odt') }, { label: 'HWPX로 작성 (실험적)', onClick: gen('hwpx') }],
      });
      const applyPreset = (pr, isCenter) => {
        m.el.querySelector('#d-org').value = pr.orgName;
        m.el.querySelector('#d-recv').value = pr.receiver;
        m.el.querySelector('#d-via').value = pr.via;
        m.el.querySelector('#d-title').value = pr.title;
        m.el.querySelector('#d-body').value = pr.body;
        m.el.querySelector('#d-att').value = pr.att;
        m.el.querySelector('#d-sender').value = pr.sender;
        m.el.querySelector('#d-no').value = pr.docNo;
        m.el.querySelector('#doc-mode-center').classList.toggle('on', isCenter);
        m.el.querySelector('#doc-mode-rollup').classList.toggle('on', !isCenter);
      };
      m.el.querySelector('#doc-mode-center').addEventListener('click', () => applyPreset(centerPreset, true));
      m.el.querySelector('#doc-mode-rollup').addEventListener('click', () => applyPreset(rollupPreset, false));
    },
  };

  g.Detail = Detail;
})(window);
