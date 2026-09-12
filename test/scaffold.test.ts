import assert from "node:assert/strict";
import test from "node:test";

import Database from "better-sqlite3";

import { buildServer } from "../src/server/app.js";

test("the local server exposes a health check", async (context) => {
  const server = buildServer();
  context.after(() => server.close());

  const response = await server.inject({ method: "GET", url: "/health" });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { status: "ok" });
});

test("SQLite supports an in-memory prepared query", () => {
  const database = new Database(":memory:");

  try {
    const row = database.prepare("SELECT 1 AS value").get() as { value: number };
    assert.deepEqual(row, { value: 1 });
  } finally {
    database.close();
  }
});
