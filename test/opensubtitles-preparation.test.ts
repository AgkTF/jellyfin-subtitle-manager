import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import Database from "better-sqlite3";

import { buildServer } from "../src/server/app.js";
import {
  createOpenSubtitlesPreparation,
  type OpenSubtitlesHttpRequest,
  type OpenSubtitlesHttpTransport,
} from "../src/server/opensubtitles-preparation.js";
import type { PreparationVideo } from "../src/server/candidate-preparation.js";
import { openPrivateCandidateStore } from "../src/server/private-candidate-store.js";
import { openRequestWorkflow } from "../src/server/request-workflow.js";

const srt = Buffer.from([
  "1",
  "00:00:01,000 --> 00:00:03,000",
  "A fixture subtitle.",
  "",
  "2",
  "00:01:00,000 --> 00:01:02,000",
  "Original UTF-8 bytes survive staging — مرحبًا",
  "",
].join("\r\n"), "utf8");

class SyntheticOpenSubtitlesHttp implements OpenSubtitlesHttpTransport {
  readonly requests: OpenSubtitlesHttpRequest[] = [];

  constructor(
    private readonly payload = srt,
    private readonly candidate = { subtitleId: "918273", fileId: 456789 },
  ) {}

  request(request: OpenSubtitlesHttpRequest) {
    this.requests.push(request);
    const url = new URL(request.url);
    if (request.method === "GET" && url.hostname === "api.opensubtitles.com") {
      return {
        status: 200,
        headers: { "content-type": "application/json" },
        body: Buffer.from(JSON.stringify({
          total_pages: 1,
          total_count: 1,
          per_page: 50,
          page: 1,
          data: [{
            id: this.candidate.subtitleId,
            attributes: {
              language: "ar",
              release: "Quiet.Orbit.2025.1080p.WEB-DL",
              foreign_parts_only: false,
              hearing_impaired: false,
              machine_translated: false,
              ai_translated: false,
              moviehash_match: false,
              from_trusted: true,
              download_count: 100,
              files: [{ file_id: this.candidate.fileId, file_name: "Quiet.Orbit.2025.ar.srt" }],
            },
          }],
        }), "utf8"),
      };
    }
    if (request.method === "POST" && url.pathname === "/api/v1/download") {
      return {
        status: 200,
        headers: { "content-type": "application/json" },
        body: Buffer.from(JSON.stringify({
          link: `https://fixture-payload.invalid/download/${this.candidate.fileId}`,
          file_name: "Quiet.Orbit.2025.ar.srt",
          remaining: 99,
        }), "utf8"),
      };
    }
    if (request.method === "GET" && url.hostname === "fixture-payload.invalid") {
      return {
        status: 200,
        headers: { "content-type": "application/x-subrip" },
        body: this.payload,
      };
    }
    throw new Error(`Unexpected synthetic HTTP request: ${request.method} ${request.url}`);
  }
}

async function mutationHeaders(server: ReturnType<typeof buildServer>) {
  const host = "localhost:80";
  const origin = `http://${host}`;
  const response = await server.inject({ method: "GET", url: "/api/csrf-token", headers: { host, origin } });
  const cookieHeader = response.headers["set-cookie"];
  const cookie = Array.isArray(cookieHeader) ? cookieHeader[0] : cookieHeader;
  const token = cookie?.match(/^subtitle_csrf=([^;]+)/)?.[1];
  assert.ok(token);
  return { host, origin, cookie: cookie?.split(";", 1)[0], "x-csrf-token": token };
}

