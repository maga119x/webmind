# 검증 기록

검증 환경: Windows, Node.js 24.19.0. 최신 검사: 2026-10-01. 아래 이전 기록은 해당 날짜의 결과입니다.

## Google Drive 저장 전환 — 2026-10-01

- `npm test`: 6개 파일, **35개 통과**. 기존 편집·파일·인증·권한·백업 검사를 유지했습니다.
- Drive 검사에는 토큰 암호화/변조, 세션에 연결된 일회용 OAuth state, 거절 처리, 갱신 직렬화, 다른 Google 계정 차단, 연결 해제, 권한/용량/요청 제한 오류 분류가 포함됩니다. OAuth 응답은 모의 응답입니다.
- 조건부 저장 검사에서 오래된 조건을 실제로 거절하는 모의 구현만 원본 저장을 활성화했습니다. 버전 확인 뒤 외부 갱신, 저장 응답 유실 후 재시도, 재시도 전에 외부 수정, 미검증 조건에서 별도 파일 생성 검사를 통과했습니다.
- 목록 캐시 삭제 후 재구성, 새 본문/이미지의 서버 DB·영구 디스크 미기록, 첨부 소유권 검사, 외부 상대 이미지의 제한된 해석, 독립 복제·휴지통 이동을 확인했습니다.
- 이전 서버 문서와 이미지의 재다운로드·의미 비교·해시 검증, 자유 좌표와 알 수 없는 XML 보존, 반복 이전의 동일 결과, 원본 읽기 전용 보관을 확인했습니다.
- `npm run test:e2e`: **35개 통과, 20개 명시적 제외**. Chromium/Firefox/WebKit, 모바일 Chromium/WebKit 에뮬레이션에서 기존 편집·단축키·이동·자유배치·한글 조합·입출력과 로컬 문서/이미지 복구를 검사했습니다. 제외 항목은 플랫폼 전용 또는 중복 조합입니다.
- WebKit에서 발견한 IndexedDB File/Blob 저장 문제는 ArrayBuffer 저장으로 수정했고 5개 환경에서 이미지·새로고침·ZIP 흐름을 다시 통과했습니다.
- `npm run test:e2e:drive`: **2개 통과**. 독립 임시 DB/메모리 Drive 서버에서 이메일 가입·인증 → Drive 저장 → 오프라인 편집·재시도 → 충돌 복사본 → 이미지 독립 복제 → 로그아웃, 그리고 두 브라우저 컨텍스트의 외부 변경 반영·충돌 초안 새로고침 복구·최신본 열기 전 로컬 복구본 생성·게스트/회원 데이터 격리를 확인했습니다.
- TypeScript와 production 빌드 통과. 개발 브라우저에서 내 마인드맵/Drive 연결 UI를 직접 확인했고 페이지 오류가 없었습니다. 개발 서버는 `http://localhost:5173`입니다.
- 모의 Drive 부하: 3계정 × 1,001노드 × 20회 저장, **60회 성공**, 지연 중앙값 **310ms**, 95백분위 **342ms**. 테스트 서버의 Windows peak working set은 **294.3MiB**였습니다. 실제 Google 네트워크·요청 제한·Linux 512MB 환경의 측정이 아니며, 이 수치만으로 320MB 컨테이너 제한이나 512MB 서버의 여유를 보장하지 않습니다.

실제 Google 자격 증명이 없어 **Google 가입·기존 계정 연결, 실제 Picker 권한, 실제 토큰 만료/철회, Google Drive 조건부 갱신, FreeMind GUI와 Drive 동기화 왕복**은 완료로 표시하지 않습니다. [설정과 실계정 확인 절차](GOOGLE_DRIVE.md)를 따라 별도로 확인해야 합니다. 런타임은 실제 연결의 조건부 갱신 검사가 성공하기 전까지 원본 보호 모드를 사용합니다.

## 이전 검증 기록 — 2026-09-27

## 이동·자유배치 개선 후 검증

- `npm run test`: 23개 통과. 다중 선택 순서, 중복 선택, 순환 이동 거절, 계층 변경, 방향 유지, 자유 위치의 레이아웃·스키마·복사·XML 왕복 포함.
- `npx playwright test tests/e2e/editor.spec.ts tests/e2e/movement.spec.ts`: 29개 통과, 플랫폼에 맞지 않거나 중복인 16개 조합 제외. 데스크톱 Chromium/Firefox/WebKit 및 모바일 Chromium/WebKit 에뮬레이션.
- 추가 Chromium 모바일 CDP 터치 입력 검사 1개 통과: 터치 드래그로 자유 위치 저장, 두 손가락 핀치 후 문서 구조·좌표 불변.
- 브라우저에서 드래그 미리보기, Esc 취소, 실행 취소·다시 실행, 새로고침 복구, 자동배치 초기화, 드롭 가장자리 순서 변경, 겹쳐 놓는 자유배치, 키보드 순서·좌우·계층·미세 이동 확인.
- TypeScript 검사 및 production 빌드 통과. 개발 서버 `http://localhost:5173`에서 개선 사항 확인 가능.
- 자유배치 좌표는 WebMind 전용 `.mm` 확장으로 보존합니다. FreeMind 자체의 시각 배치 일치는 검증하거나 보장하지 않습니다. 조작 설명: [MOVEMENT.md](MOVEMENT.md).

