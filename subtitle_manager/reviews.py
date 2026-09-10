"""Immutable local review evidence and pure dry-run planning.

No media access, subtitle acceptance, or action execution. JSON is the persistence
format, not a commitment to the final product interface or deployment.
"""
from collections import Counter
from copy import deepcopy
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import tempfile

from .report import candidate_languages

LANGUAGES = {'en', 'ar'}
OUTCOMES = {'passed', 'failed', 'issue', 'unknown'}
MEDIA = {'embedded', 'external', 'burned_in', 'unknown'}
CONCERNS = {'language_label', 'timing', 'client_playback', 'client_font', 'identity', 'overlay', 'encoding'}


def _digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=True, separators=(',', ':')).encode()).hexdigest()


def _relative(path):
    if not isinstance(path, str) or not path or '\x00' in path:
        raise ValueError('Expected a nonempty relative media path')
    p = PurePosixPath(path)
    if p.is_absolute() or '..' in p.parts or p.as_posix() != path or path == '.':
        raise ValueError('Expected a normalized relative media path')
    return path


def _library(value):
    if not isinstance(value, str) or not value.strip():
        raise ValueError('A stable library identifier is required')
    return value


def _video(inventory, path):
    matches = [v for v in inventory['videos'] if v['path'] == path]
    if len(matches) > 1:
        raise ValueError('Duplicate video paths in inventory')
    return matches[0] if matches else None


def _snapshot(inventory, video):
    by_path = {s['path']: s for s in inventory['sidecars']}
    return deepcopy({
        'root': inventory.get('scan', {}).get('root'), 'path': video['path'],
        'size_bytes': video.get('size_bytes'), 'mtime_ns': video.get('mtime_ns'),
        'audio': video.get('audio', []), 'subtitles': video['subtitles'],
        'sidecars': [by_path.get(p, {'path': p, 'missing_from_inventory': True}) for p in sorted(video['sidecars'])],
    })


def _validate_observation(value):
    if not isinstance(value, dict) or set(value) - {'summary', 'findings', 'concerns', 'evidence_note', 'evidence_reference'}:
        raise ValueError('Unknown observation fields (acceptance is not supported)')
    if not isinstance(value.get('summary'), str) or not value['summary'].strip():
        raise ValueError('Observation summary is required')
    for key in ('evidence_note', 'evidence_reference'):
        if key in value and not isinstance(value[key], str):
            raise ValueError(key + ' must be text, not a file to fetch')
    if not isinstance(value.get('findings'), list) or not isinstance(value.get('concerns'), list):
        raise ValueError('findings and concerns must be lists')
    for finding in value['findings']:
        allowed = {'language', 'client', 'medium', 'rendering', 'timing', 'meaning', 'sample_scope', 'notes', 'sidecar_path'}
        if not isinstance(finding, dict) or set(finding) - allowed:
            raise ValueError('Unknown finding fields')
        if finding.get('language') not in LANGUAGES or finding.get('medium') not in MEDIA:
            raise ValueError('Finding requires language en/ar and a known medium')
        for key in ('client', 'sample_scope', 'notes'):
            if not isinstance(finding.get(key), str) or not finding[key]:
                raise ValueError('Finding requires explicit ' + key + ' (use unknown where appropriate)')
        if any(finding.get(key) not in OUTCOMES for key in ('rendering', 'timing', 'meaning')):
            raise ValueError('Invalid finding outcome')
        if finding.get('sidecar_path') is not None:
            _relative(finding['sidecar_path'])
            if finding['medium'] != 'external':
                raise ValueError('Only external findings can bind a sidecar')
    for concern in value['concerns']:
        if not isinstance(concern, dict) or set(concern) - {'kind', 'language', 'detail', 'deferred'}:
            raise ValueError('Unknown concern fields')
        if concern.get('kind') not in CONCERNS or concern.get('language') not in LANGUAGES | {None}:
            raise ValueError('Invalid concern kind or language')
        if not isinstance(concern.get('detail'), str) or not concern['detail']:
            raise ValueError('Concern detail is required')
        if 'deferred' in concern and not isinstance(concern['deferred'], bool):
            raise ValueError('deferred must be boolean')
    return deepcopy(value)


