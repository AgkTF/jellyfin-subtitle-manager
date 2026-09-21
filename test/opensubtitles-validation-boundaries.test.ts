import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createOpenSubtitlesPreparation,
  type OpenSubtitlesHttpTransport,
} from "../src/server/opensubtitles-preparation.js";
import type { PreparationVideo } from "../src/server/candidate-preparation.js";
import { openPrivateCandidateStore } from "../src/server/private-candidate-store.js";

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

function srt(cueCount: number, textLines = ["Boundary fixture."]): Buffer {
  const timestamp = (seconds: number) => {
    const hours = Math.floor(seconds / 3_600);
    const minutes = Math.floor(seconds / 60) % 60;
    const remainder = seconds % 60;
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")},000`;
  };
  return Buffer.from(Array.from({ length: cueCount }, (_, index) => [
    String(index + 1),
    `${timestamp(index)} --> ${timestamp(index + 1)}`,
    ...textLines,
    "",
  ].join("\n")).join("\n"), "utf8");
}

function prepare(context: test.TestContext, payload: Buffer, contentType = "text/plain") {
  const root = mkdtempSync(path.join(tmpdir(), "srt-boundaries-"));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const candidateFiles = openPrivateCandidateStore({ root });
  context.after(() => candidateFiles.close());
  let index = 0;
  const transport: OpenSubtitlesHttpTransport = {
    request() {
      index += 1;
      if (index === 1) {
        return {
          status: 200,
          headers: { "content-type": "application/json" },
          body: Buffer.from(JSON.stringify({
            total_pages: 1, total_count: 1, per_page: 1, page: 1,
            data: [{ id: "1", attributes: {
              language: "ar", release: "Boundary", foreign_parts_only: false,
              hearing_impaired: false, machine_translated: false, ai_translated: false,
              moviehash_match: false, from_trusted: true, download_count: 1,
              files: [{ file_id: 1, file_name: "boundary.srt" }],
            } }],
          })),
        };
      }
      if (index === 2) {
        return {
          status: 200,
          headers: { "content-type": "application/json" },
          body: Buffer.from(JSON.stringify({ link: "https://fixture-payload.invalid/boundary", remaining: 1 })),
        };
      }
      return { status: 200, headers: { "content-type": contentType }, body: payload };
    },
  };
  return createOpenSubtitlesPreparation({
    transport, candidateFiles, apiKey: "key", token: "token", payloadOrigins: ["https://fixture-payload.invalid"],
  }).prepare(video, "ar");
}

test("SRT accepts exact cue-text and cue-count limits but rejects one over", (context) => {
  assert.equal(prepare(context, srt(1, ["x".repeat(8 * 1024)])).outcome, "candidates-found");
  assert.equal(prepare(context, srt(1, ["x".repeat(8 * 1024 + 1)])).outcome, "unsafe-content");
  assert.equal(prepare(context, srt(20_000, ["x"])).outcome, "candidates-found");
  assert.equal(prepare(context, srt(20_001, ["x"])).outcome, "unsafe-content");
});

test("archive signatures and path or link evidence never reach private staging", (context) => {
  const archivePayloads = [
    Buffer.from("PK\x03\x04nested/path.srt", "latin1"),
    Buffer.from("Rar!\x1a\x07unsafe", "latin1"),
    Buffer.from("7z\xbc\xaf\x27\x1cunsafe", "latin1"),
    Buffer.from("1\n00:00:01,000 --> 00:00:02,000\n(<https://unsafe.invalid>)\n", "utf8"),
    Buffer.from("1\n00:00:01,000 --> 00:00:02,000\n../outside\n", "utf8"),
  ];
  for (const payload of archivePayloads) {
    assert.equal(prepare(context, payload).outcome, "unsafe-content");
  }
  assert.equal(prepare(context, Buffer.from([0xff, 0xfe, 0xfd])).outcome, "unsafe-content");
  assert.equal(prepare(context, Buffer.from("not an SRT", "utf8"), "application/octet-stream").outcome, "unsafe-content");
});
