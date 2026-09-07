"""Standalone stdlib scanner; also sent verbatim to Python over SSH stdin.

Only metadata probes and bounded sidecar reads. No media writes or symlink traversal.
The event stream ends with a completion marker; individual errors are retained.
"""
import argparse
import codecs
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import time

VIDEO = {'.mkv', '.mp4', '.avi', '.mov', '.m4v', '.ts', '.m2ts', '.wmv', '.webm', '.mpg', '.mpeg', '.flv'}
SUBTITLE = {'.srt', '.ass', '.ssa', '.vtt', '.smi', '.sami', '.sub', '.idx', '.sup', '.ttml'}
IMAGE = {'dvd_subtitle', 'hdmv_pgs_subtitle', 'dvb_subtitle', 'xsub'}
TEXT = {'subrip', 'ass', 'ssa', 'webvtt', 'mov_text', 'text', 'sami', 'ttml', 'microdvd', 'mpl2', 'jacosub', 'subviewer'}
LANGUAGES = {'en': 'en', 'eng': 'en', 'english': 'en', 'ar': 'ar', 'ara': 'ar', 'arabic': 'ar', 'fr': 'fr', 'fre': 'fr', 'fra': 'fr', 'french': 'fr', 'es': 'es', 'spa': 'es', 'de': 'de', 'ger': 'de', 'deu': 'de', 'ja': 'ja', 'jpn': 'ja', 'nl': 'nl', 'dut': 'nl', 'nld': 'nl', 'it': 'it', 'ita': 'it', 'ru': 'ru', 'rus': 'ru', 'pt': 'pt', 'por': 'pt', 'zh': 'zh', 'chi': 'zh', 'zho': 'zh', 'ko': 'ko', 'kor': 'ko', 'tr': 'tr', 'tur': 'tr', 'fa': 'fa', 'per': 'fa', 'fas': 'fa', 'ur': 'ur', 'urd': 'ur'}


def language(value):
    value = str(value or '').lower().strip()
    return LANGUAGES.get(value, value if re.fullmatch(r'[a-z]{2,3}', value) and value not in {'und', 'mul', 'zxx'} else None)


def flags(text):
    tokens = set(re.split(r'[^a-z0-9]+', text.lower()))
    return {'forced': bool(tokens & {'forced', 'foreign'}), 'sdh': bool(tokens & {'sdh', 'hi', 'cc'})}


def probe(path, timeout):
    result = subprocess.run(
        ['ffprobe', '-v', 'error', '-protocol_whitelist', 'file', '-probesize', '5000000',
         '-analyzeduration', '5000000', '-show_entries',
         'format=duration:stream=index,codec_type,codec_name:stream_tags=language,title:stream_disposition',
         '-of', 'json', str(path)], capture_output=True, text=True, timeout=timeout,
    )
    if result.returncode:
        raise ValueError('ffprobe failed: ' + result.stderr[:1000])
    return json.loads(result.stdout)


def embedded(stream):
    tags = stream.get('tags', {})
    disposition = stream.get('disposition', {})
    codec = stream.get('codec_name')
    result = {'source': 'embedded', 'index': stream.get('index'), 'codec': codec,
              'language': language(tags.get('language')), 'language_evidence': 'stream_tag',
              'tags': tags, 'representation': 'image' if codec in IMAGE else 'text' if codec in TEXT else 'unknown',
              'forced': bool(disposition.get('forced')) or flags(tags.get('title', ''))['forced'],
              'sdh': bool(disposition.get('hearing_impaired')) or flags(tags.get('title', ''))['sdh'],
              'disposition': disposition, 'status': 'unverified', 'provenance': 'unknown'}
    return result


