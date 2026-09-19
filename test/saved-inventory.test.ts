import assert from "node:assert/strict";
import test from "node:test";

import { buildServer } from "../src/server/app.js";
import { openRequestWorkflow } from "../src/server/request-workflow.js";

test("searches synthetic saved inventory and retains scan and subtitle evidence", async (context) => {
  const server = buildServer();
  context.after(() => server.close());

  const response = await server.inject({ method: "GET", url: "/api/inventory?q=ORBIT" });

  assert.equal(response.statusCode, 200);
  const inventory = response.json();
  assert.equal(inventory.source, "synthetic");
  assert.equal(inventory.scannedAt, "2026-01-15T12:00:00Z");
  assert.deepEqual(inventory.errors, ["Synthetic scan: /synthetic/unreadable could not be listed."]);
  assert.equal(inventory.videos.length, 1);
  assert.equal(inventory.videos[0].file, "/synthetic/Quiet.Orbit.2025.1080p.SYNTHETIC.mkv");
  assert.equal(inventory.videos[0].identities[0].release, "Quiet.Orbit.2025.1080p.SYNTHETIC");
  assert.equal(inventory.videos[0].identities[0].english.status, "unverified");
  assert.equal(inventory.videos[0].identities[0].arabic.status, "unknown");
});

test("rejects untrusted Host and Origin values before exposing saved evidence", async (context) => {
  const server = buildServer();
  context.after(() => server.close());
  for (const headers of [
    { host: "untrusted.example" },
    { host: "localhost:3000", origin: "https://untrusted.example" },
    { host: "localhost:3000", origin: "http://localhost:4000" },
    { host: "localhost:3000", origin: "null" },
  ]) {
    const response = await server.inject({ method: "GET", url: "/api/inventory", headers });
    assert.equal(response.statusCode, 403);
  }
  const response = await server.inject({ method: "GET", url: "/api/inventory", headers: {
    host: "127.0.0.1:3000", origin: "http://127.0.0.1:3000",
  } });
  assert.equal(response.statusCode, 200);
});

test("saved-inventory searches preserve existing requests and never expose a mutation operation", async (context) => {
  const workflow = openRequestWorkflow({ databasePath: ":memory:" });
  workflow.issue({
    type: "create-request", request: { id: "existing-synthetic-request", version: 0 },
    video: { libraryId: "synthetic", id: "existing-video", label: "Synthetic existing video" }, language: "en",
  });
  workflow.issue({ type: "defer-request", request: { id: "existing-synthetic-request", version: 1 } });
  const server = buildServer({ workflow });
  context.after(async () => { await server.close(); workflow.close(); });
  const before = (await server.inject({ method: "GET", url: "/api/requests" })).json();

  const all = await server.inject({ method: "GET", url: "/api/inventory" });
  assert.equal(all.json().videos.length, 3);
  const ambiguous = await server.inject({ method: "GET", url: "/api/inventory?q=Harbor.Signal.2024" });
  assert.equal(ambiguous.json().videos.length, 1);
  assert.equal(ambiguous.json().videos[0].identities.length, 2);
  const missing = await server.inject({ method: "GET", url: "/api/inventory?q=not-a-saved-video" });
  assert.deepEqual(missing.json().videos, []);
  assert.deepEqual(missing.json().errors, all.json().errors);
  const bounded = await server.inject({ method: "GET", url: `/api/inventory?q=${"x".repeat(201)}` });
  assert.equal(bounded.statusCode, 400);
  for (const method of ["POST", "PUT", "PATCH", "DELETE"] as const) {
    const response = await server.inject({ method, url: "/api/inventory" });
    assert.equal(response.statusCode, 404);
  }
  const after = (await server.inject({ method: "GET", url: "/api/requests" })).json();
  assert.deepEqual(after, before);
});
