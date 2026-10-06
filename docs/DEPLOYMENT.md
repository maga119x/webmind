# 별도 Docker 배포와 복구

기존 Nginx/Node.js 서버에 Docker 없이 분리 배포하는 `webmind.danho.kr` 구성은 [SERVER.md](SERVER.md)를 사용합니다. 아래는 별도 Docker 배포 경로입니다.

## 전제

- Linux Lightsail, Docker Engine + Compose v2, 로컬 디스크의 영속 볼륨.
- DNS가 가리키는 도메인과 HTTPS, SMTP 발송 계정.
- Google 웹 OAuth 클라이언트·Drive/Picker API·운영 콜백 설정. [Google Drive 설정](GOOGLE_DRIVE.md) 참고.
- 512MB~1GB를 고려한 단일 Node 프로세스와 SQLite 구조. 아래 메모리 제한은 운영 설정이며 **512MB 환경에서 충분하다고 검증된 수치는 아닙니다**.
- 배포 전 기존 서비스 메모리, 80/443/3000 포트, 서버 CPU 아키텍처(`uname -m`)를 확인합니다. 현재 실제 서버는 Docker 없이 운영 중이며 [CURRENT_STATUS](CURRENT_STATUS.md)를 따릅니다. 이 Docker 경로는 빌드·구동·512MB 부하 검증이 남아 있습니다.

## 로컬 빌드와 전달

```sh
# x86_64 서버. ARM 서버는 linux/arm64로 변경.
docker buildx build --platform linux/amd64 --load -t webmind:0.1.0 .
docker save -o webmind-0.1.0.tar webmind:0.1.0
```

이미지 파일과 `compose.yml`, `deploy/Caddyfile`, `.env.example`을 서버의 전용 디렉터리로 전달합니다. 빌드는 서버에서 실행하지 않습니다. 버전별 태그를 유지하고 현재 태그를 덮어쓰지 마세요.

```sh
docker load -i webmind-0.1.0.tar
cp .env.example .env
# .env를 편집한 뒤 권한 제한
chmod 600 .env
```

운영 환경변수:

```dotenv
NODE_ENV=production
APP_URL=https://mind.example.com
DOMAIN=mind.example.com
AUTH_SECRET=<무작위 32자 이상 비밀값>
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=<SMTP 계정>
SMTP_PASS=<SMTP 비밀번호>
MAIL_FROM=WebMind <noreply@example.com>
WEBMIND_IMAGE=webmind:0.1.0
GOOGLE_CLIENT_ID=<OAuth 클라이언트 ID>
GOOGLE_CLIENT_SECRET=<OAuth 비밀값>
GOOGLE_PICKER_API_KEY=<제한된 Picker API 키>
GOOGLE_PROJECT_NUMBER=<숫자 프로젝트 번호>
```

TLS가 연결 즉시 시작되는 SMTP 465 포트는 `SMTP_SECURE=true`를 사용합니다. 비밀값은 `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` 등으로 생성합니다. `.env`와 실제 데이터는 소스 저장소에 포함하지 않습니다.

기존 리버스 프록시가 없을 때:

```sh
docker compose --profile https up -d
```

기존 프록시가 있을 때는 `docker compose up -d app`으로 앱만 실행하고 프록시의 대상에 `http://127.0.0.1:3000`을 설정합니다. Lightsail 방화벽은 80/443만 웹에 공개하고 3000은 공개하지 않습니다. Compose는 3000을 loopback에만 바인딩합니다.

## 배포 확인

```sh
docker compose ps
curl --fail https://mind.example.com/api/health
docker compose logs --tail=100 app
docker stats --no-stream
```

실제 이메일 인증·재설정, 이미지 업로드, 문서 수정, 로그아웃 후 비공개 파일 접근 차단을 확인합니다. `GET /api/dev/mailbox`는 운영에서 404여야 합니다. SMTP 발송 실패와 DB 디스크 부족은 로그에서 확인합니다. HTTP 로그는 크기 10MB × 3개로 순환합니다. 공개 가입이 있으므로 서버 디스크 여유량과 계정 증가도 확인하세요.

