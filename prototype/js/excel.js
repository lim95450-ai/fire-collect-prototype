/* 엑셀 서식 분석 / 제출 검증 / 서식 생성 / 취합 (SheetJS 사용) */
(function (g) {
  const X = () => g.XLSX;

  const isNum = (s) => /^-?\d+(\.\d+)?$/.test(String(s).replace(/[,\s]/g, ''));
  function normDate(s) {
    s = String(s ?? '').trim();
    let m = s.match(/^(\d{4})[-./]\s?(\d{1,2})[-./]\s?(\d{1,2})\.?$/) || s.match(/^(\d{4})년\s?(\d{1,2})월\s?(\d{1,2})일?$/) || s.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (!m) return null;
    const y = +m[1], mo = +m[2], d = +m[3];
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }
  const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').replace(/\*|\(필수\)|（필수）/g, '').trim();
  const norm = (s) => clean(s).replace(/\s/g, '').toLowerCase();

  function sheetToAoa(ws) {
    return X().utils.sheet_to_json(ws, { header: 1, raw: false, dateNF: 'yyyy-mm-dd', defval: '', blankrows: true });
  }

  function detectHeaderRow(aoa) {
    let best = -1, bestScore = 0;
    for (let r = 0; r < Math.min(aoa.length, 15); r++) {
      const score = (aoa[r] || []).filter((c) => {
        const s = String(c).trim();
        return s && !isNum(s) && s.length <= 40;
      }).length;
      if (score > bestScore) { best = r; bestScore = score; }
    }
    if (best < 0) best = aoa.findIndex((r) => r.some((c) => String(c).trim()));
    return Math.max(best, 0);
  }

  function inferType(name, values) {
    const vals = values.map((v) => String(v).trim()).filter(Boolean);
    if (vals.length) {
      if (vals.every(isNum)) return 'number';
      if (vals.every((v) => normDate(v))) return 'date';
      return 'text';
    }
    if (/일자|날짜|일시|연월일|기간/.test(name)) return 'date';
    if (/수량|건수|인원|금액|대수|횟수|\(명\)|\(건\)|\(대\)|합계/.test(name)) return 'number';
    return 'text';
  }

  // ---------- 서식 적용 .xlsx 작성 (SheetJS 무료판은 셀 서식을 쓰지 않으므로 시트 XML을 직접 생성) ----------
  const S = { TITLE: 1, LABEL: 2, VALUE: 3, HEAD: 4, EX: 5, IN: 6, PRE: 7, NOTE: 8, CELL: 9 };
  const FONT = (x) => `<font>${x}<name val="맑은 고딕"/><family val="3"/><charset val="129"/></font>`;
  const BORDER = '<border><left style="thin"><color rgb="FF9AA3AF"/></left><right style="thin"><color rgb="FF9AA3AF"/></right><top style="thin"><color rgb="FF9AA3AF"/></top><bottom style="thin"><color rgb="FF9AA3AF"/></bottom><diagonal/></border>';
  const FILL = (rgb) => `<fill><patternFill patternType="solid"><fgColor rgb="${rgb}"/><bgColor indexed="64"/></patternFill></fill>`;
  const XF = (font, fill, border, align, extra) => `<xf numFmtId="${extra || 0}" fontId="${font}" fillId="${fill}" borderId="${border}" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"${extra ? ' applyNumberFormat="1"' : ''}><alignment ${align}/></xf>`;
  const STYLES_XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
    + '<fonts count="6">'
    + FONT('<sz val="10"/><color rgb="FF1F2328"/>')
    + FONT('<b/><sz val="16"/><color rgb="FF1F2328"/>')
    + FONT('<b/><sz val="10"/><color rgb="FF1F2328"/>')
    + FONT('<i/><sz val="10"/><color rgb="FF8C959F"/>')
    + FONT('<sz val="10"/><color rgb="FF1F3A68"/>')
    + FONT('<sz val="9"/><color rgb="FF59636E"/>')
    + '</fonts>'
    + '<fills count="5"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>'
    + FILL('FFF3F4F6') + FILL('FFE3E9F2') + FILL('FFFAFAFA') + '</fills>'
    + '<borders count="3"><border><left/><right/><top/><bottom/><diagonal/></border>' + BORDER
    + '<border><left/><right/><top/><bottom style="medium"><color rgb="FF1F2328"/></bottom><diagonal/></border></borders>'
    + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
    + '<cellXfs count="10">'
    + '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
    + XF(1, 0, 2, 'horizontal="left" vertical="center"')                          // 1 제목
    + XF(2, 2, 1, 'horizontal="center" vertical="center"')                        // 2 정보 구분
    + XF(0, 0, 1, 'horizontal="left" vertical="center" wrapText="1" indent="1"')  // 3 정보 내용
    + XF(2, 3, 1, 'horizontal="center" vertical="center" wrapText="1"')           // 4 머리글
    + XF(3, 4, 1, 'horizontal="center" vertical="center"')                        // 5 예시(회색)
    + XF(0, 0, 1, 'horizontal="center" vertical="center"', 49)                    // 6 입력칸(텍스트 형식)
    + XF(4, 0, 1, 'horizontal="center" vertical="center"', 49)                    // 7 미리 입력됨
    + XF(5, 0, 0, 'horizontal="left" vertical="center"')                          // 8 안내문
    + XF(0, 0, 1, 'horizontal="left" vertical="center" wrapText="1"')             // 9 일반 셀
    + '</cellXfs><cellStyles count="1"><cellStyle name="표준" xfId="0" builtinId="0"/></cellStyles></styleSheet>';

  const xesc = (s) => String(s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const colName = (c) => { let s = ''; c++; while (c) { const m = (c - 1) % 26; s = String.fromCharCode(65 + m) + s; c = Math.floor((c - 1) / 26); } return s; };
  const ref = (r, c) => colName(c) + (r + 1);

  function sheetXml(o) {
    const nrows = o.rows.length;
    let data = '';
    for (let r = 0; r < nrows; r++) {
      const row = o.rows[r] || [];
      let cells = '';
      const w = Math.max(row.length, o.ncols);
      for (let c = 0; c < w; c++) {
        const v = row[c];
        const s = o.style(r, c);
        const sa = s ? ` s="${s}"` : '';
        if (typeof v === 'number' && isFinite(v)) cells += `<c r="${ref(r, c)}"${sa}><v>${v}</v></c>`;
        else if (v != null && v !== '') cells += `<c r="${ref(r, c)}"${sa} t="inlineStr"><is><t xml:space="preserve">${xesc(v)}</t></is></c>`;
        else if (s) cells += `<c r="${ref(r, c)}"${sa}/>`;
      }
      const h = o.heights && o.heights[r];
      data += `<row r="${r + 1}"${h ? ` ht="${h}" customHeight="1"` : ''}>${cells}</row>`;
    }
    const last = ref(Math.max(nrows - 1, 0), Math.max(o.ncols - 1, 0));
    const pane = o.freeze ? `<pane ySplit="${o.freeze}" topLeftCell="A${o.freeze + 1}" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A${o.freeze + 1}" sqref="A${o.freeze + 1}"/>` : '';
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
      + '<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>'
      + `<dimension ref="A1:${last}"/>`
      + `<sheetViews><sheetView workbookViewId="0" showGridLines="0"${o.selected ? ' tabSelected="1"' : ''}>${pane}</sheetView></sheetViews>`
      + '<sheetFormatPr defaultRowHeight="18"/>'
      + `<cols>${o.widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>`
      + `<sheetData>${data}</sheetData>`
      + (o.autofilter ? `<autoFilter ref="${o.autofilter}"/>` : '')
      + (o.merges.length ? `<mergeCells count="${o.merges.length}">${o.merges.map((m) => `<mergeCell ref="${ref(m.s.r, m.s.c)}:${ref(m.e.r, m.e.c)}"/>`).join('')}</mergeCells>` : '')
      + (o.valids && o.valids.length ? `<dataValidations count="${o.valids.length}">${o.valids.map((v) => `<dataValidation type="list" errorStyle="information" allowBlank="1" showInputMessage="1" showErrorMessage="0" sqref="${ref(v.from, v.col)}:${ref(v.to, v.col)}"><formula1>"${xesc(v.list.join(','))}"</formula1></dataValidation>`).join('')}</dataValidations>` : '')
      + '<printOptions horizontalCentered="1"/>'
      + '<pageMargins left="0.4" right="0.4" top="0.6" bottom="0.6" header="0.3" footer="0.3"/>'
      + `<pageSetup paperSize="9" orientation="${o.landscape ? 'landscape' : 'portrait'}" fitToWidth="1" fitToHeight="0"/>`
      + '</worksheet>';
  }

  // ---------- 취합 결과 보고서 .xlsx : 제목·요약·머리글 색·테두리·기관별 줄무늬·상태 색상·틀 고정·필터 ----------
  const RS = { TITLE: 1, LABEL: 2, VALUE: 3, HEAD: 4, L: 5, C: 6, LA: 7, CA: 8, OK: 9, INFO: 10, BAD: 11, NONE: 12, NOTE: 13 };
  const LEFT = 'horizontal="left" vertical="center" wrapText="1"';
  const CENTER = 'horizontal="center" vertical="center" wrapText="1"';
  const REPORT_STYLES_XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
    + '<fonts count="9">'
    + FONT('<sz val="10"/><color rgb="FF1F2328"/>')
    + FONT('<b/><sz val="16"/><color rgb="FF1F2328"/>')
    + FONT('<b/><sz val="10"/><color rgb="FF1F2328"/>')
    + FONT('<b/><sz val="10"/><color rgb="FFFFFFFF"/>')
    + FONT('<b/><sz val="10"/><color rgb="FF166534"/>')
    + FONT('<b/><sz val="10"/><color rgb="FF1E40AF"/>')
    + FONT('<b/><sz val="10"/><color rgb="FF991B1B"/>')
    + FONT('<b/><sz val="10"/><color rgb="FF4B5563"/>')
    + FONT('<sz val="9"/><color rgb="FF59636E"/>')
    + '</fonts>'
    + '<fills count="9"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>'
    + FILL('FFF3F4F6') + FILL('FF1F3A68') + FILL('FFF3F6FB') + FILL('FFDCFCE7') + FILL('FFDBEAFE') + FILL('FFFEE2E2') + FILL('FFE5E7EB') + '</fills>'
    + '<borders count="3"><border><left/><right/><top/><bottom/><diagonal/></border>' + BORDER
    + '<border><left/><right/><top/><bottom style="medium"><color rgb="FF1F2328"/></bottom><diagonal/></border></borders>'
    + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
    + '<cellXfs count="14">'
    + '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
    + XF(1, 0, 2, 'horizontal="left" vertical="center"')   // 1 제목
    + XF(2, 2, 1, CENTER)                                  // 2 정보 라벨
    + XF(0, 0, 1, LEFT + ' indent="1"')                    // 3 정보 값
    + XF(3, 3, 1, CENTER)                                  // 4 머리글
    + XF(0, 0, 1, LEFT)                                    // 5 본문(좌)
    + XF(0, 0, 1, CENTER)                                  // 6 본문(가운데)
    + XF(0, 4, 1, LEFT)                                    // 7 본문(좌, 줄무늬)
    + XF(0, 4, 1, CENTER)                                  // 8 본문(가운데, 줄무늬)
    + XF(4, 5, 1, CENTER)                                  // 9 상태: 정상/승인
    + XF(5, 6, 1, CENTER)                                  // 10 상태: 진행/대기
    + XF(6, 7, 1, CENTER)                                  // 11 상태: 반려/미제출(경고)
    + XF(7, 8, 1, CENTER)                                  // 12 상태: 해당 없음
    + XF(8, 0, 0, 'horizontal="left" vertical="center"')   // 13 요약 한 줄
    + '</cellXfs><cellStyles count="1"><cellStyle name="표준" xfId="0" builtinId="0"/></cellStyles></styleSheet>';

  const wl = (s) => [...String(s ?? '')].reduce((a, ch) => a + (ch.charCodeAt(0) > 255 ? 2 : 1), 0);

  /** 시트 명세 → 셀/서식 배치. spec: {name,title,info:[[k,v]],note,header,rows,groups,statusCol,statusStyle,widths,freeze} */
  function layoutReport(sp) {
    const header = sp.header;
    const nc = Math.max(header.length, 2);
    const aoa = [], st = {}, merges = [], heights = {};
    const put = (r, c, v, s) => { (aoa[r] = aoa[r] || [])[c] = v; st[r + ',' + c] = s; };
    const band = (r, s) => { aoa[r] = aoa[r] || []; for (let c = 0; c < nc; c++) { if (st[r + ',' + c] == null) st[r + ',' + c] = s; if (aoa[r][c] === undefined) aoa[r][c] = ''; } };
    const mergeRow = (r, c0) => { if (nc - 1 > c0) merges.push({ s: { r, c: c0 }, e: { r, c: nc - 1 } }); };
    let r = 0;
    put(0, 0, sp.title || sp.name, RS.TITLE); band(0, RS.TITLE); mergeRow(0, 0); heights[0] = 34;
    aoa[1] = []; heights[1] = 8; r = 2;
    (sp.info || []).forEach(([k, v]) => {
      put(r, 0, k, RS.LABEL); put(r, 1, v, RS.VALUE); band(r, RS.VALUE); mergeRow(r, 1);
      heights[r] = wl(v) > 90 ? 36 : 22; r++;
    });
    if (sp.note) { put(r, 0, sp.note, RS.NOTE); band(r, RS.NOTE); mergeRow(r, 0); heights[r] = 20; r++; }
    aoa[r] = []; heights[r] = 10; r++;
    const hr = r;
    header.forEach((h, c) => put(hr, c, h, RS.HEAD));
    band(hr, RS.HEAD); heights[hr] = 28; r++;

    const maxW = header.map((h, c) => { let m = wl(h); sp.rows.forEach((row) => { const w = wl(row[c]); if (w > m) m = w; }); return m; });
    const center = maxW.map((w) => w <= 14);
    sp.rows.forEach((row, i) => {
      const alt = sp.groups ? sp.groups[i] % 2 === 1 : i % 2 === 1;
      header.forEach((_, c) => {
        const v = row[c] == null ? '' : row[c];
        let s = null;
        if (sp.statusCol === c && sp.statusStyle && v !== '') s = { ok: RS.OK, info: RS.INFO, bad: RS.BAD, none: RS.NONE }[sp.statusStyle(v)] || null;
        if (s == null) s = (center[c] || typeof v === 'number') ? (alt ? RS.CA : RS.C) : (alt ? RS.LA : RS.L);
        put(r, c, v, s);
      });
      r++;
    });
    const widths = header.map((h, c) => (sp.widths && sp.widths[c]) || Math.min(Math.max(maxW[c] + 4, 9), 44));
    if ((sp.info || sp.note) && widths[0] < 14) widths[0] = 14;
    while (widths.length < nc) widths.push(14);
    return { aoa, st, merges, heights, widths, nc, hr, last: r - 1 };
  }

  let prefillCache = null; // 같은 요청의 센터별 서식을 연속 생성할 때 복호화 결과 재사용
  const Excel = {
    isNum, normDate, clean,

    read(arrayBuffer) {
      return X().read(arrayBuffer, { type: 'array', cellDates: true, cellFormula: false });
    },

    /** 서식 파일 분석: 시트/헤더 행 추정 + 컬럼 정의 생성 */
    analyze(wb, opts) {
      opts = opts || {};
      const sheetNames = wb.SheetNames;
      const sheetName = opts.sheetName && sheetNames.includes(opts.sheetName) ? opts.sheetName : sheetNames[0];
      const ws = wb.Sheets[sheetName];
      const aoa = sheetToAoa(ws);
      let hr = opts.headerRow != null ? opts.headerRow : detectHeaderRow(aoa);
      const allMerges = ws['!merges'] || [];
      let has2Tier = false;
      let gr = -1; // 상위(그룹) 머리글 행
      if (opts.headerRow == null) {
        // 가로 병합된 머리글 다음 행에 실제 하위 머리글이 있을 때만 2단 머리글로 처리
        // (데이터 첫 행의 '1', '12.01.', '~' 등을 하위 머리글로 오인하지 않도록 세로 병합/비병합 열 검사)
        const hm = allMerges.filter((m) => m.s.r === hr && m.e.c > m.s.c);
        const vm = allMerges.filter((m) => m.s.r === hr && m.e.r >= hr + 1);
        const next = aoa[hr + 1] || [];
        const nextStartsWithOne = String(next[0] ?? '').trim() === '1' && /^(연번|순번|순|번호|no\.?)$/i.test(clean(aoa[hr] && aoa[hr][0]));
        const subLooksLikeHeader = hm.length > 0 && !nextStartsWithOne && (vm.length > 0 || hm.every((m) => {
          for (let c = m.s.c; c <= m.e.c; c++) {
            const s = String(next[c] ?? '').trim();
            if (/^(~|-|\d{1,2}\.\s*\d{1,2}\.?)$/.test(s)) return false;
          }
          return true;
        }) && (() => {
          // 가로 병합 범위 밖의 열이 비어 있어야 2단 머리글
          const inHm = (c) => hm.some((m) => c >= m.s.c && c <= m.e.c);
          let nonEmptyOutside = 0;
          for (let c = 0; c < next.length; c++) {
            if (!inHm(c) && String(next[c] ?? '').trim()) nonEmptyOutside++;
          }
          return nonEmptyOutside === 0;
        })());
        if (subLooksLikeHeader && hm.some((m) => { for (let c = m.s.c; c <= m.e.c; c++) { const s = String(next[c] ?? '').trim(); if (s && !isNum(s)) return true; } return false; })) {
          gr = hr; hr = hr + 1; has2Tier = true;
        } else if (hr > 0 && allMerges.some((m) => m.s.r === hr - 1 && m.e.r >= hr)) {
          gr = hr - 1; has2Tier = true;
        }
      }
      const header = aoa[hr] || [];
      const above = has2Tier && gr >= 0 ? aoa[gr] || [] : [];
      const merges = has2Tier ? allMerges.filter((m) => m.s.r === gr && m.e.c > m.s.c) : [];
      const hrMerges = allMerges.filter((m) => m.s.r === hr && m.e.c > m.s.c);

      const width = Math.max(header.length, above.length);
      const columns = [];
      const dataRows = aoa.slice(hr + 1).filter((r) => r.some((c) => String(c).trim()));
      const usedNames = new Map();
      for (let c = 0; c < width; c++) {
        let leaf = clean(header[c]);
        const hMerge = hrMerges.find((m) => c >= m.s.c && c <= m.e.c);
        if (!leaf && hMerge) leaf = clean(header[hMerge.s.c]);
        const grp = merges.find((m) => c >= m.s.c && c <= m.e.c);
        const grpName = grp ? clean(above[grp.s.c]) : '';
        let name = leaf;
        if (!leaf && has2Tier && above[c] && clean(above[c])) name = clean(above[c]); // 세로 병합 머리글
        else if (leaf && grpName && grpName !== leaf) name = `${grpName}/${leaf}`;
        // 첫 열 머리글이 비어 있고 데이터가 1, 2, 3... 연번 형태이면 '연번'으로 자동 명명
        if (!name && c === 0 && dataRows.length && String(dataRows[0][0] ?? '').trim() === '1') name = '연번';
        if (!name) continue;
        // 단일 머리글 행에서 가로 병합된 열(예: 교육기간 3칸, 부서명 2칸) 구분 명명
        if (hMerge && !has2Tier) {
          const span = hMerge.e.c - hMerge.s.c + 1;
          const pos = c - hMerge.s.c;
          if (span === 3 && dataRows[0] && String(dataRows[0][hMerge.s.c + 1] ?? '').trim() === '~') {
            name = pos === 0 ? `${name}(시작)` : pos === 1 ? `${name}(~)` : `${name}(종료)`;
          } else if (span === 2 && /부서|소속/.test(name)) {
            name = pos === 0 ? '기관' : '소속';
          }
        }
        if (usedNames.has(name)) {
          const cnt = usedNames.get(name) + 1;
          usedNames.set(name, cnt);
          name = `${name}(${cnt})`;
        } else {
          usedNames.set(name, 1);
        }
        // 예시 추출: 해당 컬럼에 값이 있는 첫 2개 행에서도 보완하여 빈 예시 최소화
        const samples = dataRows.slice(0, 30).map((r) => r[c] ?? '');
        const nonEmptySamples = samples.map((v) => String(v ?? '').trim()).filter(Boolean);
        let ex0 = String((dataRows[0] && dataRows[0][c]) ?? '').trim() || nonEmptySamples[0] || '';
        let ex1 = String((dataRows[1] && dataRows[1][c]) ?? '').trim() || nonEmptySamples[1] || ex0 || '';
        if (!ex0 && dataRows.length > 0) {
          const nm = norm(name);
          if (/성명|이름|대원명/.test(nm)) { ex0 = '홍길동'; ex1 = '김소방'; }
          else if (/생년월일|생일/.test(nm)) { ex0 = '1992-04-15'; ex1 = '1988-11-20'; }
          else if (/성별/.test(nm)) { ex0 = '남'; ex1 = '여'; }
          else if (/휴대전화|연락처|전화번호|핸드폰/.test(nm)) { ex0 = '010-1234-5678'; ex1 = '010-9876-5432'; }
          else if (/비고|특이사항/.test(nm)) { ex0 = '-'; ex1 = '-'; }
        }
        columns.push({
          name,
          type: inferType(name, samples),
          required: /\*|\(필수\)/.test(String(header[c] ?? '')),
          pii: g.PII ? g.PII.hintByHeader(name) : false,
          examples: [ex0, ex1],
          idx: c,
        });
      }
      const titleEndRow = has2Tier && gr >= 0 ? gr : hr;
      const titleCells = aoa.slice(0, Math.max(titleEndRow, 0)).flat().map((s) => String(s).trim()).filter(Boolean);
      const prefillRows = dataRows
        .map((row) => columns.map((col) => String(row[col.idx] ?? '').trim()))
        .filter((r) => r.some(Boolean) && !r.some((v) => /\[?예시\]?/.test(v)));
      return {
        sheetNames, sheetName, headerRow: hr, columns,
        title: titleCells[0] || '',
        previewRows: aoa.slice(0, Math.min(aoa.length, hr + 4)),
        dataRowCount: dataRows.length,
        prefillRows,
      };
    },

    /** 제출 엑셀 검증 → {header, rows, missing, extra, errors[], warnings[], sheetName} */
    validate(wb, columns, opts) {
      opts = opts || {};
      const want = columns.map((c) => norm(c.name));
      let best = { score: -1 };
      wb.SheetNames.forEach((sn) => {
        const aoa = sheetToAoa(wb.Sheets[sn]);
        for (let r = 0; r < Math.min(aoa.length, 15); r++) {
          const have = (aoa[r] || []).map(norm);
          const score = want.filter((w) => have.includes(w)).length;
          if (score > best.score) best = { score, sn, r, aoa, have };
        }
      });
      const res = { header: columns.map((c) => c.name), rows: [], missing: [], extra: [], errors: [], warnings: [], sheetName: best.sn || '' };
      if (best.score < 0) { res.missing = columns.map((c) => c.name); return res; }
      const colIdx = columns.map((c) => best.have.indexOf(norm(c.name)));
      res.missing = columns.filter((c, i) => colIdx[i] < 0).map((c) => c.name);
      const known = new Set(colIdx);
      res.extra = (best.aoa[best.r] || []).map((h, i) => (known.has(i) || !clean(h) ? null : clean(h))).filter(Boolean);
      if (res.missing.length) return res;

      const dataRows = best.aoa.slice(best.r + 1);
      const exKeys = new Set();
      const exRow = columns.map((c) => (c.examples && c.examples[0]) || '');
      exKeys.add(exRow.join('\u0001'));
      if (columns.some((c) => c.examples && c.examples[1])) exKeys.add(columns.map((c) => (c.examples && c.examples[1]) || '').join('\u0001'));
      let exampleRows = 0;

      const isMetaCol = (name) => /^(연번|no|no\.|순번|번호|기관|기관명|소속기관|소방기관|소속|소속부서|소속센터)$/i.test(norm(name));
      const hasNonMeta = columns.some((c) => !isMetaCol(c.name));

      dataRows.forEach((raw, i) => {
        const vals = colIdx.map((ci) => String(raw[ci] ?? '').trim());
        if (!vals.some(Boolean)) return;
        // 사전 입력된 메타 컬럼(연번, 기관, 소속)만 있고 실제 입력 데이터가 비어 있는 미작성 행은 제외
        if (hasNonMeta && !vals.some((v, ci) => v && !isMetaCol(columns[ci].name))) return;
        if (exKeys.has(vals.join('\u0001'))) exampleRows++;
        const rowNo = best.r + 2 + i;
        const out = vals.map((v, ci) => {
          const col = columns[ci];
          if (!v) {
            if (col.required) res.warnings.push({ row: rowNo, col: col.name, msg: '필수 항목이 비어 있습니다.' });
            return '';
          }
          // 사용자가 입력한 어떤 형식의 텍스트(예: "1998-03-21", "9/22/43" 등)든 오류로 차단하지 않고 그대로 수용
          if (col.type === 'number') {
            return isNum(v) ? v.replace(/,/g, '') : v;
          }
          if (col.type === 'date') {
            const d = normDate(v);
            return d || v;
          }
          return v;
        });
        res.rows.push(out);
      });
      if (!res.rows.length) res.errors.push({ row: 0, col: '', msg: '제출할 데이터 행이 없습니다.' });
      if (exampleRows) res.warnings.push(`예시 행과 동일한 행이 ${exampleRows}건 포함되어 있습니다. 서식의 예시 행은 필요에 따라 삭제 후 제출하세요.`);
      if (res.extra.length) res.warnings.push(`서식에 없는 컬럼은 무시됩니다: ${res.extra.join(', ')}`);
      return res;
    },

    /**
     * 요청 서식 레이아웃 (제목 → 요청 정보 표 → 작성란 표). buildTemplate / templateBytes 공용.
     * opts.prefillRoster 또는 req.prefillRoster가 켜져 있으면 센터 등록 인원(계급·성명·담당업무)까지 미리 채운다.
     */
    templateLayout(req, target, opts) {
      opts = opts || {};
      const cols = req.columns;
      const n = Math.max(cols.length, 2);
      const isOrgCol = (c) => /^(기관|기관명|소속기관|소방기관|소방서|소방서명)$/.test(norm(c.name));
      const isDeptCol = (c) => /^(소속|소속부서|소속센터|부서|부서명)$/.test(norm(c.name));
      const isNoCol = (c) => /^(연번|no|no\.|순번|순|번호)$/i.test(norm(c.name));
      const isRankCol = (c) => /^(계급|직급|계급\/직급|직위)$/.test(norm(c.name));
      const isNameCol = (c) => /^(성명|이름|대원명)$/.test(norm(c.name));
      const isBirthCol = (c) => /^(생년월일|생일|출생일|출생연월일)$/.test(norm(c.name));
      const isAppointCol = (c) => /^(임용일자|임용일|최초임용일|현계급임용일|임용연월일)$/.test(norm(c.name));
      const isPhoneCol = (c) => /^(연락처|휴대전화|전화번호|핸드폰|휴대폰|휴대전화번호)$/.test(norm(c.name));
      const isDutyCol = (c) => /^(담당업무|업무|보직|담당|직책)$/.test(norm(c.name));

      const od = (g.Org && g.Org.resolveOrgDept) ? g.Org.resolveOrgDept(target, req) : { org: '부산소방재난본부 사하소방서', dept: '신평119안전센터', station: '부산사하소방서' };
      const useRoster = opts.prefillRoster != null
        ? !!opts.prefillRoster
        : (req.prefillRoster != null ? !!req.prefillRoster : (g.Store && g.Store.prefillRosterEnabled ? g.Store.prefillRosterEnabled() : true));
      // opts.roster: 복호화된 인원명부(브라우저에서는 templateBytes가 Vault에서 복호화해 전달). 없으면 Org.rosterOf 사용
      const roster = !useRoster ? [] : (opts.roster || ((target && target.id && g.Org && g.Org.rosterOf) ? g.Org.rosterOf(target.id) : []));

      const fullOrg = (id) => {
        const nd = g.Org && g.Org.byId[id];
        if (!nd) return '';
        if (nd.type === 'hq') return nd.name;
        if (nd.type === 'station') return '부산소방재난본부 ' + nd.name.replace(/^부산/, '');
        return '부산소방재난본부 ' + nd.name;
      };
      const reqOrg = req.createdOrgId ? fullOrg(req.createdOrgId) : (od.station || od.org || '부산소방재난본부');
      const subOrg = od.org ? `${od.org} > ${od.dept || '해당 부서/센터'}` : '(제출 기관명)';
      const dl = req.deadline ? new Date(req.deadline) : null;
      const dlStr = dl ? `${dl.getFullYear()}. ${dl.getMonth() + 1}. ${dl.getDate()}.(${'일월화수목금토'[dl.getDay()]})까지` : '기한 내';
      const titleText = req.title ? `[${od.station || od.org}] ${req.title}` : '자료 제출 서식';

      const aoa = [];
      const st = {}; // 'r,c' -> 스타일 id
      const merges = [];
      const heights = {};
      const put = (r, c, v, s) => { (aoa[r] = aoa[r] || [])[c] = v; if (s != null) st[r + ',' + c] = s; };
      const fillRow = (r, s) => { for (let c = 0; c < n; c++) { if (aoa[r][c] == null) aoa[r][c] = ''; st[r + ',' + c] = st[r + ',' + c] ?? s; } };

      // 0행: 문서 제목
      put(0, 0, titleText, S.TITLE); aoa[0].length = 1; for (let c = 1; c < n; c++) st['0,' + c] = S.TITLE;
      merges.push({ s: { r: 0, c: 0 }, e: { r: 0, c: n - 1 } }); heights[0] = 34;
      aoa[1] = []; heights[1] = 8;

      // 2~5행: 요청 정보 표 (구분 | 내용)
      const descPrefix = req.desc ? `[안내·작성방법] ${String(req.desc).replace(/\r?\n/g, ' ')}  |  ` : '';
      const baseGuide = roster.length
        ? `① 소속 인원명부(${roster.length}명, 타 센터 인원 제외)의 기존 보유 정보(기관·소속·계급·성명·생년월일·임용일자·연락처 등)가 미리 입력되어 있습니다.  ② 작성자는 필요한 빈 칸 항목만 입력하시고, 해당 없는 인원 행이나 회색 예시 행은 삭제 후 제출하세요.`
        : '① 기관·소속은 미리 입력되어 있으니 그대로 두세요.  ② 회색 글씨 행은 작성 예시이므로 확인 후 삭제하거나 덮어쓰세요.  ③ 입력 칸이 부족하면 표 아래로 행을 추가해 작성하세요.';
      const guideMsg = descPrefix + baseGuide;
      const info = [
        ['요청 기관', reqOrg || '-'],
        ['제출 대상', `${subOrg} (본인 센터 전용 · 타 센터 인원 제외)`],
        ['제출 기한', dlStr],
        ['작성 요령', guideMsg],
      ];
      info.forEach(([k, v], i) => {
        const r = 2 + i;
        put(r, 0, k, S.LABEL); put(r, 1, v, S.VALUE); fillRow(r, S.VALUE);
        for (let c = 2; c < n; c++) aoa[r][c] = '';
        if (n > 2) merges.push({ s: { r, c: 1 }, e: { r, c: n - 1 } });
        heights[r] = i === 3 ? 36 : 22;
      });
      aoa[6] = []; heights[6] = 10;

      // 7행: 작성란 표 머리글
      const HR = 7;
      cols.forEach((c, i) => put(HR, i, c.name, S.HEAD));
      heights[HR] = 26;
      let r = HR + 1;

      // 예시 더미서식 (회색 이탤릭)
      const exStart = r;
      for (let i = 0; i < 2; i++) {
        if (!cols.some((c) => c.examples && c.examples[i])) continue;
        cols.forEach((c, ci) => put(r, ci, (isOrgCol(c) && od.org) ? od.org : (isDeptCol(c) && od.dept) ? od.dept : (c.examples && c.examples[i]) || '', S.EX));
        heights[r] = 21; r++;
      }

      // 실제 작성란 표 (업로드된 마스터 명단 중 본인 센터 행 필터링 또는 인원명부 연동 자동 기재 + 추가 공란 행 제공)
      const inStart = r;
      const deptColIdx = cols.findIndex((c) => isDeptCol(c));
      const orgColIdx = cols.findIndex((c) => isOrgCol(c));
      const shortDept = (od.dept || '').replace(/119안전센터|안전센터|119구조대|구조대|소방서|119소방정대|소방정대/g, '').trim();
      const prefillSrc = opts.prefillRows || req.prefillRows;
      const uploadedCenterRows = (useRoster && Array.isArray(prefillSrc) && prefillSrc.length && od.dept)
        ? prefillSrc.filter((row) => {
          const dVal = deptColIdx >= 0 ? String(row[deptColIdx] || '') : '';
          const oVal = orgColIdx >= 0 ? String(row[orgColIdx] || '') : '';
          return (dVal && (dVal.includes(od.dept) || (shortDept && dVal.includes(shortDept)))) ||
                 (!dVal && oVal && (oVal.includes(od.dept) || (shortDept && oVal.includes(shortDept))));
        })
        : [];
      const hasMeta = cols.some((c) => isNoCol(c) || isOrgCol(c) || isDeptCol(c) || isRankCol(c) || isNameCol(c) || isBirthCol(c) || isAppointCol(c) || isPhoneCol(c));
      if (uploadedCenterRows.length) {
        let seq = 1;
        uploadedCenterRows.forEach((uRow) => {
          cols.forEach((c, ci) => {
            if (isNoCol(c)) put(r, ci, String(seq), S.PRE);
            else if (uRow[ci]) put(r, ci, uRow[ci], S.PRE);
            else put(r, ci, '', S.IN);
          });
          heights[r] = 22; r++; seq++;
        });
      } else if (hasMeta) {
        let seq = 1;
        if (roster.length) {
          roster.forEach((p) => {
            cols.forEach((c, ci) => {
              if (isNoCol(c)) put(r, ci, String(seq), S.PRE);
              else if (isOrgCol(c) && od.org) put(r, ci, od.org, S.PRE);
              else if (isDeptCol(c) && od.dept) put(r, ci, od.dept, S.PRE);
              else if (isRankCol(c)) put(r, ci, p.rank || '', S.PRE);
              else if (isNameCol(c)) put(r, ci, p.name || '', S.PRE);
              else if (isBirthCol(c)) put(r, ci, p.birth || '', S.PRE);
              else if (isAppointCol(c)) put(r, ci, p.appointedAt || '', S.PRE);
              else if (isPhoneCol(c)) put(r, ci, p.phone || '', S.PRE);
              else if (isDutyCol(c)) put(r, ci, p.duty || '', S.PRE);
              else put(r, ci, '', S.IN);
            });
            heights[r] = 22; r++; seq++;
          });
        }
        const blankCount = roster.length ? 3 : 8;
        for (let k = 0; k < blankCount; k++) {
          cols.forEach((c, ci) => {
            if (isNoCol(c)) put(r, ci, String(seq), S.PRE);
            else if (isOrgCol(c) && od.org) put(r, ci, od.org, S.PRE);
            else if (isDeptCol(c) && od.dept) put(r, ci, od.dept, S.PRE);
            else put(r, ci, '', S.IN);
          });
          heights[r] = 22; r++; seq++;
        }
      } else {
        for (let k = 0; k < 8; k++) {
          cols.forEach((c, ci) => put(r, ci, '', S.IN));
          heights[r] = 22; r++;
        }
      }

      // 열 너비 자동 계산 (한글 1자 ≈ 2칸)
      const wlen = (s) => [...String(s || '')].reduce((a, ch) => a + (ch.charCodeAt(0) > 255 ? 2 : 1), 0);
      const widths = [];
      for (let c = 0; c < n; c++) {
        const col = cols[c];
        let w = col ? Math.max(wlen(col.name), ...(col.examples || []).map(wlen), wlen(isOrgCol(col) ? od.org : isDeptCol(col) ? od.dept : '')) + 5 : 14;
        if (c === 0) w = Math.max(w, 12);
        widths.push(Math.min(Math.max(w, 10), 40));
      }

      // 계급 드롭다운 입력 보조 — 목록 외 직접 입력도 허용
      const valids = [];
      cols.forEach((c, ci) => {
        if (isRankCol(c)) valids.push({ col: ci, from: inStart, to: r - 1, list: ['소방사', '소방교', '소방장', '소방위', '소방경', '소방령', '소방정'] });
      });

      // 작성안내 시트
      const guide = [['항목', '필수', '개인정보', '자동 입력', '예시 1', '예시 2']].concat(cols.map((c) => [
        c.name, c.required ? '필수' : '', c.pii ? '해당(분리·암호화 저장)' : '',
        (isOrgCol(c) || isDeptCol(c) || isNoCol(c)) ? '조직별 자동 입력' : (isRankCol(c) || isNameCol(c) || isDutyCol(c)) ? '인원명부 연동 시 자동 입력' : '',
        (c.examples && c.examples[0]) || '', (c.examples && c.examples[1]) || '',
      ]));
      guide.push(
        [],
        ['※ 기관·소속(및 인원명부 연동 시 계급·성명)은 제출 센터별로 미리 입력된 상태로 내려받습니다.'],
        ['※ 인사이동 후 [조직도 · 인원명부] 메뉴에서 인원 소속을 변경해 두면 모든 서식에 즉시 반영됩니다.'],
        ['※ 회색 글씨 예시 행은 참고용입니다. 날짜·숫자는 어떤 형식으로 적어도 접수됩니다.'],
      );

      return { aoa, st, merges, heights, widths, n, headerRow: HR, exStart, inStart, end: r, valids, guide, rosterCount: roster.length };
    },

    /** 요청 서식 엑셀(SheetJS 워크북) */
    buildTemplate(req, target, opts) {
      const L = Excel.templateLayout(req, target, opts);
      const ws = X().utils.aoa_to_sheet(L.aoa.map((row) => row || []));
      ws['!merges'] = L.merges;
      ws['!cols'] = L.widths.map((w) => ({ wch: w }));
      const gs = X().utils.aoa_to_sheet(L.guide);
      gs['!cols'] = [{ wch: 18 }, { wch: 8 }, { wch: 22 }, { wch: 24 }, { wch: 24 }, { wch: 24 }];
      const wb = X().utils.book_new();
      X().utils.book_append_sheet(wb, ws, '제출서식');
      X().utils.book_append_sheet(wb, gs, '작성안내');
      Object.defineProperty(wb, '_layout', { value: L, enumerable: false });
      return wb;
    },

    /** 서식(표 테두리·머리글 배경·예시 회색·틀 고정·인쇄 설정)이 완벽히 적용된 요청 서식 .xlsx 바이트 */
    async templateBytes(req, target, opts) {
      opts = Object.assign({}, opts);
      const Vt = g.Vault;
      // 개인정보는 Vault 토큰으로 보관되므로 서식 생성 직전에만 복호화한다
      if (!opts.roster && g.Store && g.Store.resolvedRoster && target && target.id) opts.roster = await g.Store.resolvedRoster(target.id);
      if (!opts.prefillRows && Vt && Array.isArray(req.prefillRows) && req.prefillRows.some((r) => r.some((c) => Vt.isToken(c)))) {
        if (!prefillCache || prefillCache.src !== req.prefillRows) {
          const rows = await Promise.all(req.prefillRows.map((r) => Promise.all(r.map(async (c) => (Vt.isToken(c) ? ((await Vt.getText(c)) || '') : c)))));
          prefillCache = { src: req.prefillRows, rows };
        }
        opts.prefillRows = prefillCache.rows;
      }
      const wb = Excel.buildTemplate(req, target, opts);
      const L = wb._layout;
      const zip = await g.JSZip.loadAsync(X().write(wb, { bookType: 'xlsx', type: 'array' }));
      zip.file('xl/styles.xml', STYLES_XML);
      zip.file('xl/worksheets/sheet1.xml', sheetXml({
        rows: L.aoa, style: (r, c) => L.st[r + ',' + c], ncols: L.n, merges: L.merges, heights: L.heights, widths: L.widths,
        freeze: L.headerRow + 1, valids: L.valids, selected: true, landscape: true,
      }));
      const gst = {};
      L.guide.forEach((row, r) => row.forEach((v, c) => { if (r === 0) gst[r + ',' + c] = S.HEAD; else if (row.length > 1) gst[r + ',' + c] = S.CELL; else gst[r + ',' + c] = S.NOTE; }));
      zip.file('xl/worksheets/sheet2.xml', sheetXml({
        rows: L.guide, style: (r, c) => gst[r + ',' + c], ncols: 6, merges: [], heights: { 0: 24 }, widths: [18, 8, 22, 24, 24, 24],
      }));
      return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
    },

    /** 취합 결과 등 표 형태 보고서 .xlsx. sheets: layoutReport 명세 배열 */
    async reportBytes(sheets) {
      const wb = X().utils.book_new();
      sheets.forEach((sp) => X().utils.book_append_sheet(wb, X().utils.aoa_to_sheet([['']]), sp.name.slice(0, 31)));
      const zip = await g.JSZip.loadAsync(X().write(wb, { bookType: 'xlsx', type: 'array' }));
      zip.file('xl/styles.xml', REPORT_STYLES_XML);
      sheets.forEach((sp, i) => {
        const L = layoutReport(sp);
        const hasRows = sp.rows.length > 0;
        zip.file(`xl/worksheets/sheet${i + 1}.xml`, sheetXml({
          rows: L.aoa, style: (r, c) => L.st[r + ',' + c], ncols: L.nc, merges: L.merges, heights: L.heights, widths: L.widths,
          freeze: sp.freeze !== false && hasRows ? L.hr + 1 : 0,
          autofilter: hasRows && sp.filter !== false ? `${ref(L.hr, 0)}:${ref(L.last, sp.header.length - 1)}` : '',
          selected: i === 0, landscape: true,
        }));
      });
      return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
    },

    toBytes(wb) {
      return X().write(wb, { bookType: 'xlsx', type: 'array' });
    },

    /** 취합: items=[{orgName, rows}] → aoa (첫 컬럼에 제출조직 컬럼 없이 서식 컬럼 그대로 취합) */
    merge(header, items, includeOrg = false) {
      const out = includeOrg ? [['제출조직'].concat(header)] : [header.slice()];
      items.forEach((it) => it.rows.forEach((r) => out.push(includeOrg ? [it.orgName].concat(r) : r.slice())));
      return out;
    },

    aoaToWb(sheets) {
      const wb = X().utils.book_new();
      sheets.forEach((s) => {
        const ws = X().utils.aoa_to_sheet(s.aoa);
        if (s.aoa[0]) ws['!cols'] = s.aoa[0].map((h) => ({ wch: Math.max(12, String(h).length * 2 + 2) }));
        X().utils.book_append_sheet(wb, ws, s.name.slice(0, 31));
      });
      return wb;
    },

    /** CSV 인젝션 방지: 수식으로 해석될 수 있는 값 앞에 ' 추가 */
    safeCell(v) {
      const s = String(v ?? '');
      return /^[=+\-@\t\r]/.test(s) && !isNum(s) ? "'" + s : s;
    },
  };

  g.Excel = Excel;
  if (typeof module !== 'undefined') module.exports = Excel;
})(typeof window !== 'undefined' ? window : globalThis);
