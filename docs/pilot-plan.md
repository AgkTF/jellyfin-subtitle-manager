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

## Next actions after resuming

1. Confirm the new working directory and review this plan and research.
2. Initialize Git with privacy-safe ignore rules and sanitized documentation.
3. Implement and test the read-only CLI/report stage using synthetic fixtures before a real library scan.
4. Run the approved read-only scan and present the report and proposed validation batch.

Implementation has not started. Detailed CLI flags, inventory schema, report layout, and testing structure remain engineering work within these boundaries; discuss any material scope change with the user.
