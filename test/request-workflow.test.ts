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

  assert.deepEqual(reopened.getRequest(syntheticRequest.id), syntheticRequest);
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

  assert.deepEqual(reopened.getRequest(syntheticRequest.id), deferredRequest);
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

  assert.deepEqual(reopened.getRequest(syntheticRequest.id), syntheticRequest);
  assert.deepEqual(reopened.listRequests({ lifecycle: "active" }), {
    requests: [syntheticRequest],
  });
  assert.deepEqual(reopened.listRequests({ lifecycle: "deferred" }), {
    requests: [],
  });
});
