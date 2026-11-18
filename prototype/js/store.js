/* 상태 저장소 (메타 데이터: localStorage) + 권한/조회 규칙 + 변경 작업
 * 파일 본문은 Files(일반 자료 저장소), 개인정보는 Vault에 별도 암호화 저장. 메타에는 참조 키(토큰)만 남깁니다. */
(function (g) {
  const KEY = 'fire_collect_state_v6';
  const DAY = 86400000;
  const MAX_ROWS = 3000;

  const STATUS_LABEL = { none: '미제출', submitted: '검토 대기', approved: '승인', rejected: '반려' };

  const Store = {
    state: null,
    STATUS_LABEL,
    MAX_ROWS,

    async init() {
      await Vault.init();
      await Files.init();
      let raw = null;
      try { raw = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { /* ignore */ }
      if (raw && raw.v === 1) this.state = raw; else { this.state = this.seed(); this.save(); }
      if (!Array.isArray(this.state.roster)) { this.state.roster = Org.defaultRoster(); this.save(); }
      if (!this.state.settings) { this.state.settings = { prefillRoster: true }; this.save(); }
      if (!USERS.find((u) => u.id === this.state.currentUserId)) this.state.currentUserId = 'u1';
      await this.protectAll();
      await this.autoPurge();
    },

    /** 평문으로 남아 있는 개인정보(인원명부 생년월일·연락처, 제출 엑셀 개인정보 열)를 Vault 토큰으로 치환 (재실행해도 안전) */
    async protectAll() {
      let changed = 0;
      const tok = async (val, meta) => (val && !Vault.isToken(val) ? (changed++, Vault.putText(val, meta)) : val);
      for (const p of this.state.roster) {
        p.birth = await tok(p.birth, { roster: p.id, col: '생년월일' });
        p.phone = await tok(p.phone, { roster: p.id, col: '연락처' });
      }
      for (const s of this.state.submissions) {
        for (const v of s.versions) {
          if (!v.rows || !v.rows.length || !v.piiCols || !v.piiCols.length) continue;
          const idx = v.piiCols.map((n) => v.header.indexOf(n)).filter((i) => i >= 0);
          for (const row of v.rows) {
            for (const i of idx) {
              if (row[i] !== '' && row[i] != null && !Vault.isToken(row[i])) {
                row[i] = await Vault.putText(row[i], { req: s.requestId, col: v.header[i] });
                v.piiCount = (v.piiCount || 0) + 1;
                changed++;
              }
            }
          }
        }
      }
      if (changed) this.save();
      return changed;
    },

    /** 인원명부를 복호화한 사본 (서식 생성·화면 표시용). 원본 state에는 토큰만 남는다 */
    async resolvedRoster(orgId) {
      const dec = async (v) => (Vault.isToken(v) ? ((await Vault.getText(v)) || '') : v || '');
      return Promise.all(this.rosterOf(orgId).map(async (p) => ({ ...p, birth: await dec(p.birth), phone: await dec(p.phone) })));
    },

    save() {
      localStorage.setItem(KEY, JSON.stringify(this.state));
    },

    async reset() {
      await Vault.clear();
      await Files.clear();
      this.state = this.seed();
      await this.protectAll();
      this.save();
    },

    /** 보관기간 만료 시각 (마감일 + 보관일수) */
    purgeAt(req) { return req.deadline + req.retentionDays * DAY; },

    /** 보관기간이 지난 요청의 제출 자료(Vault·일반 저장소)를 자동 파기하고 요청 조직에 알린다. 파기한 요청 수 반환 */
    async autoPurge() {
      if (this._purging) return 0;
      this._purging = true;
      let count = 0;
      try {
        for (const req of this.state.requests) {
          if (req.purged || this.purgeAt(req) > Date.now()) continue;
          await this.purge(req, true);
          this.notify(req.createdOrgId, `[자동 파기] ${req.title}`, `보관기간(마감 후 ${req.retentionDays}일)이 지나 제출 자료를 파기했습니다. (메타정보와 감사 로그는 유지)`, req.id);
          count++;
        }
        if (count) this.save();
      } finally { this._purging = false; }
      return count;
    },

    /** 7일 안에 자동 파기될 내 요청 (소유자 기준) */
    purgeSoon(user) {
      user = user || this.user();
      return this.state.requests
        .filter((r) => !r.purged && this.isOwner(r, user) && this.purgeAt(r) - Date.now() <= 7 * DAY)
        .map((r) => ({ req: r, d: U.dday(this.purgeAt(r)) }))
        .sort((a, b) => a.d - b.d);
    },

    user() { return USERS.find((u) => u.id === this.state.currentUserId); },
    setUser(id) {
      this.state.currentUserId = id;
      this.save();
      this.log('login', '', 'SSO 연동 전 모의 로그인(역할 전환)');
    },

    log(action, target, detail, userOverride) {
      const u = userOverride || this.user();
      this.state.audit.unshift({
        id: U.uid('a'), at: Date.now(), userId: u ? u.id : '-', userName: u ? `${u.name}(${u.roleLabel})` : '-',
        orgName: u ? (u.orgName || Org.name(u.orgId)) : '-', action, target: target || '', detail: detail || '',
      });
      if (this.state.audit.length > 1000) this.state.audit.length = 1000;
      this.save();
    },

    // ---------- 조회 ----------
    request(id) { return this.state.requests.find((r) => r.id === id); },
    isOwner(req, user) {
      user = user || this.user();
      if (user.role === 'auditor') return false;
      // 본인이 만든 요청이거나, 요청을 만든 조직이 본인 소속(하위 포함)일 때만 소유자 (본부 담당자라고 전체 요청의 소유자가 되지 않음)
      if (req.createdBy === user.id) return true;
      return Org.within(req.createdOrgId, user.orgId) && (req.createdOrgId === user.orgId || user.role !== 'center');
    },
    visibleTargets(req, user) {
      user = user || this.user();
      if (user.role === 'auditor' || this.isOwner(req, user)) return req.targets;
      return req.targets.filter((t) => t.kind === 'org' && Org.within(t.id, user.orgId));
    },
    myTarget(req, user) {
      user = user || this.user();
      return req.targets.find((t) => t.kind === 'org' && t.id === user.orgId) || null;
    },
    visibleRequests(user) {
      user = user || this.user();
      if (user.role === 'auditor') return { sent: this.state.requests.slice(), received: [] };
      const sent = this.state.requests.filter((r) => this.isOwner(r, user));
      const received = this.state.requests.filter((r) => !this.isOwner(r, user) && r.targets.some((t) => t.kind === 'org' && Org.within(t.id, user.orgId)));
      return { sent, received };
    },
    sub(reqId, targetId) { return this.state.submissions.find((s) => s.requestId === reqId && s.targetId === targetId) || null; },
    statusOf(reqId, targetId) { const s = this.sub(reqId, targetId); return s ? s.status : 'none'; },
    lastVersion(sub) { return sub && sub.versions.length ? sub.versions[sub.versions.length - 1] : null; },
    targetName(t) { return t.kind === 'person' ? `${t.name} (개인)` : Org.path(t.id) || Org.name(t.id); },
    isOverdue(req, status) { return (status === 'none' || status === 'rejected') && req.deadline < Date.now(); },
    progress(req, targets) {
      const c = { total: targets.length, none: 0, submitted: 0, approved: 0, rejected: 0 };
      targets.forEach((t) => { c[this.statusOf(req.id, t.id)]++; });
      c.done = c.submitted + c.approved;
      return c;
    },
    children(req) { return this.state.requests.filter((r) => r.parentId === req.id); },
    notifsFor(user) { user = user || this.user(); return this.state.notifications.filter((n) => n.toOrgId === user.orgId); },
    unread(user) { return this.notifsFor(user).filter((n) => !n.read).length; },
    /** 마감 임박(D-3 이내) 또는 반려된 건 자동 알림 (제출자 기준) */
    pendingAlerts(user) {
      user = user || this.user();
      const out = [];
      this.state.requests.forEach((r) => {
        const t = this.myTarget(r, user);
        if (!t || r.status !== 'open' || r.purged) return;
        const st = this.statusOf(r.id, t.id);
        if (st === 'none' || st === 'rejected') {
          const d = U.dday(r.deadline);
          if (d <= 3) out.push({ req: r, d, st });
        }
      });
      return out.sort((a, b) => a.d - b.d);
    },
    findPersonTarget(token) {
      for (const r of this.state.requests) {
        const t = r.targets.find((x) => x.kind === 'person' && x.token === token);
        if (t) return { req: r, target: t };
      }
      return null;
    },

    // ---------- 인원명부(인사이동) 관리 ----------
    rosterOf(orgId) {
      if (!this.state || !Array.isArray(this.state.roster)) return Org.defaultRoster().filter((p) => p.orgId === orgId);
      return this.state.roster.filter((p) => p.orgId === orgId);
    },
    async addRosterPerson(p) {
      const id = U.uid('p');
      const item = {
        id, orgId: p.orgId, rank: p.rank || '소방사', name: p.name || '',
        birth: p.birth ? await Vault.putText(p.birth, { roster: id, col: '생년월일' }) : '',
        appointedAt: p.appointedAt || '',
        phone: p.phone ? await Vault.putText(p.phone, { roster: id, col: '연락처' }) : '',
        duty: p.duty || '',
      };
      this.state.roster.push(item);
      this.log('roster.add', Org.name(item.orgId), `${item.rank} ${item.name} (${item.duty || '-'}) 등록`);
      this.save();
      return item;
    },
    async updateRosterPerson(id, patch) {
      const item = this.state.roster.find((x) => x.id === id);
      if (!item) return null;
      const prevOrg = item.orgId;
      patch = { ...patch };
      for (const [k, col] of [['birth', '생년월일'], ['phone', '연락처']]) {
        if (!(k in patch)) continue;
        if (Vault.isToken(item[k])) await Vault.del(item[k]);
        patch[k] = patch[k] ? await Vault.putText(patch[k], { roster: id, col }) : '';
      }
      Object.assign(item, patch);
      if (patch.orgId && patch.orgId !== prevOrg) {
        this.log('roster.transfer', `${item.rank} ${item.name}`, `인사이동(소속 변경): ${Org.name(prevOrg)} → ${Org.name(item.orgId)}`);
      } else {
        this.log('roster.update', Org.name(item.orgId), `${item.rank} ${item.name} 인원정보 수정`);
      }
      this.save();
      return item;
    },
    async removeRosterPerson(id) {
      const idx = this.state.roster.findIndex((x) => x.id === id);
      if (idx < 0) return;
      const [rm] = this.state.roster.splice(idx, 1);
      for (const k of ['birth', 'phone']) if (Vault.isToken(rm[k])) await Vault.del(rm[k]);
      this.log('roster.remove', Org.name(rm.orgId), `${rm.rank} ${rm.name} 명부 제외`);
      this.save();
    },
    /** 전체 명부를 복호화한 사본 (일괄 갱신 비교·내보내기용) */
    async resolvedRosterAll() {
      const dec = async (v) => (Vault.isToken(v) ? ((await Vault.getText(v)) || '') : v || '');
      return Promise.all(this.state.roster.map(async (p) => ({ ...p, birth: await dec(p.birth), phone: await dec(p.phone) })));
    },
    /** RosterImport.plan 결과를 한 번에 반영한다. 감사 로그는 건별이 아니라 요약 1건 + 전보 건별로 남긴다 */
    async applyRosterPlan(plan, meta) {
      const c = { add: 0, transfer: 0, update: 0, remove: 0 };
      const transfers = [];
      const putPii = async (id, k, val) => (val ? Vault.putText(val, { roster: id, col: k === 'birth' ? '생년월일' : '연락처' }) : '');
      for (const it of plan.items) {
        if (it.kind === 'add') {
          const id = U.uid('p'), r = it.row;
          this.state.roster.push({
            id, orgId: r.orgId, rank: r.rank || '소방사', name: r.name, appointedAt: r.appointedAt || '', duty: r.duty || '',
            birth: await putPii(id, 'birth', r.birth), phone: await putPii(id, 'phone', r.phone),
          });
          c.add++;
        } else if (it.kind === 'update' || it.kind === 'transfer') {
          const item = this.state.roster.find((x) => x.id === it.id);
          if (!item) continue;
          const patch = { ...it.patch };
          for (const k of ['birth', 'phone']) {
            if (!(k in patch)) continue;
            if (Vault.isToken(item[k])) await Vault.del(item[k]);
            patch[k] = await putPii(item.id, k, patch[k]);
          }
          const prev = item.orgId;
          Object.assign(item, patch);
          if (it.kind === 'transfer') { c.transfer++; transfers.push(`${item.rank} ${item.name}: ${Org.name(prev)} → ${Org.name(item.orgId)}`); } else c.update++;
        } else if (it.kind === 'remove') {
          const idx = this.state.roster.findIndex((x) => x.id === it.id);
          if (idx < 0) continue;
          const [rm] = this.state.roster.splice(idx, 1);
          for (const k of ['birth', 'phone']) if (Vault.isToken(rm[k])) await Vault.del(rm[k]);
          c.remove++;
        }
      }
      transfers.slice(0, 30).forEach((t) => this.log('roster.transfer', '일괄 갱신', `인사이동(소속 변경): ${t}`));
      this.log('roster.import', meta && meta.source ? meta.source : '일괄 갱신', `신규 ${c.add} · 전보 ${c.transfer} · 정보수정 ${c.update} · 제외 ${c.remove}${transfers.length > 30 ? ` (전보 ${transfers.length}건 중 30건만 개별 기록)` : ''}`);
      this.save();
      return c;
    },
    setPrefillRoster(enabled) {
      this.state.settings = this.state.settings || {};
      this.state.settings.prefillRoster = !!enabled;
      this.save();
    },
    prefillRosterEnabled() {
      return !(this.state && this.state.settings && this.state.settings.prefillRoster === false);
    },

    // ---------- 변경 ----------
    notify(toOrgId, title, body, reqId) {
      this.state.notifications.unshift({ id: U.uid('n'), toOrgId, at: Date.now(), title, body, reqId, read: false });
    },
    /** 소방 모바일 어플 푸시 알림 문구 */
    messageText(req, link) {
      return `[부산소방 모바일 어플] 자료 제출 요청 알림\n- 건명: ${req.title}\n- 마감: ${U.fmtD(req.deadline)}\n- 소방 어플 [자료제출] 메뉴에서 모바일로 즉시 제출 가능\n(직접 링크: ${link})`;
    },
    outbox(channel, preview, note) {
      this.state.outbox.unshift({ id: U.uid('o'), at: Date.now(), channel, preview, note: note || '소방 모바일 어플 푸시 전송 기록' });
      if (this.state.outbox.length > 200) this.state.outbox.length = 200;
    },

    createRequest(data) {
      const u = this.user();
      const req = {
        id: U.uid('r'), createdBy: u.id, createdOrgId: u.orgId, createdAt: Date.now(), status: 'open', purged: false,
        parentId: null, ...data,
      };
      req.targets.forEach((t) => {
        if (t.kind === 'person') {
          t.token = 'ONE-' + U.uid() + U.uid();
          t.expires = req.deadline + 3 * DAY;
          t.used = false;
        }
      });
      this.state.requests.unshift(req);
      req.targets.forEach((t) => {
        if (t.kind === 'org') this.notify(t.id, `[요청] ${req.title}`, `${Org.name(u.orgId)} ${u.name}님이 자료 제출을 요청했습니다. 마감 ${U.fmtD(req.deadline)}`, req.id);
        else {
          const link = `${location.href.split('#')[0]}#/p/${t.token}`;
          const txt = this.messageText(req, link);
          ['app', 'sms'].forEach((ch) => { if (req.channels && req.channels[ch]) this.outbox(ch, `${t.name} 대원: ${txt}`); });
        }
      });
      this.log('request.create', req.title, `대상 ${req.targets.length}건, 마감 ${U.fmtD(req.deadline)}`);
      this.save();
      return req;
    },

    /** 제출 저장 (새 버전). version은 이미 Vault/Files 분리 저장이 끝난 상태의 메타 */
    saveSubmission(req, target, version, byName) {
      let sub = this.sub(req.id, target.id);
      const resub = !!sub;
      if (!sub) { sub = { id: U.uid('s'), requestId: req.id, targetId: target.id, status: 'submitted', versions: [], reviews: [] }; this.state.submissions.push(sub); }
      version.no = sub.versions.length + 1;
      version.at = Date.now();
      version.byName = byName;
      sub.versions.push(version);
      sub.status = 'submitted';
      if (target.kind === 'person') target.used = true;
      const owner = req.createdOrgId;
      this.notify(owner, `[${resub ? '재제출' : '제출'}] ${req.title}`, `${this.targetName(target)} 제출 (v${version.no})`, req.id);
      this.log(resub ? 'submit.resubmit' : 'submit', req.title, `${this.targetName(target)} v${version.no}, 개인정보 분리보관 ${version.piiCount || 0}건`,
        target.kind === 'person' ? { id: 'person', name: target.name, roleLabel: '개인(일회용 링크)', orgName: '외부 제출자' } : undefined);
      this.save();
      return sub;
    },

    review(req, target, result, reason) {
      const sub = this.sub(req.id, target.id);
      const u = this.user();
      sub.status = result;
      sub.reviews.push({ at: Date.now(), by: u.id, byName: `${u.name}(${Org.name(u.orgId)})`, result, reason: reason || '', versionNo: sub.versions.length });
      if (target.kind === 'org') this.notify(target.id, `[${result === 'approved' ? '승인' : '반려'}] ${req.title}`, result === 'approved' ? '제출하신 자료가 승인되었습니다.' : `반려 사유: ${reason}`, req.id);
      this.log(result === 'approved' ? 'review.approve' : 'review.reject', req.title, `${this.targetName(target)}${reason ? ' / ' + reason : ''}`);
      this.save();
    },

    remind(req, targets) {
      const u = this.user();
      targets.forEach((t) => {
        if (t.kind === 'org') this.notify(t.id, `[독촉] ${req.title}`, `마감 ${U.fmtD(req.deadline)} (${U.ddayLabel(req.deadline)}) — 아직 제출되지 않았습니다.`, req.id);
      });
      const link = `${location.href.split('#')[0]}#/r/${req.id}`;
      const txt = this.messageText(req, link);
      ['app', 'sms'].forEach((ch) => { if (req.channels && req.channels[ch]) this.outbox(ch, `(독촉) ${txt}`); });
      this.log('remind', req.title, `${targets.length}개 조직에 독촉 알림`);
      this.save();
    },

    /** 보관기간 경과/수동 파기: Vault와 파일 저장소 모두에서 삭제, 메타만 남김 */
    async purge(req, auto) {
      let n = 0;
      for (const s of this.state.submissions.filter((x) => x.requestId === req.id)) {
        for (const v of s.versions) {
          if (v.textToken) { await Vault.del(v.textToken); v.textToken = null; n++; }
          for (const f of v.files || []) { if (f.ref) { await (f.store === 'vault' ? Vault : Files).del(f.ref); f.ref = null; n++; } }
          for (const row of v.rows || []) for (const c of row) if (Vault.isToken(c)) { await Vault.del(c); n++; }
          v.rows = []; v.maskedRows = []; v.purged = true; v.text = v.text ? '(파기됨)' : v.text;
        }
      }
      for (const row of req.prefillRows || []) for (const c of row) if (Vault.isToken(c)) { await Vault.del(c); n++; }
      req.prefillRows = [];
      req.purged = true; req.status = 'closed';
      this.log(auto ? 'purge.auto' : 'purge', req.title, `저장 항목 ${n}건 파기${auto ? ' (보관기간 경과 자동 파기)' : ''}`, auto ? { id: 'system', name: '시스템', roleLabel: '자동 파기', orgName: '-' } : undefined);
      this.save();
      return n;
    },

    // ---------- 시드(데모 데이터: 모두 가상) ----------
    seed() {
      const now = Date.now();
      const st = {
        v: 1, currentUserId: 'u1', requests: [], submissions: [], notifications: [], audit: [], outbox: [],
        roster: Org.defaultRoster(), settings: { prefillRoster: true },
      };
      const O = (n) => Org.byName(n).id;
      const hqChannels = { app: true, sms: false };

      const r1cols = [
        { name: '장비명', type: 'text', required: true, pii: false, examples: ['소방펌프차', '고가사다리차'] },
        { name: '규격', type: 'text', required: false, pii: false, examples: ['3,000L급', '35m급'] },
        { name: '수량', type: 'number', required: true, pii: false, examples: ['3', '1'] },
        { name: '보유부서', type: 'text', required: true, pii: false, examples: ['범일119안전센터', '부산진119구조대'] },
        { name: '도입일자', type: 'date', required: false, pii: false, examples: ['2021-03-15', '2019-11-02'] },
        { name: '비고', type: 'text', required: false, pii: false, examples: ['-', '내용연수 경과'] },
      ];
      const stationIds = Org.all.filter((n) => n.type === 'station').map((n) => n.id);
      const sahaCenters = Org.all.filter((n) => n.type === 'center' && Org.within(n.id, O('사하소방서'))).map((n) => n.id);
      const busanjinAndHaeundaeCenters = Org.all.filter((n) => n.type === 'center' && (Org.within(n.id, O('부산진소방서')) || Org.within(n.id, O('해운대소방서'))));

      // 1) 소방장비 보유현황 조사 (본부 → 12개 소방서)
      const r1 = {
        id: 'r-seed1', title: '2026년 하반기 소방장비 보유현황 조사', desc: '관내 센터·구조대별 주요 소방장비 보유 수량을 제출해 주세요. 서식의 예시 행은 삭제 후 제출합니다.',
        createdBy: 'u1', createdOrgId: O('소방행정과'), createdAt: now - 4 * DAY, deadline: now + 3 * DAY, retentionDays: 90,
        kinds: { text: false, file: true, excel: true }, columns: r1cols, templateName: '장비보유현황_서식.xlsx', targetMode: 'level2',
        targets: stationIds.map((id) => ({ kind: 'org', id })), channels: hqChannels, parentId: null, status: 'open', purged: false,
      };

      // 2) 구급대원 보수교육 이수자 명단 제출 (본부 구조구급과 → 부산진·해운대 센터)
      const r2cols = [
        { name: '성명', type: 'text', required: true, pii: true, examples: ['홍길동', '김소방'] },
        { name: '생년월일', type: 'date', required: true, pii: true, examples: ['1990-05-02', '1988-11-23'] },
        { name: '연락처', type: 'text', required: true, pii: true, examples: ['010-0000-0000', '010-1111-2222'] },
        { name: '소속', type: 'text', required: true, pii: false, examples: ['범일119안전센터', '부산진119구조대'] },
        { name: '교육 이수일자', type: 'date', required: true, pii: false, examples: ['2026-10-20', '2026-10-21'] },
      ];
      const r2 = {
        id: 'r-seed2', title: '구급대원 보수교육 이수자 명단 제출', desc: '성명·생년월일·연락처는 개인정보 컬럼으로 지정되어 제출 시 암호화 분리 저장됩니다.',
        createdBy: 'u2', createdOrgId: O('구조구급과'), createdAt: now - 1 * DAY, deadline: now + 7 * DAY, retentionDays: 30,
        kinds: { text: true, file: false, excel: true }, columns: r2cols, templateName: '', targetMode: 'level3',
        targets: busanjinAndHaeundaeCenters.map((c) => ({ kind: 'org', id: c.id })), channels: { app: true, sms: true }, parentId: null, status: 'open', purged: false,
      };

      // 3) 겨울철 화재예방 대책 추진 의견 수렴
      const r3 = {
        id: 'r-seed3', title: '겨울철 화재예방 대책 추진 의견 수렴', desc: '현장 의견을 텍스트로 작성하고 필요하면 참고 파일을 첨부해 주세요.',
        createdBy: 'u1', createdOrgId: O('소방행정과'), createdAt: now - 10 * DAY, deadline: now - 1 * DAY, retentionDays: 60,
        kinds: { text: true, file: true, excel: false }, columns: [], templateName: '', targetMode: 'level3',
        targets: Org.all.filter((n) => n.type === 'center' && Org.within(n.id, O('부산진소방서'))).map((c) => ({ kind: 'org', id: c.id })),
        channels: hqChannels, parentId: null, status: 'open', purged: false,
      };

      // 4) 제21회 부산불꽃축제 근무자 명단 제출 (실제 업로드 서식 기반 · 본부 → 12개 소방서)
      const r4cols = [
        { name: '순', type: 'number', required: false, pii: false, examples: ['1', '2'] },
        { name: '구분', type: 'text', required: true, pii: false, examples: ['소방(펌프)', '소방(구급)'] },
        { name: '배치지역 (배치시간)', type: 'text', required: true, pii: false, examples: ['광안대교 하판(17:00)', '삼익아파트 앞 방파제(15:00)'] },
        { name: '차량 및 번호', type: 'text', required: true, pii: false, examples: ['신평2선펌프차', '신평예비구급차'] },
        { name: '기관', type: 'text', required: true, pii: false, examples: ['사하소방서', '해운대소방서'] },
        { name: '소속', type: 'text', required: true, pii: false, examples: ['신평119안전센터', '우동119안전센터'] },
        { name: '계급', type: 'text', required: true, pii: false, examples: ['소방장', '소방교'] },
        { name: '성명', type: 'text', required: true, pii: true, examples: ['박신평', '최범일'] },
        { name: '연락처', type: 'text', required: false, pii: true, examples: ['010-2345-6789', '010-3456-7890'] },
        { name: '비고', type: 'text', required: false, pii: false, examples: ['안전센터별 1명', '지원자'] },
      ];
      const r4 = {
        id: 'r-seed4', title: '제21회 부산불꽃축제 근무자 명단 제출', desc: '제21회 부산불꽃축제 현장 안전관리 동원 근무자(소방펌프·구급·구조·의용소방대) 명단을 소방서별로 취합하여 제출해 주세요.',
        createdBy: 'u1', createdOrgId: O('소방행정과'), createdAt: now - 3 * DAY, deadline: now + 4 * DAY, retentionDays: 60,
        kinds: { text: false, file: false, excel: true }, columns: r4cols, templateName: '불꽃축제 근무자 명단.xlsx', targetMode: 'level2',
        targets: stationIds.map((id) => ({ kind: 'org', id })), channels: hqChannels, parentId: null, status: 'open', purged: false,
      };

      // 5) 인재개발원 교육대상자 추천 명단(2026. 12월) (실제 업로드 서식 기반 · 본부 → 12개 소방서)
      const r5cols = [
        { name: '연번', type: 'number', required: false, pii: false, examples: ['1', '2'] },
        { name: '과 정 명', type: 'text', required: true, pii: false, examples: ['마음돌봄과 치유(대사증후군 예방)', '부울경 광역교통망의 이해'] },
        { name: '교육기간(시작)', type: 'text', required: true, pii: false, examples: ['12.01.', '12.04.'] },
        { name: '교육기간(~)', type: 'text', required: false, pii: false, examples: ['~', '~'] },
        { name: '교육기간(종료)', type: 'text', required: true, pii: false, examples: ['12.02.', '12.04.'] },
        { name: '기관', type: 'text', required: true, pii: false, examples: ['사하소방서', '부산진소방서'] },
        { name: '소 속', type: 'text', required: true, pii: false, examples: ['신평119안전센터', '범일119안전센터'] },
        { name: '직급', type: 'text', required: true, pii: false, examples: ['소방위', '소방장'] },
        { name: '성 명', type: 'text', required: true, pii: true, examples: ['김하단', '박신평'] },
        { name: '생년월일', type: 'text', required: false, pii: true, examples: ['78.04.12.', '85.11.03.'] },
        { name: '성별', type: 'text', required: false, pii: false, examples: ['남', '여'] },
        { name: '휴대전화번호', type: 'text', required: false, pii: true, examples: ['010-1111-2222', '010-3333-4444'] },
        { name: '비고', type: 'text', required: false, pii: false, examples: ['제28기소방위관리역량과정', '제5기 다수사상자 구급대응'] },
      ];
      const r5 = {
        id: 'r-seed5', title: '인재개발원 교육대상자 추천 명단(2026. 12월)', desc: '2026년 12월 부산광역시 인재개발원 교육과정 교육대상자 추천 명단을 소방서별로 취합하여 제출 바랍니다.',
        createdBy: 'u1', createdOrgId: O('소방행정과'), createdAt: now - 5 * DAY, deadline: now + 5 * DAY, retentionDays: 90,
        kinds: { text: false, file: false, excel: true }, columns: r5cols, templateName: '교육생 추천서식.xlsx', targetMode: 'level2',
        targets: stationIds.map((id) => ({ kind: 'org', id })), channels: hqChannels, parentId: null, status: 'open', purged: false,
      };

      // 6) 부산소방학교 전문교육훈련 과정 수료자 명단 확인 (실제 업로드 서식 기반 · 본부 → 12개 소방서)
      const r6cols = [
        { name: '연번', type: 'number', required: false, pii: false, examples: ['1', '2'] },
        { name: '교육과정', type: 'text', required: true, pii: false, examples: ['제5기 현장지휘관 자격인증(중급)', '제12기 화재진압전술 심화'] },
        { name: '교육기간', type: 'text', required: true, pii: false, examples: ['8. 31. ~ 9. 11.', '9. 14. ~ 9. 18.'] },
        { name: '시도명', type: 'text', required: true, pii: false, examples: ['부산광역시', '부산광역시'] },
        { name: '소방서명', type: 'text', required: true, pii: false, examples: ['동래소방서', '북부소방서'] },
        { name: '부서', type: 'text', required: true, pii: false, examples: ['연산119안전센터', '화명119안전센터'] },
        { name: '계급', type: 'text', required: true, pii: false, examples: ['소방경', '소방위'] },
        { name: '성 명', type: 'text', required: true, pii: true, examples: ['이상훈', '박정민'] },
        { name: '생년월일', type: 'text', required: false, pii: true, examples: ['76.05.21.', '81.09.14.'] },
        { name: '수료시간', type: 'text', required: true, pii: false, examples: ['70H', '35H'] },
        { name: '수료번호', type: 'text', required: true, pii: false, examples: ['2026F-2079', '2026F-2080'] },
        { name: '비고', type: 'text', required: false, pii: false, examples: ['-', '결강 1시간'] },
      ];
      const r6 = {
        id: 'r-seed6', title: '2026년 9월 부산소방학교 전문교육훈련 과정 수료자 명단 확인', desc: '부산소방학교 전문교육훈련 과정 소방서별 수료자 명단 및 수료시간 이상 유무를 확인하여 제출해 주세요.',
        createdBy: 'u1', createdOrgId: O('소방행정과'), createdAt: now - 6 * DAY, deadline: now + 2 * DAY, retentionDays: 180,
        kinds: { text: false, file: false, excel: true }, columns: r6cols, templateName: '전문교육훈련 수료자 명단.xlsx', targetMode: 'level2',
        targets: stationIds.map((id) => ({ kind: 'org', id })), channels: hqChannels, parentId: null, status: 'open', purged: false,
      };

      // 7) 2026년 응급의료 유관기관 워크숍 참석자 명단 (실제 업로드 서식 기반 · 구조구급과 → 12개 소방서)
      const r7cols = [
        { name: '연번', type: 'number', required: false, pii: false, examples: ['1', '2'] },
        { name: '기관', type: 'text', required: true, pii: false, examples: ['부산소방재난본부', '사하소방서'] },
        { name: '소속', type: 'text', required: true, pii: false, examples: ['구조구급과', '신평119안전센터'] },
        { name: '직책', type: 'text', required: true, pii: false, examples: ['구급정책담당', '구급대원'] },
        { name: '계급', type: 'text', required: true, pii: false, examples: ['소방위', '소방장'] },
        { name: '성명', type: 'text', required: true, pii: true, examples: ['이구급', '박신평'] },
        { name: '비고', type: 'text', required: false, pii: false, examples: ['발표자', '수상자'] },
      ];
      const r7 = {
        id: 'r-seed7', title: '2026년 부산광역시 응급의료 유관기관 워크숍 참석자 명단', desc: '응급의료 유관기관 워크숍 소방서별 참석 대상자(수상자·발표자 포함) 명단을 제출해 주세요.',
        createdBy: 'u2', createdOrgId: O('구조구급과'), createdAt: now - 3 * DAY, deadline: now + 6 * DAY, retentionDays: 60,
        kinds: { text: false, file: false, excel: true }, columns: r7cols, templateName: '응급의료 워크숍 명단.xlsx', targetMode: 'level2',
        targets: stationIds.map((id) => ({ kind: 'org', id })), channels: hqChannels, parentId: null, status: 'open', purged: false,
      };

      // 8) (사하)2026년 공공부문 아동학대 예방교육 결과 보고 (사하소방서 → 사하 관할 11개 과·센터·구조대)
      const r8cols = [
        { name: '연번', type: 'number', required: false, pii: false, examples: ['1', '2'] },
        { name: '기관', type: 'text', required: true, pii: false, examples: ['부산소방재난본부 사하소방서', '부산소방재난본부 사하소방서'] },
        { name: '소속', type: 'text', required: true, pii: false, examples: ['신평119안전센터', '감천119안전센터'] },
        { name: '계급', type: 'text', required: true, pii: false, examples: ['소방경', '소방장'] },
        { name: '성명', type: 'text', required: true, pii: true, examples: ['배신평', '박신평'] },
        { name: '교육이수일자', type: 'text', required: true, pii: false, examples: ['2026-10-15', '2026-10-16'] },
        { name: '수료여부', type: 'text', required: true, pii: false, examples: ['수료', '수료'] },
        { name: '비고', type: 'text', required: false, pii: false, examples: ['수료증 첨부', '-'] },
      ];
      const r8 = {
        id: 'r-seed8', title: '(사하)2026년 공공부문 아동학대 예방교육 결과 보고', desc: '소방행정과-10821호와 관련하여 각 부서·안전센터·구조대별 아동학대 예방교육 이수 결과 명단 및 수료증을 제출 바랍니다.',
        createdBy: 'u7', createdOrgId: O('사하소방서'), createdAt: now - 2 * DAY, deadline: now + 5 * DAY, retentionDays: 90,
        kinds: { text: false, file: true, excel: true }, columns: r8cols, templateName: '아동학대예방교육_이수자명단_서식.xlsx', targetMode: 'level3',
        targets: sahaCenters.map((id) => ({ kind: 'org', id })), channels: hqChannels, parentId: null, status: 'open', purged: false,
      };

      // 9) (사하)2026년 사하소방서 폭력예방 통합교육 및 장애인식개선 교육 결과 보고 (사하소방서 → 사하 관할 11곳)
      const r9cols = [
        { name: '연번', type: 'number', required: false, pii: false, examples: ['1', '2'] },
        { name: '기관', type: 'text', required: true, pii: false, examples: ['부산소방재난본부 사하소방서', '부산소방재난본부 사하소방서'] },
        { name: '소속', type: 'text', required: true, pii: false, examples: ['신평119안전센터', '감천119안전센터'] },
        { name: '계급', type: 'text', required: true, pii: false, examples: ['소방위', '소방교'] },
        { name: '성명', type: 'text', required: true, pii: true, examples: ['김하단', '정화재'] },
        { name: '생년월일', type: 'date', required: false, pii: true, examples: ['1978-04-12', '1991-08-22'] },
        { name: '임용일자', type: 'date', required: false, pii: false, examples: ['2005-07-11', '2017-10-16'] },
        { name: '연락처', type: 'text', required: false, pii: true, examples: ['010-2145-1001', '010-4190-1003'] },
        { name: '폭력예방 통합교육', type: 'text', required: true, pii: false, examples: ['이수(2026.10.12.)', '이수(2026.10.14.)'] },
        { name: '사회적 장애인식개선 교육', type: 'text', required: true, pii: false, examples: ['이수(2026.10.12.)', '이수(2026.10.14.)'] },
        { name: '비고', type: 'text', required: false, pii: false, examples: ['-', '-'] },
      ];
      const r9 = {
        id: 'r-seed9', title: '(사하)2026년 폭력예방 통합교육 및 장애인식개선 교육 결과 보고', desc: '법정의무교육(폭력예방 통합교육·사회적 장애인식개선 교육) 센터별 이수 현황을 제출해 주세요. (각 센터 서식 다운로드 시 소속·계급·성명·생년월일·임용일자·연락처는 자기 센터 인원만 미리 작성되어 나오니 교육 이수 여부 빈칸만 작성해 제출하세요.)',
        createdBy: 'u7', createdOrgId: O('사하소방서'), createdAt: now - 3 * DAY, deadline: now + 4 * DAY, retentionDays: 90,
        kinds: { text: false, file: true, excel: true }, columns: r9cols, templateName: '법정의무교육_이수명단_서식.xlsx', targetMode: 'level3',
        targets: sahaCenters.map((id) => ({ kind: 'org', id })), channels: hqChannels, parentId: null, status: 'open', purged: false,
      };

      // 10) 2026년 10월 구급대원 업무범위확대 특별교육 명단 보고 (본부 → 12개 소방서)
      const r10cols = [
        { name: '연번', type: 'number', required: false, pii: false, examples: ['1', '2'] },
        { name: '기관', type: 'text', required: true, pii: false, examples: ['부산소방재난본부 사하소방서', '부산소방재난본부 부산진소방서'] },
        { name: '소속', type: 'text', required: true, pii: false, examples: ['신평119안전센터', '범일119안전센터'] },
        { name: '계급', type: 'text', required: true, pii: false, examples: ['소방장', '소방교'] },
        { name: '성명', type: 'text', required: true, pii: true, examples: ['박신평', '서구급'] },
        { name: '자격구분', type: 'text', required: true, pii: false, examples: ['1급 응급구조사', '간호사'] },
        { name: '교육희망기수', type: 'text', required: true, pii: false, examples: ['1기(10.22.)', '2기(10.29.)'] },
        { name: '비고', type: 'text', required: false, pii: false, examples: ['-', '-'] },
      ];
      const r10 = {
        id: 'r-seed10', title: '2026년 10월 구급대원 업무범위확대 특별교육 명단 보고', desc: '구조구급과-5524호 관련 구급대원 업무범위확대 특별교육 대상자 명단을 소방서별로 취합 제출 바랍니다.',
        createdBy: 'u1', createdOrgId: O('소방행정과'), createdAt: now - 2 * DAY, deadline: now + 8 * DAY, retentionDays: 60,
        kinds: { text: false, file: false, excel: true }, columns: r10cols, templateName: '구급대원_특별교육_명단_서식.xlsx', targetMode: 'level2',
        targets: stationIds.map((id) => ({ kind: 'org', id })), channels: hqChannels, parentId: null, status: 'open', purged: false,
      };

      st.requests.push(r1, r2, r3, r4, r5, r6, r7, r8, r9, r10);

      const mkSub = (req, tid, status, hoursAgo, data, reviews) => {
        const t = Org.name(tid);
        const piiIdx = req.columns.map((c, i) => (c.pii ? i : -1)).filter((i) => i >= 0);
        const rows = data.rows || [];
        const maskedRows = rows.map((r) => r.map((cell, ci) => (piiIdx.includes(ci) && g.PII ? g.PII.maskValue(cell) : cell)));
        st.submissions.push({
          id: U.uid('s'), requestId: req.id, targetId: tid, status,
          versions: [{
            no: 1, at: now - hoursAgo * 3600000, byName: `${t} 담당자`,
            text: data.text || '', textToken: null, files: [],
            header: data.header || req.columns.map((c) => c.name),
            rows, maskedRows, piiCols: piiIdx.map((i) => req.columns[i].name), piiCount: 0, warnings: [],
          }],
          reviews: reviews || (status === 'approved' ? [{ at: now - (hoursAgo - 2) * 3600000, by: req.createdBy, byName: '담당자 승인', result: 'approved', reason: '', versionNo: 1 }] : []),
        });
      };

      // r1 제출 데이터 (8개 소방서 제출: 5개 승인, 2개 검토대기, 1개 반려 — 총 15행)
      const eq = (a, b, c, d, e, f) => [a, b, String(c), d, e, f || ''];
      const h1 = r1cols.map((c) => c.name);
      mkSub(r1, O('부산진소방서'), 'submitted', 20, { header: h1, rows: [eq('소방펌프차', '3,000L급', 6, '범일119안전센터', '2021-03-15'), eq('고가사다리차', '53m급', 1, '부산진119구조대', '2019-11-02')] });
      mkSub(r1, O('해운대소방서'), 'approved', 40, { header: h1, rows: [eq('소방펌프차', '3,000L급', 9, '우동119안전센터', '2022-01-20'), eq('구조공작차', '5t급', 2, '해운대119구조대', '2020-08-07')] });
      mkSub(r1, O('중부소방서'), 'rejected', 50, { header: h1, rows: [eq('소방펌프차', '', 4, '', '2018-02-01')] },
        [{ at: now - 44 * 3600000, by: 'u1', byName: '김행정(소방행정과)', result: 'rejected', reason: '규격·보유부서 항목이 비어 있습니다. 보완 후 재제출해 주세요.', versionNo: 1 }]);
      mkSub(r1, O('사하소방서'), 'submitted', 6, { header: h1, rows: [eq('소방펌프차', '2,500L급', 7, '신평119안전센터', '2020-06-30'), eq('화학차', '10,000L급', 2, '감천119안전센터', '2021-09-12')] });
      mkSub(r1, O('동래소방서'), 'approved', 36, { header: h1, rows: [eq('소방펌프차', '3,000L급', 5, '연산119안전센터', '2021-04-10'), eq('구급차', '특수구급차', 6, '온천119안전센터', '2023-02-15')] });
      mkSub(r1, O('북부소방서'), 'approved', 32, { header: h1, rows: [eq('소방펌프차', '2,800L급', 4, '화명119안전센터', '2020-11-05'), eq('굴절사다리차', '36m급', 1, '금곡119안전센터', '2019-07-22')] });
      mkSub(r1, O('사상소방서'), 'approved', 28, { header: h1, rows: [eq('화학차', '8,000L급', 2, '감전119안전센터', '2022-05-18'), eq('소방펌프차', '3,000L급', 5, '주례119안전센터', '2021-08-30')] });
      mkSub(r1, O('남부소방서'), 'approved', 24, { header: h1, rows: [eq('소방펌프차', '3,000L급', 6, '광안119안전센터', '2023-01-12'), eq('구조버스', '중형', 1, '남부119구조대', '2020-03-19')] });

      // r3 제출 데이터
      mkSub(r3, O('범일119안전센터'), 'approved', 60, { text: '노후 전열기구 점검 홍보 강화와 취약계층 가구 방문 점검을 확대할 필요가 있습니다.' });
      mkSub(r3, O('부전119안전센터'), 'submitted', 30, { text: '전통시장 야간 순찰 시 소화기 비치 현황을 함께 확인하고 있습니다.' });

      // r4 (제21회 부산불꽃축제 근무자 명단) — 8개 소방서 제출 완료 (6개 승인, 2개 검토대기, 총 16행)
      [
        ['사하소방서', 'approved', [['1', '소방(펌프)', '광안대교 하판(17:00)', '신평2선펌프차', '사하소방서', '신평119안전센터', '소방장', '박신평', '010-2345-6789', '안전센터별 1명'], ['2', '소방(구급)', '삼익아파트 앞 방파제(15:00)', '감천예비구급차', '사하소방서', '감천119안전센터', '소방교', '조감천', '010-3456-7890', '구급지원']]],
        ['해운대소방서', 'approved', [['1', '소방(펌프)', '마린시티 방파제(16:00)', '우동1선펌프차', '해운대소방서', '우동119안전센터', '소방위', '정우동', '010-4111-2233', '현장지휘'], ['2', '소방(구조)', '동백섬 선착장(16:00)', '해운대구조공작차', '해운대소방서', '해운대119구조대', '소방장', '강구조', '010-4222-3344', '수난구조 대기']]],
        ['남부소방서', 'approved', [['1', '소방(펌프)', '광안리해수욕장 중앙(15:00)', '광안1선펌프차', '남부소방서', '광안119안전센터', '소방위', '김광안', '010-5111-2222', '본부 통제소'], ['2', '의용소방대', '도시철도 수영역(14:00)', '-', '남부소방서', '광안의용소방대', '대원', '이수영', '010-5222-3333', '질서유지']]],
        ['부산진소방서', 'approved', [['1', '소방(펌프)', '황령산 봉수대 진입로(16:00)', '범일2선펌프차', '부산진소방서', '범일119안전센터', '소방교', '최범일', '010-6111-2222', '산불예방 대기'], ['2', '소방(구급)', '광안리 호메르스호텔 앞(15:00)', '부전예비구급차', '부산진소방서', '부전119안전센터', '소방사', '박부전', '010-6222-3333', '구급지원']]],
        ['동래소방서', 'approved', [['1', '소방(펌프)', '민락수변공원(16:00)', '연산2선펌프차', '동래소방서', '연산119안전센터', '소방장', '오연산', '010-7111-2222', '지원출동'], ['2', '소방(구급)', '민락회센터 앞(15:00)', '온천구급차', '동래소방서', '온천119안전센터', '소방교', '한온천', '010-7222-3333', '구급지원']]],
        ['금정소방서', 'approved', [['1', '소방(펌프)', '수영교 교차로(16:30)', '부곡2선펌프차', '금정소방서', '부곡119안전센터', '소방장', '서부곡', '010-8111-2222', '안전센터별 1명'], ['2', '소방(구조)', '광안대교 상판(16:30)', '금정구조차', '금정소방서', '금정119구조대', '소방교', '유금정', '010-8222-3333', '구조대 2명']]],
        ['북부소방서', 'submitted', [['1', '소방(펌프)', '남천항 일원(16:00)', '화명2선펌프차', '북부소방서', '화명119안전센터', '소방위', '장화명', '010-9111-2222', '안전센터별 1명'], ['2', '의용소방대', '광안역 3번출구(14:00)', '-', '북부소방서', '화명의용소방대', '대원', '신화명', '010-9222-3333', '안전유도']]],
        ['사상소방서', 'submitted', [['1', '소방(구급)', '이기대 수변공원(15:30)', '감전예비구급차', '사상소방서', '감전119안전센터', '소방교', '문감전', '010-3111-4444', '지원자'], ['2', '소방(펌프)', '이기대 진입로(16:00)', '주례2선펌프차', '사상소방서', '주례119안전센터', '소방사', '배주례', '010-3222-5555', '-']]],
      ].forEach(([stName, status, rows], i) => mkSub(r4, O(stName), status, 30 - i * 2, { rows }));

      // r5 (인재개발원 교육대상자 추천 명단) — 7개 소방서 제출 완료 (6개 승인, 1개 검토대기, 총 14행)
      [
        ['사하소방서', 'approved', [['1', '마음돌봄과 치유(대사증후군 예방)', '12.01.', '~', '12.02.', '사하소방서', '신평119안전센터', '소방위', '김하단', '79.03.15.', '남', '010-2111-3344', '제28기소방위관리역량과정'], ['2', '부울경 광역교통망의 이해', '12.04.', '~', '12.04.', '사하소방서', '감천119안전센터', '소방장', '서구급', '84.07.22.', '여', '010-2333-4455', '제5기 다수사상자 구급대응']]],
        ['부산진소방서', 'approved', [['1', '마음돌봄과 치유(대사증후군 예방)', '12.01.', '~', '12.02.', '부산진소방서', '범일119안전센터', '소방위', '서부전', '78.11.09.', '남', '010-3111-2233', '-'], ['2', '공직자 재무설계와 은퇴준비', '12.08.', '~', '12.10.', '부산진소방서', '소방행정과', '소방장', '이진서', '82.05.19.', '남', '010-3222-4455', '-']]],
        ['동래소방서', 'approved', [['1', '부울경 광역교통망의 이해', '12.04.', '~', '12.04.', '동래소방서', '연산119안전센터', '소방위', '박연산', '80.02.14.', '남', '010-4111-5566', '인포그래픽 데이터시각화 수료'], ['2', '마음돌봄과 치유(대사증후군 예방)', '12.01.', '~', '12.02.', '동래소방서', '수안119안전센터', '소방교', '최수안', '89.09.30.', '여', '010-4222-6677', '-']]],
        ['해운대소방서', 'approved', [['1', '생성형 AI 활용 행정업무 혁신', '12.11.', '~', '12.12.', '해운대소방서', '센텀119안전센터', '소방장', '정센텀', '86.01.25.', '남', '010-5111-7788', '업무효율을 높이는 앱활용'], ['2', '마음돌봄과 치유(대사증후군 예방)', '12.01.', '~', '12.02.', '해운대소방서', '우동119안전센터', '소방교', '강우동', '91.06.12.', '남', '010-5222-8899', '-']]],
        ['남부소방서', 'approved', [['1', '부울경 광역교통망의 이해', '12.04.', '~', '12.04.', '남부소방서', '대연119안전센터', '소방위', '윤대연', '77.12.01.', '남', '010-6111-9900', '-'], ['2', '생성형 AI 활용 행정업무 혁신', '12.11.', '~', '12.12.', '남부소방서', '예방안전과', '소방교', '장예방', '90.04.08.', '여', '010-6222-1122', '-']]],
        ['북부소방서', 'approved', [['1', '마음돌봄과 치유(대사증후군 예방)', '12.01.', '~', '12.02.', '북부소방서', '구포119안전센터', '소방장', '임구포', '83.08.17.', '남', '010-7111-2233', '-'], ['2', '공직자 재무설계와 은퇴준비', '12.08.', '~', '12.10.', '북부소방서', '현장대응단', '소방위', '한대응', '76.10.23.', '남', '010-7222-3344', '-']]],
        ['강서소방서', 'submitted', [['1', '부울경 광역교통망의 이해', '12.04.', '~', '12.04.', '강서소방서', '녹산119안전센터', '소방장', '오녹산', '85.03.29.', '남', '010-8111-4455', '-'], ['2', '마음돌봄과 치유(대사증후군 예방)', '12.01.', '~', '12.02.', '강서소방서', '명지119안전센터', '소방교', '신명지', '92.11.15.', '여', '010-8222-5566', '-']]],
      ].forEach(([stName, status, rows], i) => mkSub(r5, O(stName), status, 28 - i * 2, { rows }));

      // r6 (부산소방학교 전문교육훈련 과정 수료자 명단 확인) — 8개 소방서 제출 완료 (7개 승인, 1개 검토대기, 총 16행)
      [
        ['동래소방서', 'approved', [['1', '제5기 현장지휘관 자격인증(중급)', '8. 31. ~ 9. 11.', '부산광역시', '동래소방서', '연산119안전센터', '소방경', '김연산', '74.02.11.', '70H', '2026F-2079', '-'], ['2', '제14기 화재진압전술 과정', '9. 14. ~ 9. 25.', '부산광역시', '동래소방서', '온천119안전센터', '소방교', '이온천', '88.07.19.', '70H', '2026F-2110', '-']]],
        ['북부소방서', 'approved', [['1', '제5기 현장지휘관 자격인증(중급)', '8. 31. ~ 9. 11.', '부산광역시', '북부소방서', '북부119구조대', '소방경', '박구조', '75.06.03.', '69H', '2026F-2080', '9. 10. 결강 1시간'], ['2', '제5기 현장지휘관 자격인증(중급)', '8. 31. ~ 9. 11.', '부산광역시', '북부소방서', '화명119안전센터', '소방경', '최화명', '76.09.28.', '70H', '2026F-2081', '-']]],
        ['금정소방서', 'approved', [['1', '제5기 현장지휘관 자격인증(중급)', '8. 31. ~ 9. 11.', '부산광역시', '금정소방서', '현장대응단', '소방경', '정금정', '73.11.15.', '70H', '2026F-2083', '-'], ['2', '제8기 구급전문교육 과정', '9. 7. ~ 9. 18.', '부산광역시', '금정소방서', '서동119안전센터', '소방장', '강서동', '84.04.05.', '70H', '2026F-2145', '-']]],
        ['남부소방서', 'approved', [['1', '제5기 현장지휘관 자격인증(중급)', '8. 31. ~ 9. 11.', '부산광역시', '남부소방서', '현장대응단', '소방경', '조남부', '75.01.20.', '70H', '2026F-2084', '-'], ['2', '제5기 현장지휘관 자격인증(중급)', '8. 31. ~ 9. 11.', '부산광역시', '남부소방서', '광안119안전센터', '소방경', '윤광안', '77.08.12.', '70H', '2026F-2085', '-']]],
        ['강서소방서', 'approved', [['1', '제5기 현장지휘관 자격인증(중급)', '8. 31. ~ 9. 11.', '부산광역시', '강서소방서', '녹산119안전센터', '소방경', '장녹산', '76.03.30.', '70H', '2026F-2086', '-'], ['2', '제14기 화재진압전술 과정', '9. 14. ~ 9. 25.', '부산광역시', '강서소방서', '신호119안전센터', '소방사', '임신호', '94.12.09.', '70H', '2026F-2122', '-']]],
        ['항만소방서', 'approved', [['1', '제5기 현장지휘관 자격인증(중급)', '8. 31. ~ 9. 11.', '부산광역시', '항만소방서', '현장대응단', '소방경', '한항만', '74.10.04.', '67H', '2026F-2087', '9. 8. 결강 3시간'], ['2', '제6기 선박화재대응 특수과정', '9. 14. ~ 9. 18.', '부산광역시', '항만소방서', '소방1정대', '소방위', '오정대', '81.05.17.', '35H', '2026F-2190', '-']]],
        ['사하소방서', 'approved', [['1', '제5기 현장지휘관 자격인증(중급)', '8. 31. ~ 9. 11.', '부산광역시', '사하소방서', '신평119안전센터', '소방경', '배신평', '75.04.18.', '70H', '2026F-2089', '-'], ['2', '제8기 구급전문교육 과정', '9. 7. ~ 9. 18.', '부산광역시', '사하소방서', '감천119안전센터', '소방장', '서구급', '85.11.21.', '70H', '2026F-2150', '-']]],
        ['해운대소방서', 'submitted', [['1', '제5기 현장지휘관 자격인증(중급)', '8. 31. ~ 9. 11.', '부산광역시', '해운대소방서', '우동119안전센터', '소방경', '문우동', '76.07.07.', '70H', '2026F-2090', '-'], ['2', '제14기 화재진압전술 과정', '9. 14. ~ 9. 25.', '부산광역시', '해운대소방서', '반여119안전센터', '소방교', '양반여', '89.02.25.', '70H', '2026F-2130', '-']]],
      ].forEach(([stName, status, rows], i) => mkSub(r6, O(stName), status, 25 - i * 2, { rows }));

      // r7 (2026년 응급의료 유관기관 워크숍 참석자 명단) — 7개 소방서 제출 완료 (6개 승인, 1개 검토대기, 총 14행)
      [
        ['부산진소방서', 'approved', [['1', '부산진소방서', '부전119안전센터', '구급대원', '소방교', '김부전', '유공 표창 수상자'], ['2', '부산진소방서', '구조구급과', '구급담당', '소방위', '이구조', '분임토의 발표자']]],
        ['사하소방서', 'approved', [['1', '사하소방서', '신평119안전센터', '구급대원', '소방장', '박신평', '우수 구급대원'], ['2', '사하소방서', '구조구급과', '구급담당', '소방위', '최사하', '-']]],
        ['해운대소방서', 'approved', [['1', '해운대소방서', '중동119안전센터', '구급대원', '소방교', '정중동', '유공 표창 수상자'], ['2', '해운대소방서', '센텀119안전센터', '구급대원', '소방사', '강센텀', '-']]],
        ['동래소방서', 'approved', [['1', '동래소방서', '온천119안전센터', '구급대원', '소방장', '조온천', '사례 발표자'], ['2', '동래소방서', '구조구급과', '구급계장', '소방경', '윤동래', '-']]],
        ['남부소방서', 'approved', [['1', '남부소방서', '광안119안전센터', '구급대원', '소방교', '장광안', '-'], ['2', '남부소방서', '감만119안전센터', '구급대원', '소방사', '임감만', '-']]],
        ['북부소방서', 'approved', [['1', '북부소방서', '구포119안전센터', '구급대원', '소방장', '한구포', '유공 표창 수상자'], ['2', '북부소방서', '화명119안전센터', '구급대원', '소방교', '오화명', '-']]],
        ['기장소방서', 'submitted', [['1', '기장소방서', '정관119안전센터', '구급대원', '소방교', '신정관', '-'], ['2', '기장소방서', '일광119안전센터', '구급대원', '소방사', '배일광', '-']]],
      ].forEach(([stName, status, rows], i) => mkSub(r7, O(stName), status, 22 - i * 2, { rows }));

      // r8 ((사하)2026년 공공부문 아동학대 예방교육 결과 보고) — 사하 관할 6개 센터·구조대 제출 완료 (5개 승인, 1개 검토대기, 총 20행)
      [
        ['신평119안전센터', 'approved', [
          ['1', '부산소방재난본부 사하소방서', '신평119안전센터', '소방경', '배신평', '2026-10-12', '수료', '센터장'],
          ['2', '부산소방재난본부 사하소방서', '신평119안전센터', '소방위', '김하단', '2026-10-12', '수료', '1팀장'],
          ['3', '부산소방재난본부 사하소방서', '신평119안전센터', '소방장', '박신평', '2026-10-13', '수료', '구급대원'],
          ['4', '부산소방재난본부 사하소방서', '신평119안전센터', '소방교', '정화재', '2026-10-14', '수료', '화재진압'],
        ]],
        ['감천119안전센터', 'approved', [
          ['1', '부산소방재난본부 사하소방서', '감천119안전센터', '소방경', '오감천', '2026-10-11', '수료', '센터장'],
          ['2', '부산소방재난본부 사하소방서', '감천119안전센터', '소방위', '한괴정', '2026-10-11', '수료', '1팀장'],
          ['3', '부산소방재난본부 사하소방서', '감천119안전센터', '소방장', '서구급', '2026-10-12', '수료', '구급대원'],
          ['4', '부산소방재난본부 사하소방서', '감천119안전센터', '소방교', '조감천', '2026-10-12', '수료', '화재진압'],
        ]],
        ['괴정119안전센터', 'approved', [
          ['1', '부산소방재난본부 사하소방서', '괴정119안전센터', '소방경', '장괴정', '2026-10-10', '수료', '센터장'],
          ['2', '부산소방재난본부 사하소방서', '괴정119안전센터', '소방위', '임사하', '2026-10-10', '수료', '1팀장'],
          ['3', '부산소방재난본부 사하소방서', '괴정119안전센터', '소방교', '강구급', '2026-10-13', '수료', '구급대원'],
        ]],
        ['하단119안전센터', 'approved', [
          ['1', '부산소방재난본부 사하소방서', '하단119안전센터', '소방경', '문하단', '2026-10-14', '수료', '센터장'],
          ['2', '부산소방재난본부 사하소방서', '하단119안전센터', '소방위', '신을숙', '2026-10-14', '수료', '1팀장'],
          ['3', '부산소방재난본부 사하소방서', '하단119안전센터', '소방교', '유구급', '2026-10-15', '수료', '구급대원'],
        ]],
        ['다대119안전센터', 'approved', [
          ['1', '부산소방재난본부 사하소방서', '다대119안전센터', '소방경', '권다대', '2026-10-12', '수료', '센터장'],
          ['2', '부산소방재난본부 사하소방서', '다대119안전센터', '소방위', '황몰운', '2026-10-13', '수료', '1팀장'],
          ['3', '부산소방재난본부 사하소방서', '다대119안전센터', '소방교', '전구급', '2026-10-15', '수료', '구급대원'],
        ]],
        ['사하119구조대', 'submitted', [
          ['1', '부산소방재난본부 사하소방서', '사하119구조대', '소방경', '류구조', '2026-10-16', '수료', '구조대장'],
          ['2', '부산소방재난본부 사하소방서', '사하119구조대', '소방위', '고특수', '2026-10-16', '수료', '구조1팀장'],
          ['3', '부산소방재난본부 사하소방서', '사하119구조대', '소방장', '양수난', '2026-10-16', '수료', '구조대원'],
        ]],
      ].forEach(([cName, status, rows], i) => mkSub(r8, O(cName), status, 18 - i * 2, { rows }));

      // r9 ((사하)2026년 폭력예방 통합교육 및 장애인식개선 교육 결과 보고) — 4개 센터 제출 완료 (신평·감천은 직접 제출 체험 가능하도록 미제출 상태로 유지)
      [
        ['괴정119안전센터', 'approved', [
          ['1', '부산소방재난본부 사하소방서', '괴정119안전센터', '소방경', '장괴정', '1975-01-20', '2001-06-01', '010-6623-3000', '이수(2026.05.24.)', '이수(2026.04.19.)', '-'],
          ['2', '부산소방재난본부 사하소방서', '괴정119안전센터', '소방위', '임사하', '1981-09-14', '2008-03-17', '010-6623-3001', '이수(2026.05.25.)', '이수(2026.04.20.)', '-'],
          ['3', '부산소방재난본부 사하소방서', '괴정119안전센터', '소방교', '강구급', '1990-07-07', '2016-09-26', '010-7714-3002', '이수(2026.05.26.)', '이수(2026.04.21.)', '-'],
        ]],
        ['하단119안전센터', 'approved', [
          ['1', '부산소방재난본부 사하소방서', '하단119안전센터', '소방경', '문하단', '1973-11-02', '1999-08-16', '010-8834-4000', '이수(2026.05.27.)', '이수(2026.04.22.)', '-'],
          ['2', '부산소방재난본부 사하소방서', '하단119안전센터', '소방위', '신을숙', '1979-12-05', '2006-04-03', '010-8834-4001', '이수(2026.05.28.)', '이수(2026.04.23.)', '-'],
          ['3', '부산소방재난본부 사하소방서', '하단119안전센터', '소방교', '유구급', '1992-03-18', '2018-05-14', '010-9912-4002', '이수(2026.05.29.)', '이수(2026.04.24.)', '-'],
        ]],
        ['다대119안전센터', 'approved', [
          ['1', '부산소방재난본부 사하소방서', '다대119안전센터', '소방경', '권다대', '1974-08-15', '2000-09-04', '010-3124-5000', '이수(2026.05.26.)', '이수(2026.04.21.)', '-'],
          ['2', '부산소방재난본부 사하소방서', '다대119안전센터', '소방위', '황몰운', '1984-06-22', '2010-10-18', '010-3124-5001', '이수(2026.05.27.)', '이수(2026.04.22.)', '-'],
          ['3', '부산소방재난본부 사하소방서', '다대119안전센터', '소방교', '전구급', '1991-04-09', '2017-06-12', '010-4231-5002', '이수(2026.05.28.)', '이수(2026.04.23.)', '-'],
        ]],
        ['사하119구조대', 'submitted', [
          ['1', '부산소방재난본부 사하소방서', '사하119구조대', '소방경', '류구조', '1975-03-28', '2001-02-19', '010-5342-6000', '이수(2026.05.30.)', '이수(2026.04.25.)', '-'],
          ['2', '부산소방재난본부 사하소방서', '사하119구조대', '소방위', '고특수', '1982-11-19', '2009-07-06', '010-5342-6001', '이수(2026.05.30.)', '이수(2026.04.25.)', '-'],
          ['3', '부산소방재난본부 사하소방서', '사하119구조대', '소방장', '양수난', '1987-05-11', '2014-04-21', '010-6453-6002', '이수(2026.05.30.)', '이수(2026.04.25.)', '-'],
        ]],
      ].forEach(([cName, status, rows], i) => mkSub(r9, O(cName), status, 16 - i * 2, { rows }));

      // r10 (2026년 10월 구급대원 업무범위확대 특별교육 명단 보고) — 7개 소방서 제출 완료 (6개 승인, 1개 검토대기, 총 14행)
      [
        ['사하소방서', 'approved', [['1', '부산소방재난본부 사하소방서', '신평119안전센터', '소방장', '박신평', '1급 응급구조사', '1기(10.22.)', '-'], ['2', '부산소방재난본부 사하소방서', '감천119안전센터', '소방장', '서구급', '간호사', '2기(10.29.)', '-']]],
        ['부산진소방서', 'approved', [['1', '부산소방재난본부 부산진소방서', '범일119안전센터', '소방교', '최범일', '1급 응급구조사', '1기(10.22.)', '-'], ['2', '부산소방재난본부 부산진소방서', '부전119안전센터', '소방교', '김부전', '1급 응급구조사', '2기(10.29.)', '-']]],
        ['동래소방서', 'approved', [['1', '부산소방재난본부 동래소방서', '연산119안전센터', '소방장', '오연산', '간호사', '1기(10.22.)', '-'], ['2', '부산소방재난본부 동래소방서', '온천119안전센터', '소방교', '한온천', '1급 응급구조사', '2기(10.29.)', '-']]],
        ['해운대소방서', 'approved', [['1', '부산소방재난본부 해운대소방서', '우동119안전센터', '소방교', '강우동', '1급 응급구조사', '1기(10.22.)', '-'], ['2', '부산소방재난본부 해운대소방서', '센텀119안전센터', '소방사', '정센텀', '간호사', '2기(10.29.)', '-']]],
        ['남부소방서', 'approved', [['1', '부산소방재난본부 남부소방서', '광안119안전센터', '소방교', '장광안', '1급 응급구조사', '1기(10.22.)', '-'], ['2', '부산소방재난본부 남부소방서', '대연119안전센터', '소방사', '윤대연', '1급 응급구조사', '2기(10.29.)', '-']]],
        ['북부소방서', 'approved', [['1', '부산소방재난본부 북부소방서', '화명119안전센터', '소방장', '오화명', '간호사', '1기(10.22.)', '-'], ['2', '부산소방재난본부 북부소방서', '구포119안전센터', '소방교', '한구포', '1급 응급구조사', '2기(10.29.)', '-']]],
        ['금정소방서', 'submitted', [['1', '부산소방재난본부 금정소방서', '부곡119안전센터', '소방장', '서부곡', '1급 응급구조사', '1기(10.22.)', '-'], ['2', '부산소방재난본부 금정소방서', '서동119안전센터', '소방교', '강서동', '간호사', '2기(10.29.)', '-']]],
      ].forEach(([stName, status, rows], i) => mkSub(r10, O(stName), status, 14 - i * 2, { rows }));

      st.notifications.push(
        { id: U.uid('n'), toOrgId: O('부산진소방서'), at: now - 4 * DAY, title: `[요청] ${r1.title}`, body: '소방행정과 김행정님이 자료 제출을 요청했습니다.', reqId: r1.id, read: false },
        { id: U.uid('n'), toOrgId: O('범일119안전센터'), at: now - 1 * DAY, title: `[요청] ${r2.title}`, body: '구조구급과 이구급님이 자료 제출을 요청했습니다.', reqId: r2.id, read: false },
      );
      st.audit.push({ id: U.uid('a'), at: now - 4 * DAY, userId: 'u1', userName: '김행정(본부 담당자)', orgName: '소방행정과', action: 'request.create', target: r1.title, detail: '시드 데이터' });
      return st;
    },
  };

  g.Store = Store;
})(window);
