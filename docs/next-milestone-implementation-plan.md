# Implementation plan: one subtitle request, end to end

Status: technical plan with four user-approved choices for further planning:
TypeScript for the new application with retained Python tools; SQLite for new
workflow records; loopback-only browser access; and saved-inventory selection with
explicit refresh and selected-file live inspection. The product scope is confirmed
in [next-milestone-plan.md](next-milestone-plan.md). The visual and interaction
direction is also approved and locked for implementation, as recorded below. Other
technical recommendations remain proposals. No implementation, provider access,
installation, or live media operation is authorized by this document.

## Code inspection and baseline

Read all current application modules and both test files. Baseline command:

```sh
mise exec uv -- uv run python -m unittest discover -s tests -v
```

Result during planning: **36 tests passed**, including synthetic FFmpeg fixtures.
No live library access or provider activity was needed for this baseline.

| Existing module | Reuse | Limitation relevant to this milestone |
| --- | --- | --- |
| `scanner.py` | Standalone stdlib metadata/sidecar interpretation, low-priority scan, injected probe for tests | `scan()` traverses a whole root; no selected-file inspection interface yet. Association remains a basename candidate. |
| `__main__.py` | SSH quoting/validation and streamed scan evidence behavior | CLI owns process lifecycle and output files; do not spawn the whole CLI for each browser click. |
| `reviews.py` / `ReviewStore` | Immutable historical observations, integrity checks, library isolation | Import requires a sidecar already associated in the supplied inventory; it cannot honestly represent a staged candidate preview. No rejection/request/publication lifecycle. |
| `reviews.py` / `build_plan` | Offline evidence applicability and explanations | Dry-run output is not executable authority. Any associated-sidecar snapshot change can mark reviews stale, including a new publication. |
| `report.py` | Inventory assembly and existing static reports | Not an interactive UI. `candidate_languages()` is domain calculation currently located beside HTML rendering. Avoid copying that logic into a new client. |
| `review.py` | Existing offline import/plan commands | Preserve their saved-file-only behavior; do not add implicit network access. |

Retain existing CLI contracts and the standalone Python scanner. Do not replace
historical journals, invent inventory entries for staged files, or turn the label
rename helpers under ignored `private/` into a general publisher.

## Technical shape — core choices approved for planning

### Runtime and ownership

Subsequent stack decisions: the user approved Node.js 24 LTS, Fastify 5,
React with TypeScript and Vite, and `better-sqlite3`. The bounded compatibility
check passed with Node.js v24.21.0 and better-sqlite3 v13.0.3 on Linux x64/glibc,
using the npm-bundled prebuild without native compilation. Database open, prepared
queries, commit, rollback, persistence, and foreign-key enforcement passed.
See [the compatibility report](research/sqlite-compatibility-check.md). This is a
tested pairing, not a full-stack test; TypeScript compilation is still untested.

Built-in `node:sqlite` and simple HTML with small scripts are no longer selected.
The user authorized only an isolated temporary compatibility installation/test;
project dependency installation and application implementation remain unauthorized.

Use **a TypeScript application for the new browser/workflow code**, retaining
Python for the existing scanner and legacy review/planning capability. This uses
the maintainer's primary language without rewriting working inventory logic.

Trade-off: two runtimes and a versioned subprocess contract rather than one Python
application. The simpler alternative considered was a Python workflow with
server-rendered pages. The user explicitly approved the TypeScript/Python split for
further planning. Framework selection and dependency installation are not approved
by that choice.

Keep one local application process, one active preparation/publication job at a
time, and no Redis, daemon on the media host, external queue, or separate hosted
frontend. New application state is local; SFTP playback remains an existing player
workflow, not an application-managed video stream.

Use **SQLite for new request/candidate/decision/operation records**, with
private raw candidate files beside it, not in the database or media tree. Keep
existing JSON review files immutable and reference their IDs/hashes. Transactions
help with command deduplication and durable operation intent; they cannot make a
remote filesystem write atomic with a local commit. That requires reconciliation.

### Deep modules and interfaces

These are responsibilities, not a requirement for one file or abstraction per row.

| Module | Small interface for callers | Complexity owned by its implementation |
| --- | --- | --- |
| Library evidence | Find saved files; inspect one selected file; obtain historical observations with applicability | Inventory freshness, Python/SSH transport, scoped inspection, ambiguous association, partial evidence |
| Request workflow | Issue a typed command with request ID/version; read request/list view | Legal transitions, approval binding, candidate budgets, rejection/defer memory, durable progress, operation reconciliation orchestration |
| Candidate preparation | Prepare for an identified video/language under explicit provider permissions and limits | External searches/downloads, safe archive/content handling, provenance, deduplication, explainable ranking, no-candidate/failure distinction |
| Publication | Inspect destination; publish exact approved artifact; reconcile operation; remove exact owned artifact with approval | Live identity checks, no-overwrite publication, remote audit evidence, interrupted outcomes, ownership-safe removal |

