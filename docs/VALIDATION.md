# 검증 기록

검증 환경: Windows Node.js 24.19.0, GitHub Actions Ubuntu Node.js 24, 운영 Ubuntu 24.04 Node.js 24.18.1. 최신 문서/운영 조회: 2026-10-06, 최신 제품 동기화 검사: 2026-10-04. 아래 이전 기록은 해당 날짜의 결과입니다.

## 인수인계 문서와 개발 지침 구성 — 2026-10-06

- 현재 소스 `71543bd`까지의 구현과 배포/검증 기록을 대조하여 문서 시작점, 현재 상태, 구조, 모델/API/DB, 개발 절차, 설계 결정, 장애 대응, 문서 관리 정책을 작성했습니다. 기능표의 실제 PDF 검수 및 Google 검증 범위, 이전 배포 문서의 미설정 설명도 정정했습니다.
- AGENTS.md를 공통 규칙으로 만들고 Claude Code/Gemini의 import, Copilot 안내, Cursor alwaysApply 규칙, 사람용 CONTRIBUTING/PR 양식으로 연결했습니다. 이 도구들을 모두 실제 실행해 지침 로딩을 확인한 것은 아닙니다. 구성 형식은 각 공식 문서와 대조했습니다.
- `npm run docs:test`: **8개 통과**. 정상 상대 링크/import, 누락 문서·진입점, 깨진/대소문자 불일치/무시된 파일 참조, 코드 변경의 문서 동반 조건, 파일 삭제·신규 파일, 인덱스/문서 삭제만으로 우회하는 경우, 잘못된/없는 기준 SHA·최초 push를 검사했습니다.
- `npm run docs:check -- --base 71543bd3fc3a4b578978844a285e728f7ae03bfb`: 필수 파일·문서 참조·문서 동반 변경 검사 통과. `git diff --check` 통과. GitHub Actions에 독립 docs 작업을 추가하고 제품 검사 전에 실행하도록 연결했습니다. 이 로컬 결과를 원격 전체 CI 결과로 간주하지 않습니다.
- 운영 SSH 읽기 전용 조회: 활성 릴리스 `20261004-42a8167`, WebMind와 Nginx active, HTTPS health/config 정상, Google 로그인·이메일 인증 활성. 메모리·디스크 순간값은 [CURRENT_STATUS](CURRENT_STATUS.md)에 기록했습니다.
- 제품 런타임 코드는 변경하지 않았으며 앱 재배포/재시작·DB/비밀값 변경은 하지 않았습니다. 문서 검사기 외의 제품 회귀·실제 OAuth·메일 발송·브라우저 검사는 이번 문서 작업에서 재실행하지 않았습니다. 직전 증거는 아래 날짜별 기록을 따릅니다.

## 단일 기기의 잘못된 Drive 충돌·복구 경합 수정 — 2026-10-04

