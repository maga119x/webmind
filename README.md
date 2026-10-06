# WebMind

FreeMind `.mm` 파일을 읽고 편집하는 오픈소스 웹 마인드맵입니다. 한국어·영어 UI, PC·모바일 편집, 로컬 저장과 개인 Google Drive 저장을 제공합니다.

개발을 이어받는 사람과 에이전트는 **[문서 시작점](docs/README.md) → [현재 상태](docs/CURRENT_STATUS.md) → [개발 절차](docs/DEVELOPMENT.md)**를 먼저 읽으세요. 공통 작업 규칙은 [AGENTS.md](AGENTS.md), 참여 절차는 [CONTRIBUTING.md](CONTRIBUTING.md)에 있습니다. 설계·API·운영·장애 대응과 검증 기록을 코드와 함께 관리합니다.

## 로컬 실행

Node.js 24가 필요합니다.

```sh
npm ci
npm run dev
```

브라우저에서 **http://localhost:5173** 을 엽니다. 로그인 없이 여러 문서를 만들고 이미지와 함께 이 브라우저에 저장할 수 있습니다. Google Drive 저장에는 WebMind 로그인과 별도의 Drive 연결이 필요합니다. [Google 설정 안내](docs/GOOGLE_DRIVE.md)를 참고하세요. 개발 기본 URL과 인증 쿠키가 일치하도록 `127.0.0.1` 대신 `localhost`를 사용하세요.

환경을 변경하려면 `.env.example`을 `.env`로 복사합니다. 개발에서는 SMTP가 없으면 `data/mailbox.jsonl`에 인증·재설정 메일 링크를 기록합니다. **http://localhost:5173/api/dev/mailbox** 에서도 확인할 수 있습니다. 이 메일함 API는 production 모드에서는 제공하지 않습니다. 개발 서버는 외부에 공개하지 마세요.

```sh
npm run docs:check
npm run check
npm run build
npm test
npx playwright install chromium firefox webkit
npm run test:e2e
npm run test:e2e:drive
npm start
```

빌드된 앱을 로컬에서 직접 실행할 때는 `APP_URL=http://localhost:3000`으로 설정하고 http://localhost:3000 을 사용하세요. 개발 모드의 5173 주소를 그대로 두면 인증 경로가 맞지 않습니다.

## 편집

- Tab/Insert: 하위 생각, Enter: 같은 수준 생각, F2/더블클릭: 텍스트 편집.
- Shift+Enter: 텍스트 편집 중 줄바꿈. 한글 조합 중 Enter는 편집을 종료하지 않습니다.
- Space: 접기·펼치기. Ctrl/Cmd+Z/Y: 실행 취소·다시 실행.
- Shift/Ctrl+클릭: 다중 선택. 선택한 가지를 다른 노드 위에 끌어 놓으면 부모가 변경됩니다.
- 속성 패널에서 메모, 서식, 이미지, 아이콘, 연결선, 좌우 방향과 순서를 편집합니다.
- 모바일은 하단 편집 메뉴, 두 손가락 확대와 배경 드래그를 사용합니다.

자동 저장은 IndexedDB 복구본을 기록하고, Drive 문서는 입력 중단 2초 후 또는 연속 편집 중 15초 간격으로 동기화합니다. 외부 변경을 감지하면 최신본을 불러오거나 충돌 복사본 저장을 안내합니다. 실제 Drive에서 오래된 조건부 요청의 거절을 확인하기 전에는 별도 변경본을 저장합니다. 같은 문서를 여러 탭에서 편집하는 것은 실시간 공동 편집이 아닙니다.

내 마인드맵에서 **로컬 / Google Drive / 이전 서버 문서**를 구분합니다. 기존 서버 문서는 읽기 전용으로 보관되며, **이전**을 누르면 문서와 이미지를 Drive에 복사하고 다시 내려받아 검증합니다. 로그인만으로 서버 문서를 생성하지 않으며 게스트 문서는 명시적으로 가져옵니다.

## 파일 호환성

지원하는 내용·서식·메모·아이콘·화살표를 `.mm`로 왕복 변환하며, 알 수 없는 XML 확장 요소를 보존합니다. 위험한 XML과 암호화된 문서는 가져오지 않습니다. 외부/로컬 이미지는 직접 연결해야 합니다. 이미지까지 다른 컴퓨터로 옮길 때는 ZIP 내보내기를 사용하세요.

[기능 대응표와 제한](docs/FEATURES.md), [검증 결과](docs/VALIDATION.md), [실제 운영·백업·복원](docs/SERVER.md), [별도 Docker 배포](docs/DEPLOYMENT.md)를 참고하세요.

## 구조

| 경로 | 역할 |
|---|---|
| `shared/` | 문서 모델, 구조 검증, 편집 연산, FreeMind 변환, 레이아웃 |
| `src/` | React 편집기, 계정 UI, IndexedDB 복구, 파일 내보내기 |
| `server/` | Fastify, Better Auth, SQLite, 문서·첨부파일 권한 |
| `scripts/` | 오프라인 백업·안전한 복원·부하 검사 |
| `tests/` | 모델·파일·권한 테스트, 브라우저 E2E |

문서 API는 `/api/maps`, `/api/maps/:id`, `/api/maps/:id/assets`를 사용합니다. 수정 요청은 `{title, document, revision, requestId}`이며 `revision`은 불투명 문자열, `requestId`는 재시도에 재사용하는 UUID입니다. 리비전 불일치는 HTTP 409입니다. 문서와 첨부파일의 소유권을 매번 검사합니다. 새 문서 본문과 이미지의 원본은 Drive에 있고 서버에는 계정·세션·암호화한 토큰·연결 정보·목록 캐시·이전/요청 식별자만 저장합니다. 기존 서버 문서와 이미지는 이전 후에도 읽기 전용으로 보존합니다.

요청과 `.mm`는 8MiB, 단일 이미지 업로드는 5MiB, 문서는 10,000노드/256단계까지로 제한합니다. Drive 계정의 용량과 API 제한이 적용됩니다. 모의 Drive는 테스트 프로세스에만 주입되며 실제 운영에서 켤 수 있는 환경변수나 API를 제공하지 않습니다.

## 라이선스

GPL-2.0-or-later. [LICENSE](LICENSE), [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). FreeMind 공식 배포판은 아니며 원본 Java UI나 비트맵 아이콘을 포함하지 않습니다.
