import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

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

const srt = Buffer.from("1\r\n00:00:01,000 --> 00:00:03,000\r\nFixture subtitle.\r\n", "utf8");
const identityVideo: PreparationVideo = {
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

function json(status: number, value: unknown, headers: Record<string, string> = {}): OpenSubtitlesHttpResponse {
  return {
    status,
    headers: { "content-type": "application/json", ...headers },
    body: Buffer.from(JSON.stringify(value), "utf8"),
  };
}

function result(id: string, fileId: number, overrides: Record<string, unknown> = {}) {
  return {
    id,
    attributes: {
      language: "ar",
      release: `Quiet.Orbit.Release.${id}`,
      foreign_parts_only: false,
      hearing_impaired: false,
      machine_translated: false,
      ai_translated: false,
      moviehash_match: false,
      from_trusted: true,
      download_count: 100,
      files: [{ file_id: fileId, file_name: `quiet-orbit-${fileId}.srt` }],
      ...overrides,
    },
  };
}

function page(pageNumber: number, totalPages: number, data: unknown[], totalCount = data.length) {
  return json(200, {
    total_pages: totalPages,
    total_count: totalCount,
    per_page: Math.max(1, data.length),
    page: pageNumber,
    data,
  });
}

class RouteTransport implements OpenSubtitlesHttpTransport {
  readonly requests: OpenSubtitlesHttpRequest[] = [];

  constructor(private readonly route: (request: OpenSubtitlesHttpRequest, index: number) => OpenSubtitlesHttpResponse) {}

  request(request: OpenSubtitlesHttpRequest): OpenSubtitlesHttpResponse {
    this.requests.push(request);
    return this.route(request, this.requests.length - 1);
  }
}

function withPreparation(
  context: test.TestContext,
  transport: OpenSubtitlesHttpTransport,
  run: (preparation: ReturnType<typeof createOpenSubtitlesPreparation>) => void,
) {
  const directory = mkdtempSync(path.join(tmpdir(), "opensubtitles-bounds-"));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  const candidateFiles = openPrivateCandidateStore({ root: directory });
  context.after(() => candidateFiles.close());
  run(createOpenSubtitlesPreparation({
    transport,
    candidateFiles,
    apiKey: "fixture-api-key",
    token: "fixture-token",
    payloadOrigins: ["https://fixture-payload.invalid"],
  }));
}

function successfulDownloadRoute(request: OpenSubtitlesHttpRequest): OpenSubtitlesHttpResponse | undefined {
  const url = new URL(request.url);
  if (request.method === "POST" && url.pathname === "/api/v1/download") {
    const fileId = (JSON.parse(request.body?.toString("utf8") ?? "{}") as { file_id: number }).file_id;
    return json(200, {
      link: `https://fixture-payload.invalid/download/${fileId}`,
      file_name: `quiet-orbit-${fileId}.srt`,
      requests: 1,
      remaining: 20,
      reset_time_utc: "2026-09-22T00:00:00Z",
    });
  }
  if (request.method === "GET" && url.hostname === "fixture-payload.invalid") {
    const fileId = url.pathname.split("/").at(-1) ?? "unknown";
    return {
      status: 200,
      headers: { "content-type": "application/x-subrip" },
      body: Buffer.from(`1\r\n00:00:01,000 --> 00:00:03,000\r\nFixture subtitle ${fileId}.\r\n`, "utf8"),
    };
  }
  return undefined;
}

test("bounded pagination collects eligible files before deterministic payload selection", (context) => {
  const transport = new RouteTransport((request) => {
    const fallback = successfulDownloadRoute(request);
    if (fallback !== undefined) return fallback;
    const requestedPage = Number(new URL(request.url).searchParams.get("page"));
    if (requestedPage === 1) return page(1, 2, [result("20", 200, { from_trusted: false, download_count: 10 })], 2);
    if (requestedPage === 2) return page(2, 2, [result("10", 100, { from_trusted: true, download_count: 1 })], 2);
    throw new Error(`Unexpected request ${request.url}`);
  });

  withPreparation(context, transport, (preparation) => {
    const prepared = preparation.prepare(identityVideo, "ar");
    assert.equal(prepared.outcome, "candidates-found");
    assert.deepEqual(prepared.candidates.map((candidate) => candidate.provider?.fileId), [100, 200]);
    assert.equal(prepared.candidates[0].provider?.fromTrusted, true);
    assert.equal(prepared.candidates[0].provider?.downloadCount, 1);
    assert.deepEqual(transport.requests.filter((request) => request.url.includes("/subtitles?"))
      .map((request) => new URL(request.url).searchParams.get("page")), ["1", "2"]);
  });
});

test("large numeric provider IDs retain exact ascending order", (context) => {
  const transport = new RouteTransport((request) => {
    const fallback = successfulDownloadRoute(request);
    if (fallback !== undefined) return fallback;
    return page(1, 1, [
      result("9007199254740993", 2),
      result("9007199254740992", 1),
    ], 2);
  });
  withPreparation(context, transport, (preparation) => {
    const prepared = preparation.prepare(identityVideo, "ar");
    assert.equal(prepared.outcome, "candidates-found");
    assert.equal(prepared.candidates[0].provider?.subtitleId, "9007199254740992");
  });
});

test("empty bounded search is a durable no-candidates result and performs no hidden work after restart", (context) => {
  const directory = mkdtempSync(path.join(tmpdir(), "opensubtitles-empty-"));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  const transport = new RouteTransport(() => page(1, 1, []));
  const candidateFiles = openPrivateCandidateStore({ root: path.join(directory, "files") });
  context.after(() => candidateFiles.close());
  const preparation = createOpenSubtitlesPreparation({
    transport, candidateFiles, apiKey: "fixture-api-key", token: "fixture-token",
    payloadOrigins: ["https://fixture-payload.invalid"],
  });
  const databasePath = path.join(directory, "workflow.sqlite");
  let workflow = openRequestWorkflow({ databasePath, preparation, candidateFiles });
  workflow.issue({ type: "create-request", request: { id: "request-empty", version: 0 }, video: identityVideo, language: "ar" });
  const prepared = workflow.issue({ type: "prepare-request", request: { id: "request-empty", version: 1 } });
  assert.equal(prepared.preparation?.outcome, "no-candidates");
  assert.equal(transport.requests.length, 1);
  workflow.close();
  workflow = openRequestWorkflow({ databasePath, preparation, candidateFiles });
  context.after(() => workflow.close());
  assert.equal(workflow.getRequest("request-empty")?.preparation?.outcome, "no-candidates");
  assert.equal(transport.requests.length, 1);
});

test("a result without movie-hash metadata remains eligible when no movie hash was submitted", (context) => {
  const candidate = result("1", 1);
  delete (candidate.attributes as Record<string, unknown>).moviehash_match;
  const routed = new RouteTransport((request) => successfulDownloadRoute(request) ?? page(1, 1, [candidate]));
  withPreparation(context, routed, (preparation) => {
    const prepared = preparation.prepare(identityVideo, "ar");
    assert.equal(prepared.outcome, "candidates-found");
    assert.equal(prepared.candidates[0].provider?.moviehashMatch, false);
  });
});

test("malformed pagination terminates without guessing defaults", (context) => {
  const transport = new RouteTransport(() => page(2, 2, [result("1", 1)]));
  withPreparation(context, transport, (preparation) => {
    assert.equal(preparation.prepare(identityVideo, "ar").outcome, "malformed-provider-response");
    assert.equal(transport.requests.length, 1);
  });
});

for (const scenario of [
  { name: "authentication", response: json(401, { message: "secret provider body" }), outcome: "authentication-failed" },
  { name: "quota", response: json(429, { message: "wait and retry" }, { "retry-after": "3600" }), outcome: "quota-exhausted" },
  { name: "provider", response: json(503, { message: "provider internals" }), outcome: "provider-failed" },
] as const) {
  test(`${scenario.name} search failure is terminal without retry or payload download`, (context) => {
    const transport = new RouteTransport(() => scenario.response);
    withPreparation(context, transport, (preparation) => {
      const prepared = preparation.prepare(identityVideo, "ar");
      assert.equal(prepared.outcome, scenario.outcome);
      assert.doesNotMatch(prepared.explanation, /secret provider body|wait and retry|provider internals/i);
      assert.equal(transport.requests.length, 1);
    });
  });
}

test("download-link quota exhaustion stops before payload fetch", (context) => {
  const transport = new RouteTransport((request, index) => {
    if (index === 0) return page(1, 1, [result("1", 1)]);
    if (index === 1) return json(200, {
      link: "https://fixture-payload.invalid/should-not-be-fetched",
      requests: 20,
      remaining: 0,
      reset_time_utc: "2026-09-22T00:00:00Z",
    });
    throw new Error(`Unexpected request ${request.url}`);
  });
  withPreparation(context, transport, (preparation) => {
    assert.equal(preparation.prepare(identityVideo, "ar").outcome, "quota-exhausted");
    assert.equal(transport.requests.length, 2);
  });
});

test("timeout and transport failures remain distinct terminal outcomes", (context) => {
  for (const [kind, expected] of [["timeout", "timed-out"], ["transport", "transport-failed"]] as const) {
    const transport: OpenSubtitlesHttpTransport = {
      request() { throw new OpenSubtitlesTransportError(kind); },
    };
    withPreparation(context, transport, (preparation) => {
      assert.equal(preparation.prepare(identityVideo, "ar").outcome, expected);
    });
  }
});

test("search follows one same-origin redirect without leaking credentials to the payload origin", (context) => {
  const transport = new RouteTransport((request, index) => {
    if (index === 0) return { status: 302, headers: { location: "/api/v1/subtitles?redirected=1" }, body: Buffer.alloc(0) };
    if (index === 1) return page(1, 1, [result("1", 1)]);
    if (index === 2) return json(200, { link: "https://fixture-payload.invalid/final", remaining: 2 });
    if (index === 3) return { status: 200, headers: { "content-type": "text/plain" }, body: srt };
    throw new Error(`Unexpected request ${request.url}`);
  });

  withPreparation(context, transport, (preparation) => {
    assert.equal(preparation.prepare(identityVideo, "ar").outcome, "candidates-found");
    assert.equal(transport.requests.length, 4);
    assert.match(transport.requests[1].headers.authorization, /^Bearer /);
    assert.equal(transport.requests[3].headers.authorization, undefined);
    assert.equal(transport.requests[3].headers["api-key"], undefined);
  });
});

test("a cross-origin search redirect is rejected before credentials are forwarded", (context) => {
  const transport = new RouteTransport(() => ({
    status: 302,
    headers: { location: "https://vip-api.opensubtitles.com/api/v1/subtitles" },
    body: Buffer.alloc(0),
  }));
  withPreparation(context, transport, (preparation) => {
    assert.equal(preparation.prepare(identityVideo, "ar").outcome, "unsafe-content");
    assert.equal(transport.requests.length, 1);
  });
});

test("the result inspection cap stops pagination without turning bounded completion into failure", (context) => {
  const hundredIneligibleResults = Array.from({ length: 100 }, (_, index) =>
    result(String(index + 1), index + 1, { machine_translated: true }));
  const transport = new RouteTransport((request) => {
    const requestedPage = Number(new URL(request.url).searchParams.get("page"));
    return page(requestedPage, 2, hundredIneligibleResults, 200);
  });
  withPreparation(context, transport, (preparation) => {
    assert.equal(preparation.prepare(identityVideo, "ar").outcome, "no-candidates");
    assert.equal(transport.requests.length, 1);
  });
});

test("the 200-file inspection cap stops before another search page", (context) => {
  const fiftyResults = Array.from({ length: 50 }, (_, resultIndex) => result(
    String(resultIndex + 1),
    resultIndex * 4 + 1,
    {
      files: Array.from({ length: 4 }, (_, fileIndex) => ({
        file_id: resultIndex * 4 + fileIndex + 1,
        file_name: `candidate-${resultIndex}-${fileIndex}.srt`,
      })),
    },
  ));
  const transport = new RouteTransport((request) => {
    const fallback = successfulDownloadRoute(request);
    if (fallback !== undefined) return fallback;
    return page(1, 2, fiftyResults, 100);
  });
  withPreparation(context, transport, (preparation) => {
    assert.equal(preparation.prepare(identityVideo, "ar").outcome, "candidates-found");
    assert.equal(transport.requests.filter((request) => request.url.includes("/subtitles?")).length, 1);
  });
});

test("exhausting the three-page search bound completes without requesting a fourth page", (context) => {
  const transport = new RouteTransport((request) => {
    const requestedPage = Number(new URL(request.url).searchParams.get("page"));
    return page(requestedPage, 9, [result(String(requestedPage), requestedPage, { machine_translated: true })], 9);
  });
  withPreparation(context, transport, (preparation) => {
    assert.equal(preparation.prepare(identityVideo, "ar").outcome, "no-candidates");
    assert.equal(transport.requests.length, 3);
  });
});
