# First subtitle provider selection

_Research date: 2026-09-21. No provider request, credential use, title disclosure, or subtitle download was performed._

## Decision

Select **OpenSubtitles.com REST API v1**, specifically the published OpenAPI **1.0.1** interface at `https://api.opensubtitles.com/api/v1`, for the first bounded candidate-preparation adapter. This confirms, rather than merely repeats, the provisional preference in [`next-milestone-technical-options.md`](next-milestone-technical-options.md). The decisive facts are its explicit file-hash search and candidate-level forced, hearing-impaired, machine/AI-translation, release, uploader, and trust metadata, plus delivery of one UTF-8 subtitle file rather than an archive. Those properties reduce ambiguity and attack surface for an SRT-first implementation. [OS1]

This selection does **not** establish Arabic coverage, synchronization, completeness, or human authorship. Provider flags are claims to preserve as provenance, not acceptance evidence.

## Target contract: documented facts

### Access and authentication

- Every relevant v1 operation uses an application `Api-Key`; the schema defines it as the key obtained from the application developer's OpenSubtitles.com profile. A user token is obtained with `POST /login` using an OpenSubtitles.com username/password. The login response supplies a JWT and a `base_url` of either `api.opensubtitles.com` or `vip-api.opensubtitles.com`; subsequent calls must use that host. `POST /download` requires both `Api-Key` and Bearer authorization. A versioned application `User-Agent` is also documented. [OS1][OS2]
- Therefore setup requires an OpenSubtitles.com account, a registered application/API key, and user credentials (or a securely persisted token). Credential provisioning and a real login remain later approval gates.
- Login is limited to 1 request/second, 10/minute, and 30/hour; the documentation says to stop retrying the same credentials after `401`. [OS2]

### Search

`GET /subtitles` supports precise identity by `imdb_id`/`tmdb_id`, TV parent ID plus season/episode, a 16-character OpenSubtitles `moviehash`, or filename/text `query`. It accepts comma-separated `languages`, `hearing_impaired` (`include|exclude|only`), `foreign_parts_only` (the forced/foreign-parts signal: `exclude|include|only`), `machine_translated`, `ai_translated`, `trusted_sources`, `moviehash_match`, ordering, and `page`. The response supplies `total_pages`, `total_count`, `per_page`, and `page`. Search documentation explicitly says HTTP redirects must be followed. [OS1][OS3]

For each subtitle it supplies provider/subtitle IDs, language, download counts, HI, FPS, trust, foreign-parts-only, upload date, AI- and machine-translated flags, release/comments, uploader identity/rank, title/episode identifiers, and one or more `files` with `file_id`, disc number, and filename. [OS1]

The published language table identifies English as `en` and Arabic as `ar`. [OS4]

**Inference for implementation:** prefer a known IMDb/TMDB identity and include the movie hash when available; do not label a result “hash matched,” “human-written,” or “synchronized” because the response schema has no match-reason or verified-human field. `from_trusted` and uploader rank are provenance only. A false machine/AI flag is not proof of human authorship.

### Download and payload

For a selected `files[].file_id`, `POST /download` returns `link`, `file_name`, quota counters (`requests`, `remaining`) and reset information. Creating this link consumes the download count; fetching it does not. The link lasts at most three hours and may be fetched more than once. The documented example points to `https://www.opensubtitles.com/download/.../subfile/...srt`; the API states that the linked subtitle is always UTF-8. [OS1][OS5]

Request `sub_format: "srt"` and initially accept **only a single unarchived SRT payload**. The API's recognized conversion outputs include `srt`, `sub`, `mpl`, `webvtt`, `dfxp`, and `txt`, but only SRT is proposed for Slice 2. Do not request FPS conversion, timeshift, or a synthetic filename. [OS5][OS6]

**Inference for implementation:** this endpoint avoids archive extraction, but the returned URL and response bytes remain untrusted. Preserve original delivered bytes and metadata, require a text/SRT validation pass, and reject redirects or final origins not frozen by the limits ticket.

### Errors and quotas

The provider publishes a common error-code page, while the OpenAPI operation schemas mostly specify only successful responses. Implement by HTTP status plus parsed provider error body; at minimum keep authentication, quota/rate-limit, no-candidate, malformed response, redirect, and transport outcomes distinct. Do not infer “no candidates” from an error. [OS1][OS7]

No universal numeric daily download allowance is frozen here. The contract makes entitlement account-specific: login returns `allowed_downloads`, and every successful `/download` response reports used/remaining downloads and reset time. These are **API download entitlements**, not website download limits. Search/API request-rate limits and generated-file-host limits are separate dimensions and must not be conflated. [OS1][OS2][OS5]

## Limits the next ticket must freeze

