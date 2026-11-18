# 행정자료 취합시스템 (프로토타입)

부산소방재난본부 본부·소방서·센터 간 자료 요청 → 제출 → 검토 → 취합을 한 곳에서 처리하는 **프로토타입**입니다.
서버·DB 없이 브라우저만으로 동작하며, 모든 데이터는 **브라우저 내부(localStorage·IndexedDB)** 에만 저장됩니다.

> **실제 개인정보를 입력하지 마세요.** 화면의 인원·제출 데이터는 모두 가상입니다.
> SSO, 내부망 연동, 모바일 어플 푸시 등은 시연용 화면이며 실제로 연동되지 않습니다.

## 실행

```bash
node serve.js          # http://localhost:8080  (Windows: 서버실행.bat)
```

외부 의존성이 없습니다. `localhost` 는 보안 컨텍스트라 WebCrypto/IndexedDB 가 동작합니다.
(배포 시에도 HTTPS 가 필요합니다.)

## 구성

| 경로 | 설명 |
|---|---|
| `prototype/` | 웹앱 본체 (HTML/JS/CSS, `vendor/` 에 SheetJS·JSZip) |
| `samples/` | 가상 데이터 샘플 서식·제출 파일, 로컬 취합 VBA 매크로 |
| `serve.js` | 로컬 정적 서버 (127.0.0.1 바인딩) |
| `scripts/build-static.js` | 정적 호스팅용 빌드 (`prototype/` + `samples/` → `dist/`) |
| `tools/` | 테스트 (`test_logic.js`, `e2e.js`) |

## 테스트

```bash
cd tools && npm install        # 최초 1회 (playwright-core, @xmldom/xmldom)
node test_logic.js             # 엑셀·개인정보·공문(ODT/HWPX)·취합 서식 로직
node e2e.js                    # Edge 기반 브라우저 E2E (Edge 경로는 e2e.js 상단에서 수정)
```

## 배포 (Vercel)

`vercel.json` 이 빌드 명령(`node scripts/build-static.js`)과 출력 폴더(`dist`), 보안 헤더를 지정합니다.
정적 사이트이므로 환경 변수·서버 설정이 필요 없습니다. `main` 브랜치에 push 하면 자동으로 다시 배포됩니다.

**배포 주소:** https://fire-collect-prototype.vercel.app/ (Vercel Deployment Protection 적용 — Vercel 로그인이 필요합니다)

**운영 전 필수 확인**

- 배포 주소가 공개되지 않도록 Vercel *Deployment Protection* 을 유지하세요. 이 앱에는 로그인이 없습니다.
- 개인정보 암호화 키가 브라우저 localStorage 에 함께 저장됩니다(시연 수준). 운영 단계에서는 별도 서버·KMS/HSM 으로 분리해야 합니다.
- 보안성 검토, 취약점 점검, 개인정보 영향평가 해당 여부 확인이 필요합니다.
