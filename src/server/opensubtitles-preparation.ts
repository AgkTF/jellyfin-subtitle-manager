import { createHash } from "node:crypto";
import { isIP } from "node:net";
import { performance } from "node:perf_hooks";
import { gunzipSync, inflateRawSync } from "node:zlib";

import type {
  CandidatePreparation,
  CandidatePreparationAdapter,
  CandidatePreparationRun,
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
  deadlines?: {
    connectMs: number;
    headersMs: number;
    readIdleMs: number;
    overallMs: number;
  };
}

export interface OpenSubtitlesHttpResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: Buffer | Iterable<Buffer>;
  trailers?: Record<string, string | string[] | undefined>;
}

export interface OpenSubtitlesHttpTransport {
  /** Enforces request.deadlines while connecting, receiving headers, and consuming body chunks. */
  request(request: OpenSubtitlesHttpRequest): OpenSubtitlesHttpResponse;
}

export class OpenSubtitlesTransportError extends Error {
  constructor(
    readonly kind: "timeout" | "transport",
    readonly phase?: "connect" | "headers" | "read-idle" | "overall",
  ) {
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
const MAX_PAYLOAD_TRANSFER_BYTES = 1024 * 1024;
const MAX_PAYLOAD_BYTES = 4 * 1024 * 1024;
const MAX_HEADER_BYTES = 16 * 1024;
const MAX_HEADER_FIELDS = 64;
const MAX_HEADER_FIELD_BYTES = 8 * 1024;
const MAX_PAYLOAD_ATTEMPTS = 3;
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
  "duplicate-candidate": "The provider payload duplicated a candidate already considered in this run.",
  "payload-budget-exhausted": "Three candidate payload attempts were spent. No fourth download was requested.",
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
  return typeof entry?.[1] === "string" ? entry[1] : undefined;
}

function validateHeaders(response: OpenSubtitlesHttpResponse, unsafeOutcome: PreparationFailure["outcome"]): void {
  const entries = Object.entries(response.headers);
  if (entries.length > MAX_HEADER_FIELDS || response.trailers !== undefined && Object.keys(response.trailers).length > 0) {
    throw new PreparationFailure(unsafeOutcome);
  }
  const normalizedNames = new Set<string>();
  let total = 2;
  for (const [name, rawValue] of entries) {
    const normalizedName = name.toLowerCase();
    const values = Array.isArray(rawValue) ? rawValue : rawValue === undefined ? [] : [rawValue];
    const hasControlValue = values.length !== 1 || [...values[0]].some((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code < 32 || code === 127;
    });
    if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name) || normalizedNames.has(normalizedName) || hasControlValue) {
      throw new PreparationFailure(unsafeOutcome);
    }
    normalizedNames.add(normalizedName);
    const bytes = Buffer.byteLength(name) + Buffer.byteLength(values[0]);
    if (bytes > MAX_HEADER_FIELD_BYTES) throw new PreparationFailure(unsafeOutcome);
    total += bytes + 4;
  }
  if (total > MAX_HEADER_BYTES) throw new PreparationFailure(unsafeOutcome);
}

function readTransferBody(response: OpenSubtitlesHttpResponse, maximum: number, outcome: PreparationFailure["outcome"]): Buffer {
  const declared = header(response, "content-length");
  if (declared !== undefined && (!/^\d+$/.test(declared) || Number(declared) > maximum)) {
    throw new PreparationFailure(outcome);
  }
  const chunks = Buffer.isBuffer(response.body) ? [response.body] : response.body;
  const collected: Buffer[] = [];
  let length = 0;
  for (const chunk of chunks) {
    if (!Buffer.isBuffer(chunk)) throw new PreparationFailure(outcome);
    length += chunk.length;
    if (length > maximum) throw new PreparationFailure(outcome);
    collected.push(chunk);
  }
  if (declared !== undefined && Number(declared) !== length) {
    throw new PreparationFailure(outcome);
  }
  return Buffer.concat(collected, length);
}

