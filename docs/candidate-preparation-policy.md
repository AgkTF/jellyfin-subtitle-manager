# OpenSubtitles candidate-preparation policy

Status: frozen policy for Slice 2 fixture-based implementation. This document does **not** enable provider traffic, provision credentials, disclose library titles, download subtitles, authorize a live trial, publish content, or write to a media library.

This policy consumes the documented facts and inferences in [`research/first-provider-selection.md`](research/first-provider-selection.md). OpenSubtitles.com REST API v1 (published interface 1.0.1) is the sole initial provider. Values below are application safety caps, not claims about provider quotas, coverage, synchronization, completeness, or authorship.

## Supported input and output

| Dimension | Frozen policy |
| --- | --- |
| Requested language | Exactly `en` or `ar`, copied from the durable subtitle request; never a browser-supplied provider value. |
| Search identity | A server-owned `OpenSubtitlesSearchIdentity` bound to the selected saved video, as defined below. Title, release, filename, free-text `query`, arbitrary parameters, and browser-supplied provider IDs are forbidden. |
| Search filters | The requested language; `foreign_parts_only=exclude`; machine- and AI-translated results excluded. Standard dialogue subtitle candidates are preferred; a provider hearing-impaired claim makes a result an SDH subtitle candidate but remains provenance, not proof. No browser-selectable provider filters. |
| Download request | One documented `files[].file_id`; request `sub_format: "srt"`. Do not request FPS conversion, time shift, or filename rewriting. |
| Subtitle format | One unarchived UTF-8 SRT file. Preserve the delivered entity bytes before parsing. A suffix, media type, or provider assertion alone does not establish the format. |
| Archive formats | None. ZIP, gzip files, tar, RAR, 7z, and every other container are unsupported. HTTP content-coding is transport decoding, not an accepted archive. |
| Other subtitle formats | Reject ASS/SSA, WebVTT, MicroDVD/SUB, MPL, DFXP/TTML, TXT, image subtitles, and unknown formats. This capability limit says nothing about whether such subtitles are usable elsewhere. |

The initial archive limits are concrete zeroes: **0 archive entries, path depth 0, and nesting depth 0**. Reject a container by signature or parsed content even when it is named `.srt` or labelled `text/plain`. Because no filesystem entry is accepted from a container, traversal names, absolute paths, drive-prefixed paths, NULs, hard links, symbolic links, devices, and other special entries are rejected rather than normalized.

## Saved identity gate

The current saved-inventory contract is not sufficient for OpenSubtitles search. `SavedVideoIdentity` retains a title and release label, while `SavedVideoSelection` exposes only `libraryId`, `id`, and `label`; none is a verified IMDb/TMDB identity or OpenSubtitles movie hash. Those strings **must not** be converted into a provider text query. Preparation remains `blocked` and performs no provider call until selected-file inspection has added and durably bound the following server-side evidence to the exact saved video and request:

```ts
type ProviderTitleIdentity =
  | { kind: "movie-imdb"; imdbId: string }
  | { kind: "movie-tmdb"; tmdbId: number }
  | { kind: "episode-imdb"; parentImdbId: string; season: number; episode: number }
  | { kind: "episode-tmdb"; parentTmdbId: number; season: number; episode: number };

interface OpenSubtitlesMovieHashEvidence {
  algorithm: "opensubtitles-moviehash-v1";
  value: string;
  sourceByteLength: number;
  selectedFileEvidenceHash: string;
}

interface OpenSubtitlesSearchIdentity {
  provider: "opensubtitles-v1";
  libraryId: string;
  videoId: string;
  savedIdentityId: string;
  selectedFileEvidenceHash: string;
  title: ProviderTitleIdentity;
  movieHash?: OpenSubtitlesMovieHashEvidence;
}
```

An IMDb ID is canonical decimal digits without a `tt` prefix and represents an integer from 1 through 999,999,999. A TMDB ID is an integer from 1 through 2,147,483,647. Season is an integer from 0 through 999 and episode from 0 through 9,999. The movie-hash value is exactly 16 lowercase hexadecimal characters, its byte length is a positive safe integer, and its file-evidence hash is exactly 64 lowercase hexadecimal characters. The outer file-evidence hash has the same form and must equal the hash on the current selected-file inspection. Values outside these shapes block preparation rather than falling back to title search.