class ReviewStore:
    """Append-only, owner-private JSON journal. Reimporting identical evidence is a no-op.

    import_reviews validates the entire packet before writing any records. Each
    record is published atomically; a crash may commit part of a batch, safely
    completed by reimport. Different observations coexist; there is no implicit
    acceptance, supersession, or last-write-wins policy.
    """

    def __init__(self, directory):
        self.directory = Path(directory)

    def import_reviews(self, inventory, library, packet):
        _library(library)
        if packet.get('schema_version') != 1 or not isinstance(packet.get('items'), list):
            raise ValueError('Expected observation packet schema_version 1 with items')
        prepared = []
        for item in packet['items']:
            if not isinstance(item, dict) or set(item) != {'path', 'observation'}:
                raise ValueError('Each item must contain only path and observation')
            path = _relative(item['path'])
            video = _video(inventory, path)
            if video is None:
                raise ValueError('Cannot bind observation: video not in source inventory')
            observation = _validate_observation(item['observation'])
            if any(f.get('sidecar_path') and f['sidecar_path'] not in video['sidecars'] for f in observation['findings']):
                raise ValueError('Bound sidecar must be associated with the video in source inventory')
            payload = {'schema_version': 1, 'library': library, 'snapshot': _snapshot(inventory, video),
                       'observation': observation}
            prepared.append({'id': _digest(payload), 'recorded_at': datetime.now(timezone.utc).isoformat(), **payload})
        if self.directory.is_symlink():
            raise ValueError('Review store must not be a symlink')
        self.directory.mkdir(mode=0o700, parents=True, exist_ok=True)
        os.chmod(self.directory, 0o700)
        inserted = 0
        for record in prepared:
            destination = self.directory / (record['id'] + '.json')
            fd, name = tempfile.mkstemp(prefix='.pending-', dir=self.directory)
            try:
                with os.fdopen(fd, 'w') as handle:
                    json.dump(record, handle, ensure_ascii=True, indent=2)
                    handle.write('\n')
                    handle.flush()
                    os.fsync(handle.fileno())
                try:
                    os.link(name, destination)  # Atomic create, never replace an existing record.
                    inserted += 1
                except FileExistsError:
                    existing = self._read_record(destination)
                    if existing['id'] != record['id']:
                        raise ValueError('Existing review record does not match its filename')
            finally:
                os.unlink(name)
        return {'inserted': inserted, 'already_present': len(prepared) - inserted}

    @staticmethod
    def _read_record(path):
        if path.is_symlink():
            raise ValueError('Review record must not be a symlink')
        record = json.loads(path.read_text())
        if not isinstance(record, dict) or set(record) != {'id', 'recorded_at', 'schema_version', 'library', 'snapshot', 'observation'}:
            raise ValueError('Invalid review record')
        payload = {k: v for k, v in record.items() if k not in {'id', 'recorded_at'}}
        if record['schema_version'] != 1 or _digest(payload) != record['id'] or path.stem != record['id']:
            raise ValueError('Review record failed schema or integrity check')
        _library(record['library'])
        _relative(record['snapshot']['path'])
        _validate_observation(record['observation'])
        return record

    def list(self, library):
        _library(library)
        if self.directory.is_symlink():
            raise ValueError('Review store must not be a symlink')
        records = [self._read_record(p) for p in sorted(self.directory.glob('*.json'))]
        return [r for r in records if r['library'] == library]


def _validity(inventory, record):
    original = record['snapshot']
    video = _video(inventory, original['path'])
    if video is None:
        return 'not_found' if inventory.get('complete') and not inventory.get('errors') else 'not_observed'
    if any(i.startswith('probe_failed') or i == 'file_changed_during_probe' for i in video['issues']):
        return 'unverifiable'
    current = _snapshot(inventory, video)
    for sidecar in current['sidecars']:
        if sidecar.get('missing_from_inventory') or any(
            issue == 'file_changed_during_read' or issue.startswith(('stat_failed:', 'companion_stat_failed:', 'prefix_read_failed:'))
            for issue in sidecar.get('issues', [])
        ):
            return 'unverifiable'
    if any(original.get(k) is None or current.get(k) is None for k in ('root', 'size_bytes', 'mtime_ns')):
        return 'unverifiable'
    return 'current' if current == original else 'stale'