test("an explicit request prepares and restores one privately staged OpenSubtitles SRT", async (context) => {
  const directory = mkdtempSync(path.join(tmpdir(), "opensubtitles-preparation-"));
  const databasePath = path.join(directory, "workflow.sqlite");
  const stagingRoot = path.join(directory, "candidate-files");
  context.after(() => rmSync(directory, { recursive: true, force: true }));

  const transport = new SyntheticOpenSubtitlesHttp();
  let files = openPrivateCandidateStore({ root: stagingRoot });
  const preparation = createOpenSubtitlesPreparation({
    transport,
    candidateFiles: files,
    apiKey: "fixture-api-key",
    token: "fixture-user-token",
    payloadOrigins: ["https://fixture-payload.invalid"],
  });
  let workflow = openRequestWorkflow({ databasePath, preparation, candidateFiles: files });
  let server = buildServer({ workflow });
  const headers = await mutationHeaders(server);

  const browserSuppliedProviderIdentity = await server.inject({
    method: "POST",
    url: "/api/requests",
    headers,
    payload: {
      videoId: "quiet-orbit", identityId: "quiet-orbit-2025", language: "ar",
      imdbId: "7654321",
    },
  });
  assert.equal(browserSuppliedProviderIdentity.statusCode, 201);
  assert.doesNotMatch(browserSuppliedProviderIdentity.body, /imdb|7654321/i);
  assert.equal(transport.requests.length, 0);

  const created = await server.inject({
    method: "POST",
    url: "/api/requests",
    headers,
    payload: { videoId: "quiet-orbit", identityId: "quiet-orbit-2025", language: "ar" },
  });
  assert.equal(created.statusCode, 201);
  assert.doesNotMatch(created.body, /imdb|tmdb|api-key|token|fixture-payload/i);

  const prepared = await server.inject({
    method: "POST",
    url: `/api/requests/${created.json().id}/prepare`,
    headers,
    payload: { version: 1 },
  });
  assert.equal(prepared.statusCode, 200);
  const candidate = prepared.json().preparation.candidates[0];
  assert.equal(prepared.json().preparation.candidates.length, 1);
  assert.equal(candidate.provider.name, "opensubtitles-v1");
  assert.equal(candidate.provider.subtitleId, "918273");
  assert.equal(candidate.provider.fileId, 456789);
  assert.equal(candidate.release, "Quiet.Orbit.2025.1080p.WEB-DL");
  assert.equal(candidate.provenance, "provider-reported");
  assert.equal(candidate.timing.status, "unmeasured");
  assert.equal(candidate.completeness.status, "unmeasured");
  assert.equal(candidate.contentHash, createHash("sha256").update(srt).digest("hex"));
  assert.doesNotMatch(prepared.body, /fixture-api-key|fixture-user-token|fixture-payload\.invalid/);

  assert.equal(transport.requests.length, 3);
  const searchUrl = new URL(transport.requests[0].url);
  assert.equal(searchUrl.pathname, "/api/v1/subtitles");
  assert.equal(searchUrl.searchParams.get("languages"), "ar");
  assert.equal(searchUrl.searchParams.get("imdb_id"), "1234567");
  assert.equal(searchUrl.searchParams.has("query"), false);
  assert.equal(transport.requests[1].body?.toString("utf8"), JSON.stringify({ file_id: 456789, sub_format: "srt" }));
  assert.equal(transport.requests[2].headers.authorization, undefined);
  assert.equal(transport.requests[2].headers["api-key"], undefined);

  const database = new Database(databasePath, { readonly: true });
  const attachment = database.prepare(`
    SELECT content, staged_file_id FROM candidate_attachments WHERE request_id = ?
  `).get(created.json().id) as { content: Buffer | null; staged_file_id: string };
  database.close();
  assert.equal(attachment.content, null);
  assert.match(attachment.staged_file_id, /^[0-9a-f-]{36}\.srt$/);
  const stagedPath = path.join(stagingRoot, attachment.staged_file_id);
  assert.deepEqual(readFileSync(stagedPath), srt);
  assert.equal(statSync(stagedPath).mode & 0o777, 0o600);

  await server.close();
  workflow.close();
  files.close();

  files = openPrivateCandidateStore({ root: stagingRoot });
  workflow = openRequestWorkflow({ databasePath, preparation, candidateFiles: files });
  server = buildServer({ workflow });
  context.after(async () => { await server.close(); workflow.close(); files.close(); });

  const restored = await server.inject({ method: "GET", url: `/api/requests/${created.json().id}` });
  assert.equal(restored.statusCode, 200);
  assert.equal(restored.json().preparation.candidates[0].contentHash, candidate.contentHash);
  assert.equal(restored.json().preparation.candidates[0].attachment.id, candidate.attachment.id);
  const download = await server.inject({ method: "GET", url: candidate.attachment.downloadUrl });
  assert.deepEqual(download.rawPayload, srt);
  assert.equal(transport.requests.length, 3);
});