Exactly one title-identity variant supplies the provider's IMDb/TMDB fields. An episode variant supplies its parent ID plus season and episode. A valid movie hash may be included as additional match evidence; `moviehash_match` remains a provider claim, not independent identity or synchronization proof. The backend inventory/inspection adapter creates this object. Browser callers continue to send only the existing opaque saved-video/identity selection, requested language, and explicit preparation command; they cannot submit or override this object.

This evidence addition is an implementation prerequisite for #39, not authority in this policy to inspect a real library. Synthetic fixtures may provide typed synthetic evidence at the same adapter seam.

## Exact search construction and ordering

Each search operation is `GET /api/v1/subtitles` on the active API origin. The backend emits only these query parameters, in ASCII name order:

- `ai_translated=exclude`, `foreign_parts_only=exclude`, `hearing_impaired=include`, `machine_translated=exclude`;
- `languages=en` or `languages=ar` from the request;
- `moviehash=<value>` and `moviehash_match=include` only when current hash evidence exists;
- `page=1`, then 2 and 3 only as budgets and pagination permit;
- `type=movie` plus exactly one of `imdb_id` or `tmdb_id` for a movie identity; or
- `type=episode`, `season_number`, `episode_number`, plus exactly one of `parent_imdb_id` or `parent_tmdb_id` for an episode identity.

Do not emit `query`, `year`, `order_by`, `order_direction`, `trusted_sources`, or any undocumented parameter. The released contract exposes no page-size request parameter. Accept response `per_page` only as an integer from 1 through 100; require it to stay constant, require each `data` array length not to exceed it, and independently enforce the 100-result run cap.

Collect bounded eligible records from all permitted pages before selecting payloads. Reject a record whose language or forced/machine/AI flags contradict the request filters, whose required IDs/flags/files are malformed, or whose files exceed the per-result cap. Sort eligible files deterministically by: provider-reported `moviehash_match=true` first when a hash was submitted; standard dialogue subtitle before SDH subtitle; `from_trusted=true` first; numeric `download_count` descending; numeric provider subtitle ID ascending; numeric `file_id` ascending. Missing or invalid sort fields make a record ineligible. This ordering controls attempt selection but does not establish identity, quality, synchronization, completeness, or authorship.

## Run budgets

A run is one explicitly initiated candidate-preparation operation for one particular saved video and one requested language. A restart or resumed operation does not replenish a durably reserved payload-attempt budget.

| Limit | Maximum | Rationale |
| --- | ---: | --- |
| Login calls | 1 | The provider documents strict login pacing and says not to retry a `401`. Prefer a valid backend-held token; never log in merely to retry a failed call. |
| Search/listing calls | 3 | At most pages 1–3, sequentially. This bounds identity disclosure and work while permitting pagination. |
| Search results inspected | 100 total | Bounds adversarial or inconsistent result arrays independently of page count. |
| File records inspected | 4 per result, 200 total | A result with more than four files is ineligible rather than partially interpreted; stop when the total cap is reached. |
| Candidate payload attempts | 3 | The Slice 2 hard cap, separate from search/listing calls. |
| Provider API operations | 7 | At most 1 login + 3 search + 3 download-link operations. A redirect is not a new logical operation. |
| Provider API HTTP requests | 10 | The seven initial requests plus at most one redirect hop for each search. |
| Payload-fetch HTTP requests | 9 | At most 3 requests per reserved attempt: the initial request plus 2 redirect hops. |
| All outbound HTTP requests | 19 | Combined API and payload-fetch ceiling, including redirect hops. |
| Validated candidates staged | 3 files and 12 MiB per run | At most one 4 MiB decoded entity per spent attempt. Failed, partial, and duplicate content is not retained as a candidate. |

Stop pagination when the requested page reaches documented `total_pages`, a page yields no results, or any lower cap is reached. Page numbers start at 1 and advance by one. Reject missing/non-integer pagination, changing totals, a response page different from the requested page, repeated page content, or `total_pages` below the current page. A valid total above three is not malformed: inspect pages 1–3 and stop. Reaching a cap is bounded search completion, not a transport failure.

