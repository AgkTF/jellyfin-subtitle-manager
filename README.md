# jellyfin-subtitle-manager

Read-only subtitle inventory pilot. Python 3.12+, managed with uv; no Python
runtime dependencies. The target needs Python 3 and ffprobe. Nothing is installed
on the target: SSH receives a standalone scanner on standard input.

## Run

```sh
uv run python -m subtitle_manager --host MEDIA_SSH_ALIAS --root /absolute/media/root
# Or a local fixture/library:
uv run python -m subtitle_manager --root /absolute/media/root
uv run python -m unittest discover -s tests -v
```

If uv is managed by mise but not activated, prefix these commands with
`mise exec uv --`. SSH must already work non-interactively (BatchMode); this tool
does not provision credentials or change SSH configuration.

Each run creates a private timestamped directory under ignored `reports/`:

- `events.jsonl`: flushed incremental scanner evidence, usable if interrupted.
- `inventory.json`: inventory, errors, summary, and proposed 15-file review batch.
- `report.html`: static, escaped, self-contained report; open in a browser.
- `scan.stderr.log`: scanner diagnostics and progress.

Reports contain private filenames and paths. Do not commit or share them. A custom
`--output` directory is not automatically ignored by Git. Files are created with
owner-only permissions. No remote, upload, or publication is configured.

## Scope and limits

- Sequential ffprobe metadata reads with a 30-second per-file timeout, a
  0.1-second pause, CPU niceness +15, and idle I/O priority where available.
  `--timeout` and `--delay` are configurable. Disk contention remains possible.
- Reads at most 64 KiB plus one boundary byte from a sidecar; records encoding and
  script evidence, not detected language or translation quality.
- Does not follow symlinks. Skips paired SUB payloads when an IDX exists. Retains
  unassociated sidecars, unknown formats/encodings/languages, and errors.
- Only exact, same-directory video basename associations (optionally followed by
  dot suffixes) are proposed. Longest basename wins; duplicate video basenames
  remain ambiguous. Subdirectory and differing-release sidecars remain unassociated.
- Embedded flags and language tags are evidence, not ground truth. Absence of a
  forced flag does **not** prove full dialogue. IDX language lists are prefix-only;
  multi-language IDX assets are not counted as individual tracks.
- Identity is unverified for every video. Counts are files/assets/streams, not
  Jellyfin title counts. The batch is metadata-varied, not statistically sampled;
  confirm identity and deduplicate titles/series before validation.
- Nothing is accepted or marked subtitle-complete. No timing, playback, OCR,
  authorship, or translation validation. No provider searches, downloads, media
  writes, audio processing, Jellyfin API calls, or services.
- Exit 1 means partial results, traversal failure, or probe errors; inspect the
  report and log. Successful traversal does not make all probes successful.
- Ctrl-C preserves received evidence and a partial report. It terminates local
  transport; an in-flight remote probe may take up to its timeout to finish before
  the scanner encounters the closed connection. No automatic retry/resume yet.
- File reads may update filesystem access times. Concurrent library changes can
  produce inconsistencies; size/mtime changes during a probe are flagged. This
  pilot assumes a trusted media tree, not a hostile concurrent filesystem.

## Implementation

`subtitle_manager/scanner.py` owns filesystem/probe interpretation behind a single
`scan()` event iterator and can run without the local package. The CLI owns SSH,
local evidence persistence, interruption handling, and output permissions.
`report.py` aggregates events and renders reports without touching media.
Tests exercise the scan/report interface with synthetic metadata and include a
real, tiny FFmpeg-generated bilingual-tag fixture when FFmpeg is available.

See [the approved plan](docs/pilot-plan.md), [domain glossary](CONTEXT.md), and
[sanitized research](docs/research/subtitle-solution.md). Original private research
is retained only in ignored local notes.