test("prepares one ranked recommendation and two alternatives within the payload budget", (context) => {
  const directory = mkdtempSync(path.join(tmpdir(), "opensubtitles-multiple-candidates-"));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  const candidateFiles = openPrivateCandidateStore({ root: directory });
  context.after(() => candidateFiles.close());
  const payloads = new Map([
    [11, Buffer.from("1\r\n00:00:01,000 --> 00:00:02,000\r\nFirst candidate.\r\n")],
    [12, Buffer.from("1\r\n00:00:01,000 --> 00:00:02,000\r\nSecond candidate.\r\n")],
    [13, Buffer.from("1\r\n00:00:01,000 --> 00:00:02,000\r\nThird candidate.\r\n")],
  ]);
  const requests: OpenSubtitlesHttpRequest[] = [];
  const transport: OpenSubtitlesHttpTransport = {
    request(request) {
      requests.push(request);
      const url = new URL(request.url);
      if (request.method === "GET" && url.hostname === "api.opensubtitles.com") {
        return {
          status: 200, headers: { "content-type": "application/json" },
          body: Buffer.from(JSON.stringify({
            total_pages: 1, total_count: 3, per_page: 50, page: 1,
            data: [
              { id: "103", attributes: { language: "ar", release: "Release.C", foreign_parts_only: false, hearing_impaired: true, machine_translated: false, ai_translated: false, moviehash_match: false, from_trusted: false, download_count: 5, files: [{ file_id: 13, file_name: "c.srt" }] } },
              { id: "101", attributes: { language: "ar", release: "Release.A", foreign_parts_only: false, hearing_impaired: false, machine_translated: false, ai_translated: false, moviehash_match: true, from_trusted: true, download_count: 20, files: [{ file_id: 11, file_name: "a.srt" }] } },
              { id: "102", attributes: { language: "ar", release: "Release.B", foreign_parts_only: false, hearing_impaired: false, machine_translated: false, ai_translated: false, moviehash_match: false, from_trusted: true, download_count: 10, files: [{ file_id: 12, file_name: "b.srt" }] } },
            ],
          })),
        };
      }
      if (request.method === "POST") {
        const fileId = JSON.parse(request.body?.toString("utf8") ?? "{}").file_id as number;
        return { status: 200, headers: { "content-type": "application/json" }, body: Buffer.from(JSON.stringify({ link: `https://fixture-payload.invalid/${fileId}`, remaining: 10 })) };
      }
      const fileId = Number(url.pathname.slice(1));
      return { status: 200, headers: { "content-type": "application/x-subrip" }, body: payloads.get(fileId) ?? Buffer.alloc(0) };
    },
  };
  const result = createOpenSubtitlesPreparation({
    transport, candidateFiles, apiKey: "fixture-key", token: "fixture-token",
    payloadOrigins: ["https://fixture-payload.invalid"],
  }).prepare({
    libraryId: "synthetic", id: "quiet-orbit-2025", label: "Quiet Orbit (2025)", savedVideoId: "quiet-orbit",
    openSubtitlesSearchIdentity: {
      provider: "opensubtitles-v1", libraryId: "synthetic", videoId: "quiet-orbit", savedIdentityId: "quiet-orbit-2025",
      selectedFileEvidenceHash: "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
      title: { kind: "movie-imdb", imdbId: "1234567" },
      movieHash: { algorithm: "opensubtitles-moviehash-v1", value: "0123456789abcdef", sourceByteLength: 100, selectedFileEvidenceHash: "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08" },
    },
  }, "ar");

  assert.equal(result.outcome, "candidates-found");
  assert.deepEqual(result.candidates.map((candidate) => candidate.provider?.fileId), [11, 12, 13]);
  assert.equal(result.recommendedCandidateId, "opensubtitles-101-11");
  assert.match(result.candidates[0].recommendationReason, /Arabic.*standard dialogue.*Release\.A.*provider-reported movie-hash match.*trusted-source claim/i);
  assert.equal(result.attachments.length, 3);
  assert.equal(requests.length, 7);
});

test("duplicate provider identity and bytes consume attempts without creating alternatives", (context) => {
  const directory = mkdtempSync(path.join(tmpdir(), "opensubtitles-run-duplicates-"));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  const candidateFiles = openPrivateCandidateStore({ root: directory });
  context.after(() => candidateFiles.close());
  const attempts: number[] = [];
  const posts: number[] = [];
  const body = Buffer.from("1\r\n00:00:01,000 --> 00:00:02,000\r\nSame bytes.\r\n");
  const transport: OpenSubtitlesHttpTransport = {
    request(request) {
      const url = new URL(request.url);
      if (request.method === "GET" && url.hostname === "api.opensubtitles.com") return {
        status: 200, headers: { "content-type": "application/json" }, body: Buffer.from(JSON.stringify({
          total_pages: 1, total_count: 3, per_page: 50, page: 1,
          data: [
            { id: "201", attributes: { language: "ar", release: "One", foreign_parts_only: false, hearing_impaired: false, machine_translated: false, ai_translated: false, from_trusted: true, download_count: 30, files: [{ file_id: 21, file_name: "one.srt" }] } },
            { id: "201", attributes: { language: "ar", release: "One alternate file", foreign_parts_only: false, hearing_impaired: false, machine_translated: false, ai_translated: false, from_trusted: true, download_count: 20, files: [{ file_id: 22, file_name: "one-alt.srt" }] } },
            { id: "202", attributes: { language: "ar", release: "Two", foreign_parts_only: false, hearing_impaired: false, machine_translated: false, ai_translated: false, from_trusted: true, download_count: 10, files: [{ file_id: 23, file_name: "two.srt" }] } },
          ],
        })) };
      if (request.method === "POST") {
        const fileId = JSON.parse(request.body?.toString("utf8") ?? "{}").file_id as number;
        posts.push(fileId);
        return { status: 200, headers: { "content-type": "application/json" }, body: Buffer.from(JSON.stringify({ link: `https://fixture-payload.invalid/${fileId}`, remaining: 10 })) };
      }
      return { status: 200, headers: { "content-type": "application/x-subrip" }, body };
    },
  };
  const adapter = createOpenSubtitlesPreparation({ transport, candidateFiles, apiKey: "key", token: "token", payloadOrigins: ["https://fixture-payload.invalid"] });
  const result = adapter.prepare({
    libraryId: "synthetic", id: "quiet-orbit-2025", label: "Quiet Orbit", savedVideoId: "quiet-orbit",
    openSubtitlesSearchIdentity: { provider: "opensubtitles-v1", libraryId: "synthetic", videoId: "quiet-orbit", savedIdentityId: "quiet-orbit-2025", selectedFileEvidenceHash: "a".repeat(64), title: { kind: "movie-imdb", imdbId: "123" } },
  }, "ar", { reservePayloadAttempt(fileId) { attempts.push(fileId); return attempts.length; } });

  assert.deepEqual(attempts, [21, 22, 23]);
  assert.deepEqual(posts, [21, 23]);
  assert.equal(result.outcome, "candidates-found");
  assert.equal(result.candidates.length, 1);
});