There are **zero automatic retries**: not for login, search, download-link creation, payload fetch, timeout, connection failure, `429`, or `5xx`. Provider reset/rate-limit fields may be recorded for an operator-facing outcome but never schedule hidden work. A new run requires explicit user action and retains prior operation history.

## Conservative payload-attempt accounting

Reserve one of the three attempts durably **before** sending `POST /download`. Once reserved, it is spent even if:

- the request times out, disconnects, receives an error, or returns a malformed response;
- authentication or quota failure stops the run;
- the returned link, redirect, headers, coding, or bytes are unsafe or unsupported;
- fetching, decoding, SRT validation, hashing, or private staging fails;
- the provider file ID, delivered-byte hash, or staged content duplicates an earlier candidate; or
- the process exits after reservation and cannot prove no external request was made.

Filtering a search result before reservation does not spend an attempt. Search/listing calls never spend payload attempts. A provider file ID may be reserved only once per run; seeing it again is a duplicate result, not permission for another `/download`. Duplicate bytes discovered after retrieval consume the attempt. Three reservations produce `payload-budget-exhausted`; no fourth request is made.

## Network boundaries and origin approval

Only HTTPS on the default port is allowed. Reject userinfo, IP literals, non-empty fragments, alternate ports, invalid/ambiguous encodings, and hostnames that are not an exact lowercase ASCII match after URL parsing. Validate every redirect independently. API keys, bearer tokens, cookies, and provider credentials are never sent to a payload origin.

### API origins and redirects

- API requests use only `https://api.opensubtitles.com` or `https://vip-api.opensubtitles.com`. A login `base_url` must normalize to exactly one of them and becomes the active origin for that token; it may not supply a path, query, fragment, credentials, or port.
- Search may follow **1 redirect** only when it stays on the active API origin and preserves GET semantics. Login and download-link creation allow **0 redirects**. A redirect to the other API origin is rejected rather than forwarding credentials.
- Payload fetches permit **2 redirects**. The initial URL and every resolved redirect must remain in the pre-approved payload-origin set. API-to-payload and payload-to-API redirects, HTTPS-to-HTTP redirects, and credential forwarding are rejected.

### Separately approved payload origins

The production payload-origin allowlist defaults to empty. A URL returned by `/download`, its hostname, DNS ownership, a suffix such as `opensubtitles.com`, or a successful fixture is never self-authorizing.

An exact payload origin can be added only through a reviewed backend configuration change completed **before** any request to that origin. The review record must contain the exact normalized HTTPS origin, its payload-only purpose, evidence from a provider-controlled publication or direct provider confirmation that the origin serves generated v1 download payloads, reviewer identity, and approval time. Wildcards, registrable domains, DNS suffixes, IP ranges, and browser/runtime additions are forbidden.

If published evidence is unavailable, a separately authorized **discovery-only trial** may obtain one `/download` response but must not fetch its link. The observed origin is merely a proposal and must additionally receive direct provider confirmation and human configuration approval. The generated URL is not persisted. A later explicit run may fetch only after the approved origin is already loaded at process start. Thus neither the returned hostname nor the run that returned it can approve its own fetch. This policy does not authorize that discovery trial.

Fixture transports use a distinct injected synthetic-origin set that cannot be loaded by production transport. The application may start with real access disabled, absent credentials, or an empty approved-origin set, but every real preparation operation then returns `blocked` before constructing a request or opening a socket. Invalid origin-approval configuration is rejected when production transport is configured, never ignored or populated at runtime.

## Time limits

All deadlines use monotonic elapsed time and include redirects. DNS/TCP/TLS establishment is connect time; header time runs until complete headers; read-idle time is the maximum gap between body chunks. The shortest applicable deadline wins.

| Operation | Connect | Response headers | Read idle | Per-call overall |
| --- | ---: | ---: | ---: | ---: |
| Login/search/download-link API call | 3 s | 7 s | 5 s | 15 s |
| Payload fetch | 5 s | 10 s | 10 s | 30 s |
| Whole run | — | — | — | 90 s |

