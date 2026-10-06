# 문서 모델과 저장 API

정확한 스키마는 [shared/model.ts](../shared/model.ts), 라우트는 [server/storage.ts](../server/storage.ts)와 [server/app.ts](../server/app.ts)가 정의한다. 이 문서는 새 담당자를 위한 계약 요약이다.

## 문서 모델

`MapRecord`: `id`, `storage: local | drive | legacy`, `title`, 불투명 문자열 `revision`, ISO `updatedAt`, `document: MindMap`. 선택 값 `readOnly`, `safeCopy`; `recoveredDraft`는 브라우저 복구 초기화용이며 서버 신뢰 필드가 아니다. 목록 응답은 `document`가 없는 요약이다.

`MindMap`: `version: 1`, `root`, ID를 키로 하는 `nodes`, `arrows`, `warnings`, 선택 `sourceXml`. `MindNode`: `id`, `parent`(루트는 null), 순서가 있는 `children`, 여러 줄 `text`, `side`, `folded`, `style`, `icons`, HTML `note`, 선택 `rich/link/image/cloud/offset/sourceXml`. 화살표는 `id/from/to`와 선택 `color`이다.

- 모델 1, SQLite `user_version=2`, 제품 문자열 0.1.0은 서로 다른 버전이다.
- 한 루트, 유효한 부모·자식 참조, 중복/순환 없는 도달 가능한 트리를 유지한다. 노드 이동·삭제 시 연결선도 일관되게 유지한다.
- 노드 10,000개, 깊이 256단계, 화살표 10,000개 제한. 요청과 `.mm` 8MiB, 이미지 5MiB. 세부 문자열 한도는 Zod 스키마를 따른다.
- 자유 좌표 `offset`은 배치 기준 상대값이며 `.mm`의 `WEBMIND_DX`, `WEBMIND_DY`로 보존한다.
- `sourceXml`은 지원하지 않는 원본 XML 보존용이다. 스크립트/외부 엔티티 실행 권한을 뜻하지 않는다.
- Drive 앱 ID는 `g_<Google 파일 ID>`, 로컬 ID는 `local-<UUID>` 및 이전 게스트 `demo`, legacy는 기존 서버 ID이다.

리비전은 일반 앱 코드에서 해석하지 않는다. 서버는 체크섬이 있을 때 `["content-v1", md5Checksum, name, mimeType, parents]`를 직렬화한다. 이전 `[version, etag]` 형식도 처리한다. 이는 충돌 판단용이며 원자적 업데이트 보장을 대신하지 않는다. PUT 응답에서 `safeCopy: true`면 ID가 바뀐다. 호출자는 반드시 응답 ID/리비전을 이후 요청에 사용한다.

## 브라우저 저장

현재 `idb-keyval` 기본 IndexedDB 저장소에 다음 키를 사용한다. 삭제/이전 시 접두사와 사용자 ID를 보존한다.

| 키 | 내용 |
|---|---|
| `local-map:<user>:<id>` | 로컬 MapRecord |
| `remote-map:<user>:<id>` | 마지막 브라우저 원격 문서 캐시 |
| `webmind:<user>:<id>:<tabId>` | Draft `{record, dirty, time}` |
| `webmind:<user>:<id>` | 이전 초안 키; 복구에서 지원 |
| `local-blob:<user>:<assetId>` | `{bytes: ArrayBuffer, mime}`; 과거 Blob도 읽음 |
| `remote-blob:<user>:<url>` | 인증된 원격 이미지의 브라우저 캐시 |

`user`는 WebMind 사용자 ID 또는 `guest`. 탭 ID는 sessionStorage `webmind-tab`, 최근 문서는 localStorage `webmind-last:<user>`, 언어는 `webmind-language`이다. localStorage에 문서 본문이나 토큰을 저장하지 않는다. 브라우저 캐시는 서버의 영구 저장 제한과 구분한다. 브라우저 사이트 데이터를 지우면 로컬 초안·첨부·복구본도 사라진다.

## 서버 SQLite

파일은 DATA_DIR 아래 `webmind.sqlite`, WAL/foreign_keys/busy_timeout=5000. Better Auth의 user/session/account/verification 스키마는 해당 라이브러리 migration이 소유하며 임의 수동 수정하지 않는다.

| 앱 테이블 | 주요 열 | 역할 |
|---|---|---|
| `maps` | id, owner, title, revision, document, updatedAt | 이전 서버 원본; 새 Drive 본문 저장 금지 |
| `assets` | id, mapId, mime, size | 이전 첨부 메타데이터; 파일은 DATA_DIR/assets |
| `drive_connections` | owner PK, subject, email, tokens, folder, conditional | 연결 계정·AES-GCM 암호문·조건부 갱신 검증 결과 |
| `drive_oauth` | state PK, owner, sessionHash, verifier, expires | 일회용 세션 연결 state/PKCE |
| `drive_cache` | owner+subject+id PK, title, revision, updatedAt | Drive 목록 메타데이터; 다시 구성 가능 |
| `drive_operations` | owner+subject+key PK, fileId | 생성/복사 재시도 식별자; 단순 캐시가 아님 |
| `drive_migrations` | owner+legacyId PK, driveId, subject, verifiedAt | 검증된 이전 기록; 단순 캐시가 아님 |