function gzipDeflateOffset(value: Buffer): number {
  if (value.length < 18 || value[0] !== 0x1f || value[1] !== 0x8b || value[2] !== 8 || (value[3] & 0xe0) !== 0) {
    throw new Error("invalid gzip header");
  }
  const flags = value[3];
  let offset = 10;
  const requireBytes = (count: number) => {
    if (offset + count > value.length - 8) throw new Error("truncated gzip header");
  };
  if ((flags & 0x04) !== 0) {
    requireBytes(2);
    const length = value.readUInt16LE(offset);
    offset += 2;
    requireBytes(length);
    offset += length;
  }
  for (const flag of [0x08, 0x10]) {
    if ((flags & flag) === 0) continue;
    while (offset < value.length - 8 && value[offset] !== 0) offset += 1;
    requireBytes(1);
    offset += 1;
  }
  if ((flags & 0x02) !== 0) {
    requireBytes(2);
    offset += 2;
  }
  return offset;
}

function decodeSingleGzip(transfer: Buffer, decodedMaximum: number): Buffer {
  const offset = gzipDeflateOffset(transfer);
  const inflated = inflateRawSync(transfer.subarray(offset), {
    info: true,
    maxOutputLength: decodedMaximum + 1,
  }) as unknown as { buffer: Buffer; engine: { bytesWritten: number } };
  if (offset + inflated.engine.bytesWritten + 8 !== transfer.length) throw new Error("multiple or trailing gzip data");
  const decoded = gunzipSync(transfer, { maxOutputLength: decodedMaximum + 1 });
  if (decoded.length > decodedMaximum) throw new Error("decoded gzip exceeds limit");
  return decoded;
}

function decodeHttpBody(response: OpenSubtitlesHttpResponse, transferMaximum: number, decodedMaximum: number,
  outcome: PreparationFailure["outcome"]): Buffer {
  validateHeaders(response, outcome);
  const transfer = readTransferBody(response, transferMaximum, outcome);
  const coding = header(response, "content-encoding")?.trim().toLowerCase();
  if (coding === undefined || coding === "" || coding === "identity") return transfer;
  if (coding !== "gzip") throw new PreparationFailure(outcome);
  try {
    return decodeSingleGzip(transfer, decodedMaximum);
  } catch {
    throw new PreparationFailure(outcome);
  }
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
  const body = decodeHttpBody(response, MAX_JSON_BYTES, MAX_JSON_BYTES, "malformed-provider-response");
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body)) as unknown;
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

function searchFileCount(value: unknown): number | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const attributes = (value as Record<string, unknown>).attributes;
  if (typeof attributes !== "object" || attributes === null) return undefined;
  const files = (attributes as Record<string, unknown>).files;
  return Array.isArray(files) ? files.length : undefined;
}

function readEligibleFiles(value: unknown, language: "en" | "ar", hashSubmitted: boolean): {
  files: EligibleFile[];
  inspectedFiles: number;
} {
  if (typeof value !== "object" || value === null) return { files: [], inspectedFiles: 0 };
  const result = value as Record<string, unknown>;
  const attributes = result.attributes;
  if (typeof result.id !== "string" || !/^\d{1,20}$/.test(result.id) ||
      typeof attributes !== "object" || attributes === null) return { files: [], inspectedFiles: 0 };
  const data = attributes as Record<string, unknown>;
  if (!Array.isArray(data.files)) return { files: [], inspectedFiles: 0 };
  const inspectedFiles = Math.min(data.files.length, MAX_FILES_PER_RESULT + 1);
  if (data.files.length === 0 || data.files.length > MAX_FILES_PER_RESULT || data.language !== language ||
      data.foreign_parts_only !== false || data.machine_translated !== false || data.ai_translated !== false ||
      typeof data.hearing_impaired !== "boolean" || typeof data.release !== "string" || data.release.length === 0 ||
      data.release.length > 1_024 || (data.moviehash_match !== undefined && typeof data.moviehash_match !== "boolean") ||
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
      moviehashMatch: data.moviehash_match ?? false,
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
    const resolved = new URL(location, currentUrl);
    if (resolved.href.length > 2_048 || !/^[\x20-\x7e]+$/.test(resolved.href)) {
      throw new PreparationFailure("unsafe-content");
    }
    return resolved;
  } catch (error) {
    if (error instanceof PreparationFailure) throw error;
    throw new PreparationFailure("unsafe-content");
  }
}

