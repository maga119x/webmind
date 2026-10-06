# 개발·검증 절차

작업 전에 [AGENTS](../AGENTS.md), [현재 상태](CURRENT_STATUS.md), 작업에 해당하는 [설계 문서](README.md)를 읽는다. 명령은 별도 표시가 없으면 저장소 루트에서 실행한다.

## 로컬 시작

Node.js 24와 npm, Git을 사용한다. `better-sqlite3`는 네이티브 모듈이므로 다른 OS의 `node_modules`를 복사하지 않는다. 잠금 파일 기준으로 설치한다.

```sh
npm ci
npm run dev
```

기본 UI는 `http://localhost:5173`, API는 `127.0.0.1:3000`이다. Vite가 `/api`를 API 서버로 프록시한다. 실행 전에 해당 포트의 기존 프로세스를 확인하고 다른 서비스가 쓰는 프로세스를 종료하지 않는다. 종료는 해당 개발 터미널에서 Ctrl+C를 사용한다.

환경을 바꿀 때만 [.env.example](../.env.example)을 `.env`로 복사한다. PowerShell은 `Copy-Item .env.example .env`, Linux/macOS는 `cp .env.example .env`를 사용하되 기존 파일을 덮어쓰지 않는다. 실제 비밀값은 커밋하지 않는다. 개발 기본 secret은 `data/.dev-secret`에 생성된다. 예시의 AUTH_SECRET을 사용할 경우 무작위 값으로 바꾸고 안정적으로 보관한다.

Google 설정이 없어도 로컬 편집과 모의 Drive 검사가 가능하다. 개발 모드에서 SMTP가 없으면 `data/mailbox.jsonl` 또는 `/api/dev/mailbox`로 인증 메일을 확인한다. 링크가 포함되므로 개발 서버와 메일함을 외부에 공개하지 않는다. 운영에서는 이 API가 없다.

빌드 결과를 로컬에서 확인하려면 `npm run build` 후 **개발 모드**와 `APP_URL=http://localhost:3000`으로 `npm start`를 실행한다. `NODE_ENV=production`은 HTTPS URL과 운영 인증 설정을 요구한다. 실제 운영은 [SERVER](SERVER.md)를 따른다.

## 환경 변수

서버가 읽는 설정이다. `VITE_`로 이름을 바꾸거나 클라이언트 번들에 비밀값을 넣지 않는다.

| 변수 | 개발 기본/용도 | 운영 주의 |
|---|---|---|
| `NODE_ENV` | `development`; 정확히 `production`일 때 운영 검사 | production 필수 |
| `HOST`, `PORT` | `127.0.0.1`, `3000` | 기존 서버는 `127.0.0.1:3210` |
| `APP_URL` | 브라우저 origin `http://localhost:5173` | `https://webmind.danho.kr`; OAuth 콜백·쿠키 기준 |
| `DATA_DIR` | `./data` | `/var/lib/webmind`; 프로세스에 쓰기 권한 필요 |
| `AUTH_SECRET` | 미설정 시 개발 전용 파일 생성 | 무작위 32자 이상, 변경 시 암호화 토큰 영향; 별도 보관 |
| `TRUST_PROXY` | 정확히 `true`일 때 프록시 신뢰 | 신뢰할 프록시 뒤 loopback 운영에서만 사용 |
| `EMAIL_AUTH_ENABLED` | `false` 이외에는 활성 | 비활성일 때도 Google 로그인은 독립 |
| `SMTP_HOST` | 비어 있으면 개발 메일함 | 이메일 활성 운영은 필수 |
| `SMTP_PORT`, `SMTP_SECURE` | `587`, `false` | Resend 현재 `465`, `true` |
| `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` | 발송 인증/발신자 | 서비스 전용 키, 주소 사용 |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google 로그인/Drive 연결 | 같은 웹 OAuth 클라이언트; secret 비공개 |
| `GOOGLE_PICKER_API_KEY` | Picker 초기화 시 필요한 키 | 브라우저 전달 가능하지만 referrer/API 제한 필수 |
| `GOOGLE_PROJECT_NUMBER` | 숫자 프로젝트 번호 | 프로젝트 문자열 ID와 다름 |
| `BACKUP_DIR` | 백업 스크립트 목적지 | DATA_DIR 외부의 새 디렉터리 |
| `TEST_URL`, `TEST_ORIGIN` | 부하 스크립트 대상/origin | 모의 서버 전용; 실계정/운영 부하 검사에 사용하지 않음 |

