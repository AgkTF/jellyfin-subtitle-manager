# Subtitle solution: initial research and read-only inventory

## Executive recommendation

Evaluate a standalone, report-first workflow using existing acquisition and synchronization components before installing a full media-management stack. Shortlist OpenSubtitles.com and SubDL for acquisition, ffsubsync for initial timing repair, and alass as a comparison for discontinuities. Subliminal is a candidate acquisition library, not a complete acceptance/review system.

Bazarr is the strongest integrated option investigated, but requires Sonarr/Radarr's catalogues. Neither appeared in the server's running containers or matching system services. Its built-in match scores must not be represented as probabilities of correct synchronization or translation. [1–5]

Following this research, the user selected the standalone, report-first pilot using existing components. Implementation has not started. No tools were installed, provider credentials accessed, subtitle downloads performed, or media/configuration files modified on the server. Research files were written in this local project.

## Confirmed brief

- Existing-library cleanup, automatic processing of new arrivals, and on-demand retries.
- English first, Arabic required independently; playback is never blocked by incompleteness.
- Human-written Modern Standard Arabic preferred. No subtitle generation in v1.
- English standard dialogue preferred; SDH is an acceptable fallback. Forced-only tracks do not satisfy full-language requirements.
- Preserve existing subtitles and video files. Verified embedded subtitles count; existing tracks begin unverified.
- Strong evidence permits automatic acceptance; uncertain cases require review. Calibrate with 10–20 manually checked titles before unattended installation.
- Local timing analysis; no audio uploads. Modest paid-provider options remain possible, with no purchase authorized.
- One video at a time, low priority, heavier work overnight.
- Initial reports and Jellyfin playback rather than a new UI. Review queue and weekly summary; external delivery undecided.
- Backoff for missing-language retries, manual retry, and memory of rejected candidates.
- Timing must be checked throughout a video. Roughly half a second on sampled dialogue is a provisional viewing target, not an automated guarantee.

## Environment evidence (sanitized)

Read-only SSH inspection confirmed Python 3, FFmpeg/ffprobe, and a Docker-based
Jellyfin library. Other workloads share the server; spare processing capacity
and zero playback impact must not be assumed. No Bazarr, Sonarr, or Radarr
appeared in running containers or matching services, which does not rule out
stopped or manual installations. Jellyfin's version remains unverified.

Private filesystem counts, host/mount details, and concrete title examples are
retained only in ignored local research. Findings relevant to implementation:

- File counts are not title counts: extras, duplicates, alternate cuts, and
  unusual episode numbering require identity review.
- Sidecars occur beside videos, in subdirectories, and under different release
  names. Basename matching alone cannot establish missing subtitles.
- UTF-8 and undecodable text prefixes both occur. Arabic script is not proof
  of Arabic language; legacy encodings must remain unresolved.
- Embedded tracks include text, image, forced, SDH, and bilingual cases.
- Unlabelled and multiple-language audio tracks make blindly choosing the first
  audio stream unsafe.
- IDX/SUB pairs are not necessarily separate subtitle tracks.

No full embedded-track census, cue parsing, timing analysis, OCR, or playback
validation occurred during research.

## Tool assessment

### Bazarr: integrated option with additional catalogues

Bazarr's own README explicitly says it does not scan disks to discover movies/series and manages only items indexed by Sonarr/Radarr. It offers manual searches, history, upgrades, language requirements, multiple providers, and embedded-track handling. The setup guide documents adaptive searches and automatic synchronization. [1,2]

**Fit:** broad existing functionality and an established UI.

**Costs/gaps:** adding Sonarr and Radarr to this server; catalogue import and identity verification; ensuring independent English/Arabic requirements are not stopped by a language cutoff; preventing automatic replacement during calibration. Reviewed documentation does not establish our full verified/unverified state model, translation-quality verification, or evidence-based timing acceptance gate.

Do not install or import automatically. If selected, library import must not rename, move, delete, or initiate video downloads.

### Jellyfin OpenSubtitles plugin: simplest acquisition integration

The official plugin downloads subtitles from OpenSubtitles.com. [3]

**Fit:** low-complexity download option within the existing media server.

**Gap:** its README does not establish local synchronization, multi-provider coverage, or our acceptance/review workflow. It is a baseline, not a demonstrated complete solution.

### Subliminal: reusable acquisition component

Subliminal supplies a CLI and Python API. Its current source documentation lists OpenSubtitles.com and several other providers. Scoring compares video properties and subtitle properties; it is not a measurement of actual dialogue timing or translation correctness. SubDL is not in the upstream provider list reviewed, although Bazarr has its own SubDL adapter. Do not assume Bazarr's provider set is available through upstream Subliminal. [4,5,9]

The ReadTheDocs landing page contains outdated-looking Python-version text; pin and verify an actual released version rather than assuming all current-branch features are released. [4]

### ffsubsync: first synchronization candidate

Language-agnostic alignment uses speech/activity timing and can use a correctly synchronized subtitle in another language as its reference. A verified English subtitle could therefore help align an Arabic candidate locally. This is not translation checking. [6]

The current default-branch README also documents multi-segment sampling, low-quality skip controls, and experimental piecewise alignment. Those features must be checked against the version selected for the pilot. Piecewise alignment remains experimental; default-branch documentation is not a stable-release guarantee. Global alignment alone cannot repair offsets that change after an inserted/deleted scene. [6]

Do not convert the algorithm's correlation score into a probability. Optimizing a candidate and measuring its fit against the same activity signal is not independent validation.

