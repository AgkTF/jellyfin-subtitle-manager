import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { openPrivateCandidateStore } from "../src/server/private-candidate-store.js";

const content = Buffer.from("1\r\n00:00:01,000 --> 00:00:03,000\r\nOriginal bytes.\r\n", "utf8");
const contentHash = createHash("sha256").update(content).digest("hex");

test("private staging commits exact bytes atomically and deduplicates after restart", (context) => {
  const root = mkdtempSync(path.join(tmpdir(), "private-candidate-store-"));
  context.after(() => rmSync(root, { recursive: true, force: true }));

  const first = openPrivateCandidateStore({ root });
  const stagedFileId = first.stage(content);
  assert.deepEqual(first.read(stagedFileId, contentHash), content);
  assert.equal(statSync(path.join(root, stagedFileId)).mode & 0o777, 0o600);
  assert.deepEqual(readdirSync(root), [stagedFileId]);
  first.close();

  const reopened = openPrivateCandidateStore({ root });
  assert.equal(reopened.findByContentHash?.(contentHash), stagedFileId);
  assert.equal(reopened.stage(Buffer.from(content)), stagedFileId);
  reopened.close();
});

test("private reads reject tampered bytes and reconciliation removes only owned partial state", (context) => {
  const root = mkdtempSync(path.join(tmpdir(), "private-candidate-reconcile-"));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const store = openPrivateCandidateStore({ root });
  const retained = store.stage(content);
  const orphan = store.stage(Buffer.from("orphan"));
  const partial = `${"01234567-89ab-cdef-0123-456789abcdef"}.srt.tmp`;
  writeFileSync(path.join(root, partial), Buffer.from("interrupted"), { mode: 0o600 });
  writeFileSync(path.join(root, orphan), Buffer.from("tampered"));

  assert.equal(store.read(retained, contentHash) !== undefined, true);
  assert.equal(store.read(retained, "0".repeat(64)), undefined);
  store.reconcile?.();
  assert.deepEqual(new Set(readdirSync(root)), new Set([retained, orphan]));
  store.close();
});