function validateHttpsOrigin(url: URL): void {
  if (url.protocol !== "https:" || url.port !== "" || url.username !== "" || url.password !== "" ||
      url.hash !== "" || url.hostname !== url.hostname.toLowerCase() || isIP(url.hostname) !== 0) {
    throw new PreparationFailure("unsafe-content");
  }
}

function hasContainerSignature(body: Buffer): boolean {
  const startsWith = (...bytes: number[]) => body.subarray(0, bytes.length).equals(Buffer.from(bytes));
  return startsWith(0x50, 0x4b, 0x03, 0x04) || startsWith(0x50, 0x4b, 0x05, 0x06) ||
    startsWith(0x50, 0x4b, 0x07, 0x08) || startsWith(0x1f, 0x8b) ||
    startsWith(0x52, 0x61, 0x72, 0x21, 0x1a, 0x07) || startsWith(0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c) ||
    startsWith(0x42, 0x5a, 0x68) || startsWith(0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00) ||
    startsWith(0x28, 0xb5, 0x2f, 0xfd) || startsWith(0x4c, 0x5a, 0x49, 0x50) ||
    startsWith(0x4d, 0x53, 0x43, 0x46) || startsWith(0x21, 0x3c, 0x61, 0x72, 0x63, 0x68, 0x3e) ||
    body.subarray(0, 6).toString("ascii") === "070701" || body.subarray(0, 6).toString("ascii") === "070702" ||
    body.length >= 265 && body.subarray(257, 262).toString("ascii") === "ustar";
}

