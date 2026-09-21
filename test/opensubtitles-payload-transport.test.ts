import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import Database from "better-sqlite3";

import {
  createOpenSubtitlesPreparation,
  OpenSubtitlesTransportError,
  type OpenSubtitlesHttpRequest,
  type OpenSubtitlesHttpResponse,
  type OpenSubtitlesHttpTransport,
} from "../src/server/opensubtitles-preparation.js";
import type { PreparationVideo } from "../src/server/candidate-preparation.js";
import { openPrivateCandidateStore } from "../src/server/private-candidate-store.js";
import { openRequestWorkflow } from "../src/server/request-workflow.js";

const validSrt = Buffer.from("1\r\n00:00:01,000 --> 00:00:03,000\r\nFixture subtitle.\r\n", "utf8");
const video: PreparationVideo = {
  libraryId: "synthetic",
  id: "quiet-orbit-2025",
  label: "Quiet Orbit (2025)",
  savedVideoId: "quiet-orbit",
  openSubtitlesSearchIdentity: {
    provider: "opensubtitles-v1",
    libraryId: "synthetic",
    videoId: "quiet-orbit",
    savedIdentityId: "quiet-orbit-2025",
    selectedFileEvidenceHash: "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
    title: { kind: "movie-imdb", imdbId: "1234567" },
  },
};

function json(value: unknown): OpenSubtitlesHttpResponse {
  return { status: 200, headers: { "content-type": "application/json" }, body: Buffer.from(JSON.stringify(value)) };
}

function search(fileIds = [1]): OpenSubtitlesHttpResponse {
  return json({
    total_pages: 1,
    total_count: fileIds.length,
    per_page: Math.max(1, fileIds.length),
    page: 1,
    data: fileIds.map((fileId) => ({
      id: String(fileId),
      attributes: {
        language: "ar",
        release: `Fixture.${fileId}`,
        foreign_parts_only: false,
        hearing_impaired: false,
        machine_translated: false,
        ai_translated: false,
        moviehash_match: false,
        from_trusted: true,
        download_count: 10,
        files: [{ file_id: fileId, file_name: `fixture-${fileId}.srt` }],
      },
    })),
  });
}

class Routes implements OpenSubtitlesHttpTransport {
  readonly requests: OpenSubtitlesHttpRequest[] = [];
  constructor(private readonly route: (request: OpenSubtitlesHttpRequest, index: number) => OpenSubtitlesHttpResponse) {}
  request(request: OpenSubtitlesHttpRequest): OpenSubtitlesHttpResponse {
    this.requests.push(request);
    return this.route(request, this.requests.length - 1);
  }
}

function prepareWithTransport(context: test.TestContext, transport: OpenSubtitlesHttpTransport, origins = ["https://fixture-payload.invalid"],
  reservePayloadAttempt?: (fileId: number) => number | "duplicate" | "exhausted") {
  const root = mkdtempSync(path.join(tmpdir(), "payload-policy-"));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const store = openPrivateCandidateStore({ root });
  context.after(() => store.close());
  return createOpenSubtitlesPreparation({
    transport,
    candidateFiles: store,
    apiKey: "fixture-key",
    token: "fixture-token",
    payloadOrigins: origins,
  }).prepare(video, "ar", reservePayloadAttempt === undefined ? undefined : { reservePayloadAttempt });
}

test("a payload may follow two independently approved redirects without provider credentials", (context) => {
  const transport = new Routes((request, index) => {
    if (index === 0) return search();
    if (index === 1) return json({ link: "https://fixture-payload.invalid/first", remaining: 2 });
    if (index === 2) return { status: 302, headers: { location: "/second" }, body: Buffer.alloc(0) };
    if (index === 3) return { status: 307, headers: { location: "https://cdn-fixture.invalid/final" }, body: Buffer.alloc(0) };
    return { status: 200, headers: { "content-type": "application/x-subrip" }, body: validSrt };
  });

  const prepared = prepareWithTransport(context, transport, ["https://fixture-payload.invalid", "https://cdn-fixture.invalid"]);
  assert.equal(prepared.outcome, "candidates-found");
  assert.equal(transport.requests.length, 5);
  for (const request of transport.requests.slice(2)) {
    assert.equal(request.headers.authorization, undefined);
    assert.equal(request.headers["api-key"], undefined);
    assert.equal(request.headers.cookie, undefined);
  }
});

