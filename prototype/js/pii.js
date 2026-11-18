/* 개인정보 패턴 탐지 / 마스킹 (프로토타입용 규칙 기반 탐지)
 * ※ 규칙 기반 탐지는 오탐·미탐이 있습니다. 운영 단계에서는 제출자 확인 + 컬럼 분리 저장과 함께 사용합니다. */
(function (g) {
  function rrnValid(d) {
    const w = [2, 3, 4, 5, 6, 7, 8, 9, 2, 3, 4, 5];
    let s = 0;
    for (let i = 0; i < 12; i++) s += +d[i] * w[i];
    return (11 - (s % 11)) % 10 === +d[12];
  }
  function luhn(d) {
    let sum = 0, alt = false;
    for (let i = d.length - 1; i >= 0; i--) {
      let n = +d[i];
      if (alt) { n *= 2; if (n > 9) n -= 9; }
      sum += n; alt = !alt;
    }
    return sum % 10 === 0;
  }

  // 순서가 우선순위 (겹치는 구간은 먼저 매칭된 유형으로 처리)
  const PATTERNS = [
    {
      type: '주민/외국인등록번호', sev: 'high',
      re: /(?<!\d)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])[-\s]?[1-8]\d{6}(?!\d)/g,
      note: (m) => (rrnValid(m.replace(/\D/g, '')) ? '검증식 일치' : '형식 일치'),
    },
    { type: '휴대전화번호', sev: 'mid', re: /(?<!\d)01[016789][-.\s]?\d{3,4}[-.\s]?\d{4}(?!\d)/g },
    { type: '유선전화번호', sev: 'low', re: /(?<!\d)0(?:2|[3-6]\d)[-.\s]?\d{3,4}[-.\s]?\d{4}(?!\d)/g },
    { type: '이메일', sev: 'mid', re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g },
    {
      type: '카드번호', sev: 'high', re: /(?<!\d)(?:\d{4}[-\s]?){3}\d{4}(?!\d)/g,
      validate: (m) => luhn(m.replace(/\D/g, '')),
    },
    { type: '계좌번호(추정)', sev: 'mid', re: /(?<!\d)\d{3,6}-\d{2,6}-\d{4,8}(?:-\d{1,3})?(?!\d)/g },
    { type: '차량번호', sev: 'low', re: /(?<![가-힣\d])\d{2,3}[가-힣]\s?\d{4}(?!\d)/g },
  ];

  // 컬럼명 기반 개인정보 추정
  const HEADER_HINT = /성명|이름|주민|생년|생일|연락처|전화|휴대|핸드폰|주소|거주지|이메일|메일|계좌|차량번호|환자|보호자|면허|사번|병명|진단|질병/;

  function mask(type, v) {
    const s = String(v);
    if (type.startsWith('주민')) { const d = s.replace(/\D/g, ''); return d.slice(0, 6) + '-*******'; }
    if (type === '휴대전화번호' || type === '유선전화번호') {
      const d = s.replace(/\D/g, '');
      return d.slice(0, d.length - 8) + '-****-' + d.slice(-4);
    }
    if (type === '이메일') { const [a, b] = s.split('@'); return a.slice(0, 1) + '***@' + b; }
    if (s.length <= 4) return '*'.repeat(s.length);
    return s.slice(0, 2) + '*'.repeat(Math.max(2, s.length - 4)) + s.slice(-2);
  }

  const PII = {
    PATTERNS,
    hintByHeader(name) { return HEADER_HINT.test(String(name || '')); },
    mask,
    /** 텍스트에서 개인정보 탐지 → [{type, sev, count, samples[], note}] */
    scan(text) {
      const src = String(text ?? '');
      if (!src) return [];
      const used = [];
      const found = new Map();
      for (const p of PATTERNS) {
        p.re.lastIndex = 0;
        let m;
        while ((m = p.re.exec(src))) {
          const s = m.index, e = s + m[0].length;
          if (used.some(([a, b]) => s < b && e > a)) continue;
          if (p.validate && !p.validate(m[0])) continue;
          used.push([s, e]);
          const f = found.get(p.type) || { type: p.type, sev: p.sev, count: 0, samples: [], note: '' };
          f.count++;
          if (f.samples.length < 3) f.samples.push(mask(p.type, m[0]));
          if (p.note) f.note = p.note(m[0]);
          found.set(p.type, f);
        }
      }
      return [...found.values()];
    },
    /** 표 데이터 스캔: 개인정보로 지정되지 않은 컬럼에서 탐지 → {colIndex: findings[]} */
    scanRows(header, rows, piiCols) {
      const skip = new Set(piiCols || []);
      const out = {};
      header.forEach((h, c) => {
        if (skip.has(c)) return;
        const agg = new Map();
        rows.forEach((r) => {
          PII.scan(r[c]).forEach((f) => {
            const a = agg.get(f.type) || { ...f, count: 0, samples: [] };
            a.count += f.count;
            f.samples.forEach((s) => { if (a.samples.length < 3) a.samples.push(s); });
            agg.set(f.type, a);
          });
        });
        if (agg.size) out[c] = [...agg.values()];
      });
      return out;
    },
    summarize(findings) {
      return findings.map((f) => `${f.type} ${f.count}건`).join(', ');
    },
    /** 텍스트 내 탐지된 개인정보를 마스킹 문자열로 치환 */
    redact(text) {
      let out = String(text ?? '');
      for (const p of PATTERNS) {
        p.re.lastIndex = 0;
        out = out.replace(p.re, (m) => (p.validate && !p.validate(m) ? m : mask(p.type, m)));
      }
      return out;
    },
    /** 임의 값 마스킹: 패턴 탐지 시 해당 규칙, 아니면 앞·뒤 한 글자만 노출 */
    maskValue(v) {
      const s = String(v ?? '');
      if (!s) return '';
      const red = PII.redact(s);
      if (red !== s) return red;
      if (s.length === 1) return '*';
      if (s.length === 2) return s[0] + '*';
      return s[0] + '*'.repeat(Math.min(s.length - 2, 8)) + s[s.length - 1];
    },
  };

  g.PII = PII;
  if (typeof module !== 'undefined') module.exports = PII;
})(typeof window !== 'undefined' ? window : globalThis);
