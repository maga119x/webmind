# 문서 관리와 에이전트 환경

문서는 코드와 함께 이 저장소에서 버전 관리한다. [문서 시작점](README.md)을 인수인계 입구로 사용한다. 채팅, 에이전트 개인 메모, 무시되는 `.deploy/`·`.browser/`의 임시 파일은 정본이 아니다. 새로운 담당자가 추적 파일만으로 코드와 절차를 이해할 수 있어야 한다. 비밀값과 사용자 데이터는 별도 보관한다.

## 갱신 책임

변경을 만든 개발자/에이전트가 같은 변경에서 관련 문서도 갱신한다.

| 변경 | 갱신할 문서 |
|---|---|
| 새 기능·지원 범위·제약 | FEATURES, CURRENT_STATUS; 조작은 MOVEMENT |
| 모듈 책임·저장/인증 흐름 | ARCHITECTURE, DATA_API; 이유가 바뀌면 DECISIONS |
| 모델·리비전·DB·HTTP·IndexedDB 계약 | DATA_API, 관련 ARCHITECTURE/GOOGLE_DRIVE |
| 실행 명령·환경 변수·테스트 구성 | DEVELOPMENT, 필요 시 README와 `.env.example` |
| Google 프로젝트·OAuth·Picker·보호 정책 | GOOGLE_DRIVE, CURRENT_STATUS; 실제 증거는 VALIDATION |
| 배포·SMTP·DNS·백업·복구 | SERVER; Docker 대안만 DEPLOYMENT |
| 실제 배포 및 검사 수행 | CURRENT_STATUS의 최신 상태, VALIDATION의 날짜별 결과 |
| 장애 원인·회귀 조건 | TROUBLESHOOTING, 관련 설계/검사 기록 |
| 개발 규칙·문서 검사 | AGENTS, DOCUMENTATION, 필요 시 DEVELOPMENT |
| 개인정보 처리·공개 설명 | `public/privacy.html`, `public/about.html`와 관련 내부 문서 |

CURRENT_STATUS는 현재 상태를 요약한다. VALIDATION은 당시 증거를 유지하며, 오래된 미완료 기록이 현재인 것처럼 보이면 날짜·대체 기록을 명시한다. 소스와 문서가 다르면 실행/테스트로 확인하고 정정한다. 예정·모의 통과·실계정 통과·배포 완료를 같은 의미로 쓰지 않는다. 검증 기록에는 명령, 날짜, 환경, 결과, 한계를 포함한다.

## 도구별 진입점

공통 규칙은 [AGENTS.md](../AGENTS.md)에 한 번만 정의하고 각 도구의 안내 파일은 이를 참조한다.

| 도구 | 저장소 설정 | 역할 |
|---|---|---|
| Codex 및 AGENTS 지원 도구 | [AGENTS.md](../AGENTS.md) | 필독 순서, 변경 규칙, 보존 조건, 완료 검사 |
| Claude Code | [CLAUDE.md](../CLAUDE.md) | AGENTS import와 문서 안내 |
| Gemini CLI | [GEMINI.md](../GEMINI.md) | AGENTS import와 문서 안내 |
| GitHub Copilot | [.github/copilot-instructions.md](../.github/copilot-instructions.md) | 구현/리뷰 시 공통 지침과 문서 확인 |
| Cursor | [.cursor/rules/webmind.mdc](../.cursor/rules/webmind.mdc) | `alwaysApply: true` 프로젝트 규칙 |
| 사람과 그 외 도구 | [CONTRIBUTING.md](../CONTRIBUTING.md), [PR 양식](../.github/pull_request_template.md) | 읽기 순서·문서/검증 기록 확인 |

도구 형식의 근거: [Claude Code 프로젝트 메모리](https://code.claude.com/docs/en/memory), [Gemini CLI 컨텍스트](https://geminicli.com/docs/cli/gemini-md/), [Copilot 저장소 지침](https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/add-custom-instructions/add-repository-instructions), [Cursor 프로젝트 규칙](https://cursor.com/docs/rules). 파일을 읽는 기능이 비활성화되었거나 지원하지 않는 클라이언트에서는 [문서 시작점의 전달 문장](README.md)을 작업 프롬프트에 포함한다. 도구별 세션에서 지침이 로드되는지는 해당 도구의 컨텍스트/메모리 표시로 확인한다.

## 자동 검사

[check-docs.mjs](../scripts/check-docs.mjs)는 Node 기본 모듈만 사용하며 다음을 검사한다.

1. 필수 문서와 에이전트 진입점이 존재하고, 진입점이 공통 문서와 연결되어 있는가.
2. Git이 관리하는 파일과 새로 추가된 무시되지 않은 Markdown/규칙 파일의 상대 링크가 실제 저장소 파일을 가리키는가. 코드 블록·외부 URL·문서 내부 앵커는 검사 대상에서 제외한다. 완전한 Markdown 파서나 외부 URL 생존 검사가 아니다.
3. 기준 커밋이 주어졌을 때 제품 코드·설정·테스트·스크립트 변경에 하나 이상의 본문 `docs/*.md` 수정이 동반되는가. 인덱스나 루트 README만 바꾸는 것으로는 충족되지 않는다. 삭제만 한 문서도 갱신으로 인정하지 않는다.

```sh
npm run docs:test
npm run docs:check
npm run docs:check -- --base <전체-커밋-SHA>
```

`--base`는 기준 커밋과 **현재 작업 트리**를 비교하며 추적되지 않은 신규 파일도 포함한다. 기준은 환경 변수 `DOCS_BASE_SHA`로도 전달할 수 있다. 기준이 없으면 구조 검사만 수행했다고 출력한다. 최초 push의 0으로 채워진 기준은 별도로 표시하고 동반 변경 검사만 생략한다. 유효하지 않거나 로컬에 없는 기준은 실패한다.

GitHub Actions의 [Verify WebMind](../.github/workflows/ci.yml)는 전체 Git 이력으로 PR의 base 또는 push 직전 커밋과 비교한다. `docs` 작업이 실패하면 제품 `test` 작업도 진행하지 않는다. 개발자가 고칠 파일을 출력하며 자동 문서 생성이나 동작 추측은 하지 않는다.

## 보장 범위

문서 파일·참조·변경 누락은 자동 검사로 잡을 수 있다. **모든 에이전트가 실제로 읽고 이해했는지, 문서 내용이 코드와 의미상 일치하는지는 강제로 증명할 수 없다.** 관련 내용을 읽고 근거를 확인하는 작업 지침과 리뷰가 필요하다. PR 양식은 참고/갱신 문서와 검사 결과를 기록하게 한다.

현재 구성은 CI 실패를 표시하는 것이며 GitHub branch protection/ruleset을 새로 설정하지 않는다. 직접 push나 관리자 우회를 막는 필수 status check는 저장소의 별도 보호 설정이 필요하다. 이번 변경은 전역 에이전트 설정·사용자의 다른 프로젝트·운영 앱을 변경하지 않는다.
