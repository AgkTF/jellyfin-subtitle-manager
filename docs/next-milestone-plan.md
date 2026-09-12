# Next milestone: one subtitle request, end to end

Status: confirmed product scope, approved by the user for implementation planning
only. This document does not authorize implementation, provider activity,
installation, or media changes.

## Purpose and existing foundation

Deliver a usable, user-initiated journey for one selected video file and one
language: inspect existing evidence, prepare a candidate, review it, approve
publication, and confirm the result in Jellyfin. Success means a real subtitle
outcome, not another report-only foundation or unattended library maintenance.

The scanner, immutable review journal, and offline planner already exist. Reuse
those capabilities where appropriate; do not rebuild them. They do not currently
provide acquisition, execution, review disposition changes, or an interactive UI.
Historical inventories and proposals are not live authorization to act.

The exploratory ten-title review is sufficient for this checkpoint. Completed
label changes and the user's decision to defer a minor timing concern remain
private evidence; do not repeat that review batch. Existing client observations
must remain distinct rather than being overwritten by newer outcomes elsewhere.

Related: [pilot](pilot-plan.md), [stage 2](stage-2-plan.md),
[research](research/subtitle-solution.md), [glossary](../CONTEXT.md).

## Agreed user journey

1. Open a small, locally accessed browser interface. See active, deferred, and
   finished requests, with a searchable library picker. No broad cleanup dashboard
   is required. The UI is new scope; framework and deployment remain undecided.
2. Select a movie/episode and English or Arabic. Resolve the actual video file;
   ask when releases or identity are ambiguous instead of guessing. Show existing
   language evidence first. Unknown evidence is not proof of missing content.
3. Explicitly initiate preparation. Once provider access is separately approved,
   this request permits bounded local inspection and searches/downloads using only
   approved providers. It does not permit publication or purchases.
4. Download at most three candidates into private staging. Evaluate originals
   only: no synchronization or timing-adjusted derivatives in this milestone.
   Metadata, structural checks, and provider scores must not be represented as
   measured dialogue synchronization. Unmeasured timing stays unknown.
5. Present one best candidate, with alternatives available on request, or explain
   that no suitable candidate was found. Show file/release association evidence,
   language, forced/SDH/full-dialogue evidence, provenance, timing evidence and its
   limits, and the proposed destination. Unknown Arabic authorship stays unknown.
6. Review the staged subtitle against the actual video in the existing desktop
   player through SFTP. The user has verified remote video playback and explicitly
   loading a local subtitle. No new player, browser video UI, or preview clips.
   Provide clear file/track selection instructions and targeted beginning/middle/end
   checks, aiming for a few minutes of user attention, not an exhaustive audit.
   Automatic player launching/seeking is not an agreed requirement.
7. Record the preview result separately from an explicit **Approve and publish**
   action showing the exact candidate and destination. Preserve unknown coverage,
   provenance, and sample scope rather than assigning formal acceptance silently.
8. Before publication, verify relevant live identities and destination safety.
   Block on changed evidence or an occupied target. Add a sidecar without replacing
   existing subtitles, changing their contents, or changing track defaults.
9. Verify destination and subtitle bytes. Show **Published; Jellyfin check pending**.
   The user performs a brief discovery/rendering check in their usual client,
   rather than repeating the entire desktop review. On confirmation, show
   **Jellyfin check confirmed**; this is not automatic formal subtitle acceptance.

## Review outcomes and revisiting work

- Reject a candidate with a reason for this video. Remember that rejection across
  requests; do not recommend it again unless relevant evidence changes.
- Defer a request without rejecting its candidates. Remove it from active attention,
  preserve history, and resume only on explicit retry.
- Rejection, deferral, no suitable candidate, and failure do not trigger another
  download or repeated search automatically. The user chooses whether to try an
  alternative. The three-download limit applies to each initiated request run;
  displaying an already staged alternative does not require downloading it again.
- Changed evidence can flag old observations as outdated; it must not silently
  restart acquisition or demand another playback check.
- If the Jellyfin check fails, show **Published; client verification failed**.
  Do not remove the subtitle automatically. Offer separately approved removal of
  only the file added by that operation, after confirming it has not changed.
- Pending review is not success. Distinguish no suitable candidate, deferred,
  blocked/failed, and confirmed delivery rather than collapsing them into “done.”

## Approval boundaries

Automatically within an explicitly initiated, separately enabled request:
read-only inspection and bounded search/download preparation, with clear progress
and a retained result. Search may disclose title/release information to providers;
this boundary must be visible when access is enabled.

Separate explicit approval is required for provider setup/access, any paid option,
publication of an exact candidate/destination, and removal of an operation-added
file. A change to the approved candidate or destination requires new approval.
Design agreement is not current permission to perform any of those operations.