## 실행한 검사

- TypeScript 검사와 production 번들 빌드.
- 모델·FreeMind 변환·인증·권한·백업·production 정적 페이지 검사 19개 통과.
- Chromium, Firefox, WebKit, 모바일 Chromium, 모바일 WebKit에서 편집·IME 조합·서식·가져오기·복구 흐름 15개 통과.
- Chromium에서 이메일 가입·인증, 클라우드 자동 저장, 오프라인 편집 후 재시도, 409 충돌 복사본, 이미지 독립 복제, 로그아웃 뒤 접근 차단 통과.
- PNG 파일 시그니처, SVG 문서, 접이식 HTML 다운로드 검사 통과.
- 데스크톱 드래그로 부모 변경, 모바일 메뉴로 부모 변경 검사 통과.
- 최종 브라우저 전체 실행: 19개 통과. 중복 실행을 줄이기 위해 클라우드·파일 바이트·드래그 검사를 일부 엔진에서만 실행한 11개 조합은 명시적으로 건너뛰었습니다.
- 백업 복원 후 DB 레코드·이미지 바이트 일치, 기존 디렉터리 덮어쓰기 거부, 변조된 백업 거부.
- `npm audit`: 보고된 취약점 없음.

실제 iOS/Android 기기가 아닌 브라우저 에뮬레이션입니다. Safari 앱 자체가 아닌 Playwright WebKit으로 검사했습니다.

## 파일 호환성

- 생성한 5,001개 노드 문서의 export → import → layout 검증.
- 공식 FreeMind 1.0.1 배포에 포함된 `doc/freemind.mm`: 482개 노드, 11개 화살표. 왕복 후 ID·부모·자식 순서·텍스트·메모 보존 확인.
- 공식 `freemind.jar`의 **MindMapXMLElement 파서**로 WebMind가 내보낸 공식 도움말 482개 노드와 자체 fixture 4개 노드를 다시 읽는 데 성공.
- 이 검사는 원본 엔진의 데이터 읽기 검증입니다. 실제 FreeMind GUI에서 글꼴·이미지·화살표 위치를 육안 비교한 것은 아닙니다. GUI 수동 승인 절차는 FEATURES.md에 있습니다.

원본 프로그램 파일은 `.browser/`에만 내려받았으며 제품에 포함되지 않습니다. 재현하려면 공식 ZIP을 풀고 다음 명령을 실행합니다(Windows classpath 구분자는 `;`, Linux는 `:`).

```sh
npx tsx scripts/check-official-fixture.ts .browser/freemind/doc/freemind.mm
java -Djava.awt.headless=true -Dfile.encoding=UTF-8 \
  -cp '.browser/freemind/lib/*;.browser/freemind/lib/jibx/*;.browser/freemind/lib/SimplyHTML/*;.browser/freemind/plugins/script/*' \
  groovy.ui.GroovyMain scripts/NativeCheck.groovy .browser/official-roundtrip.mm 482
```

PowerShell에서는 `'-Djava.awt.headless=true'`, `'-Dfile.encoding=UTF-8'`처럼 JVM 옵션을 따옴표로 감싸세요.

## 이전 서버 저장 방식의 로컬 부하 측정

`npm run test:load`로 3개 계정이 각각 1,001개 노드 문서를 20회 저장했습니다.

| 항목 | 결과 |
|---|---:|
| 총 저장 | 60회 성공 |
| 저장 지연 중앙값 | 약 21ms |
| 저장 지연 95백분위 | 약 42ms |
| Node 최대 working set | 약 163MiB |

Windows 개발 프로세스에서 이전 SQLite 본문 저장 방식을 측정한 값이며 현재 Drive 방식의 성능이 아닙니다. Linux 컨테이너 또는 Lightsail의 보장 성능도 아닙니다.

## 미실행 항목

- Docker 이미지 빌드·컨테이너 구동·512MB 제한에서의 부하 검사. Docker 엔진이 실행되지 않은 상태였고, Docker Desktop 시작을 포함한 명령이 자동 승인 검토에서 정책상 차단되었습니다. 구체적인 차단 사유는 제공되지 않았습니다.
- 최종 빌드 후 `APP_URL=http://localhost:3000`을 지정한 `npm start` 명령도 자동 승인 검토에서 차단되어 상시 미리보기 프로세스로 유지하지 못했습니다. 개발 서버와 테스트 서버를 통한 앞선 브라우저 검증은 실제로 수행했습니다.
- 실제 Lightsail 배포, 도메인 TLS, 외부 SMTP 배달. 서버 접속·DNS·SMTP 정보가 필요합니다.
- 실제 모바일 기기의 터치·키보드, 실제 Safari 앱, 물리 프린터 또는 PDF 인쇄 대화상자의 출력 검수.
- 원본 FreeMind GUI에서의 최종 시각 비교.

이 항목들은 통과한 것으로 간주하지 않습니다. Docker/서버 환경이 준비되면 DEPLOYMENT.md 순서로 검증합니다.