### alass: comparison for irregular timing

Alass documents correction of constant offsets, framerate differences, and splits, and can align against video or another subtitle. [7]

Use it as a comparison on difficult cases, not as proof that every alternate cut is repairable. Author-reported accuracy and speed are not measurements on this library. Missing dialogue cannot be translated into existence by timing repair.

## Provider assessment

### OpenSubtitles.com

The official Jellyfin plugin establishes direct integration availability. Subliminal's current OpenSubtitles.com adapter supports Arabic, hash-associated searches, release/FPS information, forced/HI flags, and a `machine_translated` field; its normal listing path filters machine-marked candidates. [3,5]

**Promising evidence:** file-hash association plus content identity and release metadata.

**Caveats:** provider associations and metadata can be wrong; an unmarked candidate is not proof of human authorship. Arabic coverage for this library has not been tested. Official API docs were discovered but their JavaScript-rendered content could not be fetched; exact quotas, pricing, and application/account requirements remain to be verified before setup. No numeric OpenSubtitles quota is assumed. [10]

### SubDL

Official API docs describe title/file-name/IMDb/TMDB searches, language filters, release lists, comments, hearing-impaired flags, FPS data, and episode/season-pack results. A personal API key is required. They currently advertise 2,000 free API requests/day and a separate anonymous download limit; account status is available through `/api/v1/me`. Verify live limits rather than hardcoding these figures. [8]

Bazarr has a dedicated SubDL provider; its source marks hash verification unavailable. Treat release-name matching as weaker evidence than an exact-file association. [9]

SubDL also offers AI translation, which is outside our v1 scope. The reviewed search schema does **not establish a dependable human-authored-only filter**. Unknown provenance must not silently become verified human translation. Language support and a large catalogue do not demonstrate acceptable Arabic coverage on these files.

**Recommendation:** test OpenSubtitles.com and SubDL together before paying for either. Compare accepted Arabic coverage, not just search-result counts. No library titles were submitted to provider APIs during this research.

## Suggested pilot (not yet executed)

1. Build a read-only inventory/report of video identity, sidecar associations, embedded subtitle streams, language/type tags, and ambiguities. Keep media-file identity distinct from movie/episode identity.
2. Select 10–20 titles across movies, series, anime, old encodings, image subtitles, alternate cuts, embedded bilingual tracks, and known troublesome cases.
3. Review existing tracks first. Explicitly resolve ambiguous episode identity and the intended audio track.
4. After credentials and download permission are arranged, acquire candidates into staging outside Jellyfin's media tree. Preserve provenance, raw files, provider IDs, hashes, and rejection history. Apply archive/path/size limits and accept only subtitle content.
5. Compare original timings, ffsubsync outputs, and alass outputs on suitable difficult cases. Save derivatives separately; no in-place correction.
6. Inspect dialogue near the beginning, middle, end, and suspected discontinuities. Include deliberately shifted/drifting copies of known-good subtitles as test controls, clearly labelled as synthetic tests.
7. Record identity, language, provenance, full-dialogue coverage, timing evidence, human assessment, and processing cost separately. Unknown remains unknown.
8. Only after validation, propose acceptance rules and reversible publication with Jellyfin-compatible language/SDH naming. Jellyfin documents external subtitle suffixes and flags. [11]

A 10–20-title pilot establishes feasibility, not reliable false-acceptance statistics. Start unattended acceptance narrowly and keep auditing results.

## Decisions settled after research

- Use a standalone, report-first pilot with existing acquisition and synchronization components rather than adding Sonarr/Radarr/Bazarr.
- Image-based tracks can satisfy a language requirement after timing and playback verification in the user's Jellyfin clients. Prefer text for new downloads; defer OCR.
- Unknown authorship may enter review but must not be automatically treated as verified human translation.

## Decisions still needed

- The read-only inventory/report pilot is approved; see `../pilot-plan.md`.
- Deployment, overnight window/timezone, summary delivery, credential provisioning, and staging/publication approval remain for later phases.

## Sources

Default-branch sources below describe the fetched code/docs, not necessarily a published release. Provider availability and quotas are subject to change.

1. Bazarr README: https://github.com/morpheus65535/bazarr/blob/master/README.md
2. Bazarr setup guide: https://wiki.bazarr.media/Getting-Started/Setup-Guide/
3. Official Jellyfin OpenSubtitles plugin: https://github.com/jellyfin/jellyfin-plugin-opensubtitles/blob/master/README.md
4. Subliminal docs and current scoring/provider documentation: https://subliminal.readthedocs.io/en/latest/ and https://github.com/Diaoul/subliminal/blob/main/docs/user/how_it_works.rst
5. Subliminal OpenSubtitles.com adapter: https://github.com/Diaoul/subliminal/blob/main/src/subliminal/providers/opensubtitlescom.py
6. ffsubsync README, algorithm and limitations: https://github.com/smacke/ffsubsync/blob/master/README.md
7. alass README: https://github.com/kaegi/alass/blob/master/README.md
8. SubDL official search/download API: https://subdl.com/api-doc
9. Bazarr SubDL adapter: https://github.com/morpheus65535/bazarr/blob/master/custom_libs/subliminal_patch/providers/subdl.py
10. OpenSubtitles official API getting-started page (content fetch blocked by JS rendering): https://opensubtitles.stoplight.io/docs/opensubtitles-api/e3750fd63a100-getting-started
11. Jellyfin external subtitle naming: https://jellyfin.org/docs/general/server/media/movies/#external-subtitles-and-audio-tracks
