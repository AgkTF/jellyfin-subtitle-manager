# jellyfin-subtitle-manager

Read-only subtitle inventory with local review evidence and dry-run planning.
Python 3.12+, managed with uv; no Python runtime dependencies. The target needs Python 3 and ffprobe. Nothing is installed
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

## Local browser application

The Node.js 24.21.0 application provides a React request workspace and a read-only
synthetic saved-inventory picker. Choose **Request subtitles** to search by title,
release or filename and inspect saved scan errors and English/Arabic evidence.
Ambiguous identities require an explicit choice; missing evidence stays unknown.
Request creation from the picker is not available yet.

`GET /api/inventory?q=...` reads only the labelled, in-code synthetic snapshot in
`src/server/saved-inventory.ts`. It has no scanner, provider, filesystem or workflow
dependency. Displayed `/synthetic/` paths are evidence labels, never opened.
Page load and search do not scan libraries, contact providers or mutate requests.

```sh
npm install
npm run check
npm run build
npm start
```

The built server listens only on `127.0.0.1:3000` by default. `PORT` may select a
different local port. For development, run `npm run dev:server` and
`npm run dev:client` in separate terminals, then open Vite's printed URL (normally
`http://127.0.0.1:5173`). Vite proxies `/api` to the loopback Fastify server on port
3000; when using a custom API `PORT`, set the same value for **both** processes.
The proxy preserves API errors rather than returning the frontend HTML page, and
preserves the original Host/Origin headers for Fastify's existing validation.

Run `npm run test:browser` for real loopback browser tests
with temporary SQLite state, including desktop and 390px picker coverage. Chromium
must be available (system Chromium or `npx playwright install chromium`).

## Review and planning foundation (stage 2)

This is an underlying capability, **not the final UI or hosting decision**. The
local CLI/static report remains provisional. No web service, notifications,
scheduling, provider integration, or action execution is introduced.

```sh
# Import a structured human-observation packet against its source inventory.
uv run python -m subtitle_manager.review import \
  --inventory reports/SCAN/inventory.json --library my-library \
  --observations private/observations.json

# Combine those reviews with this or a newer saved inventory; never rescans media.
uv run python -m subtitle_manager.review plan \
  --inventory reports/SCAN/inventory.json --library my-library
```

Use the same explicit `--library` identifier for the same library over time.
Identical paths in another library must use a different identifier. Default
`--store private/reviews` is ignored local storage: immutable, owner-private JSON
records with atomic publication and idempotent import. Back it up privately;
Git does not preserve it. A custom store/output location is not automatically
ignored. Avoid pointing it at directories owned by other applications.

`plan` produces a new timestamped `reports/review-*/plan.json` and combined
`report.html`. It does not edit original inventory/report files or visit the
server. “Current” means matching the **saved inventory supplied**, not an assertion
that a live server has not changed since that scan.

- Reviews keep source notes, client, language, medium, rendering, timing, meaning,
  and sample scope separately. Missing exact tracks/timestamps stay unknown.
- Changed root/path, video size/mtime, audio/subtitle evidence, or associated
  sidecar evidence flags reviews as stale. Missing/failed observations on partial
  scans stay historical, not proof of deletion. Renames do not transfer reviews.
- These comparisons are not full content hashes. An undetected content change
  preserving all recorded metadata cannot be ruled out. Older inventories lack
  sidecar stat metadata: naming proposals are blocked, and the first enriched
  rescan may conservatively mark their reviews stale.
- Different client outcomes coexist; contradictory same-client results are
  flagged, not silently resolved by import order. This stage does not support
  superseding/deleting reviews or making formal acceptance decisions.
- Human-reported burned-in dialogue is not represented as a discovered stream.
- Label proposals require an explicitly selected sidecar path. Preserve format,
  forced/SDH flags; block known collisions. Every proposal still requires a live
  preflight and separate publication approval. No rename commands are emitted.
- Timing concerns never invent an offset. Playback success never establishes
  human Arabic authorship or full-dialogue completion.

Observation packet schema (synthetic example):

```json
{
  "schema_version": 1,
  "items": [{
    "path": "Movie.mkv",
    "observation": {
      "summary": "Arabic readable on TV; language label missing",
      "evidence_reference": "local note identifier, not fetched by the tool",
      "evidence_note": "User report; exact selected sidecar not confirmed.",
      "findings": [{
        "language": "ar",
        "client": "Android TV",
        "medium": "external",
        "rendering": "passed",
        "timing": "passed",
        "meaning": "unknown",
        "sample_scope": "middle and end; exact timestamps not recorded",
        "notes": "User identified Arabic; authorship unknown"
      }],
      "concerns": [{
        "kind": "language_label",
        "language": "ar",
        "detail": "Client shows undefined",
        "deferred": false
      }]
    }
  }]
}
```

Findings require `language` (`en`/`ar`), `medium` (`embedded`, `external`,
`burned_in`, `unknown`), explicit client/sample_scope/notes strings, and rendering,
timing, meaning outcomes (`passed`, `failed`, `issue`, `unknown`). An optional
`sidecar_path` asserts an explicitly confirmed external association; do not fill
it from a basename guess. Valid concern kinds: `language_label`, `timing`,
`client_playback`, `client_font`, `identity`, `overlay`, `encoding`. A concern's
language may be `null` when it applies to the file or multiple languages.
All other unknown fields are rejected. Evidence references are labels, not paths
the importer will open. There is no acceptance field.

See [the stage-2 scope and design](docs/stage-2-plan.md).

## Scope and limits (scanner)

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
`reviews.py` owns immutable review storage and pure planning; `review.py` is the
provisional offline CLI. Tests cover persistence, rescan safety, source immutability,
client-specific observations, blocked proposals, and offline report generation.
Scanner tests exercise the scan/report interface with synthetic metadata and include a
real, tiny FFmpeg-generated bilingual-tag fixture when FFmpeg is available.

See [the approved plan](docs/pilot-plan.md), [domain glossary](CONTEXT.md), and
[sanitized research](docs/research/subtitle-solution.md). Original private research
is retained only in ignored local notes.