def prefix_info(path):
    with path.open('rb') as handle:
        raw = handle.read(65536)
        complete = not handle.read(1)
    encoding = 'utf-8-sig'
    if raw.startswith((codecs.BOM_UTF16_LE, codecs.BOM_UTF16_BE)):
        encoding = 'utf-16'
    try:
        text = codecs.getincrementaldecoder(encoding)().decode(raw, final=complete)
        return {'encoding': encoding, 'sample_bytes': len(raw), 'sample_complete': complete,
                'arabic_script_in_prefix': bool(re.search(r'[\u0600-\u06ff\u0750-\u077f\u08a0-\u08ff]', text))}, text
    except UnicodeError:
        return {'encoding': 'unknown', 'sample_bytes': len(raw), 'sample_complete': complete,
                'arabic_script_in_prefix': None}, ''


def sidecar(path, root, videos, all_paths):
    relative = path.relative_to(root).as_posix()
    # Longest exact basename prefix wins (Film vs Film.Extended). No fuzzy identity guesses.
    matches = [v for v in videos if v.parent == path.parent and
               (path.stem.casefold() == v.stem.casefold() or path.stem.casefold().startswith(v.stem.casefold() + '.'))]
    if matches:
        longest = max(len(v.stem) for v in matches)
        matches = [v for v in matches if len(v.stem) == longest]
    suffix = path.stem[len(matches[0].stem):] if matches else ''
    langs = sorted({LANGUAGES[t] for t in re.split(r'[^a-z]+', suffix.lower()) if t in LANGUAGES})
    ext = path.suffix.lower()
    result = {'path': relative, 'source': 'external', 'associated_videos': [v.relative_to(root).as_posix() for v in matches],
              'association': 'basename_candidate' if len(matches) == 1 else 'ambiguous' if matches else 'unassociated',
              'language': langs[0] if len(langs) == 1 else None, 'language_evidence': 'filename_suffix',
              'representation': 'image' if ext in {'.idx', '.sup'} else 'unknown' if ext == '.sub' else 'text',
              'status': 'unverified', 'provenance': 'unknown', **flags(suffix), 'issues': []}
    if ext == '.idx':
        companion = next((p for p in all_paths if p.parent == path.parent and p.stem == path.stem and p.suffix.lower() == '.sub'), None)
        result['companion'] = companion.relative_to(root).as_posix() if companion else None
        if companion is None:
            result['issues'].append('missing_idx_companion')
    if ext != '.sup':
        try:
            info, text = prefix_info(path)
            result.update(info)
            if ext == '.idx':
                result['idx_languages'] = sorted({language(x) for x in re.findall(r'^id:\s*([a-zA-Z]{2,3}),', text, re.M) if language(x)})
                result['language_evidence'] = 'idx_prefix_and_filename'
                if len(result['idx_languages']) == 1 and not result['language']:
                    result['language'] = result['idx_languages'][0]
                if result['language'] and result['idx_languages'] and result['idx_languages'] != [result['language']]:
                    result['issues'].append('conflicting_language_evidence')
                    result['language'] = None
            if info['encoding'] == 'unknown' and result['representation'] == 'text':
                result['issues'].append('encoding_unknown')
            if result['language'] == 'en' and info['arabic_script_in_prefix']:
                result['issues'].append('language_script_conflict')
        except OSError as exc:
            result['issues'].append('prefix_read_failed: ' + str(exc))
    if not result['language']:
        result['issues'].append('language_unknown_or_multiple')
    if result['association'] != 'basename_candidate':
        result['issues'].append('association_needs_review')
    if result['representation'] == 'unknown':
        result['issues'].append('representation_unknown')
    return result


