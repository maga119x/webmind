# 장애 대응과 작업 보존

운영 정보는 [CURRENT_STATUS](CURRENT_STATUS.md), 배포·백업은 [SERVER](SERVER.md), 저장 알고리즘은 [ARCHITECTURE](ARCHITECTURE.md)를 따른다. 로그나 재현 자료에는 OAuth 코드·토큰·쿠키·SMTP 키·개인 문서 본문을 포함하지 않는다.

## 충돌 표시 또는 작업이 이전 내용으로 돌아가는 경우

1. 현재 화면의 필요한 작업을 `.mm` 또는 이미지 포함 ZIP으로 먼저 다운로드한다. **사이트 데이터·IndexedDB 삭제, 로그아웃, 강제 새로고침을 복구의 첫 단계로 사용하지 않는다.**
2. 내 마인드맵의 저장소, 현재 문서 제목과 ID, 저장 상태, 시간, 어떤 버튼 직후 발생했는지 기록한다. 같은 제목의 Drive 파일도 ID가 다를 수 있다. 다른 탭·FreeMind·Drive 동기화 앱을 확인하되, 메시지만으로 다른 기기가 원인이라고 단정하지 않는다.
3. 충돌 중 현재 편집을 유지하려면 **복사본 저장** 또는 다운로드를 사용한다. **최신본 열기**는 원격 버전으로 전환하므로 이전 내용처럼 보일 수 있다. 이때 현재 작업은 로컬 `문서 제목 복구본`으로 보관되며 내 마인드맵에서 다시 연다.
4. 수정 버전이 배포되어 있는지 실제 `/srv/webmind/current` 링크를 확인한다. `/api/health`의 `0.1.0`만으로 판단하지 않는다. 화면이 구버전 번들을 사용한다면 작업을 보관한 뒤 새로고침한다. 브라우저 캐시·초안을 일괄 삭제하지 않는다.

### 수정된 사고와 회귀 조건

2026-10-04 `42a8167` 이전에는 본문이 같아도 Drive `version` 증가로 충돌이 발생했다. 여기에 오래된 외부 조회가 저장 후 도착하거나, 복구 초안의 dirty 인식이 늦어 원격 내용이 적용되면서 작업이 되돌아갈 수 있었다. 수정 후 다음 조건을 유지해야 한다.

- 메타데이터 version만 증가하고 본문·이름·종류·부모가 같으면 충돌하지 않는다.
- stat/다운로드/stat 중 본문 변화와 실제 외부 수정은 무시하지 않는다.
- 저장 전 시작한 GET은 저장 후 화면을 덮지 않는다.
- 저장 응답과 IndexedDB 쓰기를 기다리는 동안 입력한 텍스트가 보존된다.
- dirty 초안을 열자마자 원격 조회가 와도 복구 내용을 유지한다.
- 불확실한 pending 저장을 외부 조회보다 먼저 재확인한다.
- 최신본 열기 준비 중 추가 입력하면 교체를 중단한다.

관련 검사: `tests/drive.test.ts`, `tests/e2e/sync.spec.ts`, `tests/e2e/cloud.spec.ts`. [검증 기록](VALIDATION.md)에 실제 Drive 메타데이터 갱신/본문 충돌 검사의 범위가 있다. 메타데이터만 바뀌는 오류를 수정했다고 실제 충돌까지 무시하거나 보호 모드를 해제하지 않는다.

## 증상별 확인

| 증상 | 확인과 조치 |
|---|---|
| 오프라인/동기화 중 상태가 계속됨 | 로컬 초안 보존 → 네트워크 및 health → 로그인/Drive 상태 확인. 같은 요청을 무작정 새 UUID로 다시 보내지 않음 |
| 401, 세션 만료 | 작업 다운로드 후 같은 WebMind 계정으로 로그인; 다른 계정으로 전환하면 기존 계정의 캐시는 숨겨짐 |
| Drive 연결 필요/권한 철회 | 기존 연결 계정 확인 후 재연결. 연결 해제는 Drive 파일 삭제가 아님 |
| 용량 부족/429 | Drive 용량 또는 요청 제한을 확인; 앱의 백오프를 유지하고 반복 업로드를 강제하지 않음 |
| 파일을 찾을 수 없음/403 | 소유 계정, 휴지통, Picker 선택 권한 확인. 임의 파일 ID만으로 권한을 우회하지 않음 |
| Picker가 열리지 않거나 키 오류 | 같은 프로젝트의 OAuth/키/숫자 appId, API 활성화, origin/referrer 제한 확인. `Referrer-Policy: strict-origin-when-cross-origin` 유지 |
| OAuth redirect mismatch/state 오류 | APP_URL·등록 콜백 두 개·현재 브라우저 origin·세션 확인. 코드/state를 복사해 임의 재사용하지 않음 |
| 외부 `.mm` 이미지 누락 | 폴더와 개별 파일 접근을 구분; Picker로 이미지 재연결. 경로가 애매하거나 외부/로컬 경로면 자동 접근하지 않음 |
| 목록 캐시 재구성이 필요 | 로그인 후 새로고침. `drive_cache`만 목록 캐시이며 operations/migrations/connections를 함께 삭제하지 않음 |
| 메일이 오지 않음 | emailAuthEnabled → 전용 SMTP 설정 → Resend 도메인/발송 상태·반송 확인. 운영 dev mailbox를 켜지 않음 |
| 502/시작 실패 | systemd·loopback health·디스크/메모리·최근 로그 확인. 현재 ENV의 비밀값을 출력하지 않음 |
| HTTPS 갱신 실패 | A 레코드, ACME 경로, Certbot 타이머/인증서 확인. 이미 성공한 초기 발급 타이머를 반복 실행하지 않음 |

Google 상세 설정과 실제 권한 검증은 [GOOGLE_DRIVE](GOOGLE_DRIVE.md), SMTP/DNS/TLS 구성은 [SERVER](SERVER.md)에 있다.

## 운영에서 읽기 전용 진단

SSH 접속 후 Linux 셸에서 실행한다. 로그는 필요한 구간만 보고 외부에 공유하기 전에 민감 정보를 제거한다.

```sh
readlink -f /srv/webmind/current
systemctl is-active webmind nginx
systemctl show webmind -p MemoryCurrent -p MemoryPeak
curl --fail --silent http://127.0.0.1:3210/api/health
curl --fail --silent https://webmind.danho.kr/api/config
free -m
df -h /var/lib/webmind
sudo journalctl -u webmind --since '10 minutes ago' --no-pager
sudo nginx -t
```

새 릴리스 문제이면 [활성화/롤백 절차](SERVER.md)에 따라 직전 검증된 릴리스를 사용한다. DB 스키마가 바뀌었다면 코드 롤백만으로 충분한지 먼저 확인한다. 원본 DB/첨부를 삭제하거나 기존 환경 파일을 새 예시로 덮어쓰지 않는다.

## 복원 범위

서버 백업은 계정·암호화 토큰·설정/작업 기록·이전 서버 문서를 보호한다. 새 Drive 문서/이미지와 브라우저의 미동기화 초안은 포함하지 않는다. Drive 휴지통/버전과 사용자 ZIP, 해당 브라우저의 로컬 복구 문서를 별도로 확인한다.

복원은 새 디렉터리에만 실행하고 manifest 해시·SQLite 무결성 확인 후 전환한다. AUTH_SECRET은 별도 보관본과 일치해야 하며, 다른 데이터 경로를 쓸 때 systemd의 쓰기 허용 경로도 조정해야 한다. [서버 복원](SERVER.md)의 순서를 사용하고 운영 데이터를 직접 덮어쓰지 않는다.