test("an unapproved payload redirect is terminal and is never requested", (context) => {
  const transport = new Routes((_request, index) => {
    if (index === 0) return search();
    if (index === 1) return json({ link: "https://fixture-payload.invalid/first", remaining: 2 });
    return { status: 302, headers: { location: "https://unapproved.invalid/final" }, body: Buffer.alloc(0) };
  });

  const prepared = prepareWithTransport(context, transport);
  assert.equal(prepared.outcome, "unsafe-content");
  assert.equal(prepared.candidates.length, 0);
  assert.equal(transport.requests.length, 3);
});

test("one gzip HTTP coding is decoded while transfer and entity limits remain independent", (context) => {
  const compressed = gzipSync(validSrt);
  const transport = new Routes((_request, index) => {
    if (index === 0) return search();
    if (index === 1) return json({ link: "https://fixture-payload.invalid/final", remaining: 2 });
    return {
      status: 200,
      headers: { "content-type": "text/plain", "content-encoding": "gzip", "content-length": String(compressed.length) },
      body: [compressed.subarray(0, 8), compressed.subarray(8)],
    };
  });

  assert.equal(prepareWithTransport(context, transport).outcome, "candidates-found");
});

test("stacked coding, trailers, and excessive headers are unsafe content", (context) => {
  for (const payload of [
    { headers: { "content-type": "text/plain", "content-encoding": "gzip, identity" }, body: gzipSync(validSrt) },
    { headers: { "content-type": "text/plain", "content-encoding": "gzip" }, body: Buffer.concat([gzipSync(validSrt), gzipSync(validSrt)]) },
    { headers: { "content-type": "text/plain", "content-encoding": "gzip" }, body: Buffer.concat([gzipSync(validSrt), Buffer.from("trailing")]) },
    { headers: { "content-type": "text/plain" }, body: validSrt, trailers: { digest: "unsafe" } },
    { headers: { "content-type": "text/plain", "Content-Length": String(validSrt.length), "content-length": String(validSrt.length) }, body: validSrt },
    { headers: { "content-type": "text/plain", "content-disposition": "attachment; filename=\"bad\u0001.srt\"" }, body: validSrt },
    { headers: Object.fromEntries(Array.from({ length: 65 }, (_, index) => [`x-${index}`, "value"])), body: validSrt },
  ] as Array<Omit<OpenSubtitlesHttpResponse, "status">>) {
    const transport = new Routes((_request, index) => index === 0
      ? search()
      : index === 1
        ? json({ link: "https://fixture-payload.invalid/final", remaining: 2 })
        : { status: 200, ...payload });
    assert.equal(prepareWithTransport(context, transport).outcome, "unsafe-content");
  }
});

test("three malformed links spend reservations before download creation and no fourth is attempted", (context) => {
  const events: string[] = [];
  const transport = new Routes((request, index) => {
    if (index === 0) return search([1, 2, 3, 4]);
    events.push(`post:${JSON.parse(request.body?.toString("utf8") ?? "{}").file_id as number}`);
    return json({ link: "not a URL", remaining: 2 });
  });
  let attempts = 0;
  const prepared = prepareWithTransport(context, transport, undefined, (fileId) => {
    attempts += 1;
    events.push(`reserve:${fileId}`);
    return attempts <= 3 ? attempts : "exhausted";
  });

  assert.equal(prepared.outcome, "payload-budget-exhausted");
  assert.deepEqual(events, ["reserve:1", "post:1", "reserve:2", "post:2", "reserve:3", "post:3"]);
  assert.equal(transport.requests.length, 4);
});