새 문서 본문/첨부를 서버 DB·영구 디스크·로그에 저장하지 않는다. 운영 DB와 암호화 비밀값은 별도로 백업하며 AUTH_SECRET을 임의 변경하지 않는다. 스키마 변경은 기존 DB 업그레이드·백업/복원·롤백 계획과 테스트를 동반한다.

## HTTP API

문서·Drive API는 이메일이 확인된 세션이 필요하다. health/config는 공개이며, 인증 API는 Better Auth의 각 흐름에 따른다. 개발 메일함은 개발 모드에서만 공개된다. 변경 요청에 Origin 헤더가 있으면 APP_URL과 다른 origin을 거절한다. `/api/*` 응답은 `Cache-Control: no-store`를 사용한다. 로컬 문서는 브라우저에서만 관리한다.

| 메서드/경로 | 입력 / 결과 |
|---|---|
| GET `/api/health` | `{status:"ok", version:"0.1.0"}`; Google·SMTP 가용성 검사는 아님 |
| GET `/api/config` | `{googleLogin, emailAuthEnabled}` |
| GET/POST `/api/auth/*` | Better Auth 이메일/Google 로그인·세션·계정 연결·인증·재설정 |
| GET `/api/drive/status` | configured, googleLogin, pickerConfigured, connected, email?, conditionalVerified; 로그인 필요 |
| POST `/api/drive/connect` | `{url}` → Google 별도 동의로 이동 |
| GET `/api/drive/callback` | state/code/error; 검증 후 앱으로 redirect |
| POST `/api/drive/disconnect` | `{connected:false}`; Drive 파일 유지 |
| POST `/api/drive/picker-token` | 단기 accessToken, 제한된 apiKey, appId; 메모리에서만 사용 |
| POST `/api/drive/open` | `{fileId}` → 소유권·파싱 확인 후 MapRecord |
| GET `/api/maps` | Drive + legacy 문서 요약 목록; 로컬은 포함하지 않음 |
| POST `/api/maps` | `{title, document, requestId?}` → 201 Drive MapRecord |
| GET `/api/maps/:id` | 소유자의 MapRecord; legacy는 readOnly |
| PUT `/api/maps/:id` | `{title, document, revision, requestId}` → MapRecord; ID가 바뀔 수 있음 |
| DELETE `/api/maps/:id` | Drive 파일과 앱 관리 첨부 휴지통 이동 → 204; legacy 거절 |
| POST `/api/maps/:id/assets` | 지원 image MIME의 raw bytes → 201 `{url}`; multipart/form-data 아님 |
| GET `/api/maps/:id/assets/:asset` | 문서/첨부 소유권 검사 후 이미지 bytes |
| POST `/api/maps/:id/assets/relink` | Picker의 `{fileId}` → 문서에 독립 업로드한 `{url}` |
| POST `/api/maps/:id/migrate` | legacy 본문/첨부 복사·의미/해시 검증 → Drive MapRecord; 원본 유지 |
| GET `/api/dev/mailbox` | 개발 전용 인증/재설정 링크 목록; production에는 등록하지 않음 |

`title`은 trim 후 1~200자, requestId는 UUID이다. 생성/저장 API는 requestId 생략 시 서버가 생성하지만 클라이언트는 재시도 안전성을 위해 같은 UUID를 재사용한다. 문서 복제와 이름 변경은 별도 endpoint 없이 POST와 PUT을 사용한다. Better Auth의 직접 access-token/refresh-token endpoint는 차단한다.

오류 형태는 보통 `{error, code?}`이며 입력 검증은 `details`가 붙을 수 있다. 상태별 대응:

| 상태 | 의미 / 처리 |
|---|---|
| 400 | 잘못된 입력·문서·이미지; 입력 수정 |
| 401 | 세션 없음/만료; 로컬 초안 유지 후 재로그인 |
| 403 | origin 또는 Drive 권한; 권한 확인 |
| 404 | 삭제·권한 없음·연결되지 않은 첨부; 초안 유지 |
| 409 | 실제 충돌, legacy_readonly, 계정 불일치, 이전 검증 등; code로 구분 |
| 413 / 507 | 파일 크기 / Drive 용량; 다운로드·용량 정리 안내 |
| 428 | Drive 연결/재연결 필요 |
| 429 / 503 | 요청 제한/일시 장애 또는 미설정; code에 맞춰 재시도/설정 안내 |

실제 Google의 412 조건부 갱신 실패는 서버에서 conflict/409로 변환한다. Google 응답 본문·토큰을 오류 로그나 사용자 화면으로 그대로 전달하지 않는다.

## Drive 파일 메타데이터

`appProperties`의 `webmind`는 root/assets/asset/map/opened/pending 등을 구분한다. 첨부는 map/path/hash, 첨부 폴더는 assetFolder, 생성은 operation/createRequest/createHash/ready/source, 저장은 saveOperation/saveRequest/saveHash를 사용한다. 파일명만으로 식별하거나 이 속성을 무조건 지우지 않는다. 구체적 폴더/이미지 구조와 외부 파일 제약은 [GOOGLE_DRIVE](GOOGLE_DRIVE.md)를 따른다.
