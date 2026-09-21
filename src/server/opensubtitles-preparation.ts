import { createHash } from "node:crypto";
import { isIP } from "node:net";
import { performance } from "node:perf_hooks";

import type {
  CandidatePreparation,
  CandidatePreparationAdapter,
  OpenSubtitlesSearchIdentity,
  PreparationOutcome,
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

export class OpenSubtitlesTransportError extends Error {
  constructor(readonly kind: "timeout" | "transport") {
    super(kind === "timeout" ? "OpenSubtitles request timed out" : "OpenSubtitles transport failed");
    this.name = "OpenSubtitlesTransportError";
  }
}

interface SearchFile {
  file_id: number;
  file_name: string;
}

interface EligibleFile {
  subtitleId: string;
  file: SearchFile;
  release: string;
  hearingImpaired: boolean;
  moviehashMatch: boolean;
  fromTrusted: boolean;
  downloadCount: number;
}

interface SearchPage {
  totalPages: number;
  totalCount: number;
  perPage: number;
  data: unknown[];
}

const API_ORIGIN = "https://api.opensubtitles.com";
const MAX_JSON_BYTES = 2 * 1024 * 1024;
const MAX_PAYLOAD_BYTES = 4 * 1024 * 1024;
const MAX_SEARCH_PAGES = 3;
const MAX_RESULTS = 100;
const MAX_FILES = 200;
const MAX_FILES_PER_RESULT = 4;
const MAX_RUN_MS = 90_000;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const jsonContentType = /^application\/(?:json|[A-Za-z0-9!#$&^_.+-]+\+json)(?:\s*;|$)/i;
const payloadContentTypes = new Set(["text/plain", "application/x-subrip"]);

const outcomeExplanations: Record<Exclude<PreparationOutcome, "candidates-found" | "no-suitable-candidate" | "failed">, string> = {
  blocked: "Preparation is blocked until safe provider access and current typed identity evidence are available.",
  "no-candidates": "The bounded provider search completed without an eligible subtitle candidate.",
  "authentication-failed": "The provider rejected authentication. Preparation stopped without retrying or downloading a candidate.",
  "quota-exhausted": "The provider quota is exhausted. Preparation stopped without waiting, retrying, or downloading another candidate.",
  "transport-failed": "The provider could not be reached safely. Preparation stopped without retrying.",
  "timed-out": "The provider request timed out. Preparation stopped without retrying.",
  "malformed-provider-response": "The provider returned a malformed response. Preparation stopped without guessing missing values.",
  "unsafe-content": "The provider response crossed a configured safety boundary. Preparation stopped without retaining unsafe content.",
  "provider-failed": "The provider returned an unsuccessful response. Preparation stopped without retrying.",
  "duplicate-candidate": "Every retrieved candidate duplicated content already considered in this bounded run.",
  "payload-budget-exhausted": "The three candidate payload attempts were spent without producing a reviewable candidate.",
  "run-deadline-exhausted": "The bounded preparation deadline was exhausted. No background work will continue.",
};

class PreparationFailure extends Error {
  constructor(readonly outcome: Exclude<PreparationOutcome, "candidates-found" | "no-suitable-candidate" | "failed">) {
    super(outcome);
  }
}

function terminal(outcome: PreparationFailure["outcome"]): CandidatePreparation {
  return {
    outcome,
    explanation: outcomeExplanations[outcome],
    nextActions: outcome === "no-candidates" ? ["defer"] : ["defer", "retry"],
    candidates: [],
    recommendedCandidateId: null,
    attachments: [],
  };
}

function header(response: OpenSubtitlesHttpResponse, name: string): string | undefined {
  const entry = Object.entries(response.headers).find(([key]) => key.toLowerCase() === name);
  return entry?.[1];
}

function mapHttpFailure(status: number): PreparationFailure {
  if (status === 401 || status === 403) return new PreparationFailure("authentication-failed");
  if (status === 429) return new PreparationFailure("quota-exhausted");
  return new PreparationFailure("provider-failed");
}

function decodeJson(response: OpenSubtitlesHttpResponse): unknown {
  if (response.status < 200 || response.status >= 300) throw mapHttpFailure(response.status);
  if (!jsonContentType.test(header(response, "content-type") ?? "")) {
    throw new PreparationFailure("malformed-provider-response");
  }
  if (response.body.length > MAX_JSON_BYTES) throw new PreparationFailure("malformed-provider-response");
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(response.body)) as unknown;
  } catch {
    throw new PreparationFailure("malformed-provider-response");
  }
}

function isIntegerInRange(value: unknown, minimum: number, maximum: number): value is number {
  return Number.isInteger(value) && Number(value) >= minimum && Number(value) <= maximum;
}

function readSearchPage(value: unknown, requestedPage: number): SearchPage {
  if (typeof value !== "object" || value === null) throw new PreparationFailure("malformed-provider-response");
  const response = value as Record<string, unknown>;
  if (response.page !== requestedPage || !isIntegerInRange(response.total_pages, requestedPage, Number.MAX_SAFE_INTEGER) ||
      !isIntegerInRange(response.total_count, 0, Number.MAX_SAFE_INTEGER) ||
      !isIntegerInRange(response.per_page, 1, 100) || !Array.isArray(response.data) ||
      response.data.length > response.per_page) {
    throw new PreparationFailure("malformed-provider-response");
  }
  return {
    totalPages: response.total_pages,
    totalCount: response.total_count,
    perPage: response.per_page,
    data: response.data,
  };
}

function readEligibleFiles(value: unknown, language: "en" | "ar", hashSubmitted: boolean): {
  files: EligibleFile[];
  inspectedFiles: number;
} {
  if (typeof value !== "object" || value === null) return { files: [], inspectedFiles: 0 };
  const result = value as Record<string, unknown>;
  const attributes = result.attributes;
  if (typeof result.id !== "string" || !/^\d+$/.test(result.id) ||
      typeof attributes !== "object" || attributes === null) return { files: [], inspectedFiles: 0 };
  const data = attributes as Record<string, unknown>;
  if (!Array.isArray(data.files)) return { files: [], inspectedFiles: 0 };
  const inspectedFiles = Math.min(data.files.length, MAX_FILES_PER_RESULT + 1);
  if (data.files.length === 0 || data.files.length > MAX_FILES_PER_RESULT || data.language !== language ||
      data.foreign_parts_only !== false || data.machine_translated !== false || data.ai_translated !== false ||
      typeof data.hearing_impaired !== "boolean" || typeof data.release !== "string" || data.release.length === 0 ||
      data.release.length > 1_024 || typeof data.moviehash_match !== "boolean" ||
      (hashSubmitted && typeof data.moviehash_match !== "boolean") || typeof data.from_trusted !== "boolean" ||
      !isIntegerInRange(data.download_count, 0, Number.MAX_SAFE_INTEGER)) {
    return { files: [], inspectedFiles };
  }
  const files: EligibleFile[] = [];
  for (const candidate of data.files) {
    if (typeof candidate !== "object" || candidate === null) return { files: [], inspectedFiles };
    const file = candidate as Record<string, unknown>;
    if (!isIntegerInRange(file.file_id, 1, Number.MAX_SAFE_INTEGER) ||
        typeof file.file_name !== "string" || file.file_name.length === 0 || file.file_name.length > 255) {
      return { files: [], inspectedFiles };
    }
    files.push({
      subtitleId: result.id,
      file: { file_id: file.file_id, file_name: file.file_name },
      release: data.release,
      hearingImpaired: data.hearing_impaired,
      moviehashMatch: data.moviehash_match,
      fromTrusted: data.from_trusted,
      downloadCount: data.download_count,
    });
  }
  return { files, inspectedFiles };
}

function addTitleIdentity(parameters: URLSearchParams, title: ProviderTitleIdentity): void {
  switch (title.kind) {
    case "movie-imdb": parameters.set("imdb_id", title.imdbId); parameters.set("type", "movie"); break;
    case "movie-tmdb": parameters.set("tmdb_id", String(title.tmdbId)); parameters.set("type", "movie"); break;
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

function searchUrl(identity: OpenSubtitlesSearchIdentity, language: "en" | "ar", page: number): string {
  const parameters = new URLSearchParams({
    ai_translated: "exclude",
    foreign_parts_only: "exclude",
    hearing_impaired: "include",
    languages: language,
    machine_translated: "exclude",
    page: String(page),
  });
  addTitleIdentity(parameters, identity.title);
  if (identity.movieHash !== undefined) {
    parameters.set("moviehash", identity.movieHash.value);
    parameters.set("moviehash_match", "include");
  }
  parameters.sort();
  return `${API_ORIGIN}/api/v1/subtitles?${parameters.toString()}`;
}

function hasValidTitleIdentity(title: ProviderTitleIdentity): boolean {
  const validImdbId = (value: string) => /^[1-9]\d{0,8}$/.test(value);
  const validTmdbId = (value: number) => isIntegerInRange(value, 1, 2_147_483_647);
  const validEpisode = (season: number, episode: number) =>
    isIntegerInRange(season, 0, 999) && isIntegerInRange(episode, 0, 9_999);
  switch (title.kind) {
    case "movie-imdb": return validImdbId(title.imdbId);
    case "movie-tmdb": return validTmdbId(title.tmdbId);
    case "episode-imdb": return validImdbId(title.parentImdbId) && validEpisode(title.season, title.episode);
    case "episode-tmdb": return validTmdbId(title.parentTmdbId) && validEpisode(title.season, title.episode);
  }
}

function hasValidIdentity(identity: OpenSubtitlesSearchIdentity, video: {
  libraryId: string;
  id: string;
  savedVideoId?: string;
}): boolean {
  if (identity.provider !== "opensubtitles-v1" || identity.libraryId !== video.libraryId ||
      identity.videoId !== video.savedVideoId || identity.savedIdentityId !== video.id ||
      !/^[a-f0-9]{64}$/.test(identity.selectedFileEvidenceHash) || !hasValidTitleIdentity(identity.title)) return false;
  const movieHash = identity.movieHash;
  return movieHash === undefined || (
    movieHash.algorithm === "opensubtitles-moviehash-v1" && /^[a-f0-9]{16}$/.test(movieHash.value) &&
    Number.isSafeInteger(movieHash.sourceByteLength) && movieHash.sourceByteLength > 0 &&
    movieHash.selectedFileEvidenceHash === identity.selectedFileEvidenceHash
  );
}

function readRedirect(response: OpenSubtitlesHttpResponse, currentUrl: string): URL {
  const location = header(response, "location");
  if (location === undefined || location.length === 0 || location.length > 2_048 || !/^[\x20-\x7e]+$/.test(location)) {
    throw new PreparationFailure("unsafe-content");
  }
  try {
    return new URL(location, currentUrl);
  } catch {
    throw new PreparationFailure("unsafe-content");
  }
}

function validateHttpsOrigin(url: URL): void {
  if (url.protocol !== "https:" || url.port !== "" || url.username !== "" || url.password !== "" ||
      url.hash !== "" || url.hostname !== url.hostname.toLowerCase() || isIP(url.hostname) !== 0) {
    throw new PreparationFailure("unsafe-content");
  }
}

function validatePlainSrt(response: OpenSubtitlesHttpResponse): Buffer {
  if (response.status < 200 || response.status >= 300) throw mapHttpFailure(response.status);
  const rawContentType = header(response, "content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (rawContentType !== undefined && !payloadContentTypes.has(rawContentType)) throw new PreparationFailure("unsafe-content");
  const contentEncoding = header(response, "content-encoding")?.trim().toLowerCase();
  if (contentEncoding !== undefined && contentEncoding !== "identity") throw new PreparationFailure("unsafe-content");
  if (response.body.length === 0 || response.body.length > MAX_PAYLOAD_BYTES) throw new PreparationFailure("unsafe-content");
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(response.body);
  } catch {
    throw new PreparationFailure("unsafe-content");
  }
  if (text.startsWith("\uFEFF")) text = text.slice(1);
  if (text.includes("\uFEFF") || [...text].length > 2_000_000 || [...text].some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code === 0 || (code < 32 && code !== 9 && code !== 10 && code !== 13);
  })) throw new PreparationFailure("unsafe-content");
  const normalized = text.replace(/\r\n?/g, "\n").trimEnd();
  const physicalLines = normalized.split("\n");
  if (physicalLines.some((line) => Buffer.byteLength(line, "utf8") > 16 * 1024)) throw new PreparationFailure("unsafe-content");
  const cues = normalized.split(/\n{2,}/u);
  if (cues.length === 0 || cues.length > 20_000) throw new PreparationFailure("unsafe-content");
  let previousNumber = 0;
  let previousStart = -1;
  for (const cue of cues) {
    const lines = cue.split("\n");
    if (lines.length < 3 || lines.length > 22 || !/^\d+$/u.test(lines[0])) throw new PreparationFailure("unsafe-content");
    const number = Number(lines[0]);
    const timing = /^(\d{2}):(\d{2}):(\d{2}),(\d{3}) --> (\d{2}):(\d{2}):(\d{2}),(\d{3})$/u.exec(lines[1]);
    if (number <= previousNumber || timing === null) throw new PreparationFailure("unsafe-content");
    const values = timing.slice(1).map(Number);
    if (values[0] > 47 || values[1] > 59 || values[2] > 59 || values[4] > 47 || values[5] > 59 || values[6] > 59) {
      throw new PreparationFailure("unsafe-content");
    }
    const start = (((values[0] * 60 + values[1]) * 60 + values[2]) * 1000) + values[3];
    const end = (((values[4] * 60 + values[5]) * 60 + values[6]) * 1000) + values[7];
    const cueText = lines.slice(2).join("\n");
    if (start >= end || start < previousStart || cueText.trim().length === 0 || Buffer.byteLength(cueText, "utf8") > 8 * 1024) {
      throw new PreparationFailure("unsafe-content");
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
  monotonicNow?: () => number;
}): CandidatePreparationAdapter {
  const payloadOrigins = new Set<string>();
  for (const origin of options.payloadOrigins) {
    const parsed = new URL(origin);
    validateHttpsOrigin(parsed);
    if (parsed.origin !== origin || parsed.pathname !== "/" || parsed.search !== "") {
      throw new Error("OpenSubtitles payload origins must be exact normalized HTTPS origins");
    }
    payloadOrigins.add(origin);
  }
  const now = options.monotonicNow ?? (() => performance.now());

  return {
    prepare(video, language) {
      const identity = video.openSubtitlesSearchIdentity;
      if (identity === undefined || !hasValidIdentity(identity, video) || options.apiKey.length === 0 ||
          options.token.length === 0 || payloadOrigins.size === 0) return terminal("blocked");
      const startedAt = now();
      const checkDeadline = () => {
        if (now() - startedAt >= MAX_RUN_MS) throw new PreparationFailure("run-deadline-exhausted");
      };
      const request = (httpRequest: OpenSubtitlesHttpRequest) => {
        checkDeadline();
        try {
          const response = options.transport.request(httpRequest);
          checkDeadline();
          return response;
        } catch (error) {
          if (error instanceof PreparationFailure) throw error;
          if (error instanceof OpenSubtitlesTransportError) {
            throw new PreparationFailure(error.kind === "timeout" ? "timed-out" : "transport-failed");
          }
          throw new PreparationFailure("transport-failed");
        }
      };
      const apiHeaders = {
        "api-key": options.apiKey,
        authorization: `Bearer ${options.token}`,
        "user-agent": "jellyfin-subtitle-manager/0.1.0",
      };
      const searchRequest = (url: string) => {
        let response = request({ method: "GET", url, headers: apiHeaders });
        if (REDIRECT_STATUSES.has(response.status)) {
          const redirect = readRedirect(response, url);
          validateHttpsOrigin(redirect);
          if (redirect.origin !== API_ORIGIN) throw new PreparationFailure("unsafe-content");
          response = request({ method: "GET", url: redirect.href, headers: apiHeaders });
          if (REDIRECT_STATUSES.has(response.status)) throw new PreparationFailure("unsafe-content");
        }
        return response;
      };
      const payloadRequest = (url: string) => {
        const current = new URL(url);
        validateHttpsOrigin(current);
        if (!payloadOrigins.has(current.origin)) throw new PreparationFailure("unsafe-content");
        const response = request({
          method: "GET",
          url: current.href,
          headers: { "user-agent": "jellyfin-subtitle-manager/0.1.0" },
        });
        if (REDIRECT_STATUSES.has(response.status)) throw new PreparationFailure("unsafe-content");
        return response;
      };

      try {
        const eligible: EligibleFile[] = [];
        const pageFingerprints = new Set<string>();
        let expectedTotalPages: number | undefined;
        let expectedTotalCount: number | undefined;
        let expectedPerPage: number | undefined;
        let inspectedResults = 0;
        let inspectedFiles = 0;
        for (let pageNumber = 1; pageNumber <= MAX_SEARCH_PAGES; pageNumber += 1) {
          const page = readSearchPage(decodeJson(searchRequest(searchUrl(identity, language, pageNumber))), pageNumber);
          if ((expectedTotalPages !== undefined && page.totalPages !== expectedTotalPages) ||
              (expectedTotalCount !== undefined && page.totalCount !== expectedTotalCount) ||
              (expectedPerPage !== undefined && page.perPage !== expectedPerPage)) {
            throw new PreparationFailure("malformed-provider-response");
          }
          expectedTotalPages = page.totalPages;
          expectedTotalCount = page.totalCount;
          expectedPerPage = page.perPage;
          const fingerprint = createHash("sha256").update(JSON.stringify(page.data)).digest("hex");
          if (pageFingerprints.has(fingerprint) && page.data.length > 0) throw new PreparationFailure("malformed-provider-response");
          pageFingerprints.add(fingerprint);
          for (const value of page.data) {
            if (inspectedResults >= MAX_RESULTS || inspectedFiles >= MAX_FILES) break;
            inspectedResults += 1;
            const parsed = readEligibleFiles(value, language, identity.movieHash !== undefined);
            if (inspectedFiles + parsed.inspectedFiles > MAX_FILES) break;
            inspectedFiles += parsed.inspectedFiles;
            eligible.push(...parsed.files);
          }
          if (page.data.length === 0 || pageNumber >= page.totalPages || inspectedResults >= MAX_RESULTS || inspectedFiles >= MAX_FILES) break;
        }
        eligible.sort((left, right) =>
          Number(right.moviehashMatch) - Number(left.moviehashMatch) ||
          Number(left.hearingImpaired) - Number(right.hearingImpaired) ||
          Number(right.fromTrusted) - Number(left.fromTrusted) ||
          right.downloadCount - left.downloadCount ||
          Number(left.subtitleId) - Number(right.subtitleId) || left.file.file_id - right.file.file_id);
        if (eligible.length === 0) return terminal("no-candidates");

        const selected = eligible[0];
        const downloadResponse = request({
          method: "POST",
          url: `${API_ORIGIN}/api/v1/download`,
          headers: { ...apiHeaders, "content-type": "application/json" },
          body: Buffer.from(JSON.stringify({ file_id: selected.file.file_id, sub_format: "srt" }), "utf8"),
        });
        if (REDIRECT_STATUSES.has(downloadResponse.status)) throw new PreparationFailure("unsafe-content");
        const download = decodeJson(downloadResponse);
        if (typeof download !== "object" || download === null) throw new PreparationFailure("malformed-provider-response");
        const fields = download as Record<string, unknown>;
        if (typeof fields.link !== "string" || (fields.remaining !== undefined &&
            !isIntegerInRange(fields.remaining, 0, Number.MAX_SAFE_INTEGER))) {
          throw new PreparationFailure("malformed-provider-response");
        }
        if (fields.remaining === 0) throw new PreparationFailure("quota-exhausted");
        let payloadUrl: URL;
        try { payloadUrl = new URL(fields.link); } catch { throw new PreparationFailure("malformed-provider-response"); }
        validateHttpsOrigin(payloadUrl);
        if (!payloadOrigins.has(payloadUrl.origin)) throw new PreparationFailure("unsafe-content");
        const original = validatePlainSrt(payloadRequest(payloadUrl.href));
        const contentHash = createHash("sha256").update(original).digest("hex");
        const candidateId = `opensubtitles-${selected.subtitleId}-${selected.file.file_id}`;
        const provider = {
          name: "opensubtitles-v1" as const,
          subtitleId: selected.subtitleId,
          fileId: selected.file.file_id,
          moviehashMatch: selected.moviehashMatch,
          hearingImpaired: selected.hearingImpaired,
          fromTrusted: selected.fromTrusted,
          downloadCount: selected.downloadCount,
        };
        const identityEvidenceHash = createHash("sha256").update(JSON.stringify({
          libraryId: video.libraryId,
          videoId: video.id,
          selectedFileEvidenceHash: identity.selectedFileEvidenceHash,
          language,
          provider,
          release: selected.release,
          contentHash,
        })).digest("hex");
        const stagedFileId = options.candidateFiles.stage(original);
        const candidate: SubtitleCandidate = {
          id: candidateId,
          label: `OpenSubtitles candidate ${selected.subtitleId}`,
          file: selected.file.file_name,
          release: selected.release,
          association: "OpenSubtitles provider identity and release metadata are recorded as candidate provenance, not proof of synchronization.",
          language,
          subtitleType: "text-based",
          provenance: "provider-reported",
          authorship: "unknown",
          provider,
          timing: { status: "unmeasured", evidence: "No dialogue synchronization measurement was performed.", limits: "Provider metadata and valid SRT structure do not establish synchronization." },
          completeness: { status: "unmeasured", evidence: "No full-dialogue coverage measurement was performed.", limits: "A valid SRT structure does not establish full-dialogue coverage." },
          destination: `/synthetic/subtitles/${video.id}.${language}.opensubtitles.srt`,
          recommendationReason: "Selected by bounded provider metadata ordering; quality, completeness, and timing remain unmeasured.",
          identityEvidenceHash,
          contentHash,
        };
        return {
          outcome: "candidates-found",
          explanation: "Prepared one bounded OpenSubtitles fixture candidate for review.",
          nextActions: ["defer"],
          candidates: [candidate],
          recommendedCandidateId: candidate.id,
          attachments: [{ candidateId, filename: safeFilename(selected.file.file_name), stagedFileId }],
        };
      } catch (error) {
        if (error instanceof PreparationFailure) return terminal(error.outcome);
        return terminal("malformed-provider-response");
      }
    },
  };
}