def scan(root, probe_fn=probe, timeout=30, delay=0.1):
    root = Path(root).absolute()
    if root.is_symlink() or not root.is_dir():
        raise ValueError('Media root must be an existing non-symlink directory')
    root = root.resolve()
    yield {'kind': 'header', 'schema_version': 1, 'root': str(root), 'started_at': time.time(),
           'limitations': ['Metadata only; no accepted subtitles', 'Filename identity and association are unverified',
                           'No timing, translation, full-dialogue, or authorship verification',
                           'Sidecar encoding/script evidence uses at most 64 KiB', 'Symlinks are skipped']}
    paths, walk_errors = [], []
    for directory, dirs, files in os.walk(root, followlinks=False, onerror=lambda e: walk_errors.append(str(e))):
        dirs[:] = sorted(d for d in dirs if not (Path(directory) / d).is_symlink())
        for name in sorted(files):
            path = Path(directory) / name
            if not path.is_symlink() and path.is_file() and path.suffix.lower() in VIDEO | SUBTITLE:
                paths.append(path)
    for error in walk_errors:
        yield {'kind': 'error', 'message': error}
    videos = sorted(p for p in paths if p.suffix.lower() in VIDEO)
    subtitles = sorted(p for p in paths if p.suffix.lower() in SUBTITLE)
    idx_keys = {(p.parent, p.stem) for p in subtitles if p.suffix.lower() == '.idx'}
    associations = {}
    for path in subtitles:
        if path.suffix.lower() == '.sub' and (path.parent, path.stem) in idx_keys:
            continue
        entry = sidecar(path, root, videos, subtitles)
        for video in entry['associated_videos']:
            associations.setdefault(video, []).append(entry['path'])
        yield {'kind': 'sidecar', **entry}
    for number, path in enumerate(videos, 1):
        relative = path.relative_to(root).as_posix()
        entry = {'kind': 'video', 'path': relative, 'identity_status': 'unverified',
                 'sidecars': associations.get(relative, []), 'subtitles': [], 'audio': [], 'issues': []}
        try:
            stat = path.stat()
            entry.update(size_bytes=stat.st_size, mtime_ns=stat.st_mtime_ns)
            metadata = probe_fn(path, timeout)
            entry['duration'] = metadata.get('format', {}).get('duration')
            for stream in metadata.get('streams', []):
                if stream.get('codec_type') == 'subtitle':
                    entry['subtitles'].append(embedded(stream))
                elif stream.get('codec_type') == 'audio':
                    entry['audio'].append(stream)
            if not entry['audio'] or len(entry['audio']) > 1 or any(not language(s.get('tags', {}).get('language')) for s in entry['audio']):
                entry['issues'].append('audio_selection_needs_review')
            if any(not s['language'] for s in entry['subtitles']):
                entry['issues'].append('embedded_language_unknown')
            if any(s['representation'] == 'unknown' for s in entry['subtitles']):
                entry['issues'].append('embedded_representation_unknown')
            after = path.stat()
            if (stat.st_size, stat.st_mtime_ns) != (after.st_size, after.st_mtime_ns):
                entry['issues'].append('file_changed_during_probe')
        except (OSError, ValueError, subprocess.TimeoutExpired) as exc:
            entry['issues'].append('probe_failed: ' + str(exc))
        yield entry
        if number % 25 == 0:
            print('Probed %d/%d videos' % (number, len(videos)), file=sys.stderr, flush=True)
        time.sleep(delay)
    yield {'kind': 'complete', 'finished_at': time.time(), 'video_count': len(videos)}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('root')
    parser.add_argument('--timeout', type=float, default=30)
    parser.add_argument('--delay', type=float, default=0.1)
    args = parser.parse_args()
    if args.timeout <= 0 or args.delay < 0:
        parser.error('timeout must be positive; delay must be nonnegative')
    if not shutil.which('ffprobe'):
        parser.error('ffprobe is required')
    try:
        os.nice(15)
        if shutil.which('ionice'):
            subprocess.run(['ionice', '-c', '3', '-p', str(os.getpid())], check=True)
    except (OSError, subprocess.CalledProcessError) as exc:
        print('Warning: could not lower priority: ' + str(exc), file=sys.stderr)
    for event in scan(args.root, timeout=args.timeout, delay=args.delay):
        print(json.dumps(event, ensure_ascii=True), flush=True)


if __name__ == '__main__':
    main()
