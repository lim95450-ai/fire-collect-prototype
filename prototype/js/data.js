/* 조직도(샘플) 및 모의 사용자.
 * ※ 부산소방재난본부 정식 조직도 수령 후 교체 예정. 현재는 공개 자료 기반 샘플입니다. */
(function (g) {
  const D = (name, teams) => ({ name, type: 'dept', children: teams.map((t) => ({ name: t, type: 'team' })) });
  const STATION_DEPTS = ['청문감사담당관', '소방행정과', '예방안전과', '구조구급과', '현장대응단'];
  const S = (name, centers) => ({ name, type: 'station', children: STATION_DEPTS.concat(centers).map((c) => ({ name: c, type: 'center' })) });

  const stations = [
    S('중부소방서', ['중앙119안전센터', '부민119안전센터', '충무119안전센터', '창선119안전센터', '초량119안전센터', '중부119구조대']),
    S('부산진소방서', ['부전119안전센터', '범일119안전센터', '수정119안전센터', '가야119안전센터', '당감119안전센터', '부산진119구조대']),
    S('동래소방서', ['연산119안전센터', '수안119안전센터', '온천119안전센터', '양정119안전센터', '사직119안전센터', '동래119구조대']),
    S('북부소방서', ['금곡119안전센터', '구포119안전센터', '화명119안전센터', '만덕119안전센터', '북부119구조대']),
    S('사상소방서', ['삼락119안전센터', '감전119안전센터', '주례119안전센터', '학장119안전센터', '모라119안전센터', '사상119구조대']),
    S('사하소방서', ['신평119안전센터', '괴정119안전센터', '하단119안전센터', '다대119안전센터', '감천119안전센터', '사하119구조대']),
    S('해운대소방서', ['우동119안전센터', '중동119안전센터', '반여119안전센터', '좌동119안전센터', '센텀119안전센터', '해운대119구조대']),
    S('금정소방서', ['부곡119안전센터', '서동119안전센터', '남산119안전센터', '회동119안전센터', '산성산악119안전센터', '금정119구조대']),
    S('남부소방서', ['광안119안전센터', '감만119안전센터', '대연119안전센터', '망미119안전센터', '용당119안전센터', '남부119구조대']),
    S('강서소방서', ['녹산119안전센터', '신호119안전센터', '대저119안전센터', '강동119안전센터', '지사119안전센터', '강서119구조대']),
    S('항만소방서', ['동삼119안전센터', '영선119안전센터', '청학119안전센터', '부두119안전센터', '소방1정대', '소방2정대', '항만119구조대']),
    S('기장소방서', ['정관119안전센터', '일광119안전센터', '송정119안전센터', '장안119안전센터', '기장119구조대']),
  ];

  const TREE = {
    name: '부산소방재난본부', type: 'hq', children: [
      {
        name: '소방재난본부', type: 'group', children: [
          D('소방행정과', ['소방행정계', '소방조직관리계', '기획예산계']),
          D('방호조사과', ['방호계', '전술훈련계', '화재조사계']),
          D('구조구급과', ['구조계', '구급계', '생활안전계', '소방홍보계']),
          D('119종합상황실', ['상황분석계', '정보통신계', '상황관리계', '구급상황관리센터']),
          D('재난예방담당관', ['예방지도계', '소방제도계', '위험물안전계', '재난안전조사계']),
          D('소방감사담당관', ['청렴감찰계', '감사계', '법무수사계', '보건안전계']),
          D('회계장비담당관', ['회계예산계', '장비관리계', '계약관리계', '청사관리계']),
          D('인사담당관', ['인사계', '인재채용계', '교육기획계', '후생복지계']),
          D('119특수대응단', ['운영지원계', '특수구조대', '119항공대', '수상구조대']),
          D('119안전체험관', ['체험운영계', '체험기획계', '안전지원계']),
        ],
      },
      {
        name: '소방학교', type: 'group', children: [
          D('소방학교', ['교육지원과', '인재양성과', '교육훈련과']),
        ],
      },
      { name: '12개 소방서', type: 'group', children: stations },
    ],
  };

  const Org = { root: TREE, byId: {}, parentOf: {}, all: [] };

  (function assign(node, id, parent) {
    node.id = id;
    Org.byId[id] = node;
    Org.all.push(node);
    if (parent) Org.parentOf[id] = parent.id;
    (node.children || []).forEach((c, i) => assign(c, id + '.' + i, node));
  })(TREE, 'hq', null);

  /** 요청 단위 레벨: dept/station = 2(부서·소방서), team/center = 3(계·센터) */
  Org.unitLevel = (n) => (n.type === 'dept' || n.type === 'station' ? 2 : n.type === 'team' || n.type === 'center' ? 3 : 0);
  Org.node = (id) => Org.byId[id];
  Org.name = (id) => (Org.byId[id] ? Org.byId[id].name : id);
  Org.byName = (name) => {
    if (!name) return undefined;
    const stripped = String(name).replace(/^부산/, '');
    return Org.all.find((n) => n.name === name)
      || Org.all.find((n) => n.name === stripped)
      || Org.all.find((n) => n.name === '부산' + stripped);
  };
  /** 경로 문자열 (본부/그룹 제외) 예: 부산진소방서 > 범일119안전센터 */
  Org.path = (id) => {
    const out = [];
    let cur = id;
    while (cur) {
      const n = Org.byId[cur];
      if (n && n.type !== 'hq' && n.type !== 'group') out.unshift(n.name);
      cur = Org.parentOf[cur];
    }
    return out.join(' > ');
  };
  /** id가 ancestorId의 하위(또는 동일)인가 */
  Org.within = (id, ancestorId) => {
    let cur = id;
    while (cur) {
      if (cur === ancestorId) return true;
      cur = Org.parentOf[cur];
    }
    return false;
  };
  Org.subtree = (id) => {
    const out = [];
    (function walk(n) { out.push(n.id); (n.children || []).forEach(walk); })(Org.byId[id]);
    return out;
  };
  Org.unitsAtLevel = (level) => Org.all.filter((n) => Org.unitLevel(n) === level);
  Org.stationOf = (id) => {
    let cur = id;
    while (cur) {
      if (Org.byId[cur].type === 'station') return cur;
      cur = Org.parentOf[cur];
    }
    return null;
  };
  /** 상위 소방서/부서(레벨2) id */
  Org.level2Of = (id) => {
    let cur = id;
    while (cur) {
      if (Org.unitLevel(Org.byId[cur]) === 2) return cur;
      cur = Org.parentOf[cur];
    }
    return null;
  };

  /** 대상 조직 정보(기관, 소속, 소방서명) 해석 */
  Org.resolveOrgDept = (target, req) => {
    let org = '부산소방재난본부';
    let dept = '';
    let station = '';

    if (target && target.id) {
      const node = Org.byId[target.id];
      if (node) {
        if (node.type === 'center' || node.type === 'team') {
          const stId = Org.stationOf(target.id);
          if (stId) {
            const stName = Org.name(stId);
            station = stName;
            const cleanSt = stName.replace(/^부산/, '');
            org = '부산소방재난본부 ' + cleanSt;
            dept = node.name;
          } else {
            const pId = Org.parentOf[target.id];
            const pName = pId ? Org.name(pId) : '';
            if (pName === '소방학교') {
              org = '부산소방재난본부 소방학교';
              dept = node.name;
              station = '소방학교';
            } else {
              org = '부산소방재난본부';
              dept = (pName ? pName + ' ' : '') + node.name;
              station = '부산소방재난본부';
            }
          }
        } else if (node.type === 'station') {
          station = node.name;
          org = '부산소방재난본부';
          dept = node.name;
        } else if (node.type === 'dept') {
          org = '부산소방재난본부';
          dept = node.name;
          station = '부산소방재난본부';
        } else {
          org = '부산소방재난본부';
          dept = node.name;
        }
      }
    } else if (req && req.createdOrgId) {
      const cNode = Org.byId[req.createdOrgId];
      if (cNode && cNode.type === 'station') {
        const cleanSt = cNode.name.replace(/^부산/, '');
        org = '부산소방재난본부 ' + cleanSt;
        dept = (cNode.children && cNode.children[0] && cNode.children[0].name) || '';
        station = cNode.name;
      }
    }
    return { org, dept, station };
  };

  // 모의 사용자 (SSO 연동 전 역할 전환용). 실제 개인정보 아님.
  const USERS = [
    { id: 'u1', name: '김행정', rank: '소방위', orgId: Org.byName('소방행정과').id, role: 'hq', roleLabel: '본부 담당자' },
    { id: 'u2', name: '이구급', rank: '소방장', orgId: Org.byName('구조구급과').id, role: 'hq', roleLabel: '본부 담당자' },
    { id: 'u3', name: '박진서', rank: '소방위', orgId: Org.byName('부산진소방서').id, role: 'station', roleLabel: '소방서 담당자' },
    { id: 'u4', name: '최범일', rank: '소방교', orgId: Org.byName('범일119안전센터').id, role: 'center', roleLabel: '센터/팀 담당자' },
    { id: 'u5', name: '정해운', rank: '소방위', orgId: Org.byName('해운대소방서').id, role: 'station', roleLabel: '소방서 담당자' },
    { id: 'u6', name: '한보안', rank: '소방경', orgId: 'hq', role: 'auditor', roleLabel: '보안담당자(감사)' },
    { id: 'u7', name: '강사하', rank: '소방위', orgId: Org.byName('사하소방서').id, role: 'station', roleLabel: '소방서 담당자(사하)' },
    { id: 'u8', name: '조감천', rank: '소방교', orgId: Org.byName('감천119안전센터').id, role: 'center', roleLabel: '센터 담당자(감천)' },
    { id: 'u9', name: '박신평', rank: '소방장', orgId: Org.byName('신평119안전센터').id, role: 'center', roleLabel: '센터 담당자(신평)' },
  ];

  // 센터·부서별 기본 인원명부 (가상 인원 — 계급·성명·생년월일·임용일자·연락처·담당업무 보유, 인사이동/전보 수정 시 서식에 즉시 반영)
  const SEED_ROSTER = {
    '신평119안전센터': [
      ['소방경', '배신평', '센터장', '1973-05-14', '1999-03-02', '010-2145-1000'],
      ['소방위', '김하단', '1팀장', '1978-04-12', '2005-07-11', '010-2145-1001'],
      ['소방장', '박신평', '구급대원', '1985-11-03', '2012-09-01', '010-3382-1002'],
      ['소방교', '정화재', '화재진압', '1991-08-22', '2017-10-16', '010-4190-1003'],
      ['소방사', '최안전', '운전원', '1996-02-19', '2022-04-04', '010-5821-1004'],
    ],
    '감천119안전센터': [
      ['소방경', '오감천', '센터장', '1974-02-19', '2000-04-10', '010-4412-2000'],
      ['소방위', '한괴정', '1팀장', '1980-06-25', '2007-05-21', '010-4412-2001'],
      ['소방장', '서구급', '구급대원', '1986-12-08', '2013-08-12', '010-5591-2002'],
      ['소방교', '조감천', '화재진압', '1992-03-30', '2018-11-05', '010-6723-2003'],
      ['소방사', '윤다대', '운전원', '1997-09-11', '2023-01-09', '010-7834-2004'],
    ],
    '괴정119안전센터': [
      ['소방경', '장괴정', '센터장', '1975-01-20', '2001-06-01', '010-6623-3000'],
      ['소방위', '임사하', '1팀장', '1981-09-14', '2008-03-17', '010-6623-3001'],
      ['소방교', '강구급', '구급대원', '1990-07-07', '2016-09-26', '010-7714-3002'],
      ['소방사', '조진압', '화재진압', '1996-01-30', '2021-11-15', '010-8129-3003'],
    ],
    '하단119안전센터': [
      ['소방경', '문하단', '센터장', '1973-11-02', '1999-08-16', '010-8834-4000'],
      ['소방위', '신을숙', '1팀장', '1979-12-05', '2006-04-03', '010-8834-4001'],
      ['소방교', '유구급', '구급대원', '1992-03-18', '2018-05-14', '010-9912-4002'],
      ['소방사', '백진압', '화재진압', '1995-10-27', '2021-03-22', '010-2341-4003'],
    ],
    '다대119안전센터': [
      ['소방경', '권다대', '센터장', '1974-08-15', '2000-09-04', '010-3124-5000'],
      ['소방위', '황몰운', '1팀장', '1984-06-22', '2010-10-18', '010-3124-5001'],
      ['소방교', '전구급', '구급대원', '1991-04-09', '2017-06-12', '010-4231-5002'],
      ['소방사', '남진압', '화재진압', '1995-10-09', '2022-02-07', '010-5349-5003'],
    ],
    '사하119구조대': [
      ['소방경', '류구조', '구조대장', '1975-03-28', '2001-02-19', '010-5342-6000'],
      ['소방위', '고특수', '구조1팀장', '1982-11-19', '2009-07-06', '010-5342-6001'],
      ['소방장', '양수난', '구조대원', '1987-05-11', '2014-04-21', '010-6453-6002'],
      ['소방교', '손산악', '구조대원', '1990-08-27', '2016-12-05', '010-7564-6003'],
    ],
    '범일119안전센터': [
      ['소방경', '강범일', '센터장', '1974-07-12', '2000-05-15', '010-3210-7000'],
      ['소방위', '서부전', '1팀장', '1980-10-03', '2007-08-20', '010-3210-7001'],
      ['소방교', '최범일', '구급대원', '1991-05-16', '2017-03-13', '010-4321-7002'],
      ['소방사', '남수정', '화재진압', '1996-12-24', '2022-09-05', '010-5432-7003'],
    ],
  };

  Org.defaultRoster = () => {
    const list = [];
    let seq = 1;
    const surnames = ['김', '이', '박', '최', '정', '강', '조', '윤', '장', '임'];
    Org.all.filter((n) => n.type === 'center' || n.type === 'team').forEach((n, idx) => {
      const custom = SEED_ROSTER[n.name];
      if (custom) {
        custom.forEach(([rank, name, duty, birth, appointedAt, phone]) => list.push({
          id: 'p' + (seq++), orgId: n.id, rank, name, duty,
          birth: birth || '1988-05-15', appointedAt: appointedAt || '2015-03-02', phone: phone || '010-1234-5678',
        }));
      } else {
        const short = n.name.replace(/119안전센터|안전센터|119구조대|구조대|계$/g, '').slice(0, 2) || '대원';
        const pad = (x) => String(x).padStart(2, '0');
        list.push(
          { id: 'p' + (seq++), orgId: n.id, rank: '소방위', name: surnames[idx % 10] + short, duty: '팀장', birth: `198${idx % 5}-${pad((idx % 12) + 1)}-12`, appointedAt: `200${(idx % 4) + 6}-04-01`, phone: `010-3${pad(idx % 99)}0-1001` },
          { id: 'p' + (seq++), orgId: n.id, rank: '소방교', name: surnames[(idx + 3) % 10] + '구급', duty: '구급대원', birth: `199${idx % 4}-${pad(((idx + 3) % 12) + 1)}-21`, appointedAt: `201${(idx % 4) + 5}-09-14`, phone: `010-4${pad(idx % 99)}0-1002` },
          { id: 'p' + (seq++), orgId: n.id, rank: '소방사', name: surnames[(idx + 6) % 10] + '진압', duty: '화재진압', birth: `199${(idx % 4) + 5}-${pad(((idx + 6) % 12) + 1)}-08`, appointedAt: `202${idx % 4}-11-02`, phone: `010-5${pad(idx % 99)}0-1003` },
        );
      }
    });
    return list;
  };

  Org.rosterOf = (orgId) => {
    if (g.Store && g.Store.state && Array.isArray(g.Store.state.roster)) {
      return g.Store.rosterOf(orgId);
    }
    return Org.defaultRoster().filter((p) => p.orgId === orgId);
  };

  g.Org = Org;
  g.USERS = USERS;
  if (typeof module !== 'undefined') module.exports = { Org, USERS };
})(typeof window !== 'undefined' ? window : globalThis);
