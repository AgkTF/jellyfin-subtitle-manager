import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import Database from "better-sqlite3";

import {
  CandidateRejectionValidationError,
  openRequestWorkflow,
  RequestVersionConflictError,
} from "../src/server/request-workflow.js";

const syntheticRequest = {
  id: "request-synthetic-001",
  version: 1,
  video: {
    libraryId: "library-synthetic",
    id: "video-synthetic-001",
    label: "Synthetic fixture — The Example Film",
  },
  language: "ar",
  lifecycle: "active",
} as const;

const activeRequestView = {
  ...syntheticRequest,
  lifecycleHistory: [{ version: 1, lifecycle: "active" }],
  preparation: null,
} as const;

test("a subtitle request remains active after the workflow is reopened", (context) => {
  const directory = mkdtempSync(join(tmpdir(), "subtitle-request-workflow-"));
  const databasePath = join(directory, "workflow.sqlite");
  context.after(() => rmSync(directory, { recursive: true, force: true }));

  const workflow = openRequestWorkflow({ databasePath });
  workflow.issue({
    type: "create-request",
    request: { id: syntheticRequest.id, version: 0 },
    video: syntheticRequest.video,
    language: syntheticRequest.language,
  });

  assert.deepEqual(workflow.listRequests({ lifecycle: "active" }), {
    requests: [syntheticRequest],
  });
  workflow.close();

  const reopened = openRequestWorkflow({ databasePath });
  context.after(() => reopened.close());

  assert.deepEqual(reopened.getRequest(syntheticRequest.id), activeRequestView);
  assert.deepEqual(reopened.listRequests({ lifecycle: "active" }), {
    requests: [syntheticRequest],
  });
});

test("a subtitle request remains deferred after the workflow is reopened", (context) => {
  const directory = mkdtempSync(join(tmpdir(), "subtitle-request-workflow-"));
  const databasePath = join(directory, "workflow.sqlite");
  context.after(() => rmSync(directory, { recursive: true, force: true }));

  const workflow = openRequestWorkflow({ databasePath });
  workflow.issue({
    type: "create-request",
    request: { id: syntheticRequest.id, version: 0 },
    video: syntheticRequest.video,
    language: syntheticRequest.language,
  });
  workflow.issue({
    type: "defer-request",
    request: { id: syntheticRequest.id, version: 1 },
  });

  const deferredRequest = {
    ...syntheticRequest,
    version: 2,
    lifecycle: "deferred",
  } as const;
  assert.deepEqual(workflow.listRequests({ lifecycle: "active" }), {
    requests: [],
  });
  assert.deepEqual(workflow.listRequests({ lifecycle: "deferred" }), {
    requests: [deferredRequest],
  });
  workflow.close();

  const reopened = openRequestWorkflow({ databasePath });
  context.after(() => reopened.close());

  assert.deepEqual(reopened.getRequest(syntheticRequest.id), {
    ...deferredRequest,
    lifecycleHistory: [
      { version: 1, lifecycle: "active" },
      { version: 2, lifecycle: "deferred" },
    ],
    preparation: null,
  });
  assert.deepEqual(reopened.listRequests({ lifecycle: "deferred" }), {
    requests: [deferredRequest],
  });
});

test("a stale command cannot defer a subtitle request", (context) => {
  const directory = mkdtempSync(join(tmpdir(), "subtitle-request-workflow-"));
  const databasePath = join(directory, "workflow.sqlite");
  context.after(() => rmSync(directory, { recursive: true, force: true }));

  const workflow = openRequestWorkflow({ databasePath });
  workflow.issue({
    type: "create-request",
    request: { id: syntheticRequest.id, version: 0 },
    video: syntheticRequest.video,
    language: syntheticRequest.language,
  });

  assert.throws(
    () =>
      workflow.issue({
        type: "defer-request",
        request: { id: syntheticRequest.id, version: 0 },
      }),
    RequestVersionConflictError,
  );
  workflow.close();

  const reopened = openRequestWorkflow({ databasePath });
  context.after(() => reopened.close());

  assert.deepEqual(reopened.getRequest(syntheticRequest.id), activeRequestView);
  assert.deepEqual(reopened.listRequests({ lifecycle: "active" }), {
    requests: [syntheticRequest],
  });
  assert.deepEqual(reopened.listRequests({ lifecycle: "deferred" }), {
    requests: [],
  });
});