test("identical bytes from distinct provider identities are rejected without staging another file", (context) => {
  const directory = mkdtempSync(path.join(tmpdir(), "opensubtitles-duplicate-bytes-"));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
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
  const firstFiles = openPrivateCandidateStore({ root: directory });
  const first = createOpenSubtitlesPreparation({
    transport: new SyntheticOpenSubtitlesHttp(), candidateFiles: firstFiles,
    apiKey: "fixture-api-key", token: "fixture-user-token", payloadOrigins: ["https://fixture-payload.invalid"],
  }).prepare(video, "ar");
  assert.equal(first.outcome, "candidates-found");
  firstFiles.close();

  const secondFiles = openPrivateCandidateStore({ root: directory });
  context.after(() => secondFiles.close());
  const second = createOpenSubtitlesPreparation({
    transport: new SyntheticOpenSubtitlesHttp(srt, { subtitleId: "918274", fileId: 456790 }), candidateFiles: secondFiles,
    apiKey: "fixture-api-key", token: "fixture-user-token", payloadOrigins: ["https://fixture-payload.invalid"],
  }).prepare(video, "ar");
  assert.equal(second.outcome, "duplicate-candidate");
  assert.equal(second.attachments.length, 0);
  assert.equal(readdirSync(directory).length, 1);
});

test("malformed subtitle bytes never become a staged candidate", (context) => {
  const directory = mkdtempSync(path.join(tmpdir(), "opensubtitles-invalid-srt-"));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  const candidateFiles = openPrivateCandidateStore({ root: directory });
  const preparation = createOpenSubtitlesPreparation({
    transport: new SyntheticOpenSubtitlesHttp(Buffer.from("not an srt", "utf8")),
    candidateFiles,
    apiKey: "fixture-api-key",
    token: "fixture-user-token",
    payloadOrigins: ["https://fixture-payload.invalid"],
  });

  const result = preparation.prepare({
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
  }, "ar");
  assert.equal(result.outcome, "unsafe-content");
  assert.equal(result.candidates.length, 0);
  assert.deepEqual(readdirSync(directory), []);
});

test("stale or malformed provider identity blocks before synthetic HTTP", (context) => {
  const directory = mkdtempSync(path.join(tmpdir(), "opensubtitles-blocked-identity-"));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  const transport = new SyntheticOpenSubtitlesHttp();
  const candidateFiles = openPrivateCandidateStore({ root: directory });
  const preparation = createOpenSubtitlesPreparation({
    transport,
    candidateFiles,
    apiKey: "fixture-api-key",
    token: "fixture-user-token",
    payloadOrigins: ["https://fixture-payload.invalid"],
  });

  const blocked = preparation.prepare({
    libraryId: "synthetic",
    id: "quiet-orbit-2025",
    label: "Quiet Orbit (2025)",
    savedVideoId: "different-video",
    openSubtitlesSearchIdentity: {
      provider: "opensubtitles-v1",
      libraryId: "synthetic",
      videoId: "quiet-orbit",
      savedIdentityId: "quiet-orbit-2025",
      selectedFileEvidenceHash: "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
      title: { kind: "episode-tmdb", parentTmdbId: 0, season: 1_000, episode: 10_000 },
      movieHash: {
        algorithm: "opensubtitles-moviehash-v1",
        value: "ABCDEF0123456789",
        sourceByteLength: 0,
        selectedFileEvidenceHash: "0".repeat(64),
      },
    },
  }, "ar");

  assert.equal(blocked.outcome, "blocked");
  assert.equal(blocked.candidates.length, 0);
  assert.equal(transport.requests.length, 0);
  assert.deepEqual(readdirSync(directory), []);
});
