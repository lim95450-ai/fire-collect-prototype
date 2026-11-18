/* 데모용 샘플 엑셀 생성: node tools/make_samples.js  (모두 가상 데이터) */
const path = require('path');
const fs = require('fs');
const XLSX = require('../prototype/vendor/xlsx.full.min.js');
XLSX.writeFile = (wb, f) => fs.writeFileSync(f, XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));

const out = path.join(__dirname, '..', 'samples');
fs.mkdirSync(out, { recursive: true });

// 1) 서식 예시: 제목행 + 2단 머리글(병합) — 새 요청 만들기에서 드래그해 분석 시연
{
  const aoa = [
    ['소방장비 보유현황 조사표', '', '', '', '', ''],
    ['(2026년 하반기 기준)', '', '', '', '', ''],
    ['장비명', '규격', '보유 현황', '', '도입일자', '비고'],
    ['', '', '수량', '보유부서', '', ''],
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 5 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: 5 } },
    { s: { r: 2, c: 2 }, e: { r: 2, c: 3 } },
    { s: { r: 2, c: 0 }, e: { r: 3, c: 0 } },
    { s: { r: 2, c: 1 }, e: { r: 3, c: 1 } },
    { s: { r: 2, c: 4 }, e: { r: 3, c: 4 } },
    { s: { r: 2, c: 5 }, e: { r: 3, c: 5 } },
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '조사표');
  XLSX.writeFile(wb, path.join(out, '01_서식예시_장비보유현황(2단머리글).xlsx'));
}

// 2) 서식 예시: 단순 머리글 + 개인정보 컬럼 + 예시 1행 (필수 표시 *)
{
  const aoa = [
    ['성명*', '생년월일*', '연락처*', '소속*', '교육 이수일자*', '비고'],
    ['홍길동', '1990-05-02', '010-0000-0000', '범일119안전센터', '2026-10-20', ''],
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'Sheet1');
  XLSX.writeFile(wb, path.join(out, '02_서식예시_교육이수자명단.xlsx'));
}

// 3) 제출 예시: 교육이수자 명단 (가상 개인정보 포함, 4번째 행 소속에 연락처가 섞여 있음 → 탐지 시연)
{
  const aoa = [
    ['성명', '생년월일', '연락처', '소속', '교육 이수일자'],
    ['김가상', '1991-03-14', '010-1234-5678', '범일119안전센터', '2026-10-20'],
    ['이가상', '1987-12-01', '010-2345-6789', '부전119안전센터', '2026-10-21'],
    ['박가상', '1993-07-30', '010-3456-7890', '수정119안전센터', '2026-10-21'],
    ['최가상', '1985-01-09', '010-4567-8901', '가야119안전센터 (비상연락 051-123-4567, 900101-1234567)', '2026-10-22'],
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), '명단');
  XLSX.writeFile(wb, path.join(out, '03_제출예시_교육이수자명단(가상개인정보).xlsx'));
}

// 4) 제출 예시: 장비 보유현황 (정상)
{
  const aoa = [
    ['장비명', '규격', '수량', '보유부서', '도입일자', '비고'],
    ['소방펌프차', '3,000L급', 5, '범일119안전센터', '2021-03-15', ''],
    ['구조공작차', '5t급', 1, '부산진119구조대', '2020-08-07', ''],
    ['공기호흡기', 'KFI 6.8L', 120, '부전119안전센터', '2022-05-30', '일부 교체 예정'],
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'Sheet1');
  XLSX.writeFile(wb, path.join(out, '04_제출예시_장비보유현황.xlsx'));
}

// 5) 제출 예시: 장비 보유현황 (오류 포함 → 검증 시연)
{
  const aoa = [
    ['장비명', '규격', '수량', '보유부서', '도입일자', '비고'],
    ['소방펌프차', '3,000L급', '다섯 대', '범일119안전센터', '2021-03-15', ''],
    ['', '5t급', 1, '부산진119구조대', '2020/13/45', ''],
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'Sheet1');
  XLSX.writeFile(wb, path.join(out, '05_제출예시_장비보유현황(오류포함).xlsx'));
}

console.log('샘플 생성 완료:', out);