test("retrying a deferred subtitle request makes it durably active", (context) => {
  const directory = mkdtempSync(join(tmpdir(), "subtitle-request-workflow-"));
  const databasePath = join(directory, "workflow.sqlite");
  context.after(() => rmSync(directory, { recursive: true, force: true }));

  const workflow = openRequestWorkflow({ databasePath });
  workflow.issue({
    type: "create-request",
    request: { id: syntheticRequest.id, version: 0 },
    video: syntheticRequest.video,
    language: syntheticRequest.language,
  });
  workflow.issue({
    type: "defer-request",
    request: { id: syntheticRequest.id, version: 1 },
  });
  workflow.issue({
    type: "retry-request",
    request: { id: syntheticRequest.id, version: 2 },
  });
  workflow.close();

  const reopened = openRequestWorkflow({ databasePath });
  context.after(() => reopened.close());

  const retriedRequest = {
    ...syntheticRequest,
    version: 3,
  } as const;
  assert.deepEqual(reopened.getRequest(syntheticRequest.id), {
    ...retriedRequest,
    lifecycleHistory: [
      { version: 1, lifecycle: "active" },
      { version: 2, lifecycle: "deferred" },
      { version: 3, lifecycle: "active" },
    ],
    preparation: null,
  });
  assert.deepEqual(reopened.listRequests({ lifecycle: "active" }), {
    requests: [retriedRequest],
  });
  assert.deepEqual(reopened.listRequests({ lifecycle: "deferred" }), {
    requests: [],
  });
});

test("preparing an active request stores three bounded synthetic candidates and survives restart", (context) => {
  const directory = mkdtempSync(join(tmpdir(), "subtitle-request-workflow-"));
  const databasePath = join(directory, "workflow.sqlite");
  context.after(() => rmSync(directory, { recursive: true, force: true }));

  const workflow = openRequestWorkflow({ databasePath });
  workflow.issue({
    type: "create-request",
    request: { id: syntheticRequest.id, version: 0 },
    video: syntheticRequest.video,
    language: syntheticRequest.language,
  });
  const prepared = workflow.issue({
    type: "prepare-request",
    request: { id: syntheticRequest.id, version: 1 },
  });

  assert.equal(prepared.lifecycle, "active");
  assert.equal(prepared.preparation?.candidates.length, 3);
  assert.equal(prepared.preparation?.candidates.every((candidate) => candidate.timing.status === "unmeasured"), true);
  assert.equal(prepared.preparation?.candidates.every((candidate) => candidate.provenance === "unknown"), true);
  assert.equal(prepared.preparation?.candidates.some((candidate) => candidate.language === "ar" && candidate.authorship === "unknown"), true);
  assert.equal(prepared.preparation?.candidates.length, 3);
  assert.equal(prepared.preparation?.recommendedCandidateId, prepared.preparation?.candidates[0].id);
  workflow.close();

  const reopened = openRequestWorkflow({ databasePath });
  context.after(() => reopened.close());
  const restored = reopened.getRequest(syntheticRequest.id);
  assert.deepEqual(restored?.preparation, prepared.preparation);
  assert.equal(restored?.version, 1);
});