def _label_proposal(inventory, video, language, findings):
    proposal = {'source': None, 'destination': None, 'blockers': [],
                'preconditions': ['Live source/target preflight required', 'Media publication not authorized']}
    bound = {f['sidecar_path'] for f in findings if f.get('sidecar_path')}
    if len(bound) != 1:
        proposal['blockers'].append('Confirm the exact selected sidecar; basename evidence alone is insufficient')
        proposal['candidate_sidecars'] = video['sidecars']
        return proposal
    source = next(iter(bound))
    proposal['source'] = source
    sidecar = next((s for s in inventory['sidecars'] if s['path'] == source), None)
    if sidecar is None or sidecar.get('associated_videos') != [video['path']]:
        proposal['blockers'].append('Sidecar association is absent or ambiguous')
        return proposal
    extension = PurePosixPath(source).suffix
    if extension.lower() not in {'.srt', '.ass', '.ssa', '.vtt', '.smi', '.sami', '.ttml'}:
        proposal['blockers'].append('Paired/image/unknown sidecar naming is not supported in this stage')
        return proposal
    suffix = '.' + language
    suffix += '.forced' if sidecar['forced'] else ''
    suffix += '.sdh' if sidecar['sdh'] else ''
    target = str(PurePosixPath(video['path']).with_suffix('')) + suffix + extension
    proposal['destination'] = target
    if sidecar.get('size_bytes') is None or sidecar.get('mtime_ns') is None:
        proposal['blockers'].append('Saved inventory lacks sidecar identity metadata')
    if not inventory.get('complete') or inventory.get('errors'):
        proposal['blockers'].append('Inventory is partial or has traversal errors')
    known_paths = [v['path'] for v in inventory['videos']] + [s['path'] for s in inventory['sidecars']]
    if target == source:
        proposal['blockers'].append('Sidecar already has the proposed name')
    elif any(p.casefold() == target.casefold() for p in known_paths):
        proposal['blockers'].append('Destination collides with a path in saved inventory')
    return proposal


