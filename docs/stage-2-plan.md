# Stage 2: review evidence and dry-run planning

## Approved scope

Build the underlying review records and action-planning logic, importing the
completed human review rather than asking for it again. Existing CLI/static HTML
are provisional engineering interfaces. Final UI, hosting, interaction design,
scheduling, and notifications are undecided; discuss those before implementing
user-facing workflows or deployment. Python remains provisional; the maintainer's
primary language is TypeScript. No rewrite is currently planned.

No media writes, renames, provider calls/downloads, synchronization, server installs,
or new live scan are needed for this milestone. Saved inventory is sufficient.

## Implementation and test surfaces

- A local review journal imports structured observations against a saved inventory
  and lists them independently of scans. Immutable content-addressed JSON records
  make repeated imports idempotent and retain conflicting client observations.
  This storage is an implementation choice, not a deployment/UI commitment.
- A pure planner combines a saved inventory and that journal into explanatory,
  per-language actions. It never executes actions or assigns acceptance.
- A provisional local CLI imports records and generates a new JSON plan and HTML
  report. Existing scan commands and original scan artifacts remain unchanged.

Test observable behavior through journal import/list, plan generation, and CLI
outputs: persistence/idempotence, media changes and partial scans, client-specific
results, burned-in evidence, language naming blockers, report escaping, and no
media/source-inventory writes. Synthetic fixtures use no private titles or paths.

## Evidence rules

Require an explicit stable library identifier so identical paths on different
servers cannot accidentally share review evidence. Bind observations to root,
relative video path, size, mtime, and the captured audio/subtitle evidence. These
are conservative change detectors, not a cryptographic identity of media content.
Do not move observations automatically across renames or alternate releases.

Changed or unobservable files retain historical observations but those observations
must not drive current actions. Partial scans cannot prove a missing file was
deleted. Selected-track identity and sample scope remain explicit unknowns when
not recorded. Original inventories lack sidecar size/mtime evidence; surface that
limitation. Future scans can capture sidecar stat metadata without reading contents
beyond the existing bounded prefix checks.

Human-reported language, rendering, timing, meaning, and burned-in content are
separate from tags, full-dialogue coverage, provenance, and acceptance. Never infer
human Arabic authorship or subtitle completeness from successful playback. Store
browser failures alongside TV successes; do not convert client failures into file
repair actions. Contradictory observations stay visible, without last-write-wins.

## Planning rules

Preserve reported-working candidates; investigate unresolved language evidence
before suggesting acquisition. Flag scan failures separately. Report timing,
labelling, client rendering, and Arabic provenance concerns independently.

A language-name proposal requires an explicitly confirmed sidecar association;
the imported smoke tests generally do not have one. Show blocked proposals rather
than guessing a filename. Retain format/forced/SDH flags, check collisions visible
in saved evidence, and always require live preflight plus publication approval.
Do not emit executable rename/repair commands or inferred timing offsets.

## Implementation status

The journal, planner, offline import/plan CLI, and combined static report are
implemented. Ten existing human reviews and their source notes have been imported
privately; repeating the import adds no duplicates. Synthetic tests cover changed
video/sidecar evidence, partial scans, client conflicts, language-label blockers,
format/flag preservation, and input immutability. No new server scan was run.

Exact selected sidecars remain unconfirmed for the imported label cases, so those
proposals are blocked instead of inventing executable names. This stage deliberately
has no acceptance, review supersession/deletion, or action execution. See README
for the provisional JSON packet contract and current limitations.

## Completion criteria

Import all ten reviews with their source notes; mark remaining batch items as
unreviewed in the existing private review artifacts. Produce a fresh combined
report with actionable distinctions and unchanged acceptance counts. Demonstrate
with synthetic rescan fixtures that changed files do not inherit actionable review
evidence. Leave final product-platform decisions and real correction work for
separate discussions.
