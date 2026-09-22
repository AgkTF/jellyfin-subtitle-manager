# OpenSubtitles bounded trial (#44)

## Result

The separately approved discovery-only trial ended with `unsafe-content`: the API response redirected outside the trial runner's approved request behavior. This is a valid bounded safety outcome. It triggered no retry, scope expansion, payload fetch, private candidate staging, publication, or media-library write.

- Started: `2026-09-22T03:53:44.391Z`
- Completed: `2026-09-22T03:53:44.649Z`
- API origin: `https://api.opensubtitles.com`
- Search HTTP requests: 1
- Download-link operations: 0
- Payload attempts and fetches: 0
- Search results and file records inspected: 0
- Generated links retained or reported: 0
- Candidates staged: 0

The first search response was a redirect. The approved runner rejected it without following it or recording its target. No additional request was made. Determining whether that redirect conforms to the documented same-origin search allowance requires a separately approved follow-up; it was not patched around during this trial.

## Approved disclosure and limits

The user approved disclosure of the following exact search identity:

- Title context: *Halo* (2022), season 1, episode 1
- Provider identity: IMDb parent ID `8631904`
- Language: English (`en`)
- OpenSubtitles movie hash: omitted

Credentials came from a user-owned OpenSubtitles.com account. The application API key was created in that account's API-consumer area and stored in the ignored local `.env`. The bearer token was obtained through a separately approved bounded login and stored in the same ignored file. Passwords, keys, tokens, and account identifiers are absent from this record.

The discovery trial allowed:

- only the login-selected `https://api.opensubtitles.com` API origin;
- at most 3 search requests and 1 download-link operation;
- no retries;
- no payload-origin trust derived from a returned link;
- no payload fetches or private staging; and
- no publication or media-library writes.

The local trial record contains only this bounded scope, timestamps, counters, terminal outcome, and an optional normalized payload origin. It contains no credentials or generated links.

## Approved redirect follow-up

The user separately approved one follow-up under the original disclosure and safety boundaries, permitting at most one search redirect only when it resolved to the exact approved API origin.

- Started: `2026-09-22T04:04:11.473Z`
- Completed: `2026-09-22T04:04:11.836Z`
- Logical search operations: 1
- Same-origin search redirects followed: 1
- API HTTP requests: 2
- Download-link operations: 0
- Payload attempts and fetches: 0
- Search results and file records inspected: 0
- Generated links retained or reported: 0
- Candidates staged: 0
- Publication operations: 0
- Media-library writes: 0
- Outcome: `malformed-provider-response`

The redirect's normalized origin was validated as `https://api.opensubtitles.com` and it was followed once within the shared request and 90-second run deadlines; the full redirect URL was not retained or reported. The resulting response did not satisfy the frozen JSON search-response contract, so the run stopped without guessing defaults or issuing another request. No credentials or generated link was retained.

## Follow-up blocker

The response difference requires diagnosis under a new, separately approved scope. No additional request may be made and no response validation may be relaxed merely to continue this trial. Any future generated payload origin would remain untrusted until supported by provider-controlled evidence and human approval; if published evidence is unavailable, direct provider confirmation and explicit human configuration approval are both required.
