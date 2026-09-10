# Read-only subtitle inventory pilot

## Approved direction

Project name: `jellyfin-subtitle-manager`.

Build a standalone command-line tool in Python, managed with uv. Reuse existing subtitle components in later phases rather than adding Sonarr/Radarr/Bazarr. Domain terminology is in `../CONTEXT.md`; research and the broader approved brief are in `research/subtitle-solution.md`.

## First-stage behavior

- Run the CLI on the user's current machine.
- Use SSH to execute a standard-library-only Python scanner on the configured media host, using its existing ffprobe for metadata.
- Read media under the configured media root without modifying it.
- Return structured metadata to the local machine; do not copy whole videos.
- Catalogue external and embedded subtitle tracks and flag ambiguous language, identity, encoding, and subtitle representation.
- Produce a terminal summary, local JSON inventory, and static HTML report. No web server, frontend framework, database server, or video previews in this stage.
- Distinguish track presence from acceptance. Inventory does not verify synchronization, translation quality, or human authorship.
- Propose a varied 10–20-title validation batch for review with the user.

## Boundaries

No server installs, persistent services, media modifications, provider searches/downloads, synchronization, OCR, or generation in this first stage. Actual SSH/library checks remain read-only; run metadata probes sequentially and conservatively. Provider credentials and publication permissions belong to later phases.

Verified image-based subtitles can satisfy a language requirement when timing and playback work in the user's clients. Prefer text for new downloads. Unknown-provenance Arabic candidates may enter review but must not be automatically represented as human-written.

## Git and privacy

After the directory/session transition, initialize Git before code implementation. Establish ignore rules before staging. The intended first commit contains approved documentation, not generated inventories, HTML reports, credentials, or downloaded subtitles. No remote or push is authorized.

The existing research document contains private library examples and server paths. Before the first commit, move identifying inventory details into an ignored local report or otherwise sanitize tracked research; ignoring future generated reports alone does not remove those existing details.

## Session transition

The directory rename and fresh-session transition are complete. Private host and
media-root settings are retained in ignored local notes, not tracked defaults.

## Implementation status

- Directory transition completed; Git initialized with sanitized documentation and
  privacy-safe ignore rules. Original research is retained in ignored local notes.
- The Python/uv CLI, standalone SSH scanner, JSON inventory, static HTML report,
  and metadata-varied proposed validation batch are implemented.
- Synthetic tests include real FFmpeg media, invalid media, standalone execution,
  association ambiguity, image subtitles, legacy encoding, and error handling.
- See `../README.md` for commands, output locations, and known limitations.
- Actual scan evidence and review batches belong in ignored `reports/`, not Git.

Ten titles have now been reviewed with the user. Private observations and the
consolidated findings are retained in ignored local storage. Do not repeat those
checks just because the original inventory contains only metadata.

The approved stage-2 review/planning foundation is implemented; see
`stage-2-plan.md` and `../README.md`. It imports persistent human observations,
checks applicability against saved scans, and emits dry-run plans in a new report.
The initial ten reviews have been imported without changing the scan evidence.

The CLI/static report remains provisional. Final UI, platform/hosting, interaction,
scheduling, and notifications are deliberately undecided and must be discussed
before user-facing workflows or deployment. Python vs a larger TypeScript
application is also deferred.

Next: inspect the combined plan and scope any real label or timing correction
separately. Provider setup, downloads, synchronization, and publication remain
later work requiring their own approval. Discuss material scope changes.
