import { createHash } from "node:crypto";

import type {
  CandidatePreparationAdapter,
  OpenSubtitlesSearchIdentity,
  ProviderTitleIdentity,
  SubtitleCandidate,
} from "./candidate-preparation.js";
import type { PrivateCandidateStore } from "./private-candidate-store.js";

export interface OpenSubtitlesHttpRequest {
  method: "GET" | "POST";
  url: string;
  headers: Record<string, string>;
  body?: Buffer;
}

export interface OpenSubtitlesHttpResponse {
  status: number;
  headers: Record<string, string | undefined>;
  body: Buffer;
}

export interface OpenSubtitlesHttpTransport {
  request(request: OpenSubtitlesHttpRequest): OpenSubtitlesHttpResponse;
}

interface SearchFile {
  file_id: number;
  file_name: string;
}

interface SearchResult {
  id: string;
  attributes: {
    language: string;
    release: string;
    foreign_parts_only: boolean;
    hearing_impaired: boolean;
    machine_translated: boolean;
    ai_translated: boolean;
    files: SearchFile[];
  };
}

interface SearchResponse {
  total_pages: number;
  total_count: number;
  per_page: number;
  page: number;
  data: SearchResult[];
}

const apiOrigin = "https://api.opensubtitles.com";
const jsonContentType = /^application\/(?:json|[A-Za-z0-9!#$&^_.+-]+\+json)(?:\s*;|$)/i;
const payloadContentTypes = new Set(["text/plain", "application/x-subrip"]);

function decodeJson(response: OpenSubtitlesHttpResponse): unknown {
  if (response.status !== 200 || !jsonContentType.test(response.headers["content-type"] ?? "")) {
    throw new Error("OpenSubtitles fixture returned an unsuccessful JSON response");
  }
  if (response.body.length > 2 * 1024 * 1024) throw new Error("OpenSubtitles JSON response is too large");
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(response.body)) as unknown;
}

function isIntegerInRange(value: unknown, minimum: number, maximum: number): value is number {
  return Number.isInteger(value) && Number(value) >= minimum && Number(value) <= maximum;
}

function readSingleSearchResult(value: unknown, language: "en" | "ar"): SearchResult {
  if (typeof value !== "object" || value === null) throw new Error("Malformed OpenSubtitles search response");
  const response = value as Partial<SearchResponse>;
  if (response.page !== 1 || response.total_pages !== 1 || response.total_count !== 1 ||
      !isIntegerInRange(response.per_page, 1, 100) || !Array.isArray(response.data) || response.data.length !== 1) {
    throw new Error("The narrow OpenSubtitles path requires one page with one result");
  }
  const result = response.data[0] as Partial<SearchResult>;
  const attributes = result.attributes as Partial<SearchResult["attributes"]> | undefined;
  if (typeof result.id !== "string" || !/^\d+$/.test(result.id) || attributes === undefined ||
      attributes.language !== language || typeof attributes.release !== "string" || attributes.release.length === 0 ||
      attributes.foreign_parts_only !== false || attributes.machine_translated !== false ||
      attributes.ai_translated !== false || typeof attributes.hearing_impaired !== "boolean" ||
      !Array.isArray(attributes.files) || attributes.files.length !== 1) {
    throw new Error("OpenSubtitles result is not eligible for the narrow preparation path");
  }
  const file = attributes.files[0] as Partial<SearchFile>;
  if (!isIntegerInRange(file.file_id, 1, Number.MAX_SAFE_INTEGER) ||
      typeof file.file_name !== "string" || file.file_name.length === 0 || file.file_name.length > 255) {
    throw new Error("OpenSubtitles file identity is malformed");
  }
  return result as SearchResult;
}

function addTitleIdentity(parameters: URLSearchParams, title: ProviderTitleIdentity): void {
  switch (title.kind) {
    case "movie-imdb":
      parameters.set("imdb_id", title.imdbId);
      parameters.set("type", "movie");
      break;
    case "movie-tmdb":
      parameters.set("tmdb_id", String(title.tmdbId));
      parameters.set("type", "movie");
      break;
    case "episode-imdb":
      parameters.set("episode_number", String(title.episode));
      parameters.set("parent_imdb_id", title.parentImdbId);
      parameters.set("season_number", String(title.season));
      parameters.set("type", "episode");
      break;
    case "episode-tmdb":
      parameters.set("episode_number", String(title.episode));
      parameters.set("parent_tmdb_id", String(title.parentTmdbId));
      parameters.set("season_number", String(title.season));
      parameters.set("type", "episode");
      break;
  }
}

function searchUrl(identity: OpenSubtitlesSearchIdentity, language: "en" | "ar"): string {
  const parameters = new URLSearchParams({
    ai_translated: "exclude",
    foreign_parts_only: "exclude",
    hearing_impaired: "include",
    languages: language,
    machine_translated: "exclude",
    page: "1",
  });
  addTitleIdentity(parameters, identity.title);
  if (identity.movieHash !== undefined) {
    parameters.set("moviehash", identity.movieHash.value);
    parameters.set("moviehash_match", "include");
  }
  parameters.sort();
  return `${apiOrigin}/api/v1/subtitles?${parameters.toString()}`;
}

function hasValidTitleIdentity(title: ProviderTitleIdentity): boolean {
  const validImdbId = (value: string) => /^[1-9]\d{0,8}$/.test(value);
  const validTmdbId = (value: number) => isIntegerInRange(value, 1, 2_147_483_647);
  const validEpisode = (season: number, episode: number) =>
    isIntegerInRange(season, 0, 999) && isIntegerInRange(episode, 0, 9_999);
  switch (title.kind) {
    case "movie-imdb": return validImdbId(title.imdbId);
    case "movie-tmdb": return validTmdbId(title.tmdbId);
    case "episode-imdb":
      return validImdbId(title.parentImdbId) && validEpisode(title.season, title.episode);
    case "episode-tmdb":
      return validTmdbId(title.parentTmdbId) && validEpisode(title.season, title.episode);
  }
}

function hasValidIdentity(identity: OpenSubtitlesSearchIdentity, video: {
  libraryId: string;
  id: string;
  savedVideoId?: string;
}): boolean {
  if (identity.provider !== "opensubtitles-v1" || identity.libraryId !== video.libraryId ||
      identity.videoId !== video.savedVideoId || identity.savedIdentityId !== video.id ||
      !/^[a-f0-9]{64}$/.test(identity.selectedFileEvidenceHash) || !hasValidTitleIdentity(identity.title)) {
    return false;
  }
  const movieHash = identity.movieHash;
  return movieHash === undefined || (
    movieHash.algorithm === "opensubtitles-moviehash-v1" &&
    /^[a-f0-9]{16}$/.test(movieHash.value) &&
    Number.isSafeInteger(movieHash.sourceByteLength) && movieHash.sourceByteLength > 0 &&
    movieHash.selectedFileEvidenceHash === identity.selectedFileEvidenceHash
  );
}

function validatePlainSrt(response: OpenSubtitlesHttpResponse): Buffer {
  if (response.status !== 200) throw new Error("OpenSubtitles payload request failed");
  const rawContentType = response.headers["content-type"]?.split(";", 1)[0].trim().toLowerCase();
  if (rawContentType !== undefined && !payloadContentTypes.has(rawContentType)) {
    throw new Error("OpenSubtitles payload type is unsupported");
  }
  if (response.body.length === 0 || response.body.length > 4 * 1024 * 1024) {
    throw new Error("OpenSubtitles payload size is invalid");
  }
  let text = new TextDecoder("utf-8", { fatal: true }).decode(response.body);
  if (text.startsWith("\uFEFF")) text = text.slice(1);
  if ([...text].some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code === 0 || (code < 32 && code !== 9 && code !== 10 && code !== 13);
  })) {
    throw new Error("OpenSubtitles payload contains unsupported controls");
  }
  const normalized = text.replace(/\r\n?/g, "\n").trimEnd();
  const cues = normalized.split(/\n{2,}/u);
  if (cues.length === 0 || cues.length > 20_000) throw new Error("OpenSubtitles payload has no bounded SRT cues");
  let previousNumber = 0;
  let previousStart = -1;
  for (const cue of cues) {
    const lines = cue.split("\n");
    if (lines.length < 3 || lines.length > 22 || !/^\d+$/u.test(lines[0])) {
      throw new Error("OpenSubtitles payload is not a plain SRT");
    }
    const number = Number(lines[0]);
    if (number <= previousNumber) throw new Error("OpenSubtitles SRT cue numbers are not increasing");
    const timing = /^(\d{2}):(\d{2}):(\d{2}),(\d{3}) --> (\d{2}):(\d{2}):(\d{2}),(\d{3})$/u.exec(lines[1]);
    if (timing === null) throw new Error("OpenSubtitles SRT timing is malformed");
    const values = timing.slice(1).map(Number);
    if (values[0] > 47 || values[1] > 59 || values[2] > 59 || values[4] > 47 || values[5] > 59 || values[6] > 59) {
      throw new Error("OpenSubtitles SRT timing is outside the supported range");
    }
    const start = (((values[0] * 60 + values[1]) * 60 + values[2]) * 1000) + values[3];
    const end = (((values[4] * 60 + values[5]) * 60 + values[6]) * 1000) + values[7];
    if (start >= end || start < previousStart || lines.slice(2).join("\n").trim().length === 0) {
      throw new Error("OpenSubtitles SRT cue structure is invalid");
    }
    previousNumber = number;
    previousStart = start;
  }
  return response.body;
}