UI handlers must not choose shell commands, resolve arbitrary paths, mutate records
directly, or implement transition rules. They call the same workflow interface used
by tests. Typed commands are a closed set, not a general event/scripting framework.

Use internal seams only where behavior actually varies: remote filesystem transport
with a temporary-filesystem test adapter; provider transport with a synthetic HTTP
adapter. Exercise SQLite and real temporary files in tests rather than mocking away
persistence. Preserve existing useful regression tests; do not multiply tests for
pass-through wrappers.

### New evidence without rewriting old evidence

A preview record binds the selected video evidence, candidate content hash, client,
sample scope, and reported outcomes. It does not require a fictitious published
sidecar. Publication records link that hash to the destination and verification;
Jellyfin checks are separate observations linked to the publication.

Request lifecycle, publication state, and evidence status must remain separate:
a deferred request can still have staged files, and a failed client check can
still have a published file. Avoid one giant status enum that hides those facts.

Adding a sidecar may invalidate a legacy review's whole snapshot. Preserve that
historical result and show the verified operation link plus new candidate-specific
observations; do not weaken the old comparison globally to make it look current.
Rejecting a candidate remembers video identity and both provider identity and byte
hash where available. A new provider ID for identical bytes is not a fresh candidate.
An explicit retry does not silently erase prior rejection reasons.

## Delivery slices and stopping points

### 0. Resolve technical gates

The runtime split, storage approach, and minimal browser/server stack are confirmed
for planning. Select the first provider after primary-source verification of
released interfaces, access requirements, language/provenance metadata, quotas,
and archive behavior.
Existing provider research is a shortlist, not proof of current access or coverage.
Start with one provider; a second is not required for the first end-to-end success.
No credentials or private library queries are needed for documentation research.

Before live publication, verify a safe remote staging/finalization strategy under
separate read-only permission. The completed filename-only operations do not prove
that a local-to-remote copy/publish protocol has already been designed or tested.

### 1. Browser request journey with synthetic candidates

The visual/interaction gate is complete. The locked reference is
`reports/ui-prototype-20260911-165957/refined.html`; its adjacent `README.md`
records the decision and prototype limits. The prototype is a visual and behavioral
reference, not production source. Rewrite it with production components,
accessibility, error handling, and tests rather than promoting the HTML directly.

Preserve these validated decisions:

- A full-width workspace with compact icon rail, grouped navigation, and request
  ledger, using 10 px desktop outer gutters and independent rounded sections.
- A concise selected-request summary with progressive evidence. Expand only the
  current decision by default; keep detailed evidence available on demand.
- A distinct preview, exact publication approval, and Jellyfin verification flow.
  Provider setup, request state, publication state, and client verification must
  remain visibly separate.
- Short, action-first copy with safety qualifications near evidence or irreversible
  approval instead of repeated throughout routine task text.
- Mineral blue surfaces; Kodchasan Medium/SemiBold only for branding and selected
  page/action headings; system sans for navigation, controls, status, and body;
  Arabic-capable sans for cues; and monospace for file/release identity.
- A 10 px minimum for metadata, compact request-level actions, a system-sans current
  state badge, and no duplicated state summaries or non-actionable status ornament.
  Disconnected-provider status is an actionable, dot-free control.
- Content-fitting feedback and exact-destination callouts up to 70ch on desktop,
  full-width safe wrapping on mobile, and one request-group control on mobile.

Use React with TypeScript and Vite for the browser interface and Fastify 5 for the
local server. Keep workflow rules in the workflow module rather than duplicating
them in React. Select the smallest production UI primitives and styling approach
that can reproduce the locked direction; do not substitute a generic dashboard
template. Preserve keyboard access, visible focus, semantic control names, dialog
focus management, and readable responsive behavior.

Implement a focused request list, saved-inventory picker, candidate detail, preview
instructions, explicit approval screen, and durable request decisions through the
workflow interface. Use clearly labelled synthetic candidates and temporary media
fixtures; production publication remains disabled. No simulated real success.

Saved inventory displays scan time and errors. Use explicit user-triggered
library refresh, never an automatic scan on app launch/page load. Add bounded live
inspection of the selected video and nearby sidecar association evidence before
real preparation; do not present a scoped inspection as a complete library scan.
The user approved this freshness/refresh behavior for planning; no live scan has
been authorized by that approval.

Preview handoff: expose only the selected candidate as an attachment, with its ID,
hash and video/SFTP locator. The user opens the remote video and explicitly loads
that downloaded local file. No arbitrary file-serving endpoint, URI auto-execution,
player IPC, automatic seeking, or browser video transport is required. Record that
playback observations are user reports, not proof of what the player loaded.