## 검사 선택표

| 변경 범위 | 필요한 검사와 추가 확인 |
|---|---|
| 문서·에이전트 안내만 | `npm run docs:check`, `git diff --check`; 근거 소스와 날짜 대조 |
| 문서 검사기·정책 | `npm run docs:test`, `npm run docs:check -- --base <전체 SHA>` |
| shared 모델/이동/파일 변환 | `npm run check`, `npm test`; 관련 편집 E2E/왕복 fixture |
| React UI/단축키/모바일 | `npm run build`, 관련 `test:e2e`; IME·모바일 대체 조작 확인 |
| 저장·복구·Drive | `npm run build`, `npm test`, `npm run test:e2e:drive`; 계정 격리·늦은 응답·불확실한 저장 검사 |
| 인증·권한·운영 구성 | build/test, production/권한 검사; 실제 OAuth/SMTP는 별도 증거 |
| 백업·복원 | `npm test`의 backup 검사; 별도 디렉터리 복원, 운영 덮어쓰기 금지 |
| Google 설정 Python 도구 | `python -m unittest discover -s tests -p test_configure_google.py` |
| 배포 shell | Linux/WSL의 `for script in deploy/*.sh; do bash -n "$script"; done` |

전체 제품 회귀 검사의 일반 순서:

```sh
npm run docs:test
npm run docs:check
npm run build
npm test
npx playwright install chromium firefox webkit
npm run test:e2e
npm run test:e2e:drive
git diff --check
```

Linux CI의 브라우저 설치는 `--with-deps`를 추가한다. 특정 테스트는 `npx vitest run tests/drive.test.ts`, `npx playwright test tests/e2e/movement.spec.ts --project=chromium`처럼 실행할 수 있다. 모의 Drive의 특정 테스트는 빌드 후 `npx playwright test --config playwright.drive.config.ts tests/e2e/sync.spec.ts`를 사용한다.

일반 E2E는 5173 개발 서버를 재사용할 수 있고 Chromium/Firefox/WebKit 및 모바일 에뮬레이션을 실행한다. **다른 프로젝트가 5173에서 실행 중이면 중단하고 대상 구성을 먼저 확인한다.** `cloud.spec.ts`와 `sync.spec.ts`는 이 설정에서 제외되며, Drive E2E의 전용 4173 서버에서만 실행한다. Drive E2E는 기존 서버를 재사용하지 않고 임시 DB·모의 메일·메모리 Drive를 사용한다. 두 설정을 혼동하면 존재하지 않는 테스트 API 때문에 잘못된 실패가 발생한다.

테스트 추가 위치는 [아키텍처](ARCHITECTURE.md)의 모듈 책임과 `tests/`의 기존 회귀를 따른다. 단순 구현 복사 테스트보다 사용자 작업 유실·권한 경계·호환성·경합 재현을 우선한다. 통과한 검사를 이유 없이 반복하지 않는다.

## 결과와 인수인계

실행한 명령, 통과/실패/제외 수, 환경, 미실행 항목을 [VALIDATION](VALIDATION.md)에 날짜와 함께 기록한다. 과거 검증을 이번 변경의 검증으로 보고하지 않는다. 모의 Drive 성공은 실제 OAuth·조건부 업로드 성공이 아니다. WebKit 에뮬레이션은 실제 Safari/iPhone 검증이 아니다.

기능/API/운영 변경에는 관련 문서를 동반한다. 문서 비교 정책은 [DOCUMENTATION](DOCUMENTATION.md)을 따른다. 배포 시에는 커밋, 새/이전 릴리스, 백업, health 및 주요 흐름, 롤백 결과를 남긴다. 문서만 수정한 경우 앱 배포는 필요하지 않다.
