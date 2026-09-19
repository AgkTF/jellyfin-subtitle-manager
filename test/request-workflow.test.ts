import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
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
  });
  assert.deepEqual(reopened.listRequests({ lifecycle: "active" }), {
    requests: [retriedRequest],
  });
  assert.deepEqual(reopened.listRequests({ lifecycle: "deferred" }), {
    requests: [],
  });
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
