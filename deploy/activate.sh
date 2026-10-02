#!/usr/bin/env bash
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo 'Run with sudo'; exit 1; }
release=$(realpath -e -- "${1:?Pass the release directory}")
[[ $release == /srv/webmind/releases/* && -f $release/dist/server/index.js && -d $release/node_modules ]] || { echo 'Invalid release directory'; exit 1; }
python3 - <<'PY'
from pathlib import Path
values = {}
for line in Path('/etc/webmind/webmind.env').read_text().splitlines():
    if '=' in line and not line.lstrip().startswith('#'):
        key, value = line.split('=', 1)
        values[key.strip()] = value.strip().strip('"').strip("'")
required = ['AUTH_SECRET', 'APP_URL']
if values.get('EMAIL_AUTH_ENABLED', 'true') != 'false':
    required += ['SMTP_HOST', 'MAIL_FROM']
missing = [key for key in required if not values.get(key)]
if missing:
    raise SystemExit('Configure these settings before activation: ' + ', '.join(missing))
PY
previous=$(readlink -f /srv/webmind/current || true)
ln -sfn -- "$release" /srv/webmind/.current-next
mv -Tf /srv/webmind/.current-next /srv/webmind/current
systemctl enable webmind.service
systemctl restart webmind.service
for attempt in {1..20}; do
    if curl --fail --silent --max-time 2 http://127.0.0.1:3210/api/health >/dev/null; then
        printf 'Active release: %s\n' "$release"
        exit 0
    fi
    sleep 1
done
systemctl stop webmind.service
if [[ -n $previous && $previous != "$release" && -f $previous/dist/server/index.js ]]; then
    ln -sfn -- "$previous" /srv/webmind/.current-next
    mv -Tf /srv/webmind/.current-next /srv/webmind/current
    systemctl start webmind.service
    printf 'New release failed; previous release restored: %s\n' "$previous" >&2
else
    echo 'Activation failed; service stopped. Inspect journalctl -u webmind.' >&2
fi
exit 1