test("a resolved redirect target over 2048 ASCII characters is never requested", (context) => {
  const prefix = "https://fixture-payload.invalid/";
  const initial = `${prefix}${"a".repeat(2_048 - prefix.length)}`;
  const transport = new Routes((_request, index) => {
    if (index === 0) return search();
    if (index === 1) return json({ link: initial, remaining: 2 });
    return { status: 302, headers: { location: "?x" }, body: Buffer.alloc(0) };
  });
  assert.equal(prepareWithTransport(context, transport).outcome, "unsafe-content");
  assert.equal(transport.requests.length, 3);
});

test("a previously reserved provider file is distinguished from an exhausted budget", (context) => {
  const transport = new Routes(() => search());
  const prepared = prepareWithTransport(context, transport, undefined, () => "duplicate");
  assert.equal(prepared.outcome, "duplicate-candidate");
  assert.equal(transport.requests.length, 1);
});

test("payload response metadata includes the frozen transport deadlines", (context) => {
  const transport = new Routes((request, index) => {
    if (index === 0) return search();
    if (index === 1) return json({ link: "https://fixture-payload.invalid/final", remaining: 2 });
    assert.deepEqual(request.deadlines, { connectMs: 5_000, headersMs: 10_000, readIdleMs: 10_000, overallMs: 30_000 });
    return { status: 200, headers: { "content-type": "text/plain" }, body: validSrt };
  });
  assert.equal(prepareWithTransport(context, transport).outcome, "candidates-found");
});

for (const phase of ["connect", "headers", "read-idle", "overall"] as const) {
  test(`${phase} timeout aborts the call without hidden continuation`, (context) => {
    const transport = new Routes(() => { throw new OpenSubtitlesTransportError("timeout", phase); });
    assert.equal(prepareWithTransport(context, transport).outcome, "timed-out");
    assert.equal(transport.requests.length, 1);
  });
}

test("the workflow commits an attempt before requesting a link and never persists that link", (context) => {
  const root = mkdtempSync(path.join(tmpdir(), "durable-payload-attempt-"));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const databasePath = path.join(root, "workflow.sqlite");
  const candidateFiles = openPrivateCandidateStore({ root: path.join(root, "files") });
  const generatedLink = "https://fixture-payload.invalid/generated-secret-capability";
  const transport = new Routes((_request, index) => {
    if (index === 0) return search();
    if (index === 1) {
      const inspection = new Database(databasePath, { readonly: true });
      const count = (inspection.prepare("SELECT count(*) AS count FROM provider_payload_attempts").get() as { count: number }).count;
      inspection.close();
      assert.equal(count, 1);
      return json({ link: generatedLink, remaining: 2 });
    }
    return { status: 200, headers: { "content-type": "text/plain" }, body: validSrt };
  });
  const preparation = createOpenSubtitlesPreparation({
    transport,
    candidateFiles,
    apiKey: "fixture-key",
    token: "fixture-token",
    payloadOrigins: ["https://fixture-payload.invalid"],
  });
  const workflow = openRequestWorkflow({ databasePath, preparation, candidateFiles });
  context.after(() => { workflow.close(); candidateFiles.close(); });
  workflow.issue({ type: "create-request", request: { id: "durable", version: 0 }, video, language: "ar" });
  const prepared = workflow.issue({ type: "prepare-request", request: { id: "durable", version: 1 } });
  assert.equal(prepared.preparation?.outcome, "candidates-found");

  const inspection = new Database(databasePath, { readonly: true });
  const attempts = inspection.prepare("SELECT attempt_number, provider_file_id FROM provider_payload_attempts").all();
  const persistedText = inspection.prepare(`
    SELECT candidates_json || explanation || next_actions_json AS value FROM request_preparations
    UNION ALL SELECT provider_identity_json AS value FROM subtitle_requests
    UNION ALL SELECT sql AS value FROM sqlite_master
  `).all().map((row) => (row as { value: string | null }).value ?? "").join("\n");
  inspection.close();
  assert.deepEqual(attempts, [{ attempt_number: 1, provider_file_id: 1 }]);
  assert.doesNotMatch(persistedText, /generated-secret-capability/);
});