Exit: demonstrate the request/review/defer/reject journey after app restart with
no provider or real library writes. Compare the production UI with the locked
reference at desktop and 390 px mobile widths, including empty, blocked, failed,
disabled, dialog, feedback, and lower action states. This is an intermediate slice,
not completion of the agreed end-to-end product milestone.

### 2. Bounded real candidate preparation

Add one verified provider adapter and safe local staging. Preserve original bytes
and provenance; validate supported subtitle content rather than trusting suffixes.
Explicitly choose the first supported download formats (recommend SRT initially,
without changing policy toward working embedded/image/ASS library tracks).
Unsupported formats are a capability limit, not evidence of unusable subtitles.

Freeze limits before implementing the download path: maximum three candidate
payload attempts per run, counting failed/duplicate attempts conservatively; bounded
search pages/calls, connect/read/overall time, compressed/uncompressed bytes, archive
entries and nesting. Defaults should be tested against the selected provider, not
invented from the old research. Stop on quota/auth failures; no hidden retries.
Disallow traversal, symlinks, nested archives, and non-subtitle payload publication.
Constrain provider download origins/redirects; do not fetch arbitrary browser URLs.

Rank originals using video association and language/type/provenance evidence.
Structural timing validation is not speech alignment. With no timing analyzer in
scope, say timing is unmeasured and rely on the explicitly scoped human preview.
Do not introduce model downloads, audio extraction, or synchronization secretly.

Exit: synthetic HTTP failure/safety tests plus a separately authorized provider
trial. Provider permissions and real title disclosure are approval gates.

### 3. Safe publication and recovery, tested before enabling live writes

Approval binds request version, video evidence, candidate hash, destination, and
publication flags. Recheck at execution, not only when drawing the approval screen.
Use command IDs plus transactional state to prevent repeated clicks or stale tabs
from issuing duplicate effects. Persist intent before any remote write.

Transfer into operation-owned staging, verify bytes, and finalize with an atomic
no-overwrite primitive supported by the target filesystem. Do not stream directly
into a visible final subtitle or use a check-then-overwriting-rename sequence.
Same-filesystem staging location, permissions, durability and Jellyfin visibility
must be verified; do not assume a remote temporary directory is suitable.

Local/remote connection loss produces an uncertain operation, not presumed failure
or success. Reconcile against durable operation ownership evidence, candidate hash,
and destination identity. A matching pre-existing file/hash alone is not proof
that this operation owns it. Block ambiguous recovery; do not blindly retry.
Removal has separate approval and verifies exact owned destination identity/hash.
Staging cleanup cannot reach published files or delete audit/rejection records.

Exit: failure injection before/after transfer, finalization and local acknowledgement;
collisions, symlink/path escapes, changed sources/candidate, concurrent commands,
restart, externally modified destination, and cleanup-versus-active-operation tests.
Only then propose enabling one exact live publication under separate approval.

### 4. One real request and operational finish

Run the approved path with desktop preview, explicit publication and a brief usual-
client check. Provide manual Jellyfin refresh instructions if needed. Retain pending
and failed client outcomes distinctly from verified filesystem publication.

Verify private-state permissions, backup/restore instructions (including SQLite and
candidate/audit state), recovery after restart, explicit cleanup, and old CLI/test
compatibility. Update README with implemented behavior, not prospective commands.
A no-candidate run proves bounded failure handling, not successful end-to-end delivery.

## Local browser security is part of the first slice

Use the approved loopback-only, single-user access on the user's computer. No LAN binding,
server hosting, public exposure, telemetry, or remote frontend assets. Reject
untrusted Host/Origin values, use protected state-changing requests (including CSRF
protection), and never let GET trigger scans/downloads/publication. Loopback alone
is not protection against a malicious website reaching a local application.

Escape all library/provider/subtitle text. Serve candidate files as attachments by
owned ID only, not arbitrary paths or inline active content. Keep credentials in
an explicitly configured backend-only secret source, out of browser payloads,
URLs, Git and logs. Browser records use opaque IDs; configured library roots and
SSH targets are trusted application settings, not per-request command arguments.

## Decisions needed now versus later

Confirmed for further planning: TypeScript application with retained Python tools;
SQLite for new state; loopback-only access; saved-library picker with explicit
refresh and selected-file inspection. These determine the first slice without
reopening product scope.

Next, before affected implementation: framework/package versions, first provider
and supported formats, concrete network/archive limits, and publication staging
protocol. These need source verification and/or bounded feasibility checks, not
another broad product interview. No library re-review is required.

No code or dependencies were changed while drafting this plan. The runtime/storage
choices are now approved for planning; no ADR has been created. Implementation and
external operations still require separate approval.