function hasUnsafePathOrLinkEvidence(text: string): boolean {
  return /(?:https?|ftp|file):\/\//iu.test(text) ||
    /\.\.[/\\]|(?:^|[<[(\s])[/\\]{1,2}|(?:^|[<[(\s])[A-Za-z]:[/\\]/u.test(text);
}

function validatePlainSrt(response: OpenSubtitlesHttpResponse): Buffer {
  if (response.status < 200 || response.status >= 300) throw mapHttpFailure(response.status);
  const rawContentType = header(response, "content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (rawContentType !== undefined && !payloadContentTypes.has(rawContentType)) throw new PreparationFailure("unsafe-content");
  const body = decodeHttpBody(response, MAX_PAYLOAD_TRANSFER_BYTES, MAX_PAYLOAD_BYTES, "unsafe-content");
  if (body.length === 0 || body.length > MAX_PAYLOAD_BYTES || hasContainerSignature(body)) {
    throw new PreparationFailure("unsafe-content");
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(body);
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
    if (!Number.isSafeInteger(number) || number <= previousNumber || timing === null) throw new PreparationFailure("unsafe-content");
    const values = timing.slice(1).map(Number);
    if (values[0] > 47 || values[1] > 59 || values[2] > 59 || values[4] > 47 || values[5] > 59 || values[6] > 59) {
      throw new PreparationFailure("unsafe-content");
    }
    const start = (((values[0] * 60 + values[1]) * 60 + values[2]) * 1000) + values[3];
    const end = (((values[4] * 60 + values[5]) * 60 + values[6]) * 1000) + values[7];
    const cueText = lines.slice(2).join("\n");
    if (start >= end || start < previousStart || cueText.trim().length === 0 || Buffer.byteLength(cueText, "utf8") > 8 * 1024 ||
        hasUnsafePathOrLinkEvidence(cueText)) {
      throw new PreparationFailure("unsafe-content");
    }
    previousNumber = number;
    previousStart = start;
  }
  return body;
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
    prepare(video, language, run?: CandidatePreparationRun) {
      const identity = video.openSubtitlesSearchIdentity;
      if (identity === undefined || !hasValidIdentity(identity, video) || options.apiKey.length === 0 ||
          options.token.length === 0 || payloadOrigins.size === 0) return terminal("blocked");
      const startedAt = now();
      const checkDeadline = () => {
        if (now() - startedAt >= MAX_RUN_MS) throw new PreparationFailure("run-deadline-exhausted");
      };
      const request = (httpRequest: OpenSubtitlesHttpRequest) => {
        checkDeadline();
        const requestedAt = now();
        try {
          const response = options.transport.request(httpRequest);
          validateHeaders(response, "unsafe-content");
          if (httpRequest.deadlines !== undefined && now() - requestedAt >= httpRequest.deadlines.overallMs) {
            throw new PreparationFailure("timed-out");
          }
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
      const apiDeadlines = { connectMs: 3_000, headersMs: 7_000, readIdleMs: 5_000, overallMs: 15_000 };
      const payloadDeadlines = { connectMs: 5_000, headersMs: 10_000, readIdleMs: 10_000, overallMs: 30_000 };
      const searchRequest = (url: string) => {
        let response = request({ method: "GET", url, headers: apiHeaders, deadlines: apiDeadlines });
        if (REDIRECT_STATUSES.has(response.status)) {
          const redirect = readRedirect(response, url);
          validateHttpsOrigin(redirect);
          if (redirect.origin !== API_ORIGIN) throw new PreparationFailure("unsafe-content");
          response = request({ method: "GET", url: redirect.href, headers: apiHeaders, deadlines: apiDeadlines });
          if (REDIRECT_STATUSES.has(response.status)) throw new PreparationFailure("unsafe-content");
        }
        return response;
      };
      const payloadRequest = (url: string) => {
        let current: URL;
        try { current = new URL(url); } catch { throw new PreparationFailure("malformed-provider-response"); }
        for (let redirects = 0; redirects <= 2; redirects += 1) {
          validateHttpsOrigin(current);
          if (!payloadOrigins.has(current.origin)) throw new PreparationFailure("unsafe-content");
          const response = request({
            method: "GET",
            url: current.href,
            headers: { "user-agent": "jellyfin-subtitle-manager/0.1.0" },
            deadlines: payloadDeadlines,
          });
          if (!REDIRECT_STATUSES.has(response.status)) return response;
          validateHeaders(response, "unsafe-content");
          if (redirects === 2) throw new PreparationFailure("unsafe-content");
          current = readRedirect(response, current.href);
        }
        throw new PreparationFailure("unsafe-content");
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
            const fileCount = searchFileCount(value);
            if (fileCount !== undefined && inspectedFiles + fileCount > MAX_FILES) {
              inspectedFiles = MAX_FILES;
              break;
            }
            const parsed = readEligibleFiles(value, language, identity.movieHash !== undefined);
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
          (BigInt(left.subtitleId) < BigInt(right.subtitleId) ? -1 : BigInt(left.subtitleId) > BigInt(right.subtitleId) ? 1 : 0) ||
          left.file.file_id - right.file.file_id);
        if (eligible.length === 0) return terminal("no-candidates");

        let localAttemptCount = 0;
        const reservedFileIds = new Set<number>();
        const reservedSubtitleIds = new Set<string>();
        const deliveredContentHashes = new Set<string>();
        const candidates: SubtitleCandidate[] = [];
        const attachments: CandidatePreparation["attachments"] = [];
        let lastCandidateFailure: PreparationFailure | undefined;
        let sawDuplicate = false;
        let spentAttempts = 0;
        for (const selected of eligible) {
          if (reservedFileIds.has(selected.file.file_id)) continue;
          reservedFileIds.add(selected.file.file_id);
          const attempt = run === undefined
            ? (localAttemptCount += 1) <= MAX_PAYLOAD_ATTEMPTS ? localAttemptCount : "exhausted"
            : run.reservePayloadAttempt(selected.file.file_id);
          if (attempt === "duplicate") {
            sawDuplicate = true;
            continue;
          }
          if (attempt === "exhausted" || attempt > MAX_PAYLOAD_ATTEMPTS) {
            if (candidates.length > 0) break;
            return terminal("payload-budget-exhausted");
          }
          spentAttempts = Math.max(spentAttempts, attempt);
          if (reservedSubtitleIds.has(selected.subtitleId)) {
            sawDuplicate = true;
            lastCandidateFailure = new PreparationFailure("duplicate-candidate");
            if (attempt >= MAX_PAYLOAD_ATTEMPTS) break;
            continue;
          }
          reservedSubtitleIds.add(selected.subtitleId);
          try {
            const downloadResponse = request({
              method: "POST",
              url: `${API_ORIGIN}/api/v1/download`,
              headers: { ...apiHeaders, "content-type": "application/json" },
              body: Buffer.from(JSON.stringify({ file_id: selected.file.file_id, sub_format: "srt" }), "utf8"),
              deadlines: apiDeadlines,
            });
            if (REDIRECT_STATUSES.has(downloadResponse.status)) throw new PreparationFailure("unsafe-content");
            const download = decodeJson(downloadResponse);
            if (typeof download !== "object" || download === null) throw new PreparationFailure("malformed-provider-response");
            const fields = download as Record<string, unknown>;
            if (typeof fields.link !== "string" || fields.link.length > 2_048 || !/^[\x20-\x7e]+$/.test(fields.link) ||
                (fields.remaining !== undefined && !isIntegerInRange(fields.remaining, 0, Number.MAX_SAFE_INTEGER))) {
              throw new PreparationFailure("malformed-provider-response");
            }
            if (fields.remaining === 0) throw new PreparationFailure("quota-exhausted");
            const original = validatePlainSrt(payloadRequest(fields.link));
            const contentHash = createHash("sha256").update(original).digest("hex");
            if (deliveredContentHashes.has(contentHash) ||
                options.candidateFiles.findByContentHash?.(contentHash) !== undefined) {
              lastCandidateFailure = new PreparationFailure("duplicate-candidate");
              sawDuplicate = true;
              if (attempt >= MAX_PAYLOAD_ATTEMPTS) break;
              continue;
            }
            deliveredContentHashes.add(contentHash);
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
            let stagedFileId: string;
            try {
              stagedFileId = options.candidateFiles.stage(original);
            } catch {
              throw new PreparationFailure("unsafe-content");
            }
            const languageEvidence = language === "ar" ? "Arabic" : "English";
            const typeEvidence = selected.hearingImpaired ? "SDH" : "standard dialogue";
            const associationEvidence = selected.moviehashMatch
              ? "provider-reported movie-hash match"
              : "provider title identity";
            const provenanceEvidence = selected.fromTrusted
              ? "provider trusted-source claim"
              : "provider provenance without a trusted-source claim";
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
              recommendationReason: `${languageEvidence} ${typeEvidence} candidate for release ${selected.release}; ranked using ${associationEvidence} and ${provenanceEvidence}. Synchronization, completeness, and authorship remain unmeasured.`,
              identityEvidenceHash,
              contentHash,
            };
            candidates.push(candidate);
            attachments.push({ candidateId, filename: safeFilename(selected.file.file_name), stagedFileId });
            if (attempt >= MAX_PAYLOAD_ATTEMPTS) break;
          } catch (error) {
            if (!(error instanceof PreparationFailure)) throw error;
            if (error.outcome === "authentication-failed" || error.outcome === "quota-exhausted" ||
                error.outcome === "run-deadline-exhausted") throw error;
            lastCandidateFailure = error;
            if (attempt >= MAX_PAYLOAD_ATTEMPTS) break;
          }
        }
        if (candidates.length > 0) {
          const count = candidates.length;
          return {
            outcome: "candidates-found",
            explanation: `Prepared ${count} bounded OpenSubtitles candidate${count === 1 ? "" : "s"} for review using ${spentAttempts} of three payload attempts.`,
            nextActions: ["defer"],
            candidates,
            recommendedCandidateId: candidates[0].id,
            attachments,
          };
        }
        if (spentAttempts >= MAX_PAYLOAD_ATTEMPTS) return terminal("payload-budget-exhausted");
        return terminal(lastCandidateFailure?.outcome ?? (sawDuplicate ? "duplicate-candidate" : "no-candidates"));
      } catch (error) {
        if (error instanceof PreparationFailure) return terminal(error.outcome);
        return terminal("malformed-provider-response");
      }
    },
  };
}
