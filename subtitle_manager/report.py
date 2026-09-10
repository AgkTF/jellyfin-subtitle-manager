"""Pure inventory aggregation and static, escaped review report rendering."""
from collections import Counter
import html
import json
from pathlib import PurePosixPath


def tracks(video, inventory):
    by_path = {s['path']: s for s in inventory['sidecars']}
    return video['subtitles'] + [by_path[p] for p in video['sidecars']]


def candidate_languages(video, inventory):
    # Presence is not acceptance. Ambiguous associations and conflicting evidence
    # are excluded from even this conservative tag-based count.
    return sorted({s['language'] for s in tracks(video, inventory)
                   if s.get('language') and not s['forced']
                   and s.get('association', 'basename_candidate') == 'basename_candidate'
                   and not any('conflict' in issue for issue in s.get('issues', []))})


def categories(video, inventory):
    all_tracks = tracks(video, inventory)
    path = video['path'].lower()
    result = {PurePosixPath(path).suffix, 'embedded' if video['subtitles'] else 'no_embedded',
              'sidecars' if video['sidecars'] else 'no_associated_sidecars'}
    if '/shows/' in '/' + path or re_episode(path):
        result.add('series')
    elif '/movies/' in '/' + path:
        result.add('movie')
    if 'anime' in path:
        result.add('anime_filename_hint')
    if any(word in path for word in ('extended', 'director', 'unrated', 'sample', 'extras')):
        result.add('cut_or_extra_filename_hint')
    for s in all_tracks:
        result.add(s['representation'])
        if s.get('encoding') == 'unknown':
            result.add('unknown_encoding')
        if s['forced']:
            result.add('forced')
        if s['sdh']:
            result.add('sdh')
        if not s['language']:
            result.add('unknown_language')
    langs = candidate_languages(video, inventory)
    result.add('bilingual_tags' if {'en', 'ar'} <= set(langs) else 'english_tag_only' if 'en' in langs else 'no_english_tag')
    if video['issues']:
        result.add('metadata_review')
    return result


def re_episode(path):
    import re
    return bool(re.search(r's\d+e\d+', path, re.I))


def validation_batch(inventory, count=15):
    remaining = sorted(inventory['videos'], key=lambda v: v['path'])
    chosen, covered, groups = [], set(), set()
    while remaining and len(chosen) < count:
        def score(video):
            group = str(PurePosixPath(video['path']).parent)
            return (len(categories(video, inventory) - covered), group not in groups)
        video = max(remaining, key=score)
        reasons = sorted(categories(video, inventory))
        chosen.append({'path': video['path'], 'reasons': reasons})
        covered.update(reasons)
        groups.add(str(PurePosixPath(video['path']).parent))
        remaining.remove(video)
    return chosen


def assemble(events):
    inventory = {'schema_version': 1, 'videos': [], 'sidecars': [], 'errors': [], 'complete': False}
    for event in events:
        kind = event['kind']
        if kind == 'header':
            inventory['scan'] = event
        elif kind == 'video':
            inventory['videos'].append(event)
        elif kind == 'sidecar':
            inventory['sidecars'].append(event)
        elif kind == 'error':
            inventory['errors'].append(event['message'])
        elif kind == 'complete':
            inventory['complete'] = True
            inventory['completion'] = event
    counts = Counter({key: 0 for key in (
        'english_tag_nonforced_candidates', 'arabic_tag_nonforced_candidates',
        'both_language_tag_candidates', 'videos_with_probe_errors', 'embedded_subtitle_streams',
    )})
    for video in inventory['videos']:
        langs = candidate_languages(video, inventory)
        counts['english_tag_nonforced_candidates'] += 'en' in langs
        counts['arabic_tag_nonforced_candidates'] += 'ar' in langs
        counts['both_language_tag_candidates'] += {'en', 'ar'} <= set(langs)
        counts['videos_with_probe_errors'] += any(i.startswith('probe_failed') for i in video['issues'])
        counts['embedded_subtitle_streams'] += len(video['subtitles'])
    inventory['summary'] = {'videos': len(inventory['videos']), 'sidecar_assets': len(inventory['sidecars']),
                            'unassociated_sidecars': sum(s['association'] == 'unassociated' for s in inventory['sidecars']),
                            'accepted_subtitles': 0, 'verified_complete_titles': 0, **counts}
    inventory['proposed_validation_batch'] = validation_batch(inventory)
    return inventory


