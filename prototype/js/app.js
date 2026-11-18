/* 앱 셸 · 라우터 · 대시보드 · 알림 · 조직도 · 보안 구조 · 감사로그 · 설정 · 개인 일회용 제출 */
(function (g) {
  const view = () => document.getElementById('view');
  const E = U.esc;
  const tabs = { tab: null };

  const NAV = [
    { h: '#/', t: '대시보드', roles: ['hq', 'station', 'center', 'auditor'] },
    { h: '#/new', t: '새 자료 요청', roles: ['hq', 'station'] },
    { h: '#/vba', t: 'VBA · 로컬 폴더 취합기', roles: ['hq', 'station', 'center', 'auditor'] },
    { h: '#/notifications', t: '알림 내역', roles: ['hq', 'station', 'center', 'auditor'], badge: true },
    { sep: '현장 · 교대근무' },
    { h: '#/mobile', t: '모바일 어플 뷰', roles: ['hq', 'station', 'center', 'auditor'] },
    { sep: '조직 및 보안 관리' },
    { h: '#/org', t: '조직도 · 인사이동', roles: ['hq', 'station', 'center', 'auditor'] },
    { h: '#/security', t: '개인정보 분리보관', roles: ['hq', 'station', 'center', 'auditor'] },
    { h: '#/audit', t: '감사 로그', roles: ['auditor'] },
    { h: '#/settings', t: '모바일 연동 설정', roles: ['hq', 'station'] },
  ];

  const badge = (req, st) => (Store.isOverdue(req, st) ? '<span class="badge b-overdue">기한 초과</span>' : `<span class="badge b-${st}">${Store.STATUS_LABEL[st]}</span>`);
  const prog = (c) => { const t = c.total || 1; return `<div class="prog"><i class="p-approved" style="width:${c.approved / t * 100}%"></i><i class="p-submitted" style="width:${c.submitted / t * 100}%"></i><i class="p-rejected" style="width:${c.rejected / t * 100}%"></i></div>`; };
  const ddBadge = (ts) => { const d = U.dday(ts); return `<span class="badge ${d < 0 ? 'b-overdue' : d <= 3 ? 'b-warn' : 'b-info'}">${U.ddayLabel(ts)}</span>`; };

  // ---------- 셸 ----------
  function paintShell() {
    const u = Store.user();
    const sel = document.getElementById('user-sel');
    sel.innerHTML = USERS.map((x) => `<option value="${x.id}" ${x.id === u.id ? 'selected' : ''}>${E(x.name)} — ${E(x.id === 'u6' ? '보안담당' : Org.name(x.orgId))} (${E(x.roleLabel)})</option>`).join('');
    const hash = location.hash || '#/';
    document.getElementById('nav').innerHTML = NAV.filter((n) => n.sep || n.roles.includes(u.role)).map((n) => n.sep
      ? `<div class="sep">${n.sep}</div>`
      : `<a href="${n.h}" class="${hash === n.h || (n.h !== '#/' && hash.startsWith(n.h)) ? 'on' : ''}">${n.t}${n.badge && Store.unread(u) ? ` <span class="badge b-rejected">${Store.unread(u)}</span>` : ''}</a>`).join('')
      + `<div class="me"><b>${E(u.name)}</b> ${E(u.rank)}<br>${E(u.id === 'u6' ? '보안담당' : Org.path(u.orgId))}<br><button class="btn sm" id="reset" style="margin-top:8px">데모 데이터 초기화</button></div>`;
    const n = Store.unread(u);
    const dot = document.getElementById('bell-n');
    dot.hidden = !n; dot.textContent = n;
    document.getElementById('reset').addEventListener('click', async () => {
      if (await U.confirm('모든 데모 데이터(요청·제출·Vault·로그)를 초기 상태로 되돌립니다.', '초기화')) { await Store.reset(); location.hash = '#/'; route(); U.toast('초기화했습니다.', 'ok'); }
    });
  }

  // ---------- 대시보드 ----------
  function dashboard() {
    const u = Store.user();
    const { sent, received } = Store.visibleRequests(u);
    if (!tabs.tab || (tabs.tab === 'sent' && !sent.length && received.length) || (u.role === 'center')) tabs.tab = u.role === 'center' || (!sent.length && received.length) ? 'received' : 'sent';
    if (u.role === 'auditor') tabs.tab = 'sent';
    const alerts = Store.pendingAlerts(u);
    const sentOpen = sent.filter((r) => r.status === 'open' && !r.purged);
    const toReview = sent.reduce((a, r) => a + Store.state.submissions.filter((s) => s.requestId === r.id && s.status === 'submitted').length, 0);
    const myPending = received.filter((r) => { const t = Store.myTarget(r, u); return t && ['none', 'rejected'].includes(Store.statusOf(r.id, t.id)); });
    const kpi = (n, l, c) => `<div class="kpi"><b ${c ? `style="color:${c}"` : ''}>${n}</b>${l}</div>`;
    const showSent = u.role !== 'center';

    let h = `<div class="page-h"><div><h1>${E(u.name)} ${E(u.rank)}</h1><div class="mut">${E(u.roleLabel)} · ${E(u.id === 'u6' ? '보안담당' : Org.path(u.orgId))}</div></div>
      ${['hq', 'station'].includes(u.role) ? '<a class="btn primary" href="#/new">새 자료 요청 작성</a>' : ''}</div>`;
    if (alerts.length) {
      h += `<div class="alert warn"><b>마감 임박 및 보완 요청 알림</b><ul>${alerts.map((a) => `<li><a href="#/r/${a.req.id}">${E(a.req.title)}</a> — ${a.st === 'rejected' ? '<b>반려됨</b>, ' : ''}마감 ${U.ddayLabel(a.req.deadline)} (${U.fmtD(a.req.deadline)})</li>`).join('')}</ul></div>`;
    }
    const soon = u.role === 'auditor' ? [] : Store.purgeSoon(u);
    if (soon.length) {
      h += `<div class="alert info"><b>보관기간 만료 임박 — 자동 파기 예정</b><ul>${soon.map((a) => `<li><a href="#/r/${a.req.id}">${E(a.req.title)}</a> — ${U.fmtD(Store.purgeAt(a.req))} (${U.ddayLabel(Store.purgeAt(a.req))}) 이후 제출 자료가 파기됩니다. 필요한 취합 파일은 미리 내려받으세요.</li>`).join('')}</ul></div>`;
    }
    h += '<div class="kpis">';
    if (u.role === 'auditor') h += kpi(sent.length, '전체 요청(메타)') + kpi(Store.state.audit.length, '감사 로그 건수');
    else {
      if (showSent) h += kpi(sentOpen.length, '진행 중 요청') + kpi(toReview, '검토 대기 제출', toReview ? 'var(--info)' : '');
      h += kpi(myPending.length, '내가 제출할 요청', myPending.length ? 'var(--bad)' : '') + kpi(received.length, '받은 요청');
    }
    h += '</div>';

    if (showSent && u.role !== 'auditor') h += `<div class="tabs"><button data-tab="sent" class="${tabs.tab === 'sent' ? 'on' : ''}">보낸 요청 (${sent.length})</button><button data-tab="received" class="${tabs.tab === 'received' ? 'on' : ''}">받은 요청 (${received.length})</button></div>`;
    else if (u.role === 'center') h += '<h2>받은 요청</h2>';
    else h += '<h2>전체 요청 (메타정보)</h2>';

    const list = tabs.tab === 'sent' ? sent : received;
    const isSent = tabs.tab === 'sent';
    h += `<div class="tbl-wrap card" style="padding:0"><table><thead><tr><th>건명</th><th>${isSent ? '대상' : '요청 조직'}</th><th>마감</th><th>${isSent ? '제출 현황' : '내 상태 / 관할 현황'}</th><th></th></tr></thead><tbody>
      ${list.length ? list.map((r) => {
        const t = Store.visibleTargets(r, u);
        const p = Store.progress(r, t);
        const my = Store.myTarget(r, u);
        const cu = USERS.find((x) => x.id === r.createdBy);
        return `<tr><td><a href="#/r/${r.id}"><b>${E(r.title)}</b></a>${r.parentId ? ' <span class="badge b-info">재요청</span>' : ''}${r.purged ? ' <span class="badge b-none">파기됨</span>' : ''}<div class="small mut">${r.kinds.excel ? '엑셀 ' : ''}${r.kinds.text ? '텍스트 ' : ''}${r.kinds.file ? '파일' : ''}${r.columns.some((c) => c.pii) ? ' <span class="badge b-pii">🔒 개인정보</span>' : ''}</div></td>
          <td class="small">${isSent ? `${t.length}곳` : `${E(Org.name(r.createdOrgId))}<div class="mut">${cu ? E(cu.name) : ''}</div>`}</td>
          <td>${U.fmtD(r.deadline)} ${ddBadge(r.deadline)}</td>
          <td>${!isSent && my ? badge(r, Store.statusOf(r.id, my.id)) + '<div style="height:4px"></div>' : ''}${prog(p)}<div class="small mut">제출 ${p.done}/${p.total}${p.rejected ? ` · 반려 ${p.rejected}` : ''}</div></td>
          <td style="white-space:nowrap">${isSent && r.kinds.excel && p.done > 0 ? `<button class="btn sm primary" data-quick-merge="${r.id}" style="margin-right:4px">엑셀 취합(${p.done}곳)</button>` : ''}<a class="btn sm" href="#/r/${r.id}">열기</a></td></tr>`;
      }).join('') : '<tr><td colspan="5" class="mut" style="text-align:center;padding:30px">해당하는 요청이 없습니다.</td></tr>'}
      </tbody></table></div>`;
    view().innerHTML = h;
    view().querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => { tabs.tab = b.dataset.tab; dashboard(); }));
    view().querySelectorAll('[data-quick-merge]').forEach((b) => b.addEventListener('click', () => {
      const req = Store.request(b.dataset.quickMerge);
      if (req) Detail.exportModal(req);
    }));
  }

  // ---------- 알림 ----------
  function notifications() {
    const u = Store.user();
    const list = Store.notifsFor(u);
    const alerts = Store.pendingAlerts(u);
    const ob = ['hq', 'station'].includes(u.role) ? Store.state.outbox : [];
    view().innerHTML = `<div class="page-h"><h1>알림</h1><button class="btn" id="readall">모두 읽음</button></div>
      ${alerts.length ? `<div class="alert warn"><b>자동 알림 — 마감 임박/반려</b><ul>${alerts.map((a) => `<li><a href="#/r/${a.req.id}">${E(a.req.title)}</a> · ${a.st === 'rejected' ? '반려됨 · ' : ''}${U.ddayLabel(a.req.deadline)}</li>`).join('')}</ul></div>` : ''}
      <div class="card">${list.length ? list.map((n) => `<div class="file-row" style="${n.read ? 'opacity:.65' : ''}"><div class="grow"><b>${E(n.title)}</b> ${n.read ? '' : '<span class="badge b-rejected">NEW</span>'}<div class="small">${E(n.body)}</div></div><div class="small mut">${U.fmt(n.at)}</div>${n.reqId ? `<a class="btn sm" href="#/r/${n.reqId}">열기</a>` : ''}</div>`).join('') : '<div class="mut">알림이 없습니다.</div>'}</div>
      ${ob.length ? `<div class="card"><h2>외부 메신저 발송함 <span class="badge b-warn">모의 전송</span></h2><p class="hint" style="margin-top:-6px">실제로는 발송하지 않고, 전송될 문구만 기록합니다. 문구에 자료·개인정보가 없음을 확인하세요.</p>
        ${ob.slice(0, 20).map((o) => `<div class="file-row"><span class="badge b-info">${E({ app: '소방 모바일 어플', sms: '문자/내부메신저' }[o.channel] || o.channel)}</span><div class="grow small mono" style="white-space:pre-wrap">${E(o.preview)}</div><span class="small mut">${U.fmt(o.at)}</span></div>`).join('')}</div>` : ''}`;
    document.getElementById('readall').addEventListener('click', () => { list.forEach((n) => { n.read = true; }); Store.save(); paintShell(); notifications(); });
    list.forEach((n) => { n.read = true; });
    Store.save();
    paintShell();
  }

  // ---------- 조직도 및 인사이동·인원명부 관리 ----------
  const RANKS = ['소방사', '소방교', '소방장', '소방위', '소방경', '소방령'];
  let curRosterOrgId = null;

  /** 명부를 두는 단위(센터·팀). 같은 이름이 여러 소방서에 있는 팀(예: 소방행정과)은 "소방서 > 팀" 형식으로 구분 */
  const rosterUnits = () => Org.all.filter((n) => Org.unitLevel(n) === 3);
  const orgLabel = (id) => {
    const n = Org.byId[id];
    if (!n) return id;
    return rosterUnits().filter((x) => x.name === n.name).length > 1 ? `${Org.name(Org.parentOf[id])} > ${n.name}` : n.name;
  };
  const resolveRosterOrg = (text) => {
    const parts = String(text).split('>').map((s) => s.trim()).filter(Boolean);
    const strip = (s) => s.replace(/^부산/, '');
    const last = parts.pop();
    if (!last) return undefined;
    let c = rosterUnits().filter((n) => n.name === last || strip(n.name) === strip(last));
    if (parts.length) { const par = parts.pop(); c = c.filter((n) => { const p = Org.name(Org.parentOf[n.id]); return p === par || strip(p) === strip(par); }); }
    if (c.length === 1) return c[0].id;
    if (c.length > 1) return { error: `소속 "${text}" 이(가) 여러 소방서에 있어 구분할 수 없습니다. "소방서명 > ${last}" 형식으로 적어 주세요.` };
    return undefined;
  };

  async function orgPage(orgParam) {
    const u = Store.user();
    const centers = Org.unitsAtLevel(3);
    const isCenterRole = u.role === 'center' && !!Org.byId[u.orgId];
    const defaultCenter = isCenterRole
      ? u.orgId
      : (orgParam && Org.byId[orgParam])
        ? orgParam
        : (curRosterOrgId && Org.byId[curRosterOrgId])
          ? curRosterOrgId
          : (Org.byName('신평119안전센터') ? Org.byName('신평119안전센터').id : centers[0].id);
    curRosterOrgId = defaultCenter;

    const unitMap = {};
    USERS.forEach((usr) => { if (usr.id !== 'u6') (unitMap[usr.orgId] = unitMap[usr.orgId] || []).push(usr.name); });

    const prefillOn = Store.prefillRosterEnabled();
    const selNode = Org.node(curRosterOrgId);
    const aff = Org.resolveOrgDept({ id: curRosterOrgId }, null);
    const roster = await Store.resolvedRoster(curRosterOrgId); // 생년월일·연락처는 Vault에서 복호화하여 표시

    const quickNames = isCenterRole ? [Org.name(u.orgId)] : ['신평119안전센터', '감천119안전센터', '괴정119안전센터', '하단119안전센터', '범일119안전센터'];
    const quickChips = quickNames.map((nm) => {
      const nd = Org.byName(nm);
      if (!nd) return '';
      const cnt = Store.rosterOf(nd.id).length;
      return `<button type="button" class="tog ${nd.id === curRosterOrgId ? 'on' : ''}" data-pick-org="${nd.id}">${E(nm)} (${cnt})</button>`;
    }).join('');

    // 소방서 그룹별 센터 옵션 (센터 담당자는 본인 센터만 선택 가능하도록 격리)
    const stGroups = Org.root.children.flatMap((g) => g.children);
    const orgOptions = isCenterRole
      ? `<option value="${u.orgId}" selected>${E(Org.name(u.orgId))} (${roster.length}명 · 본인 소속 전용)</option>`
      : stGroups.map((st) => {
        const kids = st.children || [];
        if (!kids.length) return `<option value="${st.id}" ${st.id === curRosterOrgId ? 'selected' : ''}>${E(st.name)}</option>`;
        return `<optgroup label="${E(st.name)}">${kids.map((c) => `<option value="${c.id}" ${c.id === curRosterOrgId ? 'selected' : ''}>${E(c.name)} (${Store.rosterOf(c.id).length}명)</option>`).join('')}</optgroup>`;
      }).join('');

    const transferOptions = (currentId) => stGroups.map((st) => {
      const kids = st.children || [];
      if (!kids.length) return '';
      return `<optgroup label="${E(st.name)}">${kids.map((c) => `<option value="${c.id}" ${c.id === currentId ? 'selected' : ''}>${E(c.name)}</option>`).join('')}</optgroup>`;
    }).join('');

    const li = (n) => {
      const ch = n.children || [];
      const tag = unitMap[n.id] ? ` <span class="badge b-info">담당 ${E(unitMap[n.id].join(', '))}</span>` : '';
      if (!ch.length) {
        const cnt = Store.rosterOf(n.id).length;
        const isSel = n.id === curRosterOrgId;
        return `<div style="padding:3px 0 3px 22px;display:flex;align-items:center;gap:6px">
          <a href="#/org?org=${encodeURIComponent(n.id)}" data-pick-org="${n.id}" style="font-weight:${isSel ? '700' : '400'};color:${isSel ? 'var(--navy)' : 'var(--txt)'}">${E(n.name)}</a>
          <span class="mut small">(${cnt}명)</span>${tag}
        </div>`;
      }
      const hasSelected = Org.subtree(n.id).includes(curRosterOrgId);
      return `<details ${n.type === 'hq' || n.type === 'group' || hasSelected ? 'open' : ''} style="margin-left:6px"><summary style="cursor:pointer;padding:3px 0"><b>${E(n.name)}</b> <span class="mut small">${ch.length}</span>${tag}</summary>${ch.map(li).join('')}</details>`;
    };

    view().innerHTML = `<div class="page-h">
        <div>
          <h1>조직도 및 인사이동 · 인원명부 관리</h1>
          <div class="mut">인사이동 후 센터별 인원(소속·계급·성명)을 수정해 두면, 각 센터에서 제출서식을 내려받을 때 해당 인원 명단이 표에 자동으로 채워집니다.</div>
        </div>
      </div>

      <div class="card roster-switch-card">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap">
          <div>
            <div style="display:flex;align-items:center;gap:8px">
              <b style="font-size:15px">서식 다운로드 시 기존 보유 인원정보 자동 기재</b>
              <span class="badge ${prefillOn ? 'b-approved' : 'b-none'}" id="prefill-state-badge">${prefillOn ? '켜짐 (기관·소속·계급·성명·생년월일·임용일자·연락처 자동 기재)' : '꺼짐 (기관·소속만 기재)'}</span>
            </div>
            <div class="small mut" style="margin-top:3px">켜두면 신평119안전센터·감천119안전센터 등에서 엑셀 서식을 내려받을 때 등록된 인원의 <b>기관, 소속, 계급, 성명, 생년월일, 임용일자, 연락처, 담당업무</b>까지 미리 작성되어 나오므로 작성자는 필요한 빈 칸만 채우면 됩니다.</div>
          </div>
          <label class="switch-wrap">
            <input type="checkbox" id="global-prefill-roster" ${prefillOn ? 'checked' : ''}>
            <span>인원명부 자동 기재 사용</span>
          </label>
        </div>
      </div>

      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap;margin-bottom:12px">
          <div>
            <h2 style="margin:0 0 4px">센터·부서별 인원명부 및 인사이동 관리</h2>
            <div class="small mut">인사이동(전보·승진·신규배치) 내역을 수정하면 즉시 제출서식 다운로드에 반영됩니다.</div>
          </div>
          <div style="display:flex;gap:6px;flex-wrap:wrap">
            ${u.role !== 'auditor' ? `<button class="btn primary sm" id="btn-roster-import" title="인사이동 시 엑셀·CSV를 붙여넣거나 올리면 변경 사항을 비교해 한 번에 반영합니다">📋 엑셀·CSV로 일괄 갱신(인사이동)</button>
            <button class="btn sm" id="btn-roster-export" title="현재 명부를 엑셀로 내려받아 수정한 뒤 다시 올릴 수 있습니다">현재 명부 엑셀 내려받기</button>` : ''}
            <button class="btn sm" id="btn-preview-tpl">${E(selNode ? selNode.name : '')} 맞춤 서식 미리보기 다운로드(.xlsx)</button>
          </div>
        </div>

        <div class="presets" style="margin-bottom:14px">
          <div class="presets-h"><span>조회·수정할 센터(부서) 선택</span><span class="hint" style="margin:0">자주 찾는 센터 바로가기 또는 전체 목록에서 선택</span></div>
          <div class="presets-b" style="align-items:center">
            <select id="roster-org-sel" style="min-width:240px;font-weight:600">${orgOptions}</select>
            <span class="vsep"></span>
            ${quickChips}
          </div>
          <div class="presets-f">
            <div class="small">서식 자동기재 정보 — <b>기관:</b> <span class="mono">${E(aff.org || '-')}</span> &nbsp;|&nbsp; <b>소속:</b> <span class="mono">${E(aff.dept || '-')}</span> &nbsp;|&nbsp; <b>등록 인원:</b> <b>${roster.length}명</b></div>
          </div>
        </div>

        <div class="tbl-wrap">
          <table id="roster-tbl">
            <thead>
              <tr>
                <th style="width:44px">연번</th>
                <th>기관</th>
                <th style="width:155px">소속 (전보 시 변경)</th>
                <th style="width:98px">계급</th>
                <th style="width:105px">성명</th>
                <th style="width:122px">생년월일</th>
                <th style="width:122px">임용일자</th>
                <th style="width:132px">연락처</th>
                <th style="width:115px">담당업무</th>
                <th style="width:64px">관리</th>
              </tr>
            </thead>
            <tbody>
              ${roster.length ? roster.map((p, idx) => `
                <tr data-person-row="${p.id}">
                  <td class="mut">${idx + 1}</td>
                  <td class="small mut">${E(aff.org)}</td>
                  <td>
                    <select data-r-org="${p.id}" style="width:100%" title="다른 센터로 변경하면 즉시 인사이동(전보) 처리됩니다">
                      ${transferOptions(p.orgId)}
                    </select>
                  </td>
                  <td>
                    <select data-r-rank="${p.id}" style="width:100%">
                      ${RANKS.map((rk) => `<option value="${rk}" ${rk === p.rank ? 'selected' : ''}>${rk}</option>`).join('')}
                    </select>
                  </td>
                  <td><input type="text" data-r-name="${p.id}" value="${E(p.name)}" style="width:100%"></td>
                  <td><input type="text" data-r-birth="${p.id}" value="${E(p.birth || '')}" placeholder="1990-01-01" style="width:100%"></td>
                  <td><input type="text" data-r-appoint="${p.id}" value="${E(p.appointedAt || '')}" placeholder="2016-03-02" style="width:100%"></td>
                  <td><input type="text" data-r-phone="${p.id}" value="${E(p.phone || '')}" placeholder="010-0000-0000" style="width:100%"></td>
                  <td><input type="text" data-r-duty="${p.id}" value="${E(p.duty || '')}" placeholder="구급대원" style="width:100%"></td>
                  <td><button type="button" class="btn sm ghost" data-r-del="${p.id}">삭제</button></td>
                </tr>
              `).join('') : `<tr><td colspan="10" class="mut" style="text-align:center;padding:20px">등록된 인원이 없습니다. 아래에서 인원을 추가하세요.</td></tr>`}
            </tbody>
          </table>
        </div>

        <div class="roster-add-bar">
          <b class="small">신규/전입 인원 추가 (${E(selNode ? selNode.name : '')})</b>
          <select id="r-add-rank" style="width:105px">${RANKS.map((rk) => `<option value="${rk}" ${rk === '소방교' ? 'selected' : ''}>${rk}</option>`).join('')}</select>
          <input type="text" id="r-add-name" placeholder="성명 (예: 홍길동)" style="width:120px">
          <input type="text" id="r-add-birth" placeholder="생년월일 (1992-05-10)" style="width:140px">
          <input type="text" id="r-add-appoint" placeholder="임용일자 (2018-03-02)" style="width:140px">
          <input type="text" id="r-add-phone" placeholder="연락처 (010-0000-0000)" style="width:145px">
          <input type="text" id="r-add-duty" placeholder="담당업무 (예: 구급대원)" style="width:130px">
          <button type="button" class="btn sm primary" id="r-add-btn">인원 추가</button>
        </div>
      </div>

      <div class="row">
        <div class="card grow" style="min-width:320px">
          <h2>전체 조직도 <span class="mut small">(센터 클릭 시 상단 명부 전환)</span></h2>
          ${li(Org.root)}
        </div>
        <div class="card grow" style="min-width:320px">
          <h2>역할별 권한 범위</h2>
          <table><thead><tr><th>역할</th><th>요청 생성</th><th>제출 현황 조회</th><th>제출 자료 열람</th></tr></thead><tbody>
          <tr><td>본부 담당자</td><td>전체 소방서·센터/팀</td><td>본인이 만든 요청 전체</td><td>요청 조직 (개인정보는 사유 입력 후 복원)</td></tr>
          <tr><td>소방서 담당자</td><td>관할 센터/팀 재요청</td><td>관할 센터/팀만</td><td>관할 조직 마스킹본, 본인 요청은 원본 가능</td></tr>
          <tr><td>센터/팀 담당자</td><td>-</td><td>본인 조직</td><td>본인 제출분</td></tr>
          <tr><td>보안담당자(감사)</td><td>-</td><td>메타정보만</td><td>열람 불가, 감사 로그 조회</td></tr></tbody></table>
        </div>
      </div>`;

    // 이벤트 바인딩
    document.getElementById('global-prefill-roster').addEventListener('change', (e) => {
      Store.setPrefillRoster(e.target.checked);
      U.toast(e.target.checked ? '인원명부 서식 자동 기재가 켜졌습니다.' : '인원명부 서식 자동 기재가 꺼졌습니다. (기관·소속만 자동 기재)', 'ok');
      orgPage(curRosterOrgId);
    });

    document.getElementById('roster-org-sel').addEventListener('change', (e) => {
      curRosterOrgId = e.target.value;
      orgPage(curRosterOrgId);
    });

    view().querySelectorAll('[data-pick-org]').forEach((el) => el.addEventListener('click', (e) => {
      e.preventDefault();
      if (isCenterRole && el.dataset.pickOrg !== u.orgId) {
        U.toast(`🔒 개인정보 보호를 위해 센터 담당자는 본인 소속(${Org.name(u.orgId)}) 인원명부만 조회·다운로드할 수 있습니다.`, 'warn');
        return;
      }
      curRosterOrgId = el.dataset.pickOrg;
      orgPage(curRosterOrgId);
    }));

    // 소속 변경 (인사이동 전보)
    view().querySelectorAll('[data-r-org]').forEach((sel) => sel.addEventListener('change', async () => {
      const pid = sel.dataset.rOrg;
      const newOrgId = sel.value;
      const p = await Store.updateRosterPerson(pid, { orgId: newOrgId });
      if (p) {
        U.toast(`인사이동 반영: ${p.rank} ${p.name} 대원이 [${Org.name(newOrgId)}](으)로 전보 처리되었습니다.`, 'ok');
        orgPage(curRosterOrgId);
      }
    }));

    // 계급 변경
    view().querySelectorAll('[data-r-rank]').forEach((sel) => sel.addEventListener('change', async () => {
      const p = await Store.updateRosterPerson(sel.dataset.rRank, { rank: sel.value });
      if (p) U.toast(`${p.name} 대원 계급이 [${p.rank}](으)로 수정되었습니다.`, 'ok');
    }));

    // 성명 / 생년월일 / 임용일자 / 연락처 / 담당업무 변경
    view().querySelectorAll('[data-r-name]').forEach((inp) => inp.addEventListener('change', async () => {
      const v = inp.value.trim();
      if (!v) return U.toast('성명을 입력하세요.', 'warn');
      await Store.updateRosterPerson(inp.dataset.rName, { name: v });
      U.toast('성명이 수정되었습니다.', 'ok');
    }));
    view().querySelectorAll('[data-r-birth]').forEach((inp) => inp.addEventListener('change', async () => {
      await Store.updateRosterPerson(inp.dataset.rBirth, { birth: inp.value.trim() });
      U.toast('생년월일이 수정되었습니다.', 'ok');
    }));
    view().querySelectorAll('[data-r-appoint]').forEach((inp) => inp.addEventListener('change', async () => {
      await Store.updateRosterPerson(inp.dataset.rAppoint, { appointedAt: inp.value.trim() });
      U.toast('임용일자가 수정되었습니다.', 'ok');
    }));
    view().querySelectorAll('[data-r-phone]').forEach((inp) => inp.addEventListener('change', async () => {
      await Store.updateRosterPerson(inp.dataset.rPhone, { phone: inp.value.trim() });
      U.toast('연락처가 수정되었습니다.', 'ok');
    }));
    view().querySelectorAll('[data-r-duty]').forEach((inp) => inp.addEventListener('change', async () => {
      await Store.updateRosterPerson(inp.dataset.rDuty, { duty: inp.value.trim() });
    }));

    // 삭제
    view().querySelectorAll('[data-r-del]').forEach((btn) => btn.addEventListener('click', async () => {
      await Store.removeRosterPerson(btn.dataset.rDel);
      U.toast('명부에서 삭제되었습니다.', 'ok');
      orgPage(curRosterOrgId);
    }));

    // 신규 인원 추가
    document.getElementById('r-add-btn').addEventListener('click', async () => {
      const rank = document.getElementById('r-add-rank').value;
      const name = document.getElementById('r-add-name').value.trim();
      const birth = document.getElementById('r-add-birth').value.trim();
      const appointedAt = document.getElementById('r-add-appoint').value.trim();
      const phone = document.getElementById('r-add-phone').value.trim();
      const duty = document.getElementById('r-add-duty').value.trim();
      if (!name) return U.toast('추가할 인원의 성명을 입력하세요.', 'warn');
      await Store.addRosterPerson({ orgId: curRosterOrgId, rank, name, birth, appointedAt, phone, duty });
      U.toast(`${Org.name(curRosterOrgId)} 명부에 [${rank} ${name}] 대원이 추가되었습니다.`, 'ok');
      orgPage(curRosterOrgId);
    });

    // 일괄 갱신 / 현재 명부 내보내기
    const canTouch = (orgId) => u.role === 'hq' || (u.role === 'station' && Org.within(orgId, u.orgId)) || (u.role === 'center' && orgId === u.orgId);
    const impBtn = document.getElementById('btn-roster-import');
    if (impBtn) impBtn.addEventListener('click', () => rosterImportDialog(u, canTouch));
    const expBtn = document.getElementById('btn-roster-export');
    if (expBtn) expBtn.addEventListener('click', async () => {
      const all = (await Store.resolvedRosterAll()).filter((p) => canTouch(p.orgId));
      const order = Org.all.map((n) => n.id);
      all.sort((a, b) => order.indexOf(a.orgId) - order.indexOf(b.orgId));
      const aoa = [['소속', '계급', '성명', '생년월일', '임용일자', '연락처', '담당업무'],
        ...all.map((p) => [orgLabel(p.orgId), p.rank, p.name, p.birth, p.appointedAt, p.phone, p.duty].map((x) => Excel.safeCell(x || '')))];
      const ws = XLSX.utils.aoa_to_sheet(aoa);
      ws['!cols'] = [22, 9, 10, 13, 13, 15, 14].map((w) => ({ wch: w }));
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, '인원명부');
      U.download(new Blob([XLSX.write(wb, { type: 'array', bookType: 'xlsx' })]), `인원명부_${new Date().toISOString().slice(0, 10)}.xlsx`);
      Store.log('roster.export', '인원명부', `${all.length}명 엑셀 내려받기 (생년월일·연락처 포함)`);
      U.toast(`현재 명부 ${all.length}명을 내려받았습니다. 인사이동 내용을 고쳐서 다시 올려 주세요.`, 'ok');
    });

    // 맞춤 서식 미리보기 다운로드
    document.getElementById('btn-preview-tpl').addEventListener('click', async () => {
      const sampleReq = {
        title: '인원현황 및 교육대상자 조사',
        createdOrgId: Org.level2Of(curRosterOrgId) || curRosterOrgId,
        deadline: Date.now() + 7 * 86400000,
        prefillRoster: Store.prefillRosterEnabled(),
        columns: [
          { name: '연번', type: 'number', required: false, pii: false, examples: ['1', '2'] },
          { name: '기관', type: 'text', required: true, pii: false, examples: [aff.org || '부산소방재난본부 사하소방서', aff.org || '부산소방재난본부 사하소방서'] },
          { name: '소속', type: 'text', required: true, pii: false, examples: [aff.dept || '신평119안전센터', aff.dept || '신평119안전센터'] },
          { name: '계급', type: 'text', required: true, pii: false, examples: ['소방교', '소방장'] },
          { name: '성명', type: 'text', required: true, pii: true, examples: ['홍길동', '김소방'] },
          { name: '생년월일', type: 'date', required: false, pii: true, examples: ['1985-11-03', '1991-08-22'] },
          { name: '임용일자', type: 'date', required: false, pii: false, examples: ['2012-09-01', '2017-10-16'] },
          { name: '연락처', type: 'text', required: false, pii: true, examples: ['010-1234-5678', '010-9876-5432'] },
          { name: '담당업무', type: 'text', required: false, pii: false, examples: ['화재진압', '구급대원'] },
          { name: '교육희망기수(작성란)', type: 'text', required: true, pii: false, examples: ['1기(12.01.)', '2기(12.08.)'] },
          { name: '비고', type: 'text', required: false, pii: false, examples: ['-', '-'] },
        ],
      };
      const orgShort = U.orgShort(Org.name(curRosterOrgId));
      const fname = `(${orgShort})인원현황 및 동원명단 제출_서식.xlsx`;
      const bytes = await Excel.templateBytes(sampleReq, { id: curRosterOrgId }, { prefillRoster: Store.prefillRosterEnabled() });
      U.download(bytes, fname, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      U.toast(`${fname} 파일을 내려받았습니다.`, 'ok');
    });
  }

  /** 인원명부 일괄 갱신 대화상자: 붙여넣기/파일 → 분석(비교) → 변경 내용 확인 → 적용 */
  function rosterImportDialog(u, canTouch) {
    let cur = null; // 마지막 분석 결과 {plan, source}
    const KIND = { add: ['신규', 'b-approved'], transfer: ['전보', 'b-info'], update: ['수정', 'b-info'], remove: ['제외', 'b-rejected'] };
    const body = `<div class="small mut" style="margin-bottom:8px">엑셀에서 표를 <b>복사해 붙여넣거나</b> .xlsx/.csv 파일을 선택하세요. 첫 줄에 <b>소속, 계급, 성명</b>(선택: 생년월일, 임용일자, 연락처, 담당업무) 제목이 있어야 합니다.
        <br>이름+생년월일이 같으면 같은 사람으로 보고 <b>소속이 바뀌면 전보, 다른 항목이 바뀌면 수정</b>으로 처리합니다. 파일의 빈 칸은 기존 값을 지우지 않습니다. 반영 전에 변경 내용을 확인할 수 있습니다.
        <br>※ <a href="#" id="ri-sample">예시 붙여넣기 채우기</a></div>
      <textarea id="ri-text" rows="6" placeholder="소속&#9;계급&#9;성명&#9;생년월일&#9;임용일자&#9;연락처&#9;담당업무" style="width:100%;font-family:monospace;font-size:12px"></textarea>
      <div style="display:flex;gap:8px;align-items:center;margin:8px 0;flex-wrap:wrap">
        <input type="file" id="ri-file" accept=".xlsx,.xls,.csv,.txt">
        <button class="btn sm primary" id="ri-run">변경 내용 분석</button>
        <label class="small" style="margin-left:auto"><input type="checkbox" id="ri-remove"> 파일에 없는 인원은 명부에서 제외 <span class="mut">(파일에 나온 소속에 한정)</span></label>
      </div>
      <div id="ri-out"></div>`;
    const m = U.modal('인원명부 일괄 갱신 (인사이동)', body, {
      wide: true, dismiss: false,
      buttons: [
        { label: '닫기' },
        {
          label: '변경 내용 적용', cls: 'primary', onClick: async () => {
            if (!cur) { U.toast('먼저 [변경 내용 분석]을 실행하세요.', 'warn'); return false; }
            const n = cur.plan.count; const total = n.add + n.transfer + n.update + n.remove;
            if (!total) { U.toast('반영할 변경 사항이 없습니다.', 'warn'); return false; }
            const ok = await U.confirm(`신규 ${n.add} · 전보 ${n.transfer} · 수정 ${n.update} · 제외 ${n.remove}건을 인원명부에 반영합니다.\n(제외된 인원의 생년월일·연락처는 Vault에서도 삭제됩니다)\n계속할까요?`, '반영');
            if (!ok) return false;
            const c = await Store.applyRosterPlan(cur.plan, { source: cur.source });
            U.toast(`반영 완료: 신규 ${c.add} · 전보 ${c.transfer} · 수정 ${c.update} · 제외 ${c.remove}`, 'ok');
            orgPage(curRosterOrgId);
          },
        },
      ],
    });
    const el = m.el;
    const q = (s) => el.querySelector(s);
    const setText = (t) => { q('#ri-text').value = t; };

    q('#ri-sample').addEventListener('click', (e) => {
      e.preventDefault();
      const c = Org.byName('신평119안전센터') || Org.all.find((n) => n.type === 'center');
      setText(`소속\t계급\t성명\t생년월일\t임용일자\t연락처\t담당업무\n${c.name}\t소방장\t홍길동\t1990-01-01\t2015-03-02\t010-0000-0000\t화재진압\n${c.name}\t소방교\t김가상\t1993.5.10\t2018-03-02\t01012345678\t구급대원`);
    });
    q('#ri-file').addEventListener('change', async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      try {
        if (/\.(xlsx|xls)$/i.test(f.name)) {
          const wb = XLSX.read(await f.arrayBuffer(), { type: 'array' });
          const ws = wb.Sheets[wb.SheetNames[0]];
          const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' });
          setText(aoa.map((r) => r.join('\t')).join('\n'));
        } else {
          const buf = new Uint8Array(await f.arrayBuffer());
          let txt = new TextDecoder('utf-8').decode(buf);
          if (txt.includes('�')) txt = new TextDecoder('euc-kr').decode(buf); // 엑셀 CSV(ANSI) 대응
          setText(txt);
        }
        U.toast(`${f.name} 내용을 불러왔습니다. [변경 내용 분석]을 눌러 주세요.`, 'ok');
      } catch (err) { U.toast('파일을 읽지 못했습니다: ' + err.message, 'warn'); }
    });

    q('#ri-run').addEventListener('click', async () => {
      const text = q('#ri-text').value;
      if (!text.trim()) return U.toast('붙여넣은 내용이 없습니다.', 'warn');
      const parsed = RosterImport.parseTable(RosterImport.parseDelimited(text));
      const out = q('#ri-out');
      if (parsed.errors.length) { out.innerHTML = `<div class="alert bad small">${parsed.errors.map(E).join('<br>')}</div>`; cur = null; return; }
      const existing = await Store.resolvedRosterAll();
      const defaultOrgId = parsed.hasOrg ? undefined : curRosterOrgId;
      const plan = RosterImport.plan(existing, parsed.rows, {
        resolveOrg: resolveRosterOrg,
        defaultOrgId, canTouch, orgName: (id) => Org.name(id), ranks: RANKS, removeMissing: q('#ri-remove').checked,
      });
      cur = { plan, source: `파일/붙여넣기 ${parsed.rows.length}행` };
      const n = plan.count;
      const changed = plan.items.filter((i) => i.kind !== 'same');
      const desc = (it) => {
        if (it.kind === 'add') return `${E(it.row.rank || '소방사')} · 담당 ${E(it.row.duty || '-')}`;
        if (it.kind === 'remove') return `${E(it.ex.rank)} · 파일에 없음`;
        return it.changes.map((c) => `<b>${RosterImport.FIELD_LABEL[c.f]}</b> ${c.f === 'orgId' ? E(Org.name(c.from)) + ' → ' + E(Org.name(c.to)) : (['birth', 'phone'].includes(c.f) ? '변경됨' : E(c.from || '(없음)') + ' → ' + E(c.to))}`).join(' · ');
      };
      const shown = changed.slice(0, 300);
      out.innerHTML = `<div class="alert ${n.add + n.transfer + n.update + n.remove ? 'ok' : 'warn'} small"><b>분석 결과</b> — 신규 ${n.add} · 전보 ${n.transfer} · 수정 ${n.update} · 제외 ${n.remove} · 변동 없음 ${n.same}
          ${!parsed.hasOrg ? `<br>소속 열이 없어 모든 인원을 현재 선택한 <b>${E(Org.name(curRosterOrgId))}</b> 소속으로 처리합니다.` : ''}</div>
        ${plan.errors.length ? `<div class="alert bad small"><b>건너뛴 행 ${plan.errors.length}건</b><br>${plan.errors.slice(0, 20).map(E).join('<br>')}${plan.errors.length > 20 ? '<br>…' : ''}</div>` : ''}
        ${plan.warnings.length ? `<div class="alert warn small"><b>확인 필요 ${plan.warnings.length}건</b><br>${plan.warnings.slice(0, 20).map(E).join('<br>')}${plan.warnings.length > 20 ? '<br>…' : ''}</div>` : ''}
        ${!q('#ri-remove').checked && plan.missing.length ? `<div class="alert warn small">파일에 없는 기존 인원 <b>${plan.missing.length}명</b> (${E(plan.missing.slice(0, 5).map((p) => p.name).join(', '))}${plan.missing.length > 5 ? ' 외' : ''}) — 퇴직·전출 등으로 제외하려면 위 "파일에 없는 인원은 명부에서 제외"를 체크하고 다시 분석하세요.</div>` : ''}
        <div class="tbl-wrap" style="max-height:260px;overflow:auto"><table><thead><tr><th>구분</th><th>성명</th><th>소속</th><th>내용</th></tr></thead><tbody>
        ${shown.map((it) => { const r = it.row || it.ex; const k = KIND[it.kind]; return `<tr><td><span class="badge ${k[1]}">${k[0]}</span></td><td>${E(r.name)}</td><td class="small">${E(Org.name(it.kind === 'remove' ? it.ex.orgId : it.row.orgId))}</td><td class="small">${desc(it)}</td></tr>`; }).join('') || '<tr><td colspan="4" class="mut">변경 사항이 없습니다.</td></tr>'}
        </tbody></table></div>${changed.length > shown.length ? `<div class="small mut">…외 ${changed.length - shown.length}건 (모두 반영됩니다)</div>` : ''}`;
    });
  }

  // ---------- 보안 구조 ----------
  async function securityPage() {
    const [vc, fc, vall] = await Promise.all([Vault.count(), Files.count(), Vault.all()]);
    let rec = null, main = null;
    for (const cand of vall) {
      for (const s of Store.state.submissions) {
        for (const v of s.versions) {
          const ri = (v.rows || []).findIndex((r) => r.includes(cand.id));
          if (ri >= 0) { main = { req: Store.request(s.requestId), v, ri }; break; }
        }
        if (main) break;
      }
      if (main) { rec = cand; break; }
    }
    if (!rec) rec = vall[0];
    const hex = (u8, n) => [...u8.slice(0, n)].map((b) => b.toString(16).padStart(2, '0')).join(' ');
    view().innerHTML = `<div class="page-h"><div><h1>보안 구조</h1><div class="mut">개인정보를 일반 자료와 분리해 저장하는 방식을 이 프로토타입에서 직접 확인할 수 있습니다.</div></div></div>
      <div class="card"><h2>저장 분리 구조</h2>
        <div class="flow"><div class="box">제출 파일/텍스트</div><div class="arr">→</div><div class="box">① 형식 검증·허용 확장자<br>② 개인정보 탐지 + 제출자 표시</div><div class="arr">→</div>
        <div class="box main"><b>메타 DB / 일반 저장소</b><br><span class="small">요청·상태·마스킹값·<b>토큰</b>만 저장<br>일반 파일(암호화)</span></div>
        <div class="box vault"><b>개인정보 Vault</b><br><span class="small">개인정보 원문·파일을<br>별도 DB·별도 키로 AES-256-GCM 암호화</span></div></div>
        <table><thead><tr><th>저장소</th><th>보관 내용</th><th>현재 항목 수</th><th>키</th></tr></thead><tbody>
        <tr><td>메타 데이터</td><td>요청, 조직, 상태, 마스킹 표시값, 토큰</td><td>${Store.state.submissions.length}건 제출</td><td>-</td></tr>
        <tr><td>일반 자료 저장소 (IndexedDB)</td><td>개인정보 없음으로 표시된 첨부 파일</td><td>${fc}건</td><td>키 A (AES-GCM)</td></tr>
        <tr><td>🔒 개인정보 Vault (IndexedDB)</td><td>개인정보 컬럼 값, 인원명부 생년월일·연락처, 개인정보 텍스트·파일 원본</td><td><b>${vc}건</b></td><td>키 B (AES-GCM, 별도)</td></tr></tbody></table>
        <p class="hint">※ 프로토타입은 키를 브라우저에 둡니다(시연용). 운영에서는 Vault를 <b>별도 서버·별도 계정</b>에 두고 키는 KMS/HSM에서 관리합니다.</p></div>
      <div class="card"><h2>실제 저장 값 비교</h2>
        ${rec && main ? `<div class="row"><div class="grow"><h3>메타 DB에 저장된 값 <span class="badge b-info">일반</span></h3>
          <p class="small mut">${E(main.req.title)}</p>
          <div class="tbl-wrap"><table><thead><tr>${main.v.header.map((c) => `<th>${E(c)}</th>`).join('')}</tr></thead><tbody><tr>${main.v.rows[main.ri].map((c) => `<td class="mono">${E(c)}</td>`).join('')}</tr><tr>${main.v.maskedRows[main.ri].map((c) => `<td class="small">${E(c)}</td>`).join('')}</tr></tbody></table></div>
          <p class="hint">첫 행: 실제 저장된 값(개인정보 컬럼은 <b>토큰</b>) / 둘째 행: 화면 표시용 마스킹 값</p></div>
          <div class="grow"><h3>Vault에 저장된 값 <span class="badge b-pii">암호화</span></h3>
          <dl class="kv"><dt>토큰</dt><dd class="mono">${E(rec.id)}</dd><dt>IV (12B)</dt><dd class="mono">${hex(rec.iv, 12)}</dd><dt>암호문(앞 24B)</dt><dd class="mono">${hex(rec.data, 24)} … (${rec.data.length}B)</dd><dt>저장 시각</dt><dd>${U.fmt(rec.at)}</dd></dl>
          <p class="hint">토큰만으로는 원문을 알 수 없고, 복원은 요청 조직 담당자가 <b>사유 입력</b> 후에만 가능하며 감사 로그에 남습니다.</p></div></div>`
        : rec ? `<div class="card"><p class="mut">Vault에 암호화 저장된 항목 (${E(rec.id)})이 보관되어 있습니다.</p></div>`
        : '<p class="mut">아직 Vault에 저장된 개인정보가 없습니다. 개인정보 컬럼이 있는 요청(예: 구급대원 보수교육 이수자 명단)에 샘플 엑셀을 제출해 보세요.</p>'}</div>
      <div class="card"><h2>개인정보 탐지 연습장</h2><p class="hint" style="margin-top:-4px">입력한 글에서 개인정보 패턴을 탐지합니다. (브라우저 안에서만 동작, 가상 값만 입력하세요)</p>
        <textarea id="pt" rows="3">홍길동 010-1234-5678, 주민번호 900101-1234567, 메일 gildong@sample.go.kr, 차량 12가3456</textarea>
        <div id="pt-r" style="margin-top:8px"></div></div>
      <div class="card"><h2>운영 단계 필수 통제 (제안서 반영 항목)</h2><ul style="margin:0;padding-left:18px">
        <li>SSO 연동 + 최소 권한(조직 트리 기반), 보안담당자는 자료 열람 불가(직무 분리)</li><li>Vault 별도 서버·별도 키 관리, 복원 시 사유 입력 + 감사 로그</li><li>보관기간 경과 자료 자동 파기 (Vault 우선)</li>
        <li>취합 엑셀 기본 마스킹본, 수식/CSV 인젝션 방어, 허용 확장자·용량 제한, 악성코드 검사</li><li>외부 메신저는 비식별 알림·내부망 링크만 (보안부서 협의 필수)</li><li>보안성 검토, 취약점 점검, 개인정보 영향평가 해당 여부 확인</li></ul></div>`;
    const run = () => {
      const t = document.getElementById('pt').value;
      const f = PII.scan(t);
      document.getElementById('pt-r').innerHTML = (f.length ? `<div class="alert warn small">탐지: ${f.map((x) => `<b>${E(x.type)}</b> ${x.count}건${x.note ? '(' + E(x.note) + ')' : ''}`).join(' · ')}</div>` : '<div class="alert ok small">탐지된 개인정보 패턴이 없습니다.</div>') + `<div class="small mut">마스킹 결과</div><div class="card" style="padding:8px 12px;margin:0">${E(PII.redact(t))}</div>`;
    };
    document.getElementById('pt').addEventListener('input', run); run();
  }

  // ---------- 감사 로그 ----------
  function auditPage() {
    const u = Store.user();
    if (u.role !== 'auditor') { view().innerHTML = '<div class="alert bad">감사 로그는 보안담당자만 조회할 수 있습니다. 상단에서 <b>한보안(보안담당자)</b>으로 전환하세요.</div>'; return; }
    const ACT = { login: '로그인', 'request.create': '요청 생성', submit: '제출', 'submit.resubmit': '재제출', 'review.approve': '승인', 'review.reject': '반려', remind: '독촉', 'export.masked': '취합(마스킹)', 'export.original': '취합(원본)', 'pii.restore': '개인정보 원문 열람', 'pii.download': '개인정보 파일 다운로드', 'file.download': '파일 다운로드', 'doc.create': '공문서 생성', purge: '자료 파기', 'purge.auto': '자동 파기(보관기간 경과)', 'template.download': '서식 다운로드', 'template.download_all': '서식 선택 다운로드', 'submission.download_excel': '제출 엑셀 다운로드', 'export.zip': '첨부파일 다운로드', 'export.xlsx_selected': '제출 엑셀 선택 다운로드', 'roster.add': '인원 추가', 'roster.update': '인원정보 수정', 'roster.transfer': '인사이동(전보)', 'roster.remove': '명부 제외', 'roster.import': '인원명부 일괄 갱신', 'roster.export': '인원명부 내려받기', 'audit.export': '감사로그 내보내기' };
    let q = '';
    const draw = () => {
      const rows = Store.state.audit.filter((a) => !q || JSON.stringify(a).includes(q) || (ACT[a.action] || '').includes(q));
      document.getElementById('arows').innerHTML = rows.slice(0, 300).map((a) => `<tr><td class="small">${U.fmt(a.at)}</td><td class="small">${E(a.userName)}<div class="mut">${E(a.orgName)}</div></td><td><span class="badge ${/pii|original/.test(a.action) ? 'b-pii' : 'b-info'}">${E(ACT[a.action] || a.action)}</span></td><td class="small">${E(a.target)}</td><td class="small">${E(a.detail)}</td></tr>`).join('') || '<tr><td colspan="5" class="mut">기록이 없습니다.</td></tr>';
    };
    view().innerHTML = `<div class="page-h"><div><h1>감사 로그</h1><div class="mut">누가 · 언제 · 무엇을 했는지 기록합니다. (운영에서는 변경 불가능한 저장소에 보관)</div></div><button class="btn" id="csv">CSV 내보내기</button></div>
      <div class="card"><input type="text" id="aq" placeholder="검색 (사용자·행위·건명…)" style="width:280px;margin-bottom:10px"><div class="tbl-wrap"><table><thead><tr><th>일시</th><th>사용자</th><th>행위</th><th>대상</th><th>상세</th></tr></thead><tbody id="arows"></tbody></table></div></div>`;
    draw();
    document.getElementById('aq').addEventListener('input', (e) => { q = e.target.value.trim(); draw(); });
    document.getElementById('csv').addEventListener('click', () => {
      const esc = (s) => `"${Excel.safeCell(s).replace(/"/g, '""')}"`;
      const csv = '\uFEFF일시,사용자,소속,행위,대상,상세\n' + Store.state.audit.map((a) => [U.fmt(a.at), a.userName, a.orgName, ACT[a.action] || a.action, a.target, a.detail].map(esc).join(',')).join('\n');
      U.download(new Blob([csv], { type: 'text/csv' }), '감사로그.csv');
      Store.log('audit.export', '감사 로그', 'CSV 내보내기');
    });
  }

  // ---------- 소방 모바일 어플(APK) 연동 설정 ----------
  function settingsPage() {
    view().innerHTML = `<div class="page-h"><div><h1>소방 모바일 어플(APK) 연동 설정</h1><div class="mut">교대근무자 스마트폰 어플 연동 규격 및 소방 내부망 푸시/SMS 알림 체계</div></div></div>
      <div class="alert warn small"><b>시연용 화면</b> — 아래 연동 항목은 운영 단계에서 구현·협의할 예정이며, 이 프로토타입에서는 실제로 연동되지 않습니다. 디스코드·텔레그램 등 외부 메신저는 사용하지 않고, <b>소방 모바일 어플(내부망)</b>과 행정망 SMS 연동을 전제로 설계합니다.</div>
      
      <div class="card"><h2>소방 모바일 어플(APK) 연동 아키텍처</h2>
        <div class="flow">
          <div class="box"><b>본부/소방서 관리자</b><br><span class="small">PC Edge 브라우저에서<br>자료 요청 발송</span></div>
          <div class="arr">→</div>
          <div class="box main"><b>소방 내부망 게이트웨이</b><br><span class="small">내부 IP (사설망)<br>푸시 알림 패킷 생성</span></div>
          <div class="arr">→</div>
          <div class="box vault"><b>대원 스마트폰 소방 어플</b><br><span class="small">기존 설치된 APK 어플<br>[자료제출] 메뉴에서 웹뷰 로딩</span></div>
        </div>
        <table style="margin-top:14px"><thead><tr><th>항목</th><th>설정 내용</th><th>상태</th></tr></thead><tbody>
        <tr><td>어플 연동 방식</td><td>소방 전용 모바일 웹뷰(WebView) 임베디드</td><td><span class="badge b-warn">시연용(미연동)</span></td></tr>
        <tr><td>인증 연계</td><td>기존 소방 어플 로그인 세션(사번/비번) 자동 상속</td><td><span class="badge b-warn">시연용(미연동)</span></td></tr>
        <tr><td>네트워크 경로</td><td>소방 내부망 전용 IP / VPN 게이트웨이 경유</td><td><span class="badge b-warn">시연용(미연동)</span></td></tr>
        <tr><td>파일 업로드 제한</td><td><b>파일당 최대 100MB</b> (복수 파일 동시 제출 지원)</td><td><span class="badge b-ok">설정됨</span></td></tr>
        <tr><td>민감정보 처리</td><td>구급 환자정보·대원 건강정보 특수 암호화 Vault 분리 저장</td><td><span class="badge b-warn">시연용(미연동)</span></td></tr>
        </tbody></table>
      </div>

      <div class="card"><h2>모바일 어플 푸시 알림 모의 테스트</h2>
        <p class="small mut">자료 요청이 발생했을 때 대원 스마트폰 소방 어플로 전달되는 푸시 알림 문구를 테스트합니다.</p>
        <div class="mono" style="white-space:pre-wrap;background:#f7f9fd;padding:12px;border-radius:8px;border:1px solid var(--line)">${E(Store.messageText({ title: '2026년 하반기 소방장비 보유현황 조사', deadline: Date.now() + 3 * 86400000 }, location.href.split('#')[0] + '#/mobile'))}</div>
        <div style="margin-top:12px">
          <button class="btn primary" id="btn-test-push">📱 모바일 어플로 푸시 알림 모의 발송</button>
          <a class="btn" href="#/mobile" style="margin-left:8px">📱 모바일 어플 화면으로 이동</a>
        </div>
      </div>`;

    document.getElementById('btn-test-push').addEventListener('click', () => {
      Store.outbox('app', `[푸시 알림] 소방 모바일 어플로 알림이 정상 전송되었습니다. (마감 D-3)`);
      U.toast('소방 모바일 어플로 푸시 알림을 발송했습니다. [모바일 어플 뷰] 메뉴에서 확인해 보세요!', 'ok');
    });
  }

  // ---------- 모바일 어플 뷰 (교대근무자 전용 스마트폰 화면) ----------
  function mobilePage(reqId) {
    const u = Store.user();
    const { received } = Store.visibleRequests(u);
    const targetReq = (reqId && reqId !== 'list') ? Store.request(reqId) : null;
    const myT = targetReq ? Store.myTarget(targetReq, u) : null;

    let listHtml = '';
    if (!received.length) {
      listHtml = '<div style="text-align:center;padding:30px 10px;color:var(--mut)">현재 본인에게 할당된 제출 요청이 없습니다.</div>';
    } else {
      listHtml = received.map((r) => {
        const t = Store.myTarget(r, u);
        const st = t ? Store.statusOf(r.id, t.id) : 'none';
        return `<a class="card m-card" href="#/mobile/${r.id}" style="display:block;text-decoration:none;margin-bottom:10px;padding:12px;border-left:4px solid var(--navy);background:#fff">
          <div style="display:flex;justify-content:space-between;align-items:flex-start">
            <b style="font-size:13.5px;color:var(--txt)">${E(r.title)}</b>
            ${badge(r, st)}
          </div>
          <div class="small mut" style="margin-top:4px">마감: ${U.fmtD(r.deadline)} (${U.ddayLabel(r.deadline)})</div>
          <div class="small mut">${E(Org.name(r.createdOrgId))} 요청</div>
        </a>`;
      }).join('');
    }

    view().innerHTML = `
      <div class="page-h">
        <div>
          <h1>📱 소방 모바일 어플 뷰 (교대근무자 체험)</h1>
          <div class="mut">교대근무자(당번·비번·휴무)가 휴대전화 소방 어플(APK)을 열어 현장에서 스마트폰으로 직접 제출하는 화면입니다.</div>
        </div>
        <div style="display:flex;gap:8px">
          <a class="btn sm" href="#/">PC 관리자 화면으로 복귀</a>
        </div>
      </div>

      <div class="alert info small" style="margin-bottom:16px">
        💡 <b>시연 안내</b>: 실제 소방 어플이 아닌 시연용 모의 화면입니다. 하단 스마트폰 목업에서 자료를 선택한 뒤 스마트폰 카메라 사진이나 서식 엑셀/파일(최대 100MB)을 업로드하고 [제출]을 누르면, PC 관리자 대시보드에 실시간으로 반영됩니다.
      </div>

      <div class="phone-wrapper">
        <div class="phone-device">
          <div class="phone-notch">
            <div class="phone-speaker"></div>
            <div class="phone-camera"></div>
          </div>
          <div class="phone-screen">
            <div class="phone-header">
              <div class="title">🚒 119 스마트현장지원 <small style="font-size:10px;opacity:.8">(부산소방 포털 어플)</small></div>
              <div style="font-size:11px;opacity:.9">${E(u.rank)} ${E(u.name)} <span style="display:inline-block;width:7px;height:7px;background:#34a96b;border-radius:50%"></span></div>
            </div>

            <div class="phone-body">
              <div style="background:#fff;border-radius:8px;padding:10px 12px;margin-bottom:12px;border:1px solid var(--line);font-size:12.5px;display:flex;justify-content:space-between;align-items:center">
                <span>소속: <b>${E(Org.name(u.orgId))}</b></span>
                <span class="badge b-info">소방 내부망 접속</span>
              </div>

              ${targetReq && myT ? `
                <div style="margin-bottom:12px">
                  <a href="#/mobile" style="font-size:12px;color:var(--info);display:inline-block;margin-bottom:6px">← 전체 요청 목록</a>
                  <h3 style="margin:0 0 4px;font-size:15px">${E(targetReq.title)}</h3>
                  <div class="small mut" style="margin-bottom:10px">마감: ${U.fmtD(targetReq.deadline)} (${U.ddayLabel(targetReq.deadline)}) · 보관 ${targetReq.retentionDays}일</div>
                  <div id="mobile-sub-form"></div>
                </div>
              ` : `
                <h3 style="font-size:14px;margin:0 0 8px">📋 자료 제출 요청 목록 (${received.length})</h3>
                ${listHtml}
              `}
            </div>

            <div class="phone-tabbar">
              <div class="phone-tab"><span>🏠</span>홈</div>
              <div class="phone-tab"><span>🚨</span>출동상황</div>
              <a class="phone-tab on" href="#/mobile" style="text-decoration:none;color:inherit"><span>📁</span>자료제출</a>
              <div class="phone-tab"><span>👤</span>내정보</div>
            </div>
          </div>
        </div>
      </div>
    `;

    if (targetReq && myT) {
      SubmitUI.mount(document.getElementById('mobile-sub-form'), targetReq, myT, {
        onDone: () => {
          U.toast('모바일 어플에서 정상 제출되었습니다.', 'ok');
          mobilePage(targetReq.id);
        },
      });
    }
  }

  // ---------- VBA 매크로 & 무서버 PC 로컬 폴더 취합기 ----------
  function buildVbaCode(defaultHeaderRow) {
    const hr = Number(defaultHeaderRow) || 5;
    return `Attribute VB_Name = "BusanFireMerge"
Option Explicit

' =============================================================================
' [부산소방재난본부 / 소방서] 센터별 제출 엑셀 일괄 자동취합 + 제출유무(O/X) 자동체크 매크로
' -----------------------------------------------------------------------------
' * 특징:
'   1. 외부 서버나 DB를 거치지 않고 담당자 행정망 PC 내부 폴더에서만 100% 동작하므로
'      개인정보(성명, 생년월일, 임용일자, 연락처 등)가 외부 서버로 전송되지 않습니다.
'   2. 폴더 내 파일명((신평)...xlsx, (감천)...xlsx 등)을 자동 분석해 [제출유무현황] 시트에
'      관할 센터·부서별 제출 완료(O) / 미제출(X) 여부를 자동으로 대조해 표시합니다.
'   3. 상단 문서 제목과 표 머리글은 딱 1번만 남기고 각 센터가 입력한 데이터 행만
'      원본 그대로(마스킹 없이) 아래로 깔끔하게 이어 붙여 줍니다.
' =============================================================================

Public Sub 부산소방_센터별엑셀_일괄취합()
    Dim fd As FileDialog
    Dim folderPath As String, fileName As String, headerRowInput As String
    Dim headerRow As Long, dataStartRow As Long
    Dim wbOut As Workbook, wsData As Worksheet, wsStat As Worksheet
    Dim wbSrc As Workbook, wsSrc As Worksheet
    Dim lastRow As Long, lastCol As Long, outRow As Long, statRow As Long
    Dim r As Long, c As Long, i As Long, fileCount As Long, totalRows As Long, copiedFromFile As Long
    Dim isFirstFile As Boolean, rowHasValue As Boolean, cellVal As String, firstColHeader As String
    Dim targets As Variant, submittedFiles() As String, submittedRows() As Long, isSub() As Boolean
    Dim submitCnt As Long, missingNames As String

    ' 관할 점검 대상 목록 (필요 시 소속 소방서 센터명으로 수정 가능)
    targets = Array("신평", "감천", "괴정", "하단", "다대", "사하구조대", "청문감사", "소방행정", "예방안전", "구조구급", "현장대응")
    ReDim submittedFiles(LBound(targets) To UBound(targets))
    ReDim submittedRows(LBound(targets) To UBound(targets))
    ReDim isSub(LBound(targets) To UBound(targets))

    ' 1. 취합할 엑셀 파일들이 들어있는 폴더 선택
    Set fd = Application.FileDialog(msoFileDialogFolderPicker)
    fd.Title = "[부산소방 자료취합] 각 센터·소방서 제출 엑셀 파일이 모인 폴더를 선택하세요"
    If fd.Show <> -1 Then Exit Sub
    folderPath = fd.SelectedItems(1)
    If Right(folderPath, 1) <> "\\" Then folderPath = folderPath & "\\"

    ' 2. 표 머리글(컬럼명) 행 번호 확인
    headerRowInput = InputBox( _
        "제출 서식에서 표 머리글(예: 순, 기관, 소속, 계급, 성명...)이 있는 행 번호를 입력하세요." & vbCrLf & vbCrLf & _
        "• 일반 소방서/본부 배포 서식: 4 또는 5" & vbCrLf & _
        "• 맞춤 다운로드 서식(상단 안내 포함): 8", _
        "표 머리글(컬럼명) 행 번호 지정", "${hr}")
    If Trim(headerRowInput) = "" Or Not IsNumeric(headerRowInput) Then Exit Sub
    headerRow = CLng(headerRowInput)
    dataStartRow = headerRow + 1

    Application.ScreenUpdating = False
    Application.DisplayAlerts = False
    On Error GoTo CleanUp

    Set wbOut = Workbooks.Add(xlWBATWorksheet)
    Set wsData = wbOut.Worksheets(1): wsData.Name = "취합결과"
    Set wsStat = wbOut.Worksheets.Add(After:=wsData): wsStat.Name = "제출유무현황"
    wsStat.Range("A1:E1").Value = Array("연번", "대상 센터/부서", "제출 유무", "취합 행 수", "제출 파일명")
    wsStat.Range("A1:E1").Font.Bold = True
    isFirstFile = True: outRow = 1

    fileName = Dir(folderPath & "*.xls*")
    Do While fileName <> ""
        If Left(fileName, 2) <> "~$" And InStr(1, fileName, "_취합결과", vbTextCompare) = 0 Then
            Set wbSrc = Workbooks.Open(folderPath & fileName, ReadOnly:=True, UpdateLinks:=0)
            Set wsSrc = wbSrc.Worksheets(1)
            lastRow = wsSrc.Cells(wsSrc.Rows.Count, 1).End(xlUp).Row
            For c = 2 To 15
                If wsSrc.Cells(wsSrc.Rows.Count, c).End(xlUp).Row > lastRow Then
                    lastRow = wsSrc.Cells(wsSrc.Rows.Count, c).End(xlUp).Row
                End If
            Next c
            lastCol = wsSrc.Cells(headerRow, wsSrc.Columns.Count).End(xlToLeft).Column
            If lastCol < 2 Then lastCol = 10

            If isFirstFile Then
                wsSrc.Range(wsSrc.Cells(1, 1), wsSrc.Cells(headerRow, lastCol)).Copy Destination:=wsData.Cells(1, 1)
                outRow = headerRow + 1: isFirstFile = False
            End If

            copiedFromFile = 0
            For r = dataStartRow To lastRow
                rowHasValue = False
                For c = 2 To lastCol
                    cellVal = Trim(CStr(wsSrc.Cells(r, c).Value))
                    If cellVal <> "" Then rowHasValue = True: Exit For
                Next c
                If rowHasValue Then
                    If InStr(1, CStr(wsSrc.Cells(r, 1).Value), "예시") > 0 Then rowHasValue = False
                End If
                If rowHasValue Then
                    For c = 1 To lastCol
                        wsData.Cells(outRow, c).Value = wsSrc.Cells(r, c).Value
                    Next c
                    outRow = outRow + 1: copiedFromFile = copiedFromFile + 1: totalRows = totalRows + 1
                End If
            Next r

            ' 파일명으로 어느 센터가 제출했는지 자동 매칭 (제출유무 O/X 체크)
            For i = LBound(targets) To UBound(targets)
                If InStr(1, fileName, CStr(targets(i)), vbTextCompare) > 0 Then
                    isSub(i) = True
                    submittedFiles(i) = fileName
                    submittedRows(i) = submittedRows(i) + copiedFromFile
                End If
            Next i

            fileCount = fileCount + 1
            wbSrc.Close SaveChanges:=False
        End If
        fileName = Dir()
    Loop

    ' [제출유무현황] 시트에 전체 대상 센터별 제출완료(O) / 미제출(X) 기록
    statRow = 2: submitCnt = 0: missingNames = ""
    For i = LBound(targets) To UBound(targets)
        wsStat.Cells(statRow, 1).Value = i - LBound(targets) + 1
        wsStat.Cells(statRow, 2).Value = targets(i)
        If isSub(i) Then
            wsStat.Cells(statRow, 3).Value = "제출완료 (O)"
            wsStat.Cells(statRow, 4).Value = submittedRows(i)
            wsStat.Cells(statRow, 5).Value = submittedFiles(i)
            submitCnt = submitCnt + 1
        Else
            wsStat.Cells(statRow, 3).Value = "미제출 (X)"
            wsStat.Cells(statRow, 3).Font.Color = RGB(200, 30, 30)
            wsStat.Cells(statRow, 3).Font.Bold = True
            wsStat.Cells(statRow, 4).Value = 0
            wsStat.Cells(statRow, 5).Value = "-"
            If missingNames <> "" Then missingNames = missingNames & ", "
            missingNames = missingNames & targets(i)
        End If
        statRow = statRow + 1
    Next i

    firstColHeader = Replace(Trim(CStr(wsData.Cells(headerRow, 1).Value)), " ", "")
    If firstColHeader = "연번" Or firstColHeader = "순" Or firstColHeader = "순번" Then
        For r = headerRow + 1 To outRow - 1
            wsData.Cells(r, 1).Value = r - headerRow
        Next r
    End If

    If outRow > headerRow Then
        With wsData.Range(wsData.Cells(headerRow, 1), wsData.Cells(outRow - 1, lastCol))
            .Borders.LineStyle = xlContinuous
            .Font.Name = "맑은 고딕": .Font.Size = 10
        End With
    End If
    wsData.Columns.AutoFit: wsStat.Columns.AutoFit: wsData.Activate
    MsgBox "총 " & fileCount & "개 파일(" & totalRows & "행) 원본 취합 완료!" & vbCrLf & _
           "• 제출 완료: " & submitCnt & "곳 / 전체 " & (UBound(targets) - LBound(targets) + 1) & "곳" & vbCrLf & _
           "• 미제출 기관: " & IIf(missingNames = "", "없음(전원 제출)", missingNames), vbInformation, "취합 및 제출유무 확인 완료"

CleanUp:
    Application.DisplayAlerts = True
    Application.ScreenUpdating = True
End Sub`;
  }

  function vbaPage() {
    let localMerged = null;
    const sahaUnits = (Org.byName('사하소방서') ? Org.byName('사하소방서').children : []).map((c) => c.name);
    const allStations = Org.unitsAtLevel(2).filter((n) => n.type === 'station').map((n) => n.name);

    view().innerHTML = `
      <div class="page-h">
        <div>
          <h1>VBA 매크로 · 무서버 PC 로컬 폴더 취합기 (제출유무 O/X 자동 대조)</h1>
          <div class="mut">개인정보(성명·생년월일·임용일자·연락처)를 마스킹하지 않고 <b>원본 그대로 합치면서</b>, 어느 센터가 냈고(O) 안 냈는지(X) 자동 체크합니다.</div>
        </div>
      </div>

      <div class="alert ok" style="margin-bottom:16px">
        <b>💡 센터별 자료는 어디에 제출하고 어떻게 합치나요? (2가지 운영 방식 모두 지원)</b><br>
        • <b>방식 A (소방 내부망 서버 운영 시)</b>: 각 센터가 웹 시스템 화면에서 바로 제출 → 웹 대시보드에서 제출유무(O/X) 실시간 확인 → 담당자가 <b>[원본 바로 취합]</b> 버튼으로 1초 병합 (내부망 서버 안에 있어 외부 유출로부터 안전)<br>
        • <b>방식 B (별도 서버 없이 공유폴더·온나라 메신저로 파일만 받을 때)</b>: 담당자가 각 센터 엑셀 파일을 내 PC 폴더에 모아두고 아래 <b>[로컬 즉시 취합기]</b> 또는 <b>[엑셀 VBA 매크로]</b>를 실행하면, <b>파일 이름을 분석해 제출완료(O)/미제출(X) 현황표까지 자동으로 만들어 주면서 명단 원본을 하나로 합쳐줍니다!</b>
      </div>

      <div class="two">
        <div>
          <div class="card">
            <h2>방식 1. 무서버 PC 로컬 다중파일 즉시 취합 + 제출유무(O/X) 자동 대조 <span class="badge b-approved">서버 전송 0%</span></h2>
            <p class="small mut" style="margin-top:-4px">각 센터에서 보내온 엑셀 파일 여러 개(<code>(신평)...xlsx</code>, <code>(감천)...xlsx</code> 등)를 한 번에 끌어다 놓으면, <b>제출/미제출 센터(O/X)를 자동 체크</b>하고 <b>원본 그대로 1개 엑셀로 병합</b>합니다.</p>
            <div class="row" style="align-items:center;margin-bottom:8px">
              <label class="fld" style="margin:0;max-width:300px">
                <span>제출 유무(O/X) 대조 대상 그룹</span>
                <select id="local-target-grp">
                  <option value="saha">사하소방서 관할 부서·안전센터·구조대 (${sahaUnits.length}곳)</option>
                  <option value="stations">부산 12개 소방서 전체 (${allStations.length}곳)</option>
                </select>
              </label>
            </div>
            <div class="drop" id="local-merge-dz">
              각 센터가 제출한 <b>엑셀 파일 여러 개를 한꺼번에 여기로 드래그</b>하거나 클릭하여 다중 선택<br>
              <span class="small">(Ctrl 또는 Shift 키로 파일 5~60개 동시 선택 · 상단 제목/머리글 중복 제거 · 제출완료 O / 미제출 X 자동 판별)</span>
            </div>
            <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap;align-items:center">
              <button class="btn primary" id="btn-demo-local-merge">⚡ 예시 체험: 사하소방서 산하 안전센터 제출 엑셀 합치기 + 미제출 대조</button>
              <span class="small mut">누르면 센터 6곳 제출(O) + 미제출 부서(X) 현황표와 통합 명단(12명 원본)이 즉시 생성됩니다.</span>
            </div>
            <div id="local-merge-res" style="margin-top:14px"></div>
          </div>

          <div class="card">
            <h2>방식 2. 엑셀 VBA 자동취합 + 제출유무 체크 매크로 (<code>.bas</code> 코드) <span class="badge b-info">엑셀 자체 실행 · 결재 첨부용</span></h2>
            <p class="small mut" style="margin-top:-4px">웹 브라우저조차 거치지 않고 <b>순수 마이크로소프트 엑셀(Excel) 프로그램 안의 VBA 매크로</b>로 폴더 내 모든 센터 엑셀 파일을 합치고 <b>[제출유무현황] 시트에 O/X를 자동 표시</b>하는 코드입니다.</p>
            <div class="row" style="align-items:flex-end;margin-bottom:10px">
              <label class="fld" style="margin:0;max-width:220px">
                <span>서식의 표 머리글(컬럼명) 기본 행 번호</span>
                <input type="number" id="vba-hr" min="1" max="20" value="5">
              </label>
              <div style="display:flex;gap:8px;flex-wrap:wrap">
                <button class="btn primary" id="btn-dl-bas">📥 VBA 매크로 파일(.bas) 다운로드</button>
                <button class="btn" id="btn-copy-vba">📋 VBA 코드 복사</button>
              </div>
            </div>
            <pre id="vba-code-box" class="mono small" style="background:#0f172a;color:#e2e8f0;padding:14px;border-radius:8px;max-height:320px;overflow:auto;line-height:1.5;margin:0">${E(buildVbaCode(5))}</pre>
          </div>
        </div>

        <div>
          <div class="card sticky">
            <h3>📌 엑셀에 VBA 매크로 넣는 방법 (30초)</h3>
            <ol class="small" style="padding-left:18px;line-height:1.7;margin:8px 0">
              <li>각 센터에서 받은 엑셀 파일들을 바탕화면의 새 폴더(예: <code>취합폴더</code>)에 모아 둡니다.</li>
              <li>빈 엑셀을 열고 키보드에서 <b><code>Alt + F11</code></b>을 누릅니다.</li>
              <li>상단 메뉴 <b>[파일] → [파일 가져오기(Import)]</b>를 눌러 다운로드한 <code>부산소방_센터별엑셀_자동취합매크로.bas</code>를 선택합니다.</li>
              <li><b><code>F5</code></b> 키(실행)를 누르고 <code>취합폴더</code>를 선택하면 1초 만에 <b>[취합결과]</b> 시트와 <b>[제출유무현황(O/X)]</b> 시트가 완성됩니다!</li>
            </ol>
            <hr style="border:none;border-top:1px solid var(--line);margin:14px 0">
            <h3>📝 결재(기안문) 첨부용 보안성 설명 문구</h3>
            <div class="small" style="background:var(--bg);padding:10px 12px;border-radius:6px;border:1px solid var(--line);line-height:1.6" id="approval-note">
              "본 자료취합 도구는 별도의 외부 서버나 데이터베이스(DB)에 개인정보를 전송·저장하지 않고, 담당자의 행정망 PC 내부 로컬 폴더에서 엑셀 매크로(VBA)로 각 센터 제출 서식의 데이터 행만 자동 병합 및 제출 유무(O/X)를 대조하는 방식이므로 개인정보가 외부로 전송되지 않으므로 외부 유출 위험을 최소화할 수 있고 수기 취합 업무 시간을 줄일 수 있음."
            </div>
            <button class="btn sm" id="btn-copy-approval" style="margin-top:8px;width:100%">결재 설명 문구 복사</button>
          </div>
        </div>
      </div>
    `;

    const renderMergedPreview = (title, header, items, totalRows) => {
      const mergedAoa = Excel.merge(header, items);
      if (header.length && /^(연번|순|순번|No)$/i.test(header[0].trim())) {
        for (let i = 1; i < mergedAoa.length; i++) mergedAoa[i][0] = i;
      }
      const grpMode = document.getElementById('local-target-grp').value;
      const targetList = grpMode === 'stations' ? allStations : sahaUnits;
      const checkRows = targetList.map((uName, idx) => {
        const shortKey = uName.replace(/119안전센터|안전센터|119구조대|소방서|담당관|과|단$/g, '').trim() || uName;
        const found = items.find((it) => it.orgName.includes(uName) || (shortKey && it.orgName.includes(shortKey)));
        return {
          no: idx + 1,
          unit: uName,
          submitted: !!found,
          rowCount: found ? found.rows.length : 0,
          fileName: found ? found.orgName : '-',
        };
      });
      const subDoneCnt = checkRows.filter((r) => r.submitted).length;
      const missingList = checkRows.filter((r) => !r.submitted).map((r) => r.unit);
      const statAoa = [['연번', '대상 기관/센터', '제출 유무', '취합 행 수', '제출 파일명']].concat(
        checkRows.map((r) => [r.no, r.unit, r.submitted ? '제출완료 (O)' : '미제출 (X)', r.rowCount, r.fileName])
      );
      const groups = [];
      items.forEach((it, gi) => it.rows.forEach(() => groups.push(gi)));
      localMerged = {
        title,
        sheets: [
          { name: '취합결과', title: `${title} — 취합 결과`, note: `제출 ${subDoneCnt}/${checkRows.length}곳  |  파일 ${items.length}개  |  총 ${totalRows}행`, header: mergedAoa[0], rows: mergedAoa.slice(1), groups },
          {
            name: '제출유무현황', title: `${title} — 제출 유무 대조`, freeze: false,
            info: [['제출 현황', `${subDoneCnt}/${checkRows.length}곳 제출${missingList.length ? ' — 미제출: ' + missingList.join(', ') : ''}`]],
            header: statAoa[0], rows: statAoa.slice(1), statusCol: 2, statusStyle: (v) => (/\(O\)/.test(v) ? 'ok' : 'bad'),
          },
        ],
      };

      const resEl = document.getElementById('local-merge-res');
      resEl.innerHTML = `
        <div class="alert ok" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
          <div>
            <b>✅ 로컬 즉시 취합 및 제출유무 대조 완료</b> — 제출 <b>${subDoneCnt}/${checkRows.length}곳</b> · 총 <b>${totalRows}행</b> 병합됨<br>
            <span class="small">${missingList.length ? `⚠️ <b>미제출(${missingList.length}곳):</b> ${missingList.map(E).join(', ')}` : '🎉 전 기관 제출 완료!'}</span>
          </div>
          <button class="btn primary" id="btn-dl-local-merged">📥 취합결과 + 제출유무현황 엑셀(.xlsx) 다운로드</button>
        </div>
        <div class="row" style="gap:12px;margin-top:8px">
          <div style="flex:1;min-width:260px">
            <div class="small" style="font-weight:700;margin-bottom:4px">📋 센터·부서별 제출 유무 자동 대조표 (O/X)</div>
            <div class="tbl-wrap" style="max-height:240px">
              <table class="small">
                <thead><tr><th>대상 센터/부서</th><th>제출 유무</th><th>건수</th><th>파일명</th></tr></thead>
                <tbody>
                  ${checkRows.map((r) => `<tr>
                    <td><b>${E(r.unit)}</b></td>
                    <td>${r.submitted ? '<span class="badge b-approved">제출완료 (O)</span>' : '<span class="badge b-rejected">미제출 (X)</span>'}</td>
                    <td>${r.rowCount}행</td>
                    <td class="mut">${E(r.fileName)}</td>
                  </tr>`).join('')}
                </tbody>
              </table>
            </div>
          </div>
          <div style="flex:2;min-width:340px">
            <div class="small" style="font-weight:700;margin-bottom:4px">📊 병합된 명단 데이터 (개인정보 원본 그대로 표시 · 총 ${totalRows}행)</div>
            <div class="tbl-wrap" style="max-height:240px">
              <table class="small">
                <thead><tr>${header.map((h) => `<th>${E(h)}</th>`).join('')}</tr></thead>
                <tbody>
                  ${mergedAoa.slice(1, 25).map((r) => `<tr>${header.map((_, ci) => `<td>${E(r[ci] ?? '')}</td>`).join('')}</tr>`).join('')}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      `;
      document.getElementById('btn-dl-local-merged').addEventListener('click', async () => {
        U.download(new Blob([await Excel.reportBytes(localMerged.sheets)]), `${localMerged.title}_취합결과_및_제출유무.xlsx`);
        U.toast('취합결과 및 제출유무현황 엑셀 파일을 다운로드했습니다.', 'ok');
      });
    };

    U.dropzone(document.getElementById('local-merge-dz'), async (files) => {
      if (!files || !files.length) return;
      const items = [];
      let header = null;
      let totalRows = 0;
      for (const f of files) {
        try {
          const wb = Excel.read(await U.readFile(f));
          const an = Excel.analyze(wb);
          if (!header && an.columns.length) header = an.columns.map((c) => c.name);
          const cols = (header || []).map((n) => ({ name: n, type: 'text', required: false, examples: ['', ''] }));
          const v = Excel.validate(wb, cols);
          const rows = v.rows.filter((r) => !r.some((c) => String(c).includes('[예시]')));
          items.push({ orgName: f.name, rows });
          totalRows += rows.length;
        } catch (err) {
          U.toast(`${f.name} 읽기 실패: ${err.message}`, 'warn');
        }
      }
      if (!header || !items.length) return U.toast('취합할 유효한 엑셀 파일을 찾지 못했습니다.', 'warn');
      renderMergedPreview('센터별_로컬일괄취합', header, items, totalRows);
    }, { accept: '.xlsx,.xls,.csv', multiple: true });

    document.getElementById('btn-demo-local-merge').addEventListener('click', () => {
      const header = ['연번', '과 정 명', '교육기간(시작)', '교육기간(~)', '교육기간(종료)', '기관', '소 속', '직급', '성 명', '생년월일', '휴대전화', '이메일'];
      const demoCenters = [
        {
          orgName: '(신평)인재개발원_교육생추천.xlsx',
          rows: [
            ['1', '마음돌봄과 치유(대사증후군 예방)', '12.01.', '~', '12.02.', '사하소방서', '신평119안전센터', '소방위', '김하단', '78.04.12.', '010-2145-1001', 'hadan78@korea.kr'],
            ['2', '부울경 광역교통망의 이해', '12.04.', '~', '12.04.', '사하소방서', '신평119안전센터', '소방장', '박신평', '85.11.03.', '010-3382-1002', 'sinpyeong85@korea.kr'],
          ],
        },
        {
          orgName: '(감천)인재개발원_교육생추천.xlsx',
          rows: [
            ['1', '챗GPT를 활용한 보고서 작성 실무', '12.08.', '~', '12.10.', '사하소방서', '감천119안전센터', '소방위', '오감천', '80.02.19.', '010-4412-2001', 'gamcheon80@korea.kr'],
            ['2', '재난현장 스트레스 회복 프로그램', '12.15.', '~', '12.16.', '사하소방서', '감천119안전센터', '소방교', '정화재', '91.07.24.', '010-5591-2002', 'fire91@korea.kr'],
          ],
        },
        {
          orgName: '(괴정)인재개발원_교육생추천.xlsx',
          rows: [
            ['1', '마음돌봄과 치유(대사증후군 예방)', '12.01.', '~', '12.02.', '사하소방서', '괴정119안전센터', '소방장', '최괴정', '86.09.14.', '010-6623-3001', 'goejeong86@korea.kr'],
            ['2', '공직자 적극행정 및 규제혁신 과정', '12.11.', '~', '12.12.', '사하소방서', '괴정119안전센터', '소방사', '윤대원', '96.01.30.', '010-7714-3002', 'yoon96@korea.kr'],
          ],
        },
        {
          orgName: '(하단)인재개발원_교육생추천.xlsx',
          rows: [
            ['1', '부울경 광역교통망의 이해', '12.04.', '~', '12.04.', '사하소방서', '하단119안전센터', '소방위', '장하단', '79.12.05.', '010-8834-4001', 'jang79@korea.kr'],
            ['2', '챗GPT를 활용한 보고서 작성 실무', '12.08.', '~', '12.10.', '사하소방서', '하단119안전센터', '소방교', '임구급', '92.03.18.', '010-9912-4002', 'lim92@korea.kr'],
          ],
        },
        {
          orgName: '(다대)인재개발원_교육생추천.xlsx',
          rows: [
            ['1', '재난현장 스트레스 회복 프로그램', '12.15.', '~', '12.16.', '사하소방서', '다대119안전센터', '소방장', '한다대', '84.06.22.', '010-3124-5001', 'dadae84@korea.kr'],
            ['2', '마음돌봄과 치유(대사증후군 예방)', '12.01.', '~', '12.02.', '사하소방서', '다대119안전센터', '소방사', '송진압', '95.10.09.', '010-4231-5002', 'song95@korea.kr'],
          ],
        },
        {
          orgName: '(사하구조대)인재개발원_교육생추천.xlsx',
          rows: [
            ['1', '재난현장 스트레스 회복 프로그램', '12.15.', '~', '12.16.', '사하소방서', '사하119구조대', '소방장', '강구조', '87.05.11.', '010-5342-6001', 'rescue87@korea.kr'],
            ['2', '공직자 적극행정 및 규제혁신 과정', '12.11.', '~', '12.12.', '사하소방서', '사하119구조대', '소방교', '조대원', '90.08.27.', '010-6453-6002', 'cho90@korea.kr'],
          ],
        },
      ];
      renderMergedPreview('(사하소방서)인재개발원_교육생추천_6개센터', header, demoCenters, 12);
      U.toast('사하소방서 6개 센터 제출 파일(12명, 개인정보 원본 포함)을 로컬에서 즉시 병합했습니다.', 'ok');
    });

    const hrInput = document.getElementById('vba-hr');
    const codeBox = document.getElementById('vba-code-box');
    hrInput.addEventListener('input', () => {
      codeBox.textContent = buildVbaCode(hrInput.value);
    });
    document.getElementById('btn-dl-bas').addEventListener('click', () => {
      const code = buildVbaCode(hrInput.value);
      U.download(new Blob([code], { type: 'text/plain;charset=utf-8' }), '부산소방_센터별엑셀_자동취합매크로.bas');
      U.toast('VBA 매크로 파일(.bas)을 다운로드했습니다.', 'ok');
    });
    document.getElementById('btn-copy-vba').addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(buildVbaCode(hrInput.value));
        U.toast('VBA 매크로 코드를 클립보드에 복사했습니다.', 'ok');
      } catch (e) {
        U.toast('복사할 수 없습니다. 코드 영역을 직접 선택해 복사해 주세요.', 'warn');
      }
    });
    document.getElementById('btn-copy-approval').addEventListener('click', async () => {
      const txt = document.getElementById('approval-note').textContent.trim();
      try {
        await navigator.clipboard.writeText(txt);
        U.toast('결재 설명 문구를 복사했습니다.', 'ok');
      } catch (e) {
        U.toast('복사 실패', 'warn');
      }
    });
  }

  // ---------- 개인 일회용 링크 제출 ----------
  function personPage(token) {
    document.getElementById('nav').innerHTML = '';
    const f = Store.findPersonTarget(token);
    if (!f) { view().innerHTML = '<div class="card"><h2>유효하지 않은 링크</h2><p>링크가 올바르지 않습니다. 요청자에게 다시 문의하세요.</p></div>'; return; }
    const { req, target } = f;
    if (target.expires < Date.now()) { view().innerHTML = '<div class="card"><h2>만료된 링크</h2><p>제출 기한이 지나 링크가 만료되었습니다. 요청자에게 문의하세요.</p></div>'; return; }
    view().innerHTML = `<div class="card"><h1>${E(req.title)}</h1><div class="mut">${E(Org.name(req.createdOrgId))} 자료 제출 요청 · 제출자 ${E(target.name)}님 · 마감 ${U.fmtD(req.deadline)}</div>
      <p style="white-space:pre-wrap">${E(req.desc)}</p><div class="alert info small">이 링크는 <b>1회용</b>이며 제출 후 사용할 수 없습니다. (${U.fmt(target.expires)} 만료)</div></div>
      <div class="card" id="pp"></div>`;
    SubmitUI.mount(document.getElementById('pp'), req, target, { person: true, byName: `${target.name}(소방공무원)`, onDone: () => personPage(token) });
  }

  // ---------- 라우터 ----------
  function route() {
    const raw = (location.hash || '#/').slice(1);
    const [path, qs] = raw.split('?');
    const params = new URLSearchParams(qs || '');
    const u = Store.user();
    const seg = path.split('/').filter(Boolean);
    const root = seg[0] || '';
    window.scrollTo(0, 0);
    paintShell();
    try {
      if (root === 'p') return personPage(seg[1]);
      if (root === 'mobile') return mobilePage(seg[1]);
      if (root === 'new') {
        if (!['hq', 'station'].includes(u.role)) { view().innerHTML = '<div class="alert bad">요청 생성 권한이 없습니다. (본부·소방서 담당자만 가능)</div>'; return; }
        return Wizard.render(view(), params.get('from'));
      }
      if (root === 'r') return Detail.render(view(), seg[1]);
      if (root === 'vba') return vbaPage();
      if (root === 'notifications') return notifications();
      if (root === 'org') return orgPage(params.get('org'));
      if (root === 'security') return securityPage();
      if (root === 'audit') return auditPage();
      if (root === 'settings') return ['hq', 'station'].includes(u.role) ? settingsPage() : (view().innerHTML = '<div class="alert bad">권한이 없습니다.</div>');
      return dashboard();
    } catch (e) {
      console.error(e);
      view().innerHTML = `<div class="alert bad">화면을 표시하는 중 오류가 발생했습니다: ${E(e.message)}</div>`;
    }
  }

  async function boot() {
    try {
      await Store.init();
    } catch (e) {
      console.error(e);
      document.getElementById('view').innerHTML = `<div class="alert bad">저장소를 초기화할 수 없습니다 (${E(e.message)}). 브라우저의 IndexedDB/WebCrypto가 필요합니다. 로컬 서버(<code>node serve.js</code>) 주소(http://localhost:8080)로 접속해 보세요.</div>`;
      return;
    }
    document.getElementById('user-sel').addEventListener('change', (e) => {
      Store.setUser(e.target.value);
      const h = location.hash;
      if (/^#\/(audit|settings|new)/.test(h) || h.startsWith('#/p/')) location.hash = '#/'; else route();
    });
    window.addEventListener('hashchange', route);
    // 보관기간이 지난 요청은 열려 있는 동안에도 10분마다 점검하여 자동 파기
    setInterval(() => { Store.autoPurge().then((n) => { if (n) route(); }).catch((e) => console.error(e)); }, 10 * 60 * 1000);
    route();
  }

  g.App = { route };
  boot();
})(window);