1. Search pages and candidates inspected; stop at documented `total_pages` and reject inconsistent pagination.
2. API requests per run, login reuse/expiry policy, and pacing below response rate-limit headers; no automatic retry after auth or quota failure.
3. At most three `/download` link requests/payload attempts, counted conservatively even for duplicate, invalid, or failed payloads.
4. Connect, response-header, idle, and total timeouts for API and payload hosts independently.
5. Redirect count and scheme; exact allowlisted API hosts and generated-download final hosts. The docs require search redirects and show, but do not normatively guarantee, the payload host.
6. Maximum JSON bytes, candidate/file-array counts, payload bytes, decoded characters/cues, line length, and duration bounds.
7. Content-Type/content-disposition handling, UTF-8 policy (including BOM/error behavior), SRT structural validation, and explicit rejection of archives, links, nested containers, and every non-SRT format.
8. Retry matrix for transient HTTP/transport failures, honoring provider reset/rate-limit information and never spending more than the run budget.

## Unresolved blockers before enabling real traffic

These do not block fixture-based adapter work, but they block a real provider trial:

- Create/approve an application and inspect the account's actual plan/entitlement. The public contract does not provide one numeric allowance valid for every account; numeric examples are not promises. Capture `allowed_downloads` and `/download` reset fields at the separately approved trial.
- Confirm token lifetime/refresh behavior; it is not specified in the reviewed v1 schema.
- Capture synthetic-contract fixtures for non-200 bodies. The common error page exists, but endpoint schemas do not freeze each error body.
- Determine the exact generated-link origin set and redirect behavior from provider confirmation or the separately approved bounded trial before allowlisting traffic. Do not allow arbitrary hosts based on a returned URL.
- The documented `sub_format` list establishes conversion output, not that every source can be converted successfully. Treat conversion failure as a bounded candidate failure.

## Fallback comparison: SubDL

SubDL's official v1 interface is implementable in principle: `GET https://api.subdl.com/api/v1/subtitles` requires an account API key and supports title/filename/SubDL/IMDb/TMDB identity, season/episode, language, release, comments, HI, FPS, full-season packs, and optional unpacked-file metadata. It documents `subs_per_page` default 10/max 30, free API keys at 2,000 requests/day, authenticated paid download quotas, and a separate anonymous website/download-host limit of 300 downloads/day/IP. Downloads are either ZIPs from `dl.subdl.com` or raw unpacked pack members. [SD1]

OpenSubtitles wins the first slot because SubDL's documented search contract has no file hash, forced-only flag, machine/AI-authorship field, uploader/trust provenance, or documented page-number/cursor despite `subs_per_page`; its linked supported-language JSON currently resolves to a first-party 404. SubDL examples use uppercase `EN`, and first-party catalogue pages visibly label Arabic as `AR`, but the broken canonical language-list artifact prevents treating the full code table as a stable machine-readable contract. [SD1][SD2][SD3]

This **supersedes** the stale statement in [`subtitle-solution.md`](subtitle-solution.md) that SubDL's API offered “unpacked-file downloads” without qualification: the current docs limit raw-file URLs to members returned with `unpack=1`; ordinary results still use ZIP downloads. It also supersedes the suggestion to test both providers first: Slice 2 should implement OpenSubtitles alone, and any coverage test remains a separately approved trial.

## Primary sources

- **[OS1]** OpenSubtitles official OpenAPI 3.0.3 document, API version 1.0.1: https://stoplight.io/api/v1/projects/opensubtitles/opensubtitles-api/nodes/open_api.json
- **[OS2]** OpenSubtitles login: https://opensubtitles.stoplight.io/docs/opensubtitles-api/73acf79accc0a-login
- **[OS3]** OpenSubtitles subtitle search: https://opensubtitles.stoplight.io/docs/opensubtitles-api/a172317bd5ccc-search-for-subtitles
- **[OS4]** OpenSubtitles languages: https://opensubtitles.stoplight.io/docs/opensubtitles-api/1de776d20e873-languages
- **[OS5]** OpenSubtitles download: https://opensubtitles.stoplight.io/docs/opensubtitles-api/6be7f6ae2d918-download
- **[OS6]** OpenSubtitles formats: https://opensubtitles.stoplight.io/docs/opensubtitles-api/69b286fc7506e-subtitle-formats
- **[OS7]** OpenSubtitles error codes: https://opensubtitles.stoplight.io/docs/opensubtitles-api/12f131ce12132-error-codes
- **[SD1]** SubDL official API documentation: https://subdl.com/api-doc
- **[SD2]** SubDL's documented language-list URL (currently first-party 404): https://subdl.com/api-files/language_list.json
- **[SD3]** SubDL first-party Arabic catalogue page showing `AR`: https://subdl.com/subtitle/sd12684428/send-help/arabic
