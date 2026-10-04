# Google Drive 저장

새 문서는 브라우저 로컬 또는 개인 Google Drive에 저장합니다. 서버 SQLite에는 회원·세션, 암호화한 OAuth 토큰, 연결 설정, 목록 메타데이터, 재시도/이전 식별자만 기록합니다. Drive 본문과 이미지 바이트는 변환·전송하는 동안 메모리에서 처리합니다. 기존 `maps`/`assets` 테이블과 디스크 이미지는 읽기 전용 원본으로 유지합니다.

## Google Cloud 설정

1. Google Cloud 프로젝트에서 **Google Drive API**와 **Google Picker API**를 활성화합니다.
2. OAuth 동의 화면에 앱 이름, 지원 이메일, 운영 도메인과 개인정보처리방침을 등록합니다. 테스트 상태에서는 실제 검증할 Google 계정을 테스트 사용자로 추가합니다.
3. **웹 애플리케이션** OAuth 클라이언트를 생성합니다. 개발 JavaScript origin은 `http://localhost:5173`입니다. 아래 두 redirect URI를 정확히 등록합니다.

   ```text
   http://localhost:5173/api/auth/callback/google
   http://localhost:5173/api/drive/callback
   ```

4. 운영 도메인에서도 HTTPS origin과 위 두 콜백 경로를 등록합니다. `APP_URL`은 브라우저가 보는 origin과 같아야 합니다. API 서버 포트 3000을 개발 콜백으로 등록하지 않습니다.
5. Picker용 API 키를 만들고 허용 HTTP referrer를 운영 origin과 Picker 프레임으로 제한합니다. 운영 키에는 `https://webmind.danho.kr/*`, `https://docs.google.com/*`를 등록하고, API 제한에는 **Google Picker API와 Google Drive API**만 지정합니다. 이는 2026-09-03 갱신된 [공식 Picker 설정](https://developers.google.com/workspace/drive/picker/guides/web-picker-sample)의 요건입니다. 개발 환경은 별도 프로젝트/키를 권장하며 그 키에만 localhost를 허용합니다. 숫자로 된 **프로젝트 번호**도 확인합니다.
6. `.env.example`을 `.env`로 복사하고 다음 값을 설정한 뒤 개발 서버를 재시작합니다. `VITE_` 접두사는 사용하지 않습니다.

   ```dotenv
   APP_URL=http://localhost:5173
   AUTH_SECRET=<안정적으로 보관할 무작위 32자 이상 값>
   GOOGLE_CLIENT_ID=<웹 OAuth 클라이언트 ID>
   GOOGLE_CLIENT_SECRET=<클라이언트 비밀값>
   GOOGLE_PICKER_API_KEY=<referrer/API 제한을 적용한 키>
   GOOGLE_PROJECT_NUMBER=<숫자 프로젝트 번호>
   ```

`AUTH_SECRET`은 Drive 토큰 암호화에도 사용합니다. 이미 연결한 뒤 변경하면 다시 연결해야 합니다. 개발에서 생략하면 `data/.dev-secret`을 사용합니다. DB 백업과 별도로 이 비밀값을 안전하게 보관하세요.

Google 로그인은 기본 계정 정보만 요청합니다. **내 마인드맵 → Google 로그인 계정 연결**은 로그인한 사용자의 명시적인 계정 연결입니다. **Drive 연결**은 별도 동의 화면에서 `openid email drive.file`과 장기 접근을 요청합니다. 갱신 토큰은 서버에만 보관하며 Picker를 열 때만 단기 접근 토큰을 브라우저 메모리로 전달합니다.

SMTP 준비 전 운영하려면 `EMAIL_AUTH_ENABLED=false`로 이메일 가입·로그인·재설정을 비활성화합니다. 이 모드에서 Google 설정까지 비어 있으면 로컬 편집만 제공하며, 운영 메일을 개발용 파일에 쓰지 않습니다. SMTP 설정 후 `true`로 전환하고 재시작하면 이메일 기능이 활성화됩니다.

`drive.file`은 앱이 만든 파일과 사용자가 Picker로 선택한 파일을 대상으로 합니다. 폴더를 골라도 그 안의 기존 파일 전체를 읽을 수 있다고 가정하지 않습니다. [Google 권한 안내](https://developers.google.com/workspace/drive/api/guides/api-specific-auth), [Picker 설정](https://developers.google.com/workspace/drive/picker/guides/overview)을 참고하세요.

## 운영 서버에 자격 증명 입력

Lightsail에는 `deploy/configure-google.py`를 `/srv/webmind/configure-google.py`로 설치했습니다. Windows PowerShell에서 아래 명령을 실행하면 OAuth 클라이언트 ID, 클라이언트 보안 비밀번호, Picker 키를 숨김 입력으로 받습니다. 기존 설정을 보호된 파일로 백업하고 Google 항목만 교체한 뒤 WebMind를 재시작합니다. 상태 검사에 실패하면 기존 설정을 복구합니다.

```powershell
ssh -t -i "C:\Users\HEYLIN\.ssh\lightsail-ubuntu-ed25519" ubuntu@13.124.18.202 "sudo python3 /srv/webmind/configure-google.py --project-number 185453382363"
```

키를 명령 인자나 저장소에 넣지 않습니다. 도구의 상태 검사 성공은 Google 권한 검증을 뜻하지 않습니다. 브라우저에서 로그인·Drive 동의·저장·Picker 재열기를 확인해야 합니다. 웹사이트 제한이 적용된 Picker 키가 출처를 확인할 수 있도록 운영 응답은 `Referrer-Policy: strict-origin-when-cross-origin`을 사용합니다.

## 사용자 흐름

- 연결 전: 로그인 없이 문서 생성·편집·이미지 연결·다운로드가 가능합니다. 로컬 문서와 이미지, 복구본은 IndexedDB에 저장됩니다.
- 연결: 로그인 후 내 마인드맵에서 Drive 연결을 실행합니다. 이메일/연결 상태, 재연결과 연결 해제를 확인할 수 있습니다. 사용자당 Google Drive 계정 하나를 연결합니다.
- 저장: 로컬 문서의 **Drive에 저장**을 누릅니다. 연결 후 새 문서는 Drive에 생성하며, **로컬 문서** 버튼으로 기기에만 저장할 수도 있습니다.
- 열기: **Drive에서 열기**의 Picker에서 본인 소유 `.mm` 파일을 선택합니다. 같은 이름의 파일도 ID로 구분합니다. 이름을 바꿔도 연결이 유지됩니다.
- 이미지: 업로드가 끝난 이미지만 `.mm`에 반영합니다. 외부 `.mm`의 이미지가 보이지 않으면 해당 노드를 선택하고 **Drive 이미지 연결** 또는 로컬 이미지 업로드를 사용합니다. 외부 파일에 첨부를 추가하려면 **첨부 폴더 접근 허용**으로 `.mm`가 들어 있는 폴더를 선택해야 할 수 있습니다. 폴더 선택은 기존 이미지 파일 권한을 대신하지 않습니다.
- 이전: 이전 서버 문서의 **이전**을 누르면 첨부까지 복사하고 다시 내려받아 내용·서식·이미지 해시를 확인합니다. 성공 후 Drive 문서를 엽니다. 서버 원본을 지우지 않으며 재시도는 같은 이전 작업을 사용합니다.
- 삭제/복제: 삭제는 Drive 휴지통 이동입니다. 앱이 관리하는 해당 문서 첨부만 함께 처리합니다. 복제는 이미지도 독립적으로 복사합니다.
- 계정 전환: 로컬/복구 데이터는 WebMind 사용자 ID별로 분리됩니다. 게스트 작업은 **이 기기의 게스트 문서 가져오기**로 가져옵니다. 연결 해제는 서버의 Drive 자격 증명을 제거하고 Drive 파일은 유지합니다. Google 계정 자체의 앱 권한 철회는 Google 계정 설정에서 수행합니다.

브라우저 데이터를 지우면 로컬 문서·첨부·미동기화 작업이 삭제됩니다. 문서 삭제 시 다른 탭의 복구본과 실행 취소가 참조할 수 있는 로컬 이미지 바이트는 유지합니다. 필요한 작업은 ZIP으로 보관하세요. 이미 로드된 앱에서의 통신 단절을 처리하며, 앱 자체를 완전 오프라인으로 처음 실행하는 PWA는 제공하지 않습니다.

## Drive 파일 구조

```text
WebMind/
  프로젝트 구상.mm
  여행 계획.mm
  assets/
    <문서 Drive ID>/
      <이미지 Drive ID>.png
```

`.mm`에는 `assets/<문서 ID>/<이미지 ID>.png` 상대경로를 저장합니다. 웹 화면은 세션 인증과 소유권 검사를 거치는 `/api/maps/:id/assets/:asset`을 사용합니다. 외부 위치에서 연 `.mm`의 새 첨부는 해당 문서 폴더 아래에 만듭니다. 외부에서 `.mm`만 다른 폴더로 옮기면 상대 이미지 경로도 함께 정리해야 합니다.

파일의 `appProperties`에는 문서/첨부 구분, 연결 문서 ID, 상대경로, 해시, 재시도 식별자를 기록합니다. `drive_cache`를 비운 뒤 **새로고침**하면 Drive에서 목록을 재구성합니다. `drive_operations`와 `drive_migrations`는 캐시가 아닌 작업 기록이므로 운영 중 삭제하지 않습니다.

외부 파일의 상대 이미지 경로는 접근 가능한 본인 소유 파일만 탐색합니다. 같은 이름이 여러 개이거나 `..`/절대경로인 경우 자동으로 선택하지 않습니다. 과도한 API 탐색을 막기 위해 외부 경로 자동 연결은 100개, 경로 깊이는 16단계로 제한하며 나머지는 Picker로 연결합니다. 원본 외부 이미지는 복제·삭제 시 보존하고 WebMind가 복사한 첨부만 관리합니다.

FreeMind를 사용할 PC에서는 `.mm`와 `assets` 폴더를 함께 동기화합니다. WebMind에서 다운로드해 옮길 때는 이미지가 포함된 ZIP을 사용하세요. 자유배치 좌표와 미지원 XML은 `.mm` 확장에 보존하지만 FreeMind가 WebMind 좌표를 적용하지는 않습니다.

## 저장과 충돌

편집 직후 IndexedDB에 복구 데이터를 기록합니다. Drive 동기화는 2초간 입력이 멈췄을 때, 또는 연속 편집 중 15초마다 시도합니다. 서버는 계정별 변경 요청을 직렬화하고 클라이언트는 파일별 미완료 요청 ID를 재사용합니다. 생성 파일 ID도 예약하여 불명확한 응답 후 중복 생성을 피합니다.

열기, 화면 복귀, 활성 문서의 30초 간격 확인으로 외부 변경을 찾습니다. 로컬 변경이 없으면 최신본을 표시합니다. 로컬 변경이 있으면 자동 저장을 멈추고 **복사본 저장 / 최신본 열기 / 다운로드**를 제공합니다. 최신본을 열기 전에 현재 작업을 독립적인 로컬 복구 문서로 보관합니다.

연결할 때 별도 임시 파일에서 조건부 저장을 검사합니다. 오래된 ETag의 갱신이 거절되고 앞서 쓴 내용이 유지되는 것을 확인한 연결에서만 원본의 조건부 갱신을 사용합니다. 이 확인이 실패하거나 파일에 ETag가 없으면 원본을 유지하고 **변경본** 파일을 생성합니다. 단순한 사전 버전 비교를 원자적 갱신으로 취급하지 않습니다. [업로드 API 안내](https://developers.google.com/workspace/drive/api/guides/manage-uploads).

원본 보호 모드는 Google OAuth의 공개 여부나 Google의 필수 요구사항이 아니라 WebMind의 데이터 보존 정책입니다. 2026-10-04 운영 연결의 Drive v3 파일 메타데이터 조회에서 `version`은 있었지만 `ETag` 응답 헤더가 없었고 조건부 갱신 검증 상태는 false였습니다. 따라서 현재 운영에서는 변경본 저장을 유지합니다. 이 결과를 모든 Drive API에서 조건부 갱신이 불가능하다는 뜻으로 일반화하지 않습니다. 같은 파일에 저장하도록 바꾸려면 동시 수정 방지·복구 전략을 별도로 구현하고 실제 API로 검증해야 하며, 플래그만 강제로 켜는 것은 안전성을 확보하지 못합니다.

재시도 때 요청 ID뿐 아니라 요청/저장 바이트 해시도 확인합니다. 응답 유실 뒤 외부 수정이 발견되면 충돌로 처리합니다. 통신 장애와 요청 제한은 지수 백오프로 재시도하며 세션 만료, 연결 권한, 삭제된 파일, 용량 부족은 별도 상태로 표시합니다.

## 구현과 검증

| 파일 | 역할 |
|---|---|
| `src/local-store.ts`, `src/persistence.ts` | 계정별 IndexedDB, 이미지, 초안, 자동 저장·외부 변경 확인 |
| `src/drive.ts` | 필요할 때만 로드하는 Google Picker |
| `server/drive-auth.ts` | 세션과 state/PKCE 검증, AES-GCM 토큰 저장·갱신 |
| `server/drive-client.ts` | 고정 Google API 전송, 제한된 다운로드, 오류 구분, 조건부 갱신 검사 |
| `server/drive-store.ts`, `server/storage.ts` | Drive/이전 서버 저장소, 첨부 권한, 안전한 저장과 이전 |
| `tests/fake-drive.ts`, `tests/drive.test.ts` | 자격 증명 없는 모의 Drive 회귀 검사 |
| `playwright.drive.config.ts` | 임시 DB와 메모리 Drive를 사용하는 독립 E2E 서버 |

```sh
npm test
npm run test:e2e
npm run test:e2e:drive
```

모의 검사는 실제 Google OAuth나 Drive API 보장을 대신하지 않습니다. [검증 기록](VALIDATION.md)에 로컬 통과 항목과 아래 실계정 완료 항목을 구분합니다.

- Google 신규 가입, 기존 계정 연결, 권한 거절, 토큰 만료/철회, 재연결·해제.
- 실제 Picker 선택과 `drive.file` 접근 범위, 외부 폴더/이미지 재연결.
- 실제 Drive 조건부 요청과 저장 도중 외부 갱신, 응답 유실 후 재시도.
- PC FreeMind에서 이미지 포함 문서를 열고 수정한 뒤 WebMind에서 변경 감지.
- 실제 운영 origin의 CSP·HTTPS·SMTP, 모바일 실기기와 Lightsail 메모리 제한.

서버 백업은 회원·암호화 토큰·설정·이전 서버 원본을 보호합니다. Drive 본문과 새 첨부는 포함하지 않으므로 Drive 자체의 백업/버전 관리 또는 WebMind ZIP 내보내기를 별도로 사용합니다. [배포·백업·복원](DEPLOYMENT.md)을 참고하세요.