function safeFilename(value: string): string {
  const name = value.replace(/[^A-Za-z0-9._-]/g, "_").replace(/^\.+/, "_").slice(0, 120);
  return name.toLowerCase().endsWith(".srt") ? name : `${name || "candidate"}.srt`;
}

export function createOpenSubtitlesPreparation(options: {
  transport: OpenSubtitlesHttpTransport;
  candidateFiles: PrivateCandidateStore;
  apiKey: string;
  token: string;
  payloadOrigins: string[];
}): CandidatePreparationAdapter {
  const payloadOrigins = new Set(options.payloadOrigins);
  return {
    prepare(video, language) {
      const identity = video.openSubtitlesSearchIdentity;
      if (identity === undefined || !hasValidIdentity(identity, video)) {
        return {
          outcome: "blocked",
          explanation: "Preparation is blocked until current typed provider identity evidence is saved for this exact video.",
          nextActions: ["defer", "retry"],
          candidates: [],
          recommendedCandidateId: null,
          attachments: [],
        };
      }
      const apiHeaders = {
        "api-key": options.apiKey,
        authorization: `Bearer ${options.token}`,
        "user-agent": "jellyfin-subtitle-manager/0.1.0",
      };
      const search = decodeJson(options.transport.request({
        method: "GET",
        url: searchUrl(identity, language),
        headers: apiHeaders,
      }));
      const result = readSingleSearchResult(search, language);
      const file = result.attributes.files[0];
      const download = decodeJson(options.transport.request({
        method: "POST",
        url: `${apiOrigin}/api/v1/download`,
        headers: { ...apiHeaders, "content-type": "application/json" },
        body: Buffer.from(JSON.stringify({ file_id: file.file_id, sub_format: "srt" }), "utf8"),
      }));
      if (typeof download !== "object" || download === null || !("link" in download) || typeof download.link !== "string") {
        throw new Error("OpenSubtitles download response is malformed");
      }
      let payloadUrl: URL;
      try {
        payloadUrl = new URL(download.link);
      } catch {
        throw new Error("OpenSubtitles payload link is malformed");
      }
      if (payloadUrl.protocol !== "https:" || payloadUrl.port !== "" || payloadUrl.username !== "" ||
          payloadUrl.password !== "" || payloadUrl.hash !== "" || !payloadOrigins.has(payloadUrl.origin)) {
        throw new Error("OpenSubtitles payload origin is not approved for this fixture transport");
      }
      const original = validatePlainSrt(options.transport.request({
        method: "GET",
        url: payloadUrl.href,
        headers: { "user-agent": "jellyfin-subtitle-manager/0.1.0" },
      }));
      const contentHash = createHash("sha256").update(original).digest("hex");
      const candidateId = `opensubtitles-${result.id}-${file.file_id}`;
      const provider = { name: "opensubtitles-v1" as const, subtitleId: result.id, fileId: file.file_id };
      const identityEvidenceHash = createHash("sha256").update(JSON.stringify({
        libraryId: video.libraryId,
        videoId: video.id,
        selectedFileEvidenceHash: identity.selectedFileEvidenceHash,
        language,
        provider,
        release: result.attributes.release,
        contentHash,
      })).digest("hex");
      const stagedFileId = options.candidateFiles.stage(original);
      const candidate: SubtitleCandidate = {
        id: candidateId,
        label: `OpenSubtitles candidate ${result.id}`,
        file: file.file_name,
        release: result.attributes.release,
        association: "OpenSubtitles provider identity and release metadata are recorded as candidate provenance, not proof of synchronization.",
        language,
        subtitleType: "text-based",
        provenance: "provider-reported",
        authorship: "unknown",
        provider,
        timing: {
          status: "unmeasured",
          evidence: "No dialogue synchronization measurement was performed.",
          limits: "Provider metadata and valid SRT structure do not establish synchronization.",
        },
        completeness: {
          status: "unmeasured",
          evidence: "No full-dialogue coverage measurement was performed.",
          limits: "A valid SRT structure does not establish full-dialogue coverage.",
        },
        destination: `/synthetic/subtitles/${video.id}.${language}.opensubtitles.srt`,
        recommendationReason: "This is the sole eligible result in the explicit one-result fixture run; quality, completeness, and timing remain unmeasured.",
        identityEvidenceHash,
        contentHash,
      };
      return {
        outcome: "candidates-found",
        explanation: "Prepared one bounded OpenSubtitles fixture candidate for review.",
        nextActions: ["defer"],
        candidates: [candidate],
        recommendedCandidateId: candidate.id,
        attachments: [{ candidateId, filename: safeFilename(file.file_name), stagedFileId }],
      };
    },
  };
}
