# webmind.danho.kr 운영 구성

Ubuntu 24.04의 기존 Nginx와 Node.js 24를 사용합니다. WebMind만 전용 사용자와 systemd 서비스로 실행합니다. 다른 사이트의 서비스, DB, 실행 디렉터리와 환경 파일을 재사용하지 않습니다.

| 항목 | 경로 / 값 |
|---|---|
| 서비스 | `webmind.service`, 실행 계정 `webmind` |
| 내부 주소 | `127.0.0.1:3210` |
| 운영 주소 | `https://webmind.danho.kr` |
| 릴리스 | `/srv/webmind/releases/<release>` |
| 현재 코드 | `/srv/webmind/current` 심볼릭 링크 |
| 환경 설정 | `/etc/webmind/webmind.env` (`root:webmind`, 0640) |
| SQLite와 기존 첨부 | `/var/lib/webmind` (`webmind:webmind`, 0700) |
| Nginx 가상 호스트 | `/etc/nginx/sites-available/webmind` |
| 인증서 | `/etc/letsencrypt/live/webmind.danho.kr/` |
| ACME 경로 | `/var/www/webmind-acme` |
| 앱 로그 | `journalctl -u webmind` |

서비스는 메모리 soft limit 320MiB / hard limit 384MiB, CPU 50%, Node old-space 192MiB를 사용합니다. 코드 디렉터리는 서비스에서 읽기 전용이며 `/var/lib/webmind`에만 데이터를 씁니다. 로그는 기존 journald/Nginx 로그 순환 정책을 사용합니다. WebMind Nginx 접근 로그는 OAuth 코드가 있는 쿼리 문자열을 기록하지 않습니다.

초기 배포는 `EMAIL_AUTH_ENABLED=false`로 이메일 가입/로그인/재설정을 차단합니다. 로컬 편집·저장·다운로드는 사용할 수 있습니다. SMTP 준비 후 환경 파일에 SMTP 값과 발신 주소를 넣고 `EMAIL_AUTH_ENABLED=true`로 변경한 뒤 WebMind만 재시작합니다. Google 인증은 별도 설정이며 이메일 로그인 활성화 여부와 독립적입니다.

## 최초 설치

로컬에서 `npm ci`, `npm test`, `npm run build`를 실행합니다. `dist`, `package.json`, `package-lock.json`, 라이선스와 `deploy`를 Linux 서버의 새 릴리스 디렉터리로 전달합니다. Windows의 `node_modules`, `.env`, 개발 DB는 보내지 않습니다. 서버에서는 해당 릴리스에 `npm ci --omit=dev --no-audit --no-fund`로 Linux용 실행 의존성만 설치합니다.

```sh
sudo bash /srv/webmind/releases/<release>/deploy/install-host.sh
sudo nano /etc/webmind/webmind.env
# SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS, MAIL_FROM 설정
# SMTP를 나중에 설정한다면 EMAIL_AUTH_ENABLED=false 유지
# AUTH_SECRET은 설치 시 생성한 값을 유지
```

호스팅케이알의 `danho.kr` DNS 관리에서 A 레코드 `webmind`를 서버 IP에 연결합니다. 기존 네임서버나 다른 레코드를 변경할 필요가 없습니다. DNS 전파 후:

```sh
sudo certbot certonly --webroot -w /var/www/webmind-acme \
  -d webmind.danho.kr --cert-name webmind.danho.kr --non-interactive --agree-tos
sudo bash /srv/webmind/releases/<release>/deploy/activate.sh /srv/webmind/releases/<release>
sudo install -m 644 /srv/webmind/current/deploy/nginx-https.conf /etc/nginx/sites-available/webmind
sudo nginx -t && sudo systemctl reload nginx
sudo install -m 755 /srv/webmind/current/deploy/renew-webmind.sh /etc/letsencrypt/renewal-hooks/deploy/60-webmind-reload-nginx
```

인증서는 기존 Certbot 타이머로 갱신합니다. WebMind의 갱신 훅은 해당 인증서가 갱신된 경우에만 Nginx 설정을 검사하고 reload합니다.

Google 연결을 사용하려면 [GOOGLE_DRIVE.md](GOOGLE_DRIVE.md)의 설정과 운영 콜백 두 개를 등록합니다.

```text
https://webmind.danho.kr/api/auth/callback/google
https://webmind.danho.kr/api/drive/callback
```

## 배포 확인과 롤백

```sh
systemctl status webmind --no-pager
curl --fail https://webmind.danho.kr/api/health
sudo journalctl -u webmind --since '10 minutes ago' --no-pager
systemctl show webmind -p MemoryCurrent -p MemoryPeak
```

Git 커밋을 기록한 새 릴리스를 준비한 뒤 `activate.sh`에 새 디렉터리를 전달합니다. 이 스크립트는 현재 링크만 바꾸고 WebMind만 재시작합니다. HTTP 상태 검사에 실패하면 이전 릴리스로 돌아갑니다. 수동 롤백도 같은 스크립트에 이전 릴리스 경로를 전달합니다. DB 형식이 달라진 업데이트라면 기존 버전의 백업도 함께 복원해야 합니다.

## 백업

`AUTH_SECRET`과 Google/SMTP 비밀값은 DB와 별도로 안전하게 보관합니다. 서버 백업에는 새 Drive 문서와 이미지가 포함되지 않습니다.

```sh
sudo systemctl stop webmind
sudo -u webmind env DATA_DIR=/var/lib/webmind \
  BACKUP_DIR=/var/lib/webmind-backups/<새-백업명> \
  /usr/bin/node /srv/webmind/current/dist/scripts/backup.js --offline-confirmed
sudo systemctl start webmind
```

먼저 `/var/lib/webmind-backups`를 `webmind:webmind`, 0700으로 생성합니다. 백업 실패 시에도 WebMind를 재시작하고 원인을 확인합니다. 검증된 백업은 별도 장치로 복사합니다. 복원 명령은 [DEPLOYMENT.md](DEPLOYMENT.md)를 참고하세요.
