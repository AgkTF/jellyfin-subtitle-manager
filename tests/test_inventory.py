import json
from pathlib import Path
import shlex
import shutil
import subprocess
import sys
import tempfile
import unittest

from subtitle_manager.__main__ import scanner_command
from subtitle_manager.report import assemble, render_html
from subtitle_manager.scanner import scan


class InventoryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / 'media'
        self.root.mkdir()

    def file(self, name, content=b''):
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)
        return path

    def inventory(self, metadata=None):
        return assemble(scan(self.root, probe_fn=lambda p, t: metadata or {}, delay=0))

    def test_presence_is_not_acceptance_and_forced_does_not_count(self):
        self.file('Movie.mkv')
        self.file('Movie.en.forced.srt', b'hello')
        data = self.inventory({'streams': [
            {'index': 1, 'codec_type': 'subtitle', 'codec_name': 'hdmv_pgs_subtitle', 'tags': {'language': 'ara'}},
            {'index': 2, 'codec_type': 'subtitle', 'codec_name': 'ass', 'tags': {'language': 'und'}},
        ]})
        self.assertEqual(data['summary']['english_tag_nonforced_candidates'], 0)
        self.assertEqual(data['summary']['arabic_tag_nonforced_candidates'], 1)
        self.assertEqual(data['summary']['accepted_subtitles'], 0)
        self.assertEqual(data['videos'][0]['subtitles'][0]['representation'], 'image')
        self.assertIn('embedded_language_unknown', data['videos'][0]['issues'])

    def test_association_is_delimited_longest_and_ambiguous_duplicates_stay_ambiguous(self):
        for name in ['Film.mkv', 'Film.Extended.mkv', 'Other.mkv', 'Other.mp4']:
            self.file(name)
        for name in ['Film.Extended.en.srt', 'Filmography.en.srt', 'Other.en.srt', 'Subs/Film.ar.srt']:
            self.file(name)
        data = self.inventory()
        subs = {s['path']: s for s in data['sidecars']}
        self.assertEqual(subs['Film.Extended.en.srt']['associated_videos'], ['Film.Extended.mkv'])
        self.assertEqual(subs['Filmography.en.srt']['association'], 'unassociated')
        self.assertIsNone(subs['Filmography.en.srt']['language'])
        self.assertEqual(subs['Other.en.srt']['association'], 'ambiguous')
        self.assertEqual(subs['Subs/Film.ar.srt']['association'], 'unassociated')
        self.assertEqual(data['summary']['english_tag_nonforced_candidates'], 1)

    def test_encoding_script_and_idx_pair(self):
        self.file('Film.mkv')
        self.file('Film.ar.srt', b'\xff\x80')
        self.file('Film.en.srt', 'مرحبا'.encode())
        self.file('Film.idx', b'# VobSub index file\nid: en, index: 0\nid: ar, index: 1\n')
        self.file('Film.sub', b'\x00\x00\x01\xba')
        data = self.inventory()
        subs = {s['path']: s for s in data['sidecars']}
        self.assertEqual(len(subs), 3)
        self.assertIn('encoding_unknown', subs['Film.ar.srt']['issues'])
        self.assertIn('language_script_conflict', subs['Film.en.srt']['issues'])
        self.assertEqual(subs['Film.idx']['idx_languages'], ['ar', 'en'])
        self.assertEqual(subs['Film.idx']['companion'], 'Film.sub')
        self.assertEqual(data['summary']['english_tag_nonforced_candidates'], 0)

    def test_utf8_prefix_boundary_not_misclassified_and_utf16_bom(self):
        self.file('Film.mkv')
        self.file('Film.en.srt', b'a' * 65535 + 'é'.encode() + b'end')
        self.file('Film.ar.srt', 'مرحبا'.encode('utf-16'))
        subs = {s['path']: s for s in self.inventory()['sidecars']}
        self.assertEqual(subs['Film.en.srt']['encoding'], 'utf-8-sig')
        self.assertFalse(subs['Film.en.srt']['sample_complete'])
        self.assertEqual(subs['Film.ar.srt']['encoding'], 'utf-16')

    def test_probe_failure_continues_and_symlinks_are_skipped(self):
        self.file('Bad.mkv')
        self.file('Good.mkv')
        (self.root / 'Link.mkv').symlink_to(self.root / 'Good.mkv')
        (self.root / 'Loop').symlink_to(self.root, target_is_directory=True)
        def fake(path, timeout):
            if path.name == 'Bad.mkv':
                raise subprocess.TimeoutExpired('ffprobe', timeout)
            return {}
        data = assemble(scan(self.root, probe_fn=fake, delay=0))
        self.assertTrue(data['complete'])
        self.assertEqual(data['summary']['videos'], 2)
        self.assertEqual(data['summary']['videos_with_probe_errors'], 1)

    def test_report_escapes_paths_and_partial_is_explicit(self):
        self.file('<script>alert(1)</script>.mkv')
        events = list(scan(self.root, probe_fn=lambda p, t: {}, delay=0))
        data = assemble(events[:-1])
        rendered = render_html(data)
        self.assertFalse(data['complete'])
        self.assertNotIn('<script>', rendered)
        self.assertIn('&lt;script&gt;', rendered)
        self.assertIn('Nothing is accepted', rendered)

    def test_batch_is_varied_and_capped(self):
        for n in range(20):
            self.file('shows/Series/S01E%02d.mkv' % n)
        self.file('movies/Film/Film.Extended.mp4')
        self.file('movies/Film/Film.Extended.ar.srt')
        data = self.inventory()
        batch = data['proposed_validation_batch']
        self.assertEqual(len(batch), 15)
        self.assertTrue(any('movies/' in item['path'] for item in batch))
        self.assertEqual(len({item['path'] for item in batch}), 15)

    def test_ssh_quotes_root_and_rejects_option_injection(self):
        root = "/media/a'; touch /tmp/never; echo '"
        command, payload = scanner_command('media-host', root, 30, .1)
        self.assertEqual(shlex.split(command[-1])[3], root)
        self.assertIn(b'def scan(', payload)
        with self.assertRaises(ValueError):
            scanner_command('-oProxyCommand=bad', root, 30, .1)

    def test_cli_refuses_reports_in_media_root(self):
        result = subprocess.run([sys.executable, '-m', 'subtitle_manager', '--root', str(self.root), '--output', str(self.root / 'reports')], capture_output=True)
        self.assertEqual(result.returncode, 2)
        self.assertFalse((self.root / 'reports').exists())

    def test_missing_root_produces_partial_report_and_nonzero_exit(self):
        output = Path(self.temp.name) / 'reports'
        result = subprocess.run([sys.executable, '-m', 'subtitle_manager', '--root', str(self.root / 'missing'), '--output', str(output)], capture_output=True)
        self.assertEqual(result.returncode, 1)
        data = json.loads(next(output.glob('*/inventory.json')).read_text())
        self.assertFalse(data['complete'])
        self.assertTrue(data['errors'])
        self.assertEqual(data['summary']['english_tag_nonforced_candidates'], 0)

    @unittest.skipUnless(shutil.which('ffprobe'), 'ffprobe required')
    def test_invalid_media_is_reported_as_probe_failure_not_silent_success(self):
        self.file('Invalid.mp4', b'fake')
        output = Path(self.temp.name) / 'reports'
        result = subprocess.run([sys.executable, '-m', 'subtitle_manager', '--root', str(self.root), '--output', str(output), '--delay', '0'], capture_output=True)
        self.assertEqual(result.returncode, 1)
        data = json.loads(next(output.glob('*/inventory.json')).read_text())
        self.assertTrue(data['complete'])  # Traversal finished, but the file could not be probed.
        self.assertEqual(data['summary']['videos_with_probe_errors'], 1)
        self.assertTrue(data['videos'][0]['issues'][0].startswith('probe_failed:'))

    @unittest.skipUnless(shutil.which('ffprobe'), 'ffprobe required')
    def test_standalone_scanner_runs_from_stdin_without_package(self):
        _, payload = scanner_command('media-host', str(self.root), 30, 0)
        result = subprocess.run([sys.executable, '-I', '-', str(self.root)], input=payload,
                                cwd=self.temp.name, capture_output=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        data = assemble(json.loads(line) for line in result.stdout.splitlines())
        self.assertTrue(data['complete'])
        self.assertEqual(data['summary']['videos'], 0)

    def test_dispositions_audio_and_missing_idx_companion_are_retained(self):
        self.file('Film.mkv')
        self.file('Film.en.idx', b'# VobSub index file\nid: ar, index: 0\n')
        data = self.inventory({'streams': [
            {'codec_type': 'subtitle', 'codec_name': 'dvd_subtitle', 'tags': {'language': 'eng'},
             'disposition': {'hearing_impaired': 1, 'forced': 1}},
            {'codec_type': 'audio', 'tags': {'language': 'eng'}},
            {'codec_type': 'audio', 'tags': {}},
        ]})
        track = data['videos'][0]['subtitles'][0]
        self.assertTrue(track['forced'])
        self.assertTrue(track['sdh'])
        self.assertIn('audio_selection_needs_review', data['videos'][0]['issues'])
        self.assertIn('missing_idx_companion', data['sidecars'][0]['issues'])
        self.assertIn('conflicting_language_evidence', data['sidecars'][0]['issues'])
        self.assertIsNone(data['sidecars'][0]['language'])

    @unittest.skipUnless(shutil.which('ffmpeg') and shutil.which('ffprobe'), 'FFmpeg required')
    def test_real_probe_cli_preserves_media_and_writes_private_report(self):
        subtitle = self.file('Film.en.srt', b'1\n00:00:00,000 --> 00:00:00,800\nHello\n')
        video = self.root / 'Film.mkv'
        subprocess.run(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', 'color=s=16x16:d=1',
                        '-i', str(subtitle), '-map', '0:v', '-map', '1:s', '-c:v', 'ffv1', '-c:s', 'srt',
                        '-metadata:s:s:0', 'language=ara', str(video)], check=True)
        before = {p.name: (p.read_bytes(), p.stat().st_mtime_ns) for p in self.root.iterdir()}
        output = Path(self.temp.name) / 'reports'
        result = subprocess.run([sys.executable, '-m', 'subtitle_manager', '--root', str(self.root), '--output', str(output), '--delay', '0'], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
        inventory_path = next(output.glob('*/inventory.json'))
        data = json.loads(inventory_path.read_text())
        self.assertEqual(data['summary']['both_language_tag_candidates'], 1)
        self.assertEqual(inventory_path.stat().st_mode & 0o777, 0o600)
        self.assertEqual(before, {p.name: (p.read_bytes(), p.stat().st_mtime_ns) for p in self.root.iterdir()})


if __name__ == '__main__':
    unittest.main()
