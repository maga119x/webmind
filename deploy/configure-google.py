#!/usr/bin/env python3
"""Configure Google credentials interactively on the WebMind host; never echo them."""
import argparse
import getpass
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import time
import urllib.request

TARGET = Path('/etc/webmind/webmind.env')


def validate(values, project):
    checks = {
        'GOOGLE_CLIENT_ID': re.escape(project) + r'-[A-Za-z0-9_-]+\.apps\.googleusercontent\.com',
        'GOOGLE_CLIENT_SECRET': r'[A-Za-z0-9_-]{20,}',
        'GOOGLE_PICKER_API_KEY': r'AIza[A-Za-z0-9_-]{20,}',
        'GOOGLE_PROJECT_NUMBER': re.escape(project),
    }
    if not re.fullmatch(r'[0-9]+', project) or set(values) != set(checks):
        raise ValueError('Expected all four Google settings for this project')
    for name, pattern in checks.items():
        if not isinstance(values[name], str) or not re.fullmatch(pattern, values[name]):
            raise ValueError('Invalid value for ' + name + '; check the copied field and project')


def merge(original, values):
    lines = [line for line in original.splitlines()
             if line.split('=', 1)[0].strip() not in values]
    lines.extend(name + '=' + json.dumps(value) for name, value in values.items())
    return '\n'.join(lines) + '\n'


def write_protected(target, content, info):
    fd, temporary = tempfile.mkstemp(dir=target.parent, prefix='.webmind-google-')
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as output:
            output.write(content)
            output.flush()
            os.fsync(output.fileno())
        os.chown(temporary, info.st_uid, info.st_gid)
        os.chmod(temporary, 0o640)
        os.replace(temporary, target)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def restart():
    result = subprocess.run(['systemctl', 'restart', 'webmind'],
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=30)
    if result.returncode:
        raise RuntimeError('WebMind could not restart')


def healthy():
    for _ in range(15):
        try:
            with urllib.request.urlopen('http://127.0.0.1:3210/api/health', timeout=2) as response:
                health = json.load(response)
            with urllib.request.urlopen('http://127.0.0.1:3210/api/config', timeout=2) as response:
                config = json.load(response)
            if health.get('status') == 'ok' and config.get('googleLogin') is True:
                return True
        except (OSError, ValueError):
            pass
        time.sleep(1)
    return False


def apply(values):
    original = TARGET.read_text(encoding='utf-8')
    info = TARGET.stat()
    backup = TARGET.with_name('webmind.env.before-google-' + time.strftime('%Y%m%d-%H%M%S')
                              + '-' + str(os.getpid()))
    write_protected(backup, original, info)
    try:
        write_protected(TARGET, merge(original, values), info)
        restart()
        if not healthy():
            raise RuntimeError('Google configuration health check did not pass')
    except (RuntimeError, OSError, subprocess.SubprocessError, KeyboardInterrupt):
        write_protected(TARGET, original, info)
        try:
            restart()
        except (RuntimeError, OSError, subprocess.SubprocessError):
            raise RuntimeError('Old settings restored; WebMind needs an operator to restart it') from None
        raise RuntimeError('Google setup failed; previous settings restored and WebMind restarted') from None
    print('Google settings saved; WebMind restarted and health checks passed.')
    print('Existing SMTP, AUTH_SECRET and other settings were preserved.')
    print('Next: sign in at https://webmind.danho.kr and connect Google Drive.')
    print('Google authorization and Picker access still require a browser check.')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--project-number', required=True)
    args = parser.parse_args()
    if not hasattr(os, 'geteuid') or os.geteuid() != 0:
        parser.error('Run with sudo on the WebMind Linux server')
    if not sys.stdin.isatty():
        parser.error('Use an interactive terminal (ssh -t); do not put keys in shell commands')
    print('Paste each value and press Enter. Input is hidden and not saved in shell history.')
    values = {
        'GOOGLE_CLIENT_ID': getpass.getpass('1/3 OAuth Client ID: ').strip(),
        'GOOGLE_CLIENT_SECRET': getpass.getpass('2/3 OAuth Client Secret: ').strip(),
        'GOOGLE_PICKER_API_KEY': getpass.getpass('3/3 Picker API Key: ').strip(),
        'GOOGLE_PROJECT_NUMBER': args.project_number,
    }
    validate(values, args.project_number)
    apply(values)


if __name__ == '__main__':
    try:
        main()
    except (KeyboardInterrupt, EOFError):
        print('\nCancelled before applying new settings.', file=sys.stderr)
        sys.exit(130)
    except (ValueError, RuntimeError, OSError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
