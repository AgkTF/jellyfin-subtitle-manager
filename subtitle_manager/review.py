"""Provisional local entry point for the review/planning foundation.

This is not the final product UI. It reads saved JSON only; it never uses SSH.
"""
import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path

from .report import render_html
from .reviews import ReviewStore, build_plan


def _outside_media(path, inventory):
    root = inventory.get('scan', {}).get('root')
    if root and Path(path).resolve().is_relative_to(Path(root).resolve()):
        raise ValueError('Local review storage/output must be outside the media root')


def main():
    parser = argparse.ArgumentParser(description='Local review evidence and dry-run planning; no media writes or remote access')
    sub = parser.add_subparsers(dest='command', required=True)
    for name in ('import', 'plan'):
        command = sub.add_parser(name)
        command.add_argument('--inventory', required=True, help='Saved scanner inventory JSON')
        command.add_argument('--library', required=True, help='Stable library identifier; use the same value for future scans')
        command.add_argument('--store', default='private/reviews', help='Private local journal directory')
        if name == 'import':
            command.add_argument('--observations', required=True, help='Structured observation packet JSON')
        else:
            command.add_argument('--output', default='reports', help='Parent of a new private report directory')
    args = parser.parse_args()
    os.umask(0o077)
    try:
        inventory = json.loads(Path(args.inventory).read_text())
        if inventory.get('schema_version') != 1:
            raise ValueError('Only inventory schema_version 1 is supported')
        _outside_media(args.store, inventory)
        store = ReviewStore(args.store)
        if args.command == 'import':
            packet = json.loads(Path(args.observations).read_text())
            print(json.dumps(store.import_reviews(inventory, args.library, packet), indent=2))
        else:
            _outside_media(args.output, inventory)
            plan = build_plan(inventory, args.library, store.list(args.library))
            # Compute before publishing, so malformed inputs cannot masquerade as
            # a successful but empty plan/report.
            report = render_html(inventory, plan)
            parent = Path(args.output)
            parent.mkdir(mode=0o700, parents=True, exist_ok=True)
            run = parent / ('review-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S.%fZ'))
            run.mkdir(mode=0o700)
            (run / 'plan.json').write_text(json.dumps(plan, ensure_ascii=True, indent=2) + '\n')
            (run / 'report.html').write_text(report, errors='xmlcharrefreplace')
            print(json.dumps(plan['summary'], indent=2))
            print('Private dry-run report: ' + str(run / 'report.html'))
        return 0
    except (OSError, ValueError, KeyError, TypeError) as exc:
        parser.exit(1, 'Review operation failed: ' + str(exc) + '\n')


if __name__ == '__main__':
    raise SystemExit(main())
