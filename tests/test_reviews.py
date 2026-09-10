from copy import deepcopy
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from subtitle_manager.report import assemble, render_html
from subtitle_manager.reviews import ReviewStore, build_plan
from subtitle_manager.scanner import scan


def fixture():
    return assemble([
        {'kind': 'header', 'schema_version': 1, 'root': '/media/synthetic'},
        {'kind': 'sidecar', 'source': 'external', 'path': 'Movie.srt', 'associated_videos': ['Movie.mkv'],
         'association': 'basename_candidate', 'language': None, 'language_evidence': 'filename_suffix',
         'representation': 'text', 'forced': False, 'sdh': False, 'status': 'unverified',
         'provenance': 'unknown', 'issues': ['language_unknown_or_multiple'], 'size_bytes': 80,
         'mtime_ns': 100, 'encoding': 'unknown'},
        {'kind': 'video', 'path': 'Movie.mkv', 'size_bytes': 1000, 'mtime_ns': 100,
         'audio': [], 'subtitles': [], 'sidecars': ['Movie.srt'], 'issues': [], 'identity_status': 'unverified'},
        {'kind': 'complete', 'video_count': 1},
    ])


def finding(language='ar', client='Android TV', medium='external', **extra):
    return {'language': language, 'client': client, 'medium': medium, 'rendering': 'passed',
            'timing': 'passed', 'meaning': 'unknown', 'sample_scope': 'middle and end',
            'notes': 'User report, exact timestamps not recorded', **extra}


def observation(findings=None, concerns=None):
    return {'summary': 'User reviewed playback', 'findings': findings if findings is not None else [finding()],
            'concerns': concerns or [], 'evidence_note': 'Private source note retained as text.'}


def packet(value):
    return {'schema_version': 1, 'items': [{'path': 'Movie.mkv', 'observation': value}]}


class ReviewTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.directory = Path(self.temp.name)
        self.store = ReviewStore(self.directory / 'reviews')
        self.inventory = fixture()

    def plan(self, value=None, inventory=None):
        if value is not None:
            self.store.import_reviews(self.inventory, 'library-a', packet(value))
        return build_plan(inventory or self.inventory, 'library-a', self.store.list('library-a'))

    def test_persist_reload_and_idempotent_import_without_changing_inventory(self):
        original = deepcopy(self.inventory)
        data = packet(observation())
        self.assertEqual(self.store.import_reviews(self.inventory, 'library-a', data)['inserted'], 1)
        reloaded = ReviewStore(self.directory / 'reviews')
        self.assertEqual(reloaded.import_reviews(self.inventory, 'library-a', data)['already_present'], 1)
        self.assertEqual(len(reloaded.list('library-a')), 1)
        self.assertEqual(reloaded.list('library-a')[0]['observation']['evidence_note'], 'Private source note retained as text.')
        self.assertEqual(self.inventory, original)
        self.assertEqual((self.directory / 'reviews').stat().st_mode & 0o777, 0o700)
        self.assertEqual(next((self.directory / 'reviews').glob('*.json')).stat().st_mode & 0o777, 0o600)

    def test_library_namespaces_never_share_observations(self):
        self.plan(observation())
        self.assertEqual(self.store.list('library-b'), [])
        plan = build_plan(self.inventory, 'library-b', self.store.list('library-a'))
        self.assertEqual(plan['summary']['observations'], 0)
        self.assertFalse(any(a['kind'] == 'preserve_observed' for a in plan['actions']))

    def test_identical_rescan_keeps_observation_and_separates_human_language_from_tags(self):
        plan = self.plan(observation())
        self.assertEqual(plan['observations'][0]['validity'], 'current')
        self.assertIsNone(self.inventory['sidecars'][0]['language'])
        kinds = {(a['kind'], a['language']) for a in plan['actions']}
        self.assertIn(('preserve_observed', 'ar'), kinds)
        self.assertIn(('review_authorship', 'ar'), kinds)
        self.assertIn(('investigate_language', 'en'), kinds)
        self.assertNotIn(('investigate_language', 'ar'), kinds)
        self.assertEqual(plan['acceptance_decisions'], 0)
        self.assertEqual(plan['complete_titles'], 0)

    def test_changed_video_root_or_sidecar_invalidates_actionable_evidence(self):
        self.plan(observation())
        for change in ('size', 'mtime', 'root', 'sidecar', 'streams'):
            with self.subTest(change=change):
                changed = deepcopy(self.inventory)
                if change == 'size':
                    changed['videos'][0]['size_bytes'] += 1
                elif change == 'mtime':
                    changed['videos'][0]['mtime_ns'] += 1
                elif change == 'root':
                    changed['scan']['root'] = '/other-root'
                elif change == 'sidecar':
                    changed['sidecars'][0]['mtime_ns'] += 1
                else:
                    changed['videos'][0]['audio'] = [{'index': 1, 'codec_name': 'aac'}]
                plan = self.plan(inventory=changed)
                self.assertEqual(plan['observations'][0]['validity'], 'stale')
                self.assertFalse(any(a['kind'] == 'preserve_observed' for a in plan['actions']))
                self.assertEqual(len(self.store.list('library-a')), 1)

    def test_missing_on_partial_scan_does_not_mean_deleted_or_drop_history(self):
        self.plan(observation())
        missing = deepcopy(self.inventory)
        missing['videos'] = []
        missing['complete'] = False
        self.assertEqual(self.plan(inventory=missing)['observations'][0]['validity'], 'not_observed')
        missing['complete'] = True
        self.assertEqual(self.plan(inventory=missing)['observations'][0]['validity'], 'not_found')
        missing['errors'] = ['Permission denied in one directory']
        self.assertEqual(self.plan(inventory=missing)['observations'][0]['validity'], 'not_observed')
        self.assertEqual(len(self.store.list('library-a')), 1)

    def test_probe_failure_and_missing_identity_do_not_reuse_good_review(self):
        self.plan(observation())
        changed = deepcopy(self.inventory)
        changed['videos'][0]['issues'] = ['probe_failed: invalid container']
        plan = self.plan(inventory=changed)
        self.assertEqual(plan['observations'][0]['validity'], 'unverifiable')
        self.assertIn('inspect_media', [a['kind'] for a in plan['actions']])
        self.assertNotIn('investigate_language', [a['kind'] for a in plan['actions']])
        changed['videos'][0]['issues'] = []
        del changed['videos'][0]['mtime_ns']
        self.assertEqual(self.plan(inventory=changed)['observations'][0]['validity'], 'unverifiable')

    def test_client_failure_does_not_erase_tv_success_or_trigger_timing_repair(self):
        value = observation([finding(client='Chromium', medium='embedded', rendering='failed', timing='unknown'),
                             finding(client='Android TV', medium='embedded')],
                            [{'kind': 'client_font', 'language': 'ar', 'detail': 'Missing glyph reported', 'deferred': True}])
        plan = self.plan(value)
        preserved = next(a for a in plan['actions'] if a['kind'] == 'preserve_observed')
        self.assertEqual(preserved['clients'], ['Android TV'])
        self.assertIn('inspect_playback_observation', [a['kind'] for a in plan['actions']])
        self.assertNotIn('review_timing', [a['kind'] for a in plan['actions']])
        self.assertEqual(next(a for a in plan['actions'] if a['kind'] == 'client_font')['status'], 'deferred')

    def test_conflicting_same_client_records_are_kept_and_flagged(self):
        self.plan(observation())
        self.plan(observation([finding(timing='issue')]))
        plan = self.plan()
        self.assertEqual(len(plan['observations']), 2)
        self.assertIn('resolve_conflicting_observations', [a['kind'] for a in plan['actions']])
        self.assertNotIn('preserve_observed', [a['kind'] for a in plan['actions']])

    def test_unreadable_sidecar_cannot_reuse_observations_even_if_video_is_unchanged(self):
        self.plan(observation())
        changed = deepcopy(self.inventory)
        changed['sidecars'][0]['issues'].append('prefix_read_failed: permission denied')
        self.assertEqual(self.plan(inventory=changed)['observations'][0]['validity'], 'unverifiable')

    def test_meaning_problem_is_not_hidden_by_good_timing(self):
        plan = self.plan(observation([finding(meaning='issue')]))
        self.assertIn('review_meaning', [a['kind'] for a in plan['actions']])
        self.assertEqual(plan['acceptance_decisions'], 0)

    def test_burned_in_language_is_not_a_stream_or_missing_language(self):
        self.inventory['videos'][0]['sidecars'] = []
        plan = self.plan(observation([finding(language='en', medium='burned_in')]))
        self.assertEqual(self.inventory['videos'][0]['subtitles'], [])
        self.assertIn(('preserve_burned_in', 'en'), {(a['kind'], a['language']) for a in plan['actions']})
        self.assertNotIn(('investigate_language', 'en'), {(a['kind'], a['language']) for a in plan['actions']})
        self.assertEqual(plan['complete_titles'], 0)

    def test_unbound_label_proposal_is_blocked_not_guessed(self):
        value = observation(concerns=[{'kind': 'language_label', 'language': 'ar', 'detail': 'User sees undefined'}])
        plan = self.plan(value)
        action = next(a for a in plan['actions'] if a['kind'] == 'label_sidecar')
        self.assertEqual(action['status'], 'blocked')
        self.assertIsNone(action['proposal']['destination'])
        self.assertEqual(action['proposal']['candidate_sidecars'], ['Movie.srt'])

    def test_confirmed_label_proposal_preserves_ass_and_forced_sdh_flags(self):
        self.inventory['sidecars'][0].update(path='Movie.ass', forced=True, sdh=True)
        self.inventory['videos'][0]['sidecars'] = ['Movie.ass']
        value = observation([finding(sidecar_path='Movie.ass')],
                            [{'kind': 'language_label', 'language': 'ar', 'detail': 'Explicit selected sidecar confirmed'}])
        plan = self.plan(value)
        action = next(a for a in plan['actions'] if a['kind'] == 'label_sidecar')
        self.assertEqual(action['proposal']['destination'], 'Movie.ar.forced.sdh.ass')
        self.assertEqual(action['status'], 'proposal_only')
        self.assertIn('Media publication not authorized', action['proposal']['preconditions'])

    def test_repeated_label_evidence_is_not_a_collision_with_itself(self):
        value = observation([finding(sidecar_path='Movie.srt')],
                            [{'kind': 'language_label', 'language': 'ar', 'detail': 'Language identified'}])
        self.plan(value)
        value['summary'] = 'Follow-up confirms the same observation'
        actions = [a for a in self.plan(value)['actions'] if a['kind'] == 'label_sidecar']
        self.assertEqual(len(actions), 1)
        self.assertEqual(actions[0]['status'], 'proposal_only')

    def test_label_collision_partial_inventory_and_legacy_identity_are_blockers(self):
        self.inventory['sidecars'].append({**self.inventory['sidecars'][0], 'path': 'Movie.AR.srt'})
        self.inventory['complete'] = False
        del self.inventory['sidecars'][0]['mtime_ns']
        value = observation([finding(sidecar_path='Movie.srt')],
                            [{'kind': 'language_label', 'language': 'ar', 'detail': 'Language identified'}])
        action = next(a for a in self.plan(value)['actions'] if a['kind'] == 'label_sidecar')
        self.assertEqual(action['status'], 'blocked')
        self.assertEqual(len(action['proposal']['blockers']), 3)

    def test_report_escapes_human_notes_and_preserves_scan_summary(self):
        value = observation()
        value['summary'] = '<script>private</script>'
        original = deepcopy(self.inventory)
        html = render_html(self.inventory, self.plan(value))
        self.assertNotIn('<script>', html)
        self.assertIn('&lt;script&gt;private&lt;/script&gt;', html)
        self.assertIn('Human review and dry-run action plan', html)
        self.assertEqual(self.inventory, original)
        self.assertEqual(self.inventory['summary']['accepted_subtitles'], 0)

    def test_timing_concern_never_invents_a_correction_amount(self):
        value = observation([finding(timing='issue')],
                            [{'kind': 'timing', 'language': 'ar', 'detail': 'Less than a second late, bothersome'}])
        action = next(a for a in self.plan(value)['actions'] if a['kind'] == 'review_timing')
        self.assertIsNone(action['proposed_offset_seconds'])

    def test_invalid_batch_is_rejected_before_any_record_is_written(self):
        data = packet(observation())
        data['items'].append({'path': '../other.mkv', 'observation': observation()})
        with self.assertRaises(ValueError):
            self.store.import_reviews(self.inventory, 'library-a', data)
        self.assertEqual(self.store.list('library-a'), [])
        value = observation()
        value['accepted'] = True
        with self.assertRaises(ValueError):
            self.store.import_reviews(self.inventory, 'library-a', packet(value))

    def test_tampering_fails_loudly_instead_of_silently_losing_reviews(self):
        self.plan(observation())
        path = next((self.directory / 'reviews').glob('*.json'))
        data = json.loads(path.read_text())
        data['observation']['summary'] = 'changed without new record'
        path.write_text(json.dumps(data))
        with self.assertRaises(ValueError):
            self.store.list('library-a')

    def test_new_scans_capture_sidecar_and_companion_identity_without_changing_content(self):
        media = self.directory / 'media'
        media.mkdir()
        for name, data in [('Film.mkv', b''), ('Film.srt', b'hello'), ('Film.idx', b'# VobSub index file'), ('Film.sub', b'payload')]:
            (media / name).write_bytes(data)
        before = {p.name: (p.read_bytes(), p.stat().st_mtime_ns) for p in media.iterdir()}
        inventory = assemble(scan(media, probe_fn=lambda p, t: {}, delay=0))
        sidecars = {s['path']: s for s in inventory['sidecars']}
        self.assertEqual(sidecars['Film.srt']['size_bytes'], 5)
        self.assertEqual(sidecars['Film.idx']['companion_identity']['size_bytes'], 7)
        self.assertEqual(before, {p.name: (p.read_bytes(), p.stat().st_mtime_ns) for p in media.iterdir()})

    def test_cli_import_plan_is_offline_preserves_inputs_and_writes_private_outputs(self):
        inv = self.directory / 'inventory.json'
        obs = self.directory / 'observations.json'
        inv.write_text(json.dumps(self.inventory))
        obs.write_text(json.dumps(packet(observation())))
        before = (inv.read_bytes(), obs.read_bytes())
        base = [sys.executable, '-m', 'subtitle_manager.review']
        common = ['--inventory', str(inv), '--library', 'library-a', '--store', str(self.directory / 'reviews')]
        result = subprocess.run(base + ['import', *common, '--observations', str(obs)], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        result = subprocess.run(base + ['plan', *common, '--output', str(self.directory / 'output')], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        path = next((self.directory / 'output').glob('*/plan.json'))
        self.assertEqual(json.loads(path.read_text())['summary']['current'], 1)
        self.assertEqual(path.stat().st_mode & 0o777, 0o600)
        self.assertTrue(path.with_name('report.html').is_file())
        self.assertEqual(before, (inv.read_bytes(), obs.read_bytes()))

    def test_cli_rejects_store_inside_media_root(self):
        self.inventory['scan']['root'] = str(self.directory / 'media')
        inv = self.directory / 'inventory.json'
        inv.write_text(json.dumps(self.inventory))
        store = self.directory / 'media' / 'reviews'
        result = subprocess.run([sys.executable, '-m', 'subtitle_manager.review', 'plan', '--inventory', str(inv),
                                 '--library', 'library-a', '--store', str(store)], capture_output=True)
        self.assertEqual(result.returncode, 1)
        self.assertFalse(store.exists())


if __name__ == '__main__':
    unittest.main()