def build_plan(inventory, library, records):
    """Return observations, validity and independent en/ar actions; never change inputs.

    Current means the captured metadata still matches, not verified media hashes
    or accepted subtitles. Unbound sidecars remain unbound even after a good review.
    """
    _library(library)
    views, actions = [], []
    active = {}
    for record in records:
        if record['library'] != library:
            continue
        status = _validity(inventory, record)
        view = {'record': deepcopy(record), 'validity': status}
        views.append(view)
        if status == 'current':
            active.setdefault(record['snapshot']['path'], []).append(record)
        else:
            actions.append({'path': record['snapshot']['path'], 'language': None,
                            'kind': 'recheck_observation', 'priority': 0, 'status': 'review_needed',
                            'reason': 'Stored observation is ' + status + '; retained as history, not current evidence',
                            'evidence_ids': [record['id']]})
    for video in inventory['videos']:
        path = video['path']
        applicable = active.get(path, [])
        findings = [f for r in applicable for f in r['observation']['findings']]
        concerns = [c for r in applicable for c in r['observation']['concerns']]
        ids = [r['id'] for r in applicable]

        def add(kind, language, reason, priority=30, status='review_needed', **extra):
            actions.append({'path': path, 'language': language, 'kind': kind, 'reason': reason,
                            'priority': priority, 'status': status, 'evidence_ids': ids, **extra})

        if any(i.startswith('probe_failed') or i == 'file_changed_during_probe' for i in video['issues']):
            add('inspect_media', None, 'Probe failed or media changed; do not infer missing subtitles', 0)
            continue
        tagged = set(candidate_languages(video, inventory))
        for lang in ('en', 'ar'):
            known = [f for f in findings if f['language'] == lang]
            conflicting_clients = {client for client in {f['client'] for f in known}
                                   if any(any(f['client'] == client and f[key] == 'passed' for f in known)
                                          and any(f['client'] == client and f[key] in {'failed', 'issue'} for f in known)
                                          for key in ('rendering', 'timing', 'meaning'))}
            good = [f for f in known if f['rendering'] == 'passed' and f['timing'] == 'passed'
                    and f['client'] not in conflicting_clients]
            if good:
                burned = any(f['medium'] == 'burned_in' for f in good)
                add('preserve_burned_in' if burned else 'preserve_observed', lang,
                    'User-reported playback works on the recorded client/samples; not acceptance',
                    40, 'advisory', clients=sorted({f['client'] for f in good}))
            elif lang in tagged or known:
                add('review_existing', lang, 'Candidate or human language evidence exists; inspect recorded limitations before further testing', 30)
            else:
                add('investigate_language', lang,
                    'No non-forced tag or current human finding identifies this language; check unlabelled/unassociated/burned-in content before acquisition', 50)
            if lang == 'ar' and (lang in tagged or known):
                add('review_authorship', lang, 'Arabic authorship is unknown; playback/language does not prove human translation', 45)
            # Keep different client outcomes visible. Contradictory reports on the
            # same client are not resolved by import order.
            for client in sorted(conflicting_clients):
                add('resolve_conflicting_observations', lang, 'Conflicting reports on client: ' + client, 5)
        for concern in concerns:
            lang = concern.get('language')
            kind = concern['kind']
            if kind == 'language_label':
                selected = [f for f in findings if f['language'] == lang and f['medium'] == 'external']
                proposal = _label_proposal(inventory, video, lang, selected) if lang else {
                    'source': None, 'destination': None, 'blockers': ['Identify language before naming']}
                add('label_sidecar', lang, concern['detail'], 10,
                    'blocked' if proposal['blockers'] else 'proposal_only', proposal=proposal)
            else:
                mapped = {'timing': 'review_timing', 'client_playback': 'client_playback', 'client_font': 'client_font',
                          'identity': 'review_identity', 'overlay': 'review_overlay', 'encoding': 'encoding_unknown'}[kind]
                extra = {'proposed_offset_seconds': None} if kind == 'timing' else {}
                add(mapped, lang, concern['detail'], 20 if kind == 'timing' else 25,
                    'deferred' if concern.get('deferred') else 'review_needed', **extra)
        # Failed findings must not disappear just because another client passed,
        # even when a caller has not supplied a corresponding concern.
        for finding in findings:
            if finding['rendering'] in {'failed', 'issue'} or finding['timing'] in {'failed', 'issue'}:
                add('inspect_playback_observation', finding['language'],
                    'Retain reported problem on ' + finding['client'] + '; distinguish client behavior from file defects',
                    25, 'deferred' if any(c.get('deferred') and c['kind'] in {'client_playback', 'client_font'}
                                         and c.get('language') in {None, finding['language']} for c in concerns)
                    else 'review_needed', finding=deepcopy(finding))
            if finding['meaning'] in {'failed', 'issue'}:
                add('review_meaning', finding['language'],
                    'Reported meaning/translation concern; timing success is separate', 20, finding=deepcopy(finding))
    # Repeated identical concerns are evidence, not multiple rename operations.
    actions = list({_digest(a): a for a in actions}.values())
    # Detect two proposals claiming the same destination, as well as on-disk
    # collisions visible to _label_proposal. Nothing here is an execution preflight.
    targets = Counter(a['proposal']['destination'].casefold() for a in actions
                      if a['kind'] == 'label_sidecar' and a['proposal'].get('destination'))
    for action in actions:
        if action['kind'] == 'label_sidecar' and action['proposal'].get('destination'):
            if targets[action['proposal']['destination'].casefold()] > 1:
                action['proposal']['blockers'].append('Multiple proposals target the same destination')
                action['status'] = 'blocked'
    actions = sorted(actions, key=lambda a: (a['priority'], a['path'], a['language'] or '', a['kind']))
    return {'schema_version': 1, 'library': library, 'mode': 'dry_run_only',
            'acceptance_decisions': 0, 'complete_titles': 0,
            'inventory_complete': bool(inventory.get('complete')), 'inventory_errors': deepcopy(inventory.get('errors', [])),
            'limitations': ['Metadata equality is not a content hash', 'No automatic transfer across renamed files or libraries',
                            'Unconfirmed selected tracks remain unbound', 'Older inventories lack sidecar stat identity',
                            'No action execution, acceptance, or inferred Arabic authorship'],
            'summary': {'observations': len(views), 'current': sum(v['validity'] == 'current' for v in views),
                        'historical_or_unverifiable': sum(v['validity'] != 'current' for v in views),
                        'videos_with_current_observations': len(active), 'actions': dict(Counter(a['kind'] for a in actions))},
            'observations': views, 'actions': actions}
