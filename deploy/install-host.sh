#!/usr/bin/env bash
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo 'Run with sudo'; exit 1; }
source_dir=$(cd -- "$(dirname -- "$0")" && pwd)
id webmind >/dev/null 2>&1 || useradd --system --home-dir /var/lib/webmind --shell /usr/sbin/nologin --user-group webmind
install -d -o webmind -g webmind -m 0700 /var/lib/webmind
install -d -o root -g webmind -m 0750 /etc/webmind
install -d -o root -g root -m 0755 /var/www/webmind-acme
if [[ ! -e /etc/webmind/webmind.env ]]; then
    umask 0077
    {
        printf 'NODE_ENV=production\nHOST=127.0.0.1\nPORT=3210\nAPP_URL=https://webmind.danho.kr\nDATA_DIR=/var/lib/webmind\nTRUST_PROXY=true\n'
        printf 'AUTH_SECRET=%s\n' "$(openssl rand -hex 32)"
        printf 'EMAIL_AUTH_ENABLED=false\nSMTP_HOST=\nSMTP_PORT=587\nSMTP_SECURE=false\nSMTP_USER=\nSMTP_PASS=\nMAIL_FROM=\n'
        printf 'GOOGLE_CLIENT_ID=\nGOOGLE_CLIENT_SECRET=\nGOOGLE_PICKER_API_KEY=\nGOOGLE_PROJECT_NUMBER=\n'
    } > /etc/webmind/webmind.env
    chown root:webmind /etc/webmind/webmind.env
    chmod 0640 /etc/webmind/webmind.env
fi
install -m 0644 "$source_dir/webmind.service" /etc/systemd/system/webmind.service
install -m 0644 "$source_dir/nginx-log.conf" /etc/nginx/conf.d/webmind-log.conf
if [[ ! -e /etc/nginx/sites-available/webmind ]]; then
    install -m 0644 "$source_dir/nginx-http.conf" /etc/nginx/sites-available/webmind
elif ! grep -q '^# Managed WebMind virtual host' /etc/nginx/sites-available/webmind; then
    echo 'An unrecognized WebMind virtual host already exists; inspect it before continuing.'
    exit 1
fi
if [[ ! -e /etc/nginx/sites-enabled/webmind ]]; then
    ln -s /etc/nginx/sites-available/webmind /etc/nginx/sites-enabled/webmind
fi
nginx -t
systemctl daemon-reload
systemctl reload nginx
echo 'Host prepared. Configure /etc/webmind/webmind.env before starting webmind.service.'
