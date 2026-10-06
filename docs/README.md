# WebMind 개발 문서 시작점

새 담당자는 [개발 지침](../AGENTS.md), [현재 상태](CURRENT_STATUS.md), [개발 절차](DEVELOPMENT.md)를 먼저 읽는다. 이 문서들은 코드와 함께 Git에서 관리하며 대화 기록을 읽지 않아도 작업을 이어갈 수 있게 유지한다.

## 읽을 문서

| 목적 | 문서 | 주요 내용 |
|---|---|---|
| 현재 무엇이 가능한가 | [CURRENT_STATUS](CURRENT_STATUS.md) | 운영 릴리스, 완료 범위, 제약, 우선 과제 |
| 실행·수정·검증 | [DEVELOPMENT](DEVELOPMENT.md), [CONTRIBUTING](../CONTRIBUTING.md) | 환경 변수, 포트, 검사 선택, 작업 완료 기준 |
| 코드와 데이터 흐름 | [ARCHITECTURE](ARCHITECTURE.md) | 모듈 책임, 편집·저장·복구·인증 흐름 |
| 모델·DB·HTTP 계약 | [DATA_API](DATA_API.md) | 노드, 리비전, IndexedDB, 테이블, 모든 앱 API |
| 사용자 기능·FreeMind 대응 | [FEATURES](FEATURES.md), [MOVEMENT](MOVEMENT.md) | 지원 기능, 키보드·드래그·자유배치, 호환성 한계 |
| Google 설정과 저장 | [GOOGLE_DRIVE](GOOGLE_DRIVE.md) | OAuth, Picker, 파일 구조, 충돌, 이전 |
| 실제 운영 서버 | [SERVER](SERVER.md) | SSH, Nginx/systemd, SMTP, 배포·백업·롤백 |
| 별도 Docker 환경 | [DEPLOYMENT](DEPLOYMENT.md) | 선택적 컨테이너 구성; 현재 운영 방식과 구분 |
| 설계 이유 | [DECISIONS](DECISIONS.md) | 저장 전환, 보호 모드, 호환성·보안 결정 |
| 장애·데이터 복구 | [TROUBLESHOOTING](TROUBLESHOOTING.md) | 잘못된 충돌, 초안, OAuth·Picker·SMTP·배포 장애 |
| 검증 근거 | [VALIDATION](VALIDATION.md) | 날짜별 실행 결과, 모의/실계정 구분, 미실행 항목 |
| 문서를 계속 유지하기 | [DOCUMENTATION](DOCUMENTATION.md) | 정본, 에이전트 진입점, CI 검사와 한계 |
| 라이선스·출처 | [LICENSE](../LICENSE), [THIRD_PARTY_NOTICES](../THIRD_PARTY_NOTICES.md) | GPL-2.0-or-later 및 의존성 출처 |

## 정보 해석

- CURRENT_STATUS는 현재 운영·구현 요약, VALIDATION은 날짜가 붙은 과거 증거다. 과거의 “미설정” 또는 “미배포”는 최신 상태보다 우선하지 않는다.
- 실행 가능한 사실은 코드·테스트·실제 운영 조회로 확인한다. 문서를 무시하고 별도 규칙을 만들지 말고, 불일치를 확인한 뒤 함께 고친다.
- `public/about.html`과 `public/privacy.html`은 사용자·OAuth 심사용 공개 페이지다. 개발 명세와 개인정보 처리 방식이 달라지면 이 페이지도 검토한다.
- 저장소만으로 복구할 수 없는 비밀값·운영 DB·사용자 Drive 데이터는 [서버 문서](SERVER.md)의 별도 보관/백업 대상이다.

## 다음 담당자에게 전달할 문장

> 저장소 루트의 AGENTS.md와 docs/README.md, docs/CURRENT_STATUS.md, docs/DEVELOPMENT.md를 먼저 읽고 관련 설계 문서를 확인한 뒤 작업하세요. 변경과 검증 결과를 문서에 반영하고 docs:check를 통과시키세요. 사용자 미저장 작업과 기존 서버 서비스를 보존하세요.