Queueing and provider-directed waiting count against the 90-second run deadline. The application does not sleep through a rate limit and resume later.

## Byte, decoding, content, and structure limits

Enforce limits while streaming and abort immediately when exceeded. Reject conflicting, invalid, or excessive `Content-Length` before reading while still enforcing streamed limits when it is absent or false.

| Data | Maximum |
| --- | ---: |
| Response header section | 16 KiB (16,384 bytes), 64 fields, 8 KiB for any one field name plus value; no trailers |
| Parsed redirect target | 2,048 ASCII characters |
| API JSON body after HTTP content decoding | 2 MiB (2,097,152 bytes) per call |
| Payload transfer body before HTTP content decoding | 1 MiB (1,048,576 bytes) |
| Payload entity after HTTP content decoding | 4 MiB (4,194,304 bytes) |
| Unicode scalar values after UTF-8 decoding | 2,000,000 |
| SRT cues | 20,000 |
| Physical line, excluding line ending | 16 KiB decoded UTF-8 bytes |
| Cue text lines | 20 per cue |
| Cue text | 8 KiB decoded UTF-8 bytes per cue |
| Timestamp | `00:00:00,000` through `47:59:59,999` |

Accept only identity or gzip HTTP content-coding, with at most one coding layer. A gzip response must contain exactly one valid member and no trailing data. Reject deflate, Brotli, stacked codings, invalid streams, additional/trailing members, and decoded output over the independent 4 MiB entity cap. Decoded gzip data must itself be SRT, never an archive member.

API success requires `application/json` or `application/*+json` and exactly one JSON value of the expected typed shape. Error bodies are bounded and redacted; they are never interpreted as success. Payload success permits `text/plain`, `application/x-subrip`, or absent `Content-Type`; reject every other type and multipart response. `Content-Disposition` is advisory: parse it within header limits, reject controls, and never use its filename as a path.

Accept UTF-8 with one optional leading BOM. Reject decoding errors, NUL, C0 controls other than tab/CR/LF, a BOM elsewhere, and non-UTF-8 fallback. Normalize line endings only in the parsed representation. The preserved and hashed original is the post-HTTP-decoding entity, before UTF-8/BOM/line-ending normalization.

An SRT has at least one cue; monotonically increasing decimal cue numbers; `HH:MM:SS,mmm --> HH:MM:SS,mmm` timing; start strictly before end; nondecreasing cue start times; at least one non-whitespace text scalar per cue; and no non-whitespace material outside cues. Overlap is permitted because structure is not synchronization. Timing and completeness remain unmeasured.

## Private staging limits

Staging is backend-owned and outside the database and media tree. A run may retain at most three validated files and 12 MiB total; each file is the exact validated entity of at most 4 MiB. Use an application-generated opaque name beneath one configured private root, exclusive creation, regular files only, mode `0600`, and no provider/browser filename or path component. The private root itself must not be a link and must be opened through a no-follow, root-confined filesystem interface.

Only one temporary file may exist for the active attempt. Partial, invalid, duplicate, over-limit, or failed content is deleted or quarantined only under its operation-owned identity and never becomes a candidate. A staged file is committed only after stream limits, decoding, archive/type sniffing, UTF-8/SRT validation, and SHA-256 hashing all succeed. Staging performs **0 media-library writes**, **0 publication operations**, and **0 overwrites**.

## Terminal outcomes

Every external call is attempted once and has one terminal result. Preserve safe status/request/reset metadata where available, but never credentials, generated links, or raw unsafe bodies.