`npm run test:load`는 **일회용 모의 Drive 서버 전용**입니다. `npm run build` 후 별도 터미널에서 `npx tsx tests/e2e-drive-server.ts`를 실행하고 부하 검사를 수행합니다. 스크립트는 모의 저장소 표시가 없는 서버에 계정을 만들지 않습니다. 모의 전송 지연은 실제 Drive 성능이 아닙니다. 512MB 제한 검증은 별도 Linux/Docker 환경에서 메모리·OOM·저장 지연을 기록합니다. Compose의 앱 320MB/Caddy 64MB 제한에서 인증 및 3계정 동시 저장이 실패하면 메모리나 인스턴스를 늘려야 합니다.

## 일관된 오프라인 백업

DB와 이전 서버 이미지의 시점을 맞추기 위해 앱을 잠시 중단합니다. 실행 중인 SQLite 파일만 직접 복사하는 방식은 사용하지 않습니다. **새 Drive 문서와 이미지는 서버 백업에 포함되지 않습니다.** Drive의 파일/버전 또는 ZIP 내보내기를 별도로 백업합니다. DB에는 암호화된 OAuth 자격 증명이 있으므로 백업 접근을 제한합니다.

```sh
mkdir -p backups
# 백업 디렉터리를 컨테이너 node 사용자(1000)가 쓸 수 있게 설정
sudo chown 1000:1000 backups
docker compose stop app
docker compose run --rm --no-deps -v "$PWD/backups:/backups" \
  -e BACKUP_DIR=/backups/backup-2026-09-27 \
  app node dist/scripts/backup.js --offline-confirmed
docker compose start app
```

실패해도 `docker compose start app`으로 서비스를 재시작하세요. 백업 이름은 매번 새 이름을 사용합니다. 백업에는 DB, 이전 서버 첨부파일, SHA-256 검증 목록이 들어갑니다. `AUTH_SECRET`과 Google/SMTP 설정은 별도 안전한 곳에 보관합니다. 개발 기본 비밀값을 사용했다면 `data/.dev-secret`도 별도 보관합니다. 같은 암호화 비밀값이 없으면 Drive 재연결이 필요합니다. 백업을 다른 장치나 스토리지에도 복사해야 서버 장애에 대비할 수 있습니다.

## 복원

복원은 기존 데이터를 덮어쓰지 않고 **새로운 데이터 디렉터리**에만 허용합니다. 먼저 앱을 중단한 뒤 새 볼륨을 준비합니다.

```sh
docker compose stop app
docker volume create webmind-restored
# 새 볼륨의 소유권 준비
docker run --rm -u root -v webmind-restored:/restore webmind:0.1.0 chown node:node /restore
docker compose run --rm --no-deps -v "$PWD/backups:/backups:ro" \
  -v webmind-restored:/restore \
  app node dist/scripts/restore.js /backups/backup-2026-09-27 /restore
```

해시와 SQLite 무결성 검사가 통과한 뒤 Compose의 앱 데이터 볼륨을 `webmind-restored:/data`로 바꾸고, 최상위 volumes에 `webmind-restored: { external: true }`를 추가합니다. 동일한 `AUTH_SECRET`을 사용해 앱을 실행하고 문서·이미지를 확인합니다. 기존 볼륨은 복구 검증을 마칠 때까지 보관합니다.

로컬 복원 검증:

```sh
npm run backup -- --offline-confirmed
npm run restore -- backups/<백업명> data-restored
```

## 업그레이드와 되돌리기

1. 앱을 중단하고 백업합니다.
2. 새 태그의 이미지를 로드합니다.
3. `.env`의 `WEBMIND_IMAGE`를 새 태그로 바꾸고 `docker compose up -d app`을 실행합니다.
4. 상태·로그·인증·문서 저장을 확인합니다.
5. 문제가 있으면 이전 이미지 태그로 되돌립니다. DB 스키마가 변경된 업데이트라면 이전 버전의 백업을 새 볼륨에 복원하고 함께 되돌립니다.

SQLite WAL은 같은 호스트의 로컬 디스크에서 사용합니다. 여러 앱 인스턴스를 같은 DB에 연결하거나 네트워크 파일시스템에 올리는 구성은 이 버전의 운영 범위가 아닙니다.
