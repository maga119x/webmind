#!/usr/bin/env bash
# Bounded DNS-propagation retry for the initial WebMind TLS setup only.
set -euo pipefail
test "$(id -u)" -eq 0
domain=webmind.danho.kr
state=/var/lib/webmind-tls
templates=/etc/webmind/tls-bootstrap
certificate=/etc/letsencrypt/live/webmind.danho.kr/fullchain.pem
site=/etc/nginx/sites-available/webmind
install -d -m 700 "$state"

finish() {
  printf '%s\n' "$1" > "$state/status"
  systemctl disable --now webmind-https.timer
}

valid_certificate() {
  test -s "$certificate" &&
    openssl x509 -in "$certificate" -noout -checkend 86400 >/dev/null &&
    openssl x509 -in "$certificate" -noout -checkhost "$domain" >/dev/null
}

attempt=0
if test -f "$state/attempts"; then read -r attempt < "$state/attempts"; fi
[[ "$attempt" =~ ^[0-9]+$ ]]
if (( attempt >= 4 )); then
  finish 'Initial HTTPS setup failed after four retries; manual review required.'
  exit 1
fi
attempt=$((attempt + 1))
printf '%s\n' "$attempt" > "$state/attempts"
printf 'Initial HTTPS setup attempt %s of 4.\n' "$attempt" > "$state/status"
on_error() {
  printf 'HTTPS attempt %s failed; inspect journalctl -u webmind-https.service.\n' "$attempt" > "$state/status"
  if (( attempt >= 4 )); then
    finish 'Initial HTTPS setup failed after four retries; manual review required.'
  fi
}
trap on_error ERR
if ! valid_certificate; then
  if ! certbot certonly --webroot -w /var/www/webmind-acme \
    -d "$domain" --cert-name "$domain" --non-interactive --agree-tos; then
    on_error
    exit 1
  fi
fi
valid_certificate
curl --fail --silent http://127.0.0.1:3210/api/health >/dev/null
grep -q 'Managed WebMind virtual host' "$site"
cp -p "$site" "$state/nginx-before-https.conf"
install -m 644 "$templates/nginx-https.conf" "$site"
if ! nginx -t; then
  cp -p "$state/nginx-before-https.conf" "$site"
  finish 'HTTPS configuration validation failed; previous configuration restored.'
  exit 1
fi
systemctl reload nginx
install -m 755 "$templates/renew-webmind.sh" /etc/letsencrypt/renewal-hooks/deploy/60-webmind-reload-nginx
curl --fail --silent --resolve "$domain:443:127.0.0.1" "https://$domain/api/health"
finish 'HTTPS active; initial setup retries disabled. Certbot handles regular renewal.'
