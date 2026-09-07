"""Local CLI. SSH runs a transient scanner without installing remote files."""
import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import shlex
import subprocess
import sys

from .report import assemble, render_html


def scanner_command(host, root, timeout, delay):
    args = [root, '--timeout', str(timeout), '--delay', str(delay)]
    scanner = Path(__file__).with_name('scanner.py')
    if host:
        if not re.fullmatch(r'[A-Za-z0-9_][A-Za-z0-9_.@-]*', host):
            raise ValueError('Use an SSH host alias or user@hostname (not SSH options)')
        remote = shlex.join(['python3', '-I', '-', *args])
        return ['ssh', '-T', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=3', host, remote], scanner.read_bytes()
    return [sys.executable, '-I', str(scanner), *args], None


def main():
    parser = argparse.ArgumentParser(description='Read-only, low-priority subtitle metadata inventory. Reports contain private filenames.')
    parser.add_argument('--host', help='Existing SSH alias; omit to scan locally')
    parser.add_argument('--root', required=True, help='Media directory on target machine')
    parser.add_argument('--output', default='reports', help='Local report parent (default: ignored reports/)')
    parser.add_argument('--timeout', type=float, default=30, help='Per-video probe timeout in seconds')
    parser.add_argument('--delay', type=float, default=0.1, help='Pause between sequential probes')
    args = parser.parse_args()
    if args.timeout <= 0 or args.delay < 0:
        parser.error('timeout must be positive; delay must be nonnegative')
    output = Path(args.output).resolve()
    if not args.host and output.is_relative_to(Path(args.root).resolve()):
        parser.error('Reports must be outside the media root')
    try:
        command, payload = scanner_command(args.host, args.root, args.timeout, args.delay)
    except ValueError as exc:
        parser.error(str(exc))
    os.umask(0o077)
    output.mkdir(parents=True, exist_ok=True)
    run = output / datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S.%fZ')
    run.mkdir(mode=0o700)
    print('Private report directory: ' + str(run), flush=True)
    events, failure = [], None
    process = None
    try:
        with (run / 'scan.stderr.log').open('w') as log, (run / 'events.jsonl').open('w') as raw:
            process = subprocess.Popen(command, stdin=subprocess.PIPE if payload else subprocess.DEVNULL,
                                       stdout=subprocess.PIPE, stderr=log, text=True)
            if payload:
                process.stdin.write(payload.decode())
                process.stdin.close()
            for line in process.stdout:
                event = json.loads(line)
                raw.write(line)
                raw.flush()
                events.append(event)
                if event['kind'] == 'video' and sum(e['kind'] == 'video' for e in events) % 25 == 0:
                    print('Received %d videos' % sum(e['kind'] == 'video' for e in events), flush=True)
            code = process.wait()
            if code:
                failure = 'Scanner exited with status %d; see scan.stderr.log' % code
    except (OSError, ValueError, KeyboardInterrupt) as exc:
        failure = 'Scan interrupted' if isinstance(exc, KeyboardInterrupt) else str(exc)
    finally:
        if process:
            if process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait()
            if process.stdout:
                process.stdout.close()
    inventory = assemble(events)
    if failure:
        inventory['complete'] = False
        inventory['errors'].append(failure)
    if not inventory['complete']:
        inventory['errors'].append('No successful completion: this inventory is partial')
    (run / 'inventory.json').write_text(json.dumps(inventory, ensure_ascii=True, indent=2) + '\n')
    (run / 'report.html').write_text(render_html(inventory))
    print(json.dumps(inventory['summary'], indent=2))
    print('Report: ' + str(run / 'report.html'))
    if inventory['errors'] or not inventory['complete'] or inventory['summary'].get('videos_with_probe_errors'):
        print('Inventory contains errors or is partial; inspect the report.', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