test("existing preparations and the earlier rejection schema migrate to durable identity evidence", (context) => {
  const directory = mkdtempSync(join(tmpdir(), "subtitle-request-workflow-"));
  const databasePath = join(directory, "workflow.sqlite");
  context.after(() => rmSync(directory, { recursive: true, force: true }));

  const workflow = openRequestWorkflow({ databasePath });
  workflow.issue({
    type: "create-request",
    request: { id: syntheticRequest.id, version: 0 },
    video: syntheticRequest.video,
    language: syntheticRequest.language,
  });
  workflow.issue({
    type: "prepare-request",
    request: { id: syntheticRequest.id, version: 1 },
  });
  workflow.close();

  const database = new Database(databasePath);
  const row = database.prepare("SELECT candidates_json FROM request_preparations WHERE request_id = ?")
    .get(syntheticRequest.id) as { candidates_json: string };
  const legacyCandidates = JSON.parse(row.candidates_json) as Array<Record<string, unknown>>;
  for (const candidate of legacyCandidates) {
    candidate.evidenceHash = candidate.identityEvidenceHash;
    delete candidate.identityEvidenceHash;
  }
  database.prepare("UPDATE request_preparations SET candidates_json = ? WHERE request_id = ?")
    .run(JSON.stringify(legacyCandidates), syntheticRequest.id);
  database.exec("ALTER TABLE candidate_rejections RENAME COLUMN candidate_identity_hash TO candidate_evidence_hash");
  database.prepare(`
    INSERT INTO candidate_rejections (
      request_id, library_id, video_id, candidate_id, candidate_evidence_hash, reason
    ) VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    syntheticRequest.id,
    syntheticRequest.video.libraryId,
    syntheticRequest.video.id,
    legacyCandidates[0].id,
    legacyCandidates[0].evidenceHash,
    "Earlier rejection remains unsuitable",
  );
  database.close();

  const reopened = openRequestWorkflow({ databasePath });
  context.after(() => reopened.close());
  const migrated = reopened.getRequest(syntheticRequest.id)?.preparation?.candidates[0];
  assert.match(migrated?.identityEvidenceHash ?? "", /^[a-f0-9]{64}$/);
  assert.equal(migrated?.rejection?.reason, "Earlier rejection remains unsuitable");
});

test("rejecting a prepared candidate preserves its reason and leaves request lifecycle and other candidates unchanged", (context) => {
  const directory = mkdtempSync(join(tmpdir(), "subtitle-request-workflow-"));
  const databasePath = join(directory, "workflow.sqlite");
  context.after(() => rmSync(directory, { recursive: true, force: true }));

  const workflow = openRequestWorkflow({ databasePath });
  workflow.issue({
    type: "create-request",
    request: { id: syntheticRequest.id, version: 0 },
    video: syntheticRequest.video,
    language: syntheticRequest.language,
  });
  const prepared = workflow.issue({
    type: "prepare-request",
    request: { id: syntheticRequest.id, version: 1 },
  });
  const candidate = prepared.preparation?.candidates[0];
  assert.ok(candidate);

  const rejected = workflow.issue({
    type: "reject-candidate",
    request: { id: syntheticRequest.id, version: 1 },
    candidate: { id: candidate.id, identityEvidenceHash: candidate.identityEvidenceHash },
    reason: "  Timing drifts after the opening scene.  ",
  });

  assert.equal(rejected.lifecycle, "active");
  assert.equal(rejected.version, 1);
  assert.equal(rejected.preparation?.recommendedCandidateId, null);
  assert.deepEqual(rejected.preparation?.candidates.map((item) => item.rejection), [
    {
      candidateId: candidate.id,
      identityEvidenceHash: candidate.identityEvidenceHash,
      reason: "Timing drifts after the opening scene.",
    },
    null,
    null,
  ]);
  workflow.close();

  const reopened = openRequestWorkflow({ databasePath });
  context.after(() => reopened.close());
  const restored = reopened.issue({
    type: "prepare-request",
    request: { id: syntheticRequest.id, version: 1 },
  });
  assert.deepEqual(restored.preparation, rejected.preparation);
});

test("candidate rejection requires a non-empty reason and matching prepared identity evidence", (context) => {
  const directory = mkdtempSync(join(tmpdir(), "subtitle-request-workflow-"));
  const databasePath = join(directory, "workflow.sqlite");
  context.after(() => rmSync(directory, { recursive: true, force: true }));

  const workflow = openRequestWorkflow({ databasePath });
  context.after(() => workflow.close());
  workflow.issue({
    type: "create-request",
    request: { id: syntheticRequest.id, version: 0 },
    video: syntheticRequest.video,
    language: syntheticRequest.language,
  });
  const prepared = workflow.issue({
    type: "prepare-request",
    request: { id: syntheticRequest.id, version: 1 },
  });
  const candidate = prepared.preparation?.candidates[0];
  assert.ok(candidate);

  assert.throws(() => workflow.issue({
    type: "reject-candidate",
    request: { id: syntheticRequest.id, version: 1 },
    candidate: { id: candidate.id, identityEvidenceHash: candidate.identityEvidenceHash },
    reason: "   ",
  }), CandidateRejectionValidationError);
  assert.throws(() => workflow.issue({
    type: "reject-candidate",
    request: { id: syntheticRequest.id, version: 1 },
    candidate: { id: candidate.id, identityEvidenceHash: "0".repeat(64) },
    reason: "Wrong candidate evidence",
  }), CandidateRejectionValidationError);
  assert.equal(workflow.getRequest(syntheticRequest.id)?.preparation?.candidates.every(
    (item) => item.rejection === null,
  ), true);

  workflow.issue({
    type: "defer-request",
    request: { id: syntheticRequest.id, version: 1 },
  });
  assert.throws(() => workflow.issue({
    type: "reject-candidate",
    request: { id: syntheticRequest.id, version: 2 },
    candidate: { id: candidate.id, identityEvidenceHash: candidate.identityEvidenceHash },
    reason: "Do not continue review while deferred",
  }), RequestVersionConflictError);
});

test("a request view retains durable lifecycle history", (context) => {
  const directory = mkdtempSync(join(tmpdir(), "subtitle-request-workflow-"));
  const databasePath = join(directory, "workflow.sqlite");
  context.after(() => rmSync(directory, { recursive: true, force: true }));

  const workflow = openRequestWorkflow({ databasePath });
  workflow.issue({
    type: "create-request",
    request: { id: syntheticRequest.id, version: 0 },
    video: syntheticRequest.video,
    language: syntheticRequest.language,
  });
  workflow.issue({
    type: "defer-request",
    request: { id: syntheticRequest.id, version: 1 },
  });
  workflow.issue({
    type: "retry-request",
    request: { id: syntheticRequest.id, version: 2 },
  });
  workflow.close();

  const reopened = openRequestWorkflow({ databasePath });
  context.after(() => reopened.close());

  assert.deepEqual(reopened.getRequest(syntheticRequest.id), {
    ...syntheticRequest,
    version: 3,
    lifecycleHistory: [
      { version: 1, lifecycle: "active" },
      { version: 2, lifecycle: "deferred" },
      { version: 3, lifecycle: "active" },
    ],
    preparation: null,
  });
});

test("repeated creation for one video and language keeps one lifecycle history", (context) => {
  const directory = mkdtempSync(join(tmpdir(), "subtitle-request-workflow-"));
  const databasePath = join(directory, "workflow.sqlite");
  context.after(() => rmSync(directory, { recursive: true, force: true }));

  const workflow = openRequestWorkflow({ databasePath });
  const first = workflow.issue({
    type: "create-request",
    request: { id: "request-first", version: 0 },
    video: syntheticRequest.video,
    language: syntheticRequest.language,
  });
  const repeated = workflow.issue({
    type: "create-request",
    request: { id: "request-second", version: 0 },
    video: syntheticRequest.video,
    language: syntheticRequest.language,
  });

  assert.deepEqual(repeated, first);
  const expectedRequest = { ...syntheticRequest, id: "request-first" };
  assert.deepEqual(workflow.listRequests({ lifecycle: "active" }), {
    requests: [expectedRequest],
  });
  workflow.close();

  const reopened = openRequestWorkflow({ databasePath });
  context.after(() => reopened.close());
  assert.deepEqual(reopened.getRequest("request-first"), {
    ...expectedRequest,
    lifecycleHistory: [{ version: 1, lifecycle: "active" }],
    preparation: null,
  });
});

test("recreating a subtitle request cannot overwrite the durable request", (context) => {
  const directory = mkdtempSync(join(tmpdir(), "subtitle-request-workflow-"));
  const databasePath = join(directory, "workflow.sqlite");
  context.after(() => rmSync(directory, { recursive: true, force: true }));

  const workflow = openRequestWorkflow({ databasePath });
  workflow.issue({
    type: "create-request",
    request: { id: syntheticRequest.id, version: 0 },
    video: syntheticRequest.video,
    language: syntheticRequest.language,
  });

  assert.throws(
    () =>
      workflow.issue({
        type: "create-request",
        request: { id: syntheticRequest.id, version: 0 },
        video: {
          libraryId: "library-synthetic-other",
          id: "video-synthetic-other",
          label: "Synthetic fixture — Must Not Replace",
        },
        language: "en",
      }),
    RequestVersionConflictError,
  );
  workflow.close();

  const reopened = openRequestWorkflow({ databasePath });
  context.after(() => reopened.close());

  assert.deepEqual(reopened.getRequest(syntheticRequest.id), activeRequestView);
  assert.deepEqual(reopened.listRequests({ lifecycle: "active" }), {
    requests: [syntheticRequest],
  });
});