- 내용이 바뀌지 않은 Drive 메타데이터 갱신만으로 리비전 충돌이 발생하는 실패 테스트를 먼저 재현했습니다. `version`이 보이지 않는 내부 변경에도 증가한다는 [Drive 파일 API 설명](https://developers.google.com/workspace/drive/api/reference/rest/v3/files)에 맞춰 파일 체크섬·이름·종류·부모 폴더로 편집 리비전을 구성했습니다. 바이트 체크섬 검증과 실제 외부 변경 검사는 유지했습니다.
- 저장 이전의 늦은 조회 응답 폐기, 미확정 저장의 재시도 우선 처리, IndexedDB 저장 대기 중 최신 입력 보존, 미저장 초안의 동기적 초기화, 최신본 열기 도중 추가 편집 보존을 수정했습니다. 복구본을 보관한 위치를 화면에 안내하며 외부 기기 사용을 단정하는 문구를 변경했습니다.
- TypeScript와 production 빌드 통과, 단위/API **38개 통과**. Drive 브라우저 시나리오 **6개 통과**(기존 2개, 신규 4개): 늦은 조회·저장 중 추가 입력·보호 모드 3회 연속 저장/오프라인 새로고침·최신본 열기 중 추가 편집을 포함합니다. 새 Drive 전용 검사는 일반 편집 브라우저 검사와 분리했습니다.
- 커밋 `42a8167`의 빌드를 `/srv/webmind/releases/20261004-42a8167`에 배포했습니다. 기존 릴리스 `20261004-66722e5`, DB·SMTP·Google 설정을 유지했습니다.
- 실제 연결된 Google Drive에서 새 검증용 문서로 메타데이터 갱신 후 편집·보호 모드 저장을 **3회 성공**했습니다. 실제 본문을 별도로 수정한 뒤 이전 리비전 저장이 **409로 거절**됨을 확인했습니다. 검사에 생성한 파일 4개는 Drive 휴지통으로 이동했습니다. 기존 사용자 문서는 변경하지 않았습니다.
- 이는 같은 파일 원본 덮어쓰기의 원자성 검증이 아닙니다. 원본 보호 모드는 계속 유지합니다. 이전 리비전 형식의 오래된 초안도 원본을 덮어쓰지 않고 별도 파일로 보존합니다. 이미 열려 있던 구버전 화면에는 새로고침이 필요합니다.

## Google 앱 공개·브랜딩 게시 — 2026-10-04

- OAuth 프로젝트 `webmind-danho`를 **외부 / 프로덕션 단계**로 전환하고 Google Console의 게시 상태를 확인했습니다. 테스트 사용자 등록 제한이 해제됐습니다. 사용자 Drive 파일의 공유 설정은 변경하지 않았습니다.
- 데이터 액세스에 `openid`, `userinfo.email`, `userinfo.profile`, `drive.file`만 등록했습니다. 인증 센터에서 모두 비민감 범위이며 별도 데이터 액세스 인증이 필요하지 않음을 확인했습니다.
- 공개 [서비스 소개](https://webmind.danho.kr/about.html)와 [개인정보처리방침](https://webmind.danho.kr/privacy.html)을 만들고 OAuth 홈페이지·개인정보처리방침으로 등록했습니다. 승인된 도메인은 `danho.kr`입니다. 브랜딩 자동 검증 후 게시했으며 **브랜딩이 인증되었으며 사용자에게 표시되고 있습니다** 상태를 확인했습니다.
- TypeScript와 production 빌드, 단위/API 검사 **36개**를 통과했습니다. 소개·개인정보처리방침을 모바일 너비 390px에서 확인했고 가로 넘침이 없었습니다. 커밋 `66722e5`를 `/srv/webmind/releases/20261004-66722e5`로 배포했으며 이전 릴리스·SMTP·환경 설정을 유지했습니다.
- 운영 서비스 active, HTTPS 상태 확인 API 정상, Google 로그인·이메일 인증 활성화를 확인했습니다. 기존 Chrome 로그인 세션에서 새로고침 후 Drive 저장 문서의 제목·내용·저장 상태가 유지됐습니다. 테스트 사용자에 등록되지 않았던 별도 계정의 최초 로그인은 이번 공개 설정 검사에 포함하지 않았습니다.
- 운영 Drive v3 파일 메타데이터의 읽기 전용 검사에서 200 응답과 `version`은 확인했으나 `ETag` 응답 헤더가 없었습니다. 연결의 조건부 갱신 검증 상태도 false여서 **원본 보호 모드를 유지**했습니다. Google 공개 설정과 별개인 앱의 보호 정책이며, 원본 자동 갱신의 안전성을 통과로 표시하지 않습니다.
- 아래의 같은 날짜 기록 중 OAuth 테스트 상태·공개 페이지 미완료 사항은 이 기록으로 대체합니다. 장기간 토큰 갱신/철회, 실제 이미지 왕복·외부 FreeMind 수정·다중 기기 경쟁의 남은 검증 항목은 유지합니다.

## 운영 Google 로그인·Drive·Picker 확인 — 2026-10-04

- 소유자가 자격 증명을 발급하고 대화형 설정 도구로 운영 서버에 입력했습니다. `/api/config`의 Google 로그인·이메일 인증 활성화와 서비스 정상 상태를 확인했습니다.
- Chrome에서 실제 Google 로그인 성공. 테스트 사용자 누락으로 Drive 동의가 차단되는 문제를 수정하고, 소유자가 직접 Drive 권한에 동의한 뒤 연결 성공.
- 실제 `.mm` 생성, 제목·노드 편집, 충돌 복사본 저장, 보호 모드의 변경본 저장을 확인했습니다. 초기 편집의 충돌 안내 원인은 확정하지 않았습니다. 이후 별도 문서의 연속 수정은 200 응답으로 완료됐습니다. 다중 기기 충돌 전체 검증은 아닙니다.
- Picker 오류를 재현하고 요청 출처가 `Referrer-Policy: same-origin`으로 누락되는 것을 확인했습니다. `strict-origin-when-cross-origin`으로 변경해 기존 키 제한을 유지하면서 Picker 표시·검색·재열기를 성공했습니다. `/api/drive/open`은 200이며 노드 내용이 일치했습니다. 새로고침 후에도 세션·문서 내용이 유지됐습니다.
- production 회귀 검사 2개 통과. 서버 코드 `cfdd76d`를 기존 정적 파일·의존성과 함께 `/srv/webmind/releases/20261004-picker-referrer`에 배포했습니다. 이전 릴리스 `20261002-d6709e4`와 SMTP·환경 파일을 보존했습니다.
- **남은 항목:** OAuth는 테스트 상태이며 공개 홈페이지·개인정보처리방침 연결과 공개 전환은 미완료입니다. 실제 조건부 갱신 검사는 통과하지 않아 원본 보호 모드를 유지합니다. 원본 자동 갱신, 장기간 토큰 갱신/철회, 이미지 왕복, 외부 FreeMind 변경, 다중 기기 경쟁은 별도 검증 대상입니다.

## 운영 HTTPS·Resend SMTP 확인 — 2026-10-04

- 초기 인증서 설정 작업이 성공했고 `https://webmind.danho.kr/api/health`에서 인증서 검증을 포함한 HTTPS 200 응답을 확인했습니다.
- `webmind` 서비스가 실행 중이며 초기 HTTPS 재시도 타이머는 성공 후 비활성화됐습니다. 일반 인증서 갱신은 Certbot이 담당합니다.
- 기존 두 서비스의 HTTPS 200 응답을 다시 확인했습니다.
- HostingKR에 Resend가 지정한 DKIM TXT와 발송용 CNAME 2개를 추가했습니다. 기존 네임서버와 10개 DNS 레코드를 유지했고, 권한 네임서버와 공개 DNS에서 값을 확인한 뒤 Resend의 `danho.kr` 도메인 **Verified** 상태를 확인했습니다.
- `webmind-production` 키를 **Sending access / danho.kr**로 제한하고 보호된 서버 환경 파일에 연결했습니다. `smtp.resend.com:465`의 TLS와 SMTP 인증이 성공했습니다.
- `WebMind <webmind@danho.kr>`에서 사용자가 지정한 주소로 테스트 메일 1건을 발송했습니다. SMTP 수락 1건·거절 0건이며 Resend에서 **Delivered**를 확인했습니다.
- `EMAIL_AUTH_ENABLED=true`를 적용하고 WebMind만 재시작했습니다. 운영 `/api/config`의 `emailAuthEnabled: true`, `/api/health`의 HTTPS 200 응답, 브라우저의 이메일 로그인 폼을 확인했습니다. 실계정 가입·인증 링크 클릭·비밀번호 재설정 전체 흐름은 이번 SMTP 검사에 포함하지 않았습니다.
- 이 SMTP 검사 시점에는 Google OAuth가 미설정이었습니다. 이후 Google 실계정 검증은 위 기록을 따릅니다. 아래 2026-10-02의 SMTP·TLS 보류 상태는 이 기록으로 대체됩니다.

## 개인 서버 배포 — 2026-10-02

- 코드 커밋 `d6709e4`를 공개 저장소 [maga119x/webmind](https://github.com/maga119x/webmind)에 게시했습니다.
- [GitHub Actions 검사](https://github.com/maga119x/webmind/actions/runs/36992282436)에서 production 빌드, 단위/API 검사, 데스크톱·모바일 브라우저 검사, 모의 Drive 브라우저 검사를 모두 통과했습니다. 로컬 단위/API 검사는 **36개 통과**입니다.
- 전용 `webmind` 사용자, `/var/lib/webmind` 데이터, `/etc/webmind/webmind.env` 설정, `127.0.0.1:3210` 포트와 systemd 서비스로 배포했습니다. 서비스 메모리 한도는 384MiB이며 시작 직후 약 53MiB를 사용했습니다. 이는 동시 사용자 부하 측정값이 아닙니다.
- 서버 내부 상태 확인 API와 정적 화면이 정상 응답합니다. SSH 터널을 통한 브라우저 검사에서 노드 편집, 제목 변경, 새로고침 후 복구, 이메일 설정 전 저장 안내를 확인했고 페이지 오류가 없었습니다.
- 서버에서 앱을 잠시 멈춰 일관된 백업을 생성한 뒤 즉시 재시작했습니다. 별도 디렉터리에 복원하여 manifest 해시, SQLite 무결성, DB 바이트 일치를 확인했습니다. 운영 데이터를 덮어쓰지 않았습니다.
- 기존 두 사이트는 배포 전후 HTTPS 200 응답을 유지했습니다. Nginx 로그 순환과 Certbot 갱신 타이머를 확인했습니다.
- SMTP는 사용자 요청으로 보류했습니다. `EMAIL_AUTH_ENABLED=false`에서 이메일 가입·로그인·재설정은 비활성화하며 서버에 테스트 메일을 기록하지 않습니다. 실제 Google OAuth 자격 증명도 미설정이므로 현재 운영 기능은 브라우저 로컬 편집·저장·다운로드입니다.
- 배포된 production 서버에서 별도 브라우저로 ZIP의 `.mm` 내용, 새로고침 복구, 모바일 편집을 확인했습니다. agent-browser 다운로드 명령은 취소 오류가 있어 Playwright의 실제 다운로드 바이트로 재검증했습니다.
- DNS A 레코드는 `13.124.18.202`이며 권한 네임서버 4개와 공개 DNS 응답을 확인했습니다. 인증서 staging 검증은 성공했으나 production 기관의 일부 지역에서 NXDOMAIN이 남아 HTTPS는 아직 미완료입니다. 전용 초기 설정 타이머가 10분 후부터 15분 간격으로 최대 4회 재시도하고, 성공 시 HTTPS 적용 후 스스로 비활성화하도록 준비했습니다. 실제 인증서 발급과 공개 HTTPS 응답은 별도 확인이 필요합니다.

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
- 당시에는 실제 Lightsail 배포, 도메인 TLS, 외부 SMTP 배달을 실행하지 않았습니다. 이후 서버 배포와 HTTPS·SMTP 배달을 검증했으며 위의 2026-10-02, 2026-10-04 기록을 따릅니다.
- 실제 모바일 기기의 터치·키보드, 실제 Safari 앱, 물리 프린터 또는 PDF 인쇄 대화상자의 출력 검수.
- 원본 FreeMind GUI에서의 최종 시각 비교.

이 항목들은 통과한 것으로 간주하지 않습니다. Docker/서버 환경이 준비되면 DEPLOYMENT.md 순서로 검증합니다.