No audio uploads, subtitle generation, OCR, font installs, encoding conversion of
working originals, automatic timing repair, video modification, replacement of
existing subtitles, default-track changes, scheduled processing, notifications,
or automatic acceptance. Known machine-generated Arabic is outside the agreed v1
scope; unknown provenance must not be relabelled as human authorship.

## UI/UX quality requirement

The user requires a clean, deliberately designed interface that is enjoyable to
use and rewarding to return to, even infrequently. This is part of the first
working version, not polish deferred to a later release. A small feature set or
single-user audience does not justify a rough administrative interface.

Agree on visual and interaction direction before implementing the browser screens.
Prioritize readable hierarchy, consistent typography/spacing, clear primary actions,
and useful context for returning users. Make progress, uncertainty, errors, and
recovery as considered as the successful path. Use motion and feedback to clarify
what changed, not distract from evidence or approval decisions. Provide keyboard
access, visible focus, sufficient contrast, and reduced-motion support.

Evaluate the design against the real workflow: a returning user can identify what
needs attention, understand the next action and its consequences, and distinguish
preview, publication, and client verification without reconstructing past work.
The user selected prototype A's Review desk layout as the preferred direction.
For the next exploration, retain that layout and use a light surface inspired by
Dub's clarity with Linear's restraint. The original palette is not preferred;
experiment with restrained palettes and typography better suited to a review tool.
No exact palette, font family, or UI library is selected yet. Dark mode is deferred
to a later milestone, not required in the first working version.

## Completion criteria

- A user can initiate and follow a request without agent-authored JSON packets or
  a sequence of manually assembled CLI commands.
- The user approves the visual/interaction direction, and the implemented journey
  meets the UI/UX quality requirement, including empty, pending, failed, and
  recovery states rather than only the successful path.
- Existing language evidence and ambiguity are visible before acquisition.
- An approved integration can prepare at most three candidates, preserve their
  raw bytes/provenance, and present one justified recommendation or a bounded
  no-candidate result. Actual provider choice and access remain separate gates.
- The staged candidate can be explicitly loaded alongside the correct remote
  video in the existing player; preview outcomes retain client and sample scope.
- Publication requires explicit, exact approval and fresh safety checks; source
  media and existing subtitles remain unchanged. Filesystem verification and
  Jellyfin confirmation are independently visible and recorded.
- Rejection, deferral, alternatives, and explicit retry preserve history without
  silent reactivation or treating publication as formal acceptance.
- Synthetic tests cover changed sources, destination collisions, stale approvals,
  rejected candidates, provider/download failure, unsafe downloaded content,
  partial publication, client failure, and repeat actions without duplicate writes.
  Private library details must not enter tracked fixtures.
- Demonstrate one separately approved real request through Jellyfin confirmation,
  without repeating the original validation batch. A no-candidate result is a valid
  bounded run, but does not demonstrate the successful delivery path by itself.

## Agreed recovery, discovery, and cleanup

- If publication is interrupted, stop and reconcile the destination against the
  operation record before retrying. Do not blindly republish or automatically roll
  back. An uncertain outcome remains visibly blocked until resolved.
- If Jellyfin has not discovered the added sidecar, provide manual refresh
  instructions in the pending-check state. Automatic Jellyfin refresh/API
  integration is not part of this milestone.
- Staged files have no automatic expiry in this milestone. Allow explicit cleanup
  from finished or deferred requests while retaining rejection reasons, provenance,
  hashes, and operation history. Staging cleanup must never delete published
  subtitles. Previewing a removed candidate may require a separately authorized
  download; cleanup must not silently initiate that download.

## Final confirmation

The product interview is complete. The user confirmed this consolidated milestone
as the shared scope and approved proceeding to implementation planning, not
execution. Technical choices and integration permissions below remain explicit
gates, not assumptions filled in by this proposal.

## Implementation gates, not additional product commitments

After the milestone is confirmed, inspect the existing code and choose the minimal
integration seams. Resolve provider release/API facts, credential handling, bounded
request/time/archive/size limits, and safe local UI access before implementation
of the affected integration. Downloads must be limited to validated subtitle
content with traversal/archive protections and quota/rate-limit handling.

Subsequent planning approval selected TypeScript for the new application with
retained Python tools, SQLite for new workflow records, loopback-only local browser
access, and a saved-library picker with explicit refresh and targeted live checks.
See [the implementation plan](next-milestone-implementation-plan.md). These choices
authorize further planning, not implementation or live operations.

UI framework, detailed browser security, staging-to-player handoff, provider
integration, and safe publication mechanics still need resolution. No rewrite of
the existing Python tools or remotely hosted application is selected. Keep library
and candidate data private; Git does not back up ignored state.