| Outcome | Handling |
| --- | --- |
| `blocked` | Missing/stale saved identity evidence, disabled real access, absent credentials, or absent origin approval performs no external call. |
| `no-candidates` | Bounded search found no eligible candidate. Spend no payload attempt; do not infer this from an error. |
| `authentication-failed` | Any authentication rejection, invalid credential/token response, or unapproved API base origin stops the entire run immediately. No retry, refresh, fallback host, or next candidate. |
| `quota-exhausted` | A quota/rate-limit response or valid response showing no remaining API download entitlement stops the run immediately. No wait, retry, or next candidate; website limits are irrelevant. |
| `transport-failed` | DNS/connect/TLS/socket/framing failure stops login/search. During a reserved attempt it fails that candidate and may advance to an already-listed candidate within all remaining budgets. Never retry the call. |
| `timed-out` | Separate from other transport failures; stops login/search, or consumes the reserved candidate attempt and may advance within bounds. |
| `malformed-provider-response` | Wrong status semantics, type, JSON, pagination, fields, URL, or quota data; stops login/search, or consumes a reserved attempt and may advance. No guessed defaults. |
| `unsafe-content` | Origin/redirect/credential violation stops the run after consuming any reservation. Excessive or unsupported headers, body, coding, container, UTF-8/SRT, links/traversal, or staging consumes the reservation and may advance after owned cleanup. |
| `provider-failed` | Other provider HTTP failure stops login/search, or consumes a reserved attempt and may advance. `5xx` is not retried. |
| `duplicate-candidate` | Duplicate provider file ID before reservation is skipped. Duplicate identity/bytes after reservation consumes the attempt and does not stage another candidate. |
| `payload-budget-exhausted` | Three attempts are reserved, including failures and duplicates. Stop payload work. |
| `run-deadline-exhausted` | The 90-second deadline stops all work with no background continuation. |

Candidate-local continuation uses only candidates already returned by bounded search. Authentication and quota always terminate the run. No outcome authorizes publication or a media-library write.

## Configuration ownership and safe defaults

The backend candidate-preparation module owns hard caps, accepted formats, API origins, redirect rules, outcome mapping, and durable attempt accounting. Deployment configuration may tighten numeric caps but never raise them. The reviewed exact payload-origin records are backend-only deployment configuration. Browser requests cannot provide identity fields, queries, URLs, hosts, paths, credentials, limits, formats, headers, origins, or retry policy.

Backend-only secret configuration owns the API key and approved user credentials or token. Secrets never appear in URLs, browser payloads, persisted provenance, exceptions, metrics, or logs. The versioned `User-Agent` is non-secret backend configuration. Since token lifetime is undocumented, token rejection is terminal; there is no automatic login/refresh fallback.

Real provider access has a separate boolean gate defaulting to disabled. Enabling it still fails closed without valid credentials, typed current identity evidence, and at least one valid origin approval. Fixture mode and production mode are disjoint process configurations; fixture origins and credentials are rejected by production startup.

Persist only bounded, redacted evidence: selected API origin; provider/subtitle/file IDs; request language and typed identity evidence; provider metadata; attempt number; status/outcome; valid quota/reset counters; byte counts; original-entity SHA-256; and owned staged-file identity. Never persist generated download links.

## Required implementation tests

Synthetic HTTP/filesystem tests must prove at least:

1. valid preparation requires the typed saved identity; stale/missing evidence blocks without title query or network access, and browser input cannot supply provider fields or URLs;
2. exact movie/episode parameter mapping, forbidden parameters, pagination validation, eligibility, and every deterministic ordering tie-breaker produce the same candidates regardless of provider result order;
3. three search operations are distinct from three payload attempts; request ceilings are 10 API, 9 payload, and 19 total including redirects;
4. an attempt is reserved before `/download` and remains spent after timeout, crash recovery, malformed link, unsafe bytes, staging failure, and duplicate hash;
5. authentication and quota stop immediately without retry or another candidate;
6. pagination, arrays, headers/fields, redirects, JSON, coding, transfer/entity bytes, Unicode, lines, cues, cue text, timestamps, staging files, and staged bytes pass at each exact maximum and fail one unit above it;
7. connect, header, idle, per-call, and run deadlines stop work without background continuation;
8. API and payload origin/redirect policies are independent, credentials never cross origins, an empty allowlist fetches nothing, and a returned hostname cannot mutate or satisfy approval;
9. gzip and decoded limits are independent, including high expansion, stacked coding, invalid streams, extra members, and trailing data; deflate and Brotli are rejected;
10. archive signatures, traversal names, absolute paths, links, nested containers, unsupported formats/types, invalid UTF-8, and malformed/excessive SRT are rejected;
11. only validated original entity bytes are privately staged under generated ownership, restart preserves their identity, and every outcome performs zero publication and media-library writes.