def _review_html(plan):
    def esc(value):
        return html.escape(str(value), quote=True)

    def evidence(value):
        return '<pre>' + esc(json.dumps(value, ensure_ascii=True, indent=2)) + '</pre>'

    def action_table(actions):
        rows = ['<table><tr><th>Video / language</th><th>Action / status</th><th>Reason and constraints</th></tr>']
        for action in actions:
            extra = {k: action[k] for k in ('proposal', 'clients', 'proposed_offset_seconds', 'finding') if k in action}
            rows.append('<tr><td>' + esc(action['path']) + '<br>' + esc(action['language'] or 'file') +
                        '</td><td>' + esc(action['kind'].replace('_', ' ')) + '<br>' + esc(action['status']) +
                        '</td><td>' + esc(action['reason']) + (evidence(extra) if extra else '') + '</td></tr>')
        return '\n'.join(rows + ['</table>'])

    body = ['<h2>Human review and dry-run action plan</h2>',
            '<p><strong>Provisional report, not a final product UI. No actions execute; nothing is accepted.</strong> '
            'Current observations match saved metadata, not a verified content hash. '
            'Client-specific failures do not invalidate successful playback on another client.</p>',
            evidence(plan['summary']), '<h3>Recorded observations</h3>']
    for view in plan['observations']:
        record = view['record']
        body.append('<details><summary>' + esc(record['snapshot']['path']) + ' — ' + esc(view['validity']) +
                    '</summary><p>' + esc(record['observation']['summary']) + '</p>' +
                    evidence(record['observation']) + '</details>')
    reviewed = [a for a in plan['actions'] if a['evidence_ids']]
    other = [a for a in plan['actions'] if not a['evidence_ids']]
    body += ['<h3>Actions for recorded reviews</h3>', action_table(reviewed),
             '<details><summary>Other inventory actions (' + str(len(other)) + ')</summary>',
             action_table(other), '</details><h3>Evidence limits</h3>', evidence(plan['limitations'])]
    return '\n'.join(body)


def render_html(inventory, review_plan=None):
    esc = lambda value: html.escape(str(value), quote=True)
    def details(value):
        return '<pre>' + esc(json.dumps(value, ensure_ascii=True, indent=2)) + '</pre>'
    body = ['<!doctype html><html lang="en"><meta charset="utf-8">',
            '<meta name="viewport" content="width=device-width, initial-scale=1">',
            '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'">',
            '<title>Subtitle inventory — private</title>',
            '<style>body{font:16px system-ui;max-width:1100px;margin:2rem auto;padding:1rem;background:#16191d;color:#eee}a{color:#9bd}summary{cursor:pointer;padding:.6rem}pre{white-space:pre-wrap;overflow-wrap:anywhere}li{margin:.6rem 0}details{border:1px solid #555;margin:.4rem 0}td,th{padding:.4rem;text-align:left}h2{margin-top:2rem}</style>',
            '<h1>Subtitle inventory <small>— private</small></h1>',
            '<p><strong>Metadata candidates only. Nothing is accepted or subtitle-complete.</strong> '
            'Language tags, absence of a forced flag, and basename matches do not prove language, full dialogue, identity, timing, quality, or human authorship. '
            'Image subtitles remain eligible for later playback/timing validation. Arabic authorship is unknown.</p>',
            '<p>Scan reached end: ' + esc(inventory['complete']) + '. Per-file and traversal errors are retained below.</p>',
            '<h2>Summary (files, not titles)</h2><table>']
    body += ['<tr><th>' + esc(k.replace('_', ' ')) + '</th><td>' + esc(v) + '</td></tr>' for k, v in inventory['summary'].items()]
    body += ['</table>']
    if review_plan is not None:
        body.append(_review_html(review_plan))
    body += ['<h2>Original metadata-proposed validation batch</h2><p>Up to 15 video files chosen for metadata variety, not statistical representation. '
             'Confirm identities, deduplicate series/titles, and add known troublesome cases before review. No provider activity is authorized.</p><ol>']
    body += ['<li>' + esc(v['path']) + '<br><small>' + esc(', '.join(v['reasons'])) + '</small></li>' for v in inventory['proposed_validation_batch']]
    body += ['</ol><h2>Scan evidence and errors</h2>', details(inventory.get('scan')), details(inventory['errors']), '<h2>Videos</h2>']
    for video in inventory['videos']:
        body.append('<details><summary>' + esc(video['path']) + ' — non-forced candidate tags: ' + esc(', '.join(candidate_languages(video, inventory)) or 'none identified') + '</summary>' + details(video) + details({'associated_external_assets': [s for s in tracks(video, inventory) if s['source'] == 'external']}) + '</details>')
    body.append('<h2>All external subtitle assets (including unassociated)</h2>')
    for sidecar in inventory['sidecars']:
        body.append('<details><summary>' + esc(sidecar['path']) + ' — ' + esc(sidecar['association']) + '</summary>' + details(sidecar) + '</details>')
    body.append('</html>')
    return '\n'.join(body)
