import { randomUUID } from "node:crypto";

import Database from "better-sqlite3";

import type {
  CandidatePreparation,
  CandidatePreparationAdapter,
  PreparationOutcome,
  PreparationVideo,
  SubtitleCandidate,
} from "./candidate-preparation.js";
import type { PrivateCandidateStore } from "./private-candidate-store.js";
import { prepareSyntheticCandidates } from "./synthetic-preparation.js";

export type SubtitleLanguage = "en" | "ar";

export interface VideoIdentity {
  libraryId: string;
  id: string;
  label: string;
}

export type RequestLifecycle = "active" | "deferred";

export interface RequestSummary {
  id: string;
  version: number;
  video: VideoIdentity;
  language: SubtitleLanguage;
  lifecycle: RequestLifecycle;
}

export interface RequestLifecycleEntry {
  version: number;
  lifecycle: RequestLifecycle;
}

export interface CandidateRejection {
  candidateId: string;
  identityEvidenceHash: string;
  reason: string;
}

export interface CandidateAttachment {
  id: string;
  filename: string;
  contentHash: string;
  downloadUrl: string;
}

export interface PreparedCandidateView extends SubtitleCandidate {
  rejection: CandidateRejection | null;
  attachment: CandidateAttachment | null;
}

export type PreviewSampleStatus = "checked" | "not-checked" | "failed";
export type PreviewOutcome = "usable" | "not-usable" | "inconclusive";

export interface PreviewObservation {
  id: string;
  attachmentId: string;
  video: VideoIdentity;
  candidateId: string;
  candidateContentHash: string;
  client: string;
  outcome: PreviewOutcome;
  sample: {
    beginning: PreviewSampleStatus;
    middle: PreviewSampleStatus;
    end: PreviewSampleStatus;
  };
  note: string | null;
  recordedAt: string;
}

export interface RequestPreparationView {
  outcome: PreparationOutcome;
  explanation: string;
  nextActions: Array<"defer" | "retry">;
  candidates: PreparedCandidateView[];
  recommendedCandidateId: string | null;
}

export interface RequestView extends RequestSummary {
  lifecycleHistory: RequestLifecycleEntry[];
  preparation: RequestPreparationView | null;
  previewObservations?: PreviewObservation[];
}

export interface RequestListView {
  requests: RequestSummary[];
}

export type RequestCommand =
  | {
      type: "create-request";
      request: {
        id: string;
        version: 0;
      };
      video: PreparationVideo;
      language: SubtitleLanguage;
    }
  | {
      type: "defer-request";
      request: {
        id: string;
        version: number;
      };
    }
  | {
      type: "retry-request";
      request: {
        id: string;
        version: number;
      };
    }
  | {
      type: "prepare-request";
      request: {
        id: string;
        version: number;
      };
    }
  | {
      type: "retry-preparation";
      request: { id: string; version: number };
    }
  | {
      type: "reject-candidate";
      request: {
        id: string;
        version: number;
      };
      candidate: {
        id: string;
        identityEvidenceHash: string;
      };
      reason: string;
    }
  | {
      type: "record-preview-observation";
      request: {
        id: string;
        version: number;
      };
      attachmentId: string;
      client: string;
      outcome: PreviewOutcome;
      sample: {
        beginning: PreviewSampleStatus;
        middle: PreviewSampleStatus;
        end: PreviewSampleStatus;
      };
      note?: string;
    };

export interface CandidateAttachmentDownload {
  filename: string;
  contentHash: string;
  content: Buffer;
}

export interface RequestWorkflow {
  issue(command: RequestCommand): RequestView;
  getRequest(requestId: string): RequestView | undefined;
  getCandidateAttachment(attachmentId: string): CandidateAttachmentDownload | undefined;
  listRequests(query: { lifecycle: RequestLifecycle }): RequestListView;
  close(): void;
}

export class RequestVersionConflictError extends Error {
  constructor() {
    super("Request is not at the expected lifecycle and version");
    this.name = "RequestVersionConflictError";
  }
}

export class CandidateRejectionValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CandidateRejectionValidationError";
  }
}

export class PreviewObservationValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PreviewObservationValidationError";
  }
}

interface RequestRow {
  request_id: string;
  version: number;
  library_id: string;
  video_id: string;
  video_label: string;
  saved_video_id: string | null;
  provider_identity_json: string | null;
  language: SubtitleLanguage;
  lifecycle: RequestLifecycle;
}

interface RequestLifecycleRow {
  version: number;
  lifecycle: RequestLifecycle;
}

interface CandidateRejectionRow {
  candidate_id: string;
  candidate_identity_hash: string;
  reason: string;
}

interface CandidateAttachmentRow {
  attachment_id: string;
  request_id: string;
  candidate_id: string;
  content_hash: string;
  filename: string;
  content: Buffer | null;
  staged_file_id: string | null;
}

interface PreviewObservationRow {
  observation_id: string;
  attachment_id: string;
  library_id: string;
  video_id: string;
  video_label: string;
  candidate_id: string;
  candidate_content_hash: string;
  client: string;
  outcome: PreviewOutcome;
  beginning: PreviewSampleStatus;
  middle: PreviewSampleStatus;
  end: PreviewSampleStatus;
  note: string | null;
  recorded_at: string;
}

interface PreparationMigrationRow extends RequestRow {
  candidates_json: string;
}

function readNextActions(value: string): Array<"defer" | "retry"> {
  try {
    return JSON.parse(value) as Array<"defer" | "retry">;
  } catch (error) {
    const repaired = value.replace(/\\"/g, '"');
    if (repaired === value) throw error;
    return JSON.parse(repaired) as Array<"defer" | "retry">;
  }
}

function toRequestSummary(row: RequestRow): RequestSummary {
  return {
    id: row.request_id,
    version: row.version,
    video: {
      libraryId: row.library_id,
      id: row.video_id,
      label: row.video_label,
    },
    language: row.language,
    lifecycle: row.lifecycle,
  };
}

function toPreparationVideo(row: RequestRow): PreparationVideo {
  return {
    libraryId: row.library_id,
    id: row.video_id,
    label: row.video_label,
    ...(row.saved_video_id === null ? {} : { savedVideoId: row.saved_video_id }),
    ...(row.provider_identity_json === null
      ? {}
      : { openSubtitlesSearchIdentity: JSON.parse(row.provider_identity_json) as PreparationVideo["openSubtitlesSearchIdentity"] }),
  };
}

export function openRequestWorkflow(options: {
  databasePath: string;
  preparation?: CandidatePreparationAdapter;
  candidateFiles?: PrivateCandidateStore;
}): RequestWorkflow {
  const database = new Database(options.databasePath);
  const preparationAdapter = options.preparation ?? {
    prepare: prepareSyntheticCandidates,
  };
  database.pragma("foreign_keys = ON");

  database.exec(`
    CREATE TABLE IF NOT EXISTS subtitle_requests (
      request_id TEXT PRIMARY KEY,
      version INTEGER NOT NULL,
      library_id TEXT NOT NULL,
      video_id TEXT NOT NULL,
      video_label TEXT NOT NULL,
      saved_video_id TEXT,
      provider_identity_json TEXT,
      language TEXT NOT NULL,
      lifecycle TEXT NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS request_lifecycle_history (
      request_id TEXT NOT NULL REFERENCES subtitle_requests(request_id),
      version INTEGER NOT NULL,
      lifecycle TEXT NOT NULL,
      PRIMARY KEY (request_id, version)
    ) STRICT;

    CREATE UNIQUE INDEX IF NOT EXISTS subtitle_requests_video_language
    ON subtitle_requests (library_id, video_id, language);

    CREATE TABLE IF NOT EXISTS request_preparations (
      request_id TEXT PRIMARY KEY REFERENCES subtitle_requests(request_id),
      candidates_json TEXT NOT NULL,
      recommended_candidate_id TEXT,
      outcome TEXT NOT NULL DEFAULT 'candidates-found',
      explanation TEXT NOT NULL DEFAULT 'Prepared bounded candidates for review.',
      next_actions_json TEXT NOT NULL DEFAULT '["defer"]'
    ) STRICT;

    CREATE TABLE IF NOT EXISTS candidate_rejections (
      request_id TEXT NOT NULL REFERENCES subtitle_requests(request_id),
      library_id TEXT NOT NULL,
      video_id TEXT NOT NULL,
      candidate_id TEXT NOT NULL,
      candidate_identity_hash TEXT NOT NULL,
      reason TEXT NOT NULL CHECK (length(trim(reason)) > 0),
      PRIMARY KEY (request_id, candidate_id, candidate_identity_hash)
    ) STRICT;

    CREATE TABLE IF NOT EXISTS candidate_attachments (
      attachment_id TEXT PRIMARY KEY,
      request_id TEXT NOT NULL REFERENCES subtitle_requests(request_id),
      candidate_id TEXT NOT NULL,
      candidate_identity_hash TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      filename TEXT NOT NULL,
      content BLOB,
      staged_file_id TEXT,
      CHECK ((content IS NOT NULL AND staged_file_id IS NULL) OR
             (content IS NULL AND staged_file_id IS NOT NULL)),
      UNIQUE (request_id, candidate_id, content_hash)
    ) STRICT;

    CREATE TABLE IF NOT EXISTS preview_observations (
      observation_id TEXT PRIMARY KEY,
      request_id TEXT NOT NULL REFERENCES subtitle_requests(request_id),
      attachment_id TEXT NOT NULL,
      library_id TEXT NOT NULL,
      video_id TEXT NOT NULL,
      video_label TEXT NOT NULL,
      candidate_id TEXT NOT NULL,
      candidate_content_hash TEXT NOT NULL,
      client TEXT NOT NULL,
      outcome TEXT NOT NULL,
      beginning TEXT NOT NULL,
      middle TEXT NOT NULL,
      end TEXT NOT NULL,
      note TEXT,
      recorded_at TEXT NOT NULL
    ) STRICT;

    INSERT OR IGNORE INTO request_lifecycle_history (request_id, version, lifecycle)
    SELECT request_id, version, lifecycle FROM subtitle_requests;
  `);

  const requestColumns = database.prepare("PRAGMA table_info(subtitle_requests)")
    .all() as Array<{ name: string }>;
  if (!requestColumns.some((column) => column.name === "saved_video_id")) {
    database.exec("ALTER TABLE subtitle_requests ADD COLUMN saved_video_id TEXT");
  }
  if (!requestColumns.some((column) => column.name === "provider_identity_json")) {
    database.exec("ALTER TABLE subtitle_requests ADD COLUMN provider_identity_json TEXT");
  }

  const attachmentColumns = database.prepare("PRAGMA table_info(candidate_attachments)")
    .all() as Array<{ name: string }>;
  if (!attachmentColumns.some((column) => column.name === "staged_file_id")) {
    database.exec(`
      ALTER TABLE candidate_attachments RENAME TO legacy_candidate_attachments;
      CREATE TABLE candidate_attachments (
        attachment_id TEXT PRIMARY KEY,
        request_id TEXT NOT NULL REFERENCES subtitle_requests(request_id),
        candidate_id TEXT NOT NULL,
        candidate_identity_hash TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        filename TEXT NOT NULL,
        content BLOB,
        staged_file_id TEXT,
        CHECK ((content IS NOT NULL AND staged_file_id IS NULL) OR
               (content IS NULL AND staged_file_id IS NOT NULL)),
        UNIQUE (request_id, candidate_id, content_hash)
      ) STRICT;
      INSERT INTO candidate_attachments (
        attachment_id, request_id, candidate_id, candidate_identity_hash,
        content_hash, filename, content, staged_file_id
      )
      SELECT attachment_id, request_id, candidate_id, candidate_identity_hash,
        content_hash, filename, content, NULL
      FROM legacy_candidate_attachments;
      DROP TABLE legacy_candidate_attachments;
    `);
  }

  const preparationColumns = database.prepare("PRAGMA table_info(request_preparations)")
    .all() as Array<{ name: string }>;
  if (!preparationColumns.some((column) => column.name === "outcome")) {
    database.exec("ALTER TABLE request_preparations ADD COLUMN outcome TEXT NOT NULL DEFAULT 'candidates-found'");
    database.exec("ALTER TABLE request_preparations ADD COLUMN explanation TEXT NOT NULL DEFAULT 'Prepared bounded candidates for review.'");
    database.exec("ALTER TABLE request_preparations ADD COLUMN next_actions_json TEXT NOT NULL DEFAULT '[\"defer\"]'");
  }

  const rejectionColumns = database.prepare("PRAGMA table_info(candidate_rejections)")
    .all() as Array<{ name: string }>;
  const hasIdentityHash = rejectionColumns.some((column) => column.name === "candidate_identity_hash");
  const hasEarlierEvidenceHash = rejectionColumns.some((column) => column.name === "candidate_evidence_hash");
  if (!hasIdentityHash && hasEarlierEvidenceHash) {
    database.exec(`
      ALTER TABLE candidate_rejections
      RENAME COLUMN candidate_evidence_hash TO candidate_identity_hash
    `);
  }

  const preparationRows = database.prepare(`
    SELECT
      r.request_id, r.version, r.library_id, r.video_id, r.video_label, r.saved_video_id,
      r.provider_identity_json, r.language, r.lifecycle, p.candidates_json, p.outcome, p.explanation, p.next_actions_json
    FROM request_preparations p
    JOIN subtitle_requests r ON r.request_id = p.request_id
  `).all() as PreparationMigrationRow[];
  const updatePreparationCandidates = database.prepare(`
    UPDATE request_preparations SET candidates_json = ? WHERE request_id = ?
  `);
  database.transaction(() => {
    for (const row of preparationRows) {
      const stored = JSON.parse(row.candidates_json) as Array<
        Omit<SubtitleCandidate, "identityEvidenceHash" | "contentHash" | "completeness"> & {
          identityEvidenceHash?: string;
          evidenceHash?: string;
          contentHash?: string;
          completeness?: SubtitleCandidate["completeness"];
        }
      >;
      if (stored.every((candidate) => candidate.identityEvidenceHash !== undefined &&
          candidate.contentHash !== undefined && candidate.completeness !== undefined)) continue;
      const generated = prepareSyntheticCandidates(
        { libraryId: row.library_id, id: row.video_id, label: row.video_label },
        row.language,
      ).candidates;
      const migrated = stored.map((candidate) => {
        const { evidenceHash, ...candidateEvidence } = candidate;
        const generatedCandidate = generated.find((item) => item.id === candidate.id);
        const identityEvidenceHash = candidate.identityEvidenceHash ?? evidenceHash ?? generatedCandidate?.identityEvidenceHash;
        const contentHash = candidate.contentHash ?? generatedCandidate?.contentHash;
        const completeness = candidate.completeness ?? generatedCandidate?.completeness;
        if (identityEvidenceHash === undefined || contentHash === undefined || completeness === undefined) {
          throw new Error(`Prepared candidate ${candidate.id} cannot be migrated to durable candidate evidence`);
        }
        return { ...candidateEvidence, identityEvidenceHash, contentHash, completeness };
      });
      updatePreparationCandidates.run(JSON.stringify(migrated), row.request_id);
    }
  })();

  const insertRequest = database.prepare(`
    INSERT INTO subtitle_requests (
      request_id, version, library_id, video_id, video_label, saved_video_id,
      provider_identity_json, language, lifecycle
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT DO NOTHING
    RETURNING request_id, version, library_id, video_id, video_label, saved_video_id,
      provider_identity_json, language, lifecycle
  `);
  const selectRequest = database.prepare(`
    SELECT request_id, version, library_id, video_id, video_label, saved_video_id,
      provider_identity_json, language, lifecycle
    FROM subtitle_requests
    WHERE request_id = ?
  `);
  const selectRequestByVideoLanguage = database.prepare(`
    SELECT request_id, version, library_id, video_id, video_label, saved_video_id,
      provider_identity_json, language, lifecycle
    FROM subtitle_requests
    WHERE library_id = ? AND video_id = ? AND language = ?
  `);
  const deferRequest = database.prepare(`
    UPDATE subtitle_requests
    SET version = version + 1, lifecycle = 'deferred'
    WHERE request_id = ? AND version = ? AND lifecycle = 'active'
    RETURNING request_id, version, library_id, video_id, video_label, saved_video_id,
      provider_identity_json, language, lifecycle
  `);
  const retryRequest = database.prepare(`
    UPDATE subtitle_requests
    SET version = version + 1, lifecycle = 'active'
    WHERE request_id = ? AND version = ? AND lifecycle = 'deferred'
    RETURNING request_id, version, library_id, video_id, video_label, saved_video_id,
      provider_identity_json, language, lifecycle
  `);
  const selectRequestsByLifecycle = database.prepare(`
    SELECT request_id, version, library_id, video_id, video_label, saved_video_id,
      provider_identity_json, language, lifecycle
    FROM subtitle_requests
    WHERE lifecycle = ?
    ORDER BY request_id
  `);
  const insertLifecycleHistory = database.prepare(`
    INSERT INTO request_lifecycle_history (request_id, version, lifecycle)
    VALUES (?, ?, ?)
  `);
  const selectLifecycleHistory = database.prepare(`
    SELECT version, lifecycle
    FROM request_lifecycle_history
    WHERE request_id = ?
    ORDER BY version
  `);
  const selectPreparation = database.prepare(`
    SELECT candidates_json, recommended_candidate_id, outcome, explanation, next_actions_json
    FROM request_preparations
    WHERE request_id = ?
  `);
  const replacePreparation = database.prepare(`
    UPDATE request_preparations
    SET candidates_json = ?, recommended_candidate_id = ?, outcome = ?, explanation = ?, next_actions_json = ?
    WHERE request_id = ?
  `);
  const insertPreparation = database.prepare(`
    INSERT OR IGNORE INTO request_preparations (
      request_id, candidates_json, recommended_candidate_id, outcome, explanation, next_actions_json
    ) VALUES (?, ?, ?, ?, ?, ?)
  `);
  const selectCandidateRejections = database.prepare(`
    SELECT candidate_id, candidate_identity_hash, reason
    FROM candidate_rejections
    WHERE request_id = ?
    ORDER BY candidate_id, candidate_identity_hash
  `);
  const insertCandidateRejection = database.prepare(`
    INSERT OR IGNORE INTO candidate_rejections (
      request_id, library_id, video_id, candidate_id, candidate_identity_hash, reason
    ) VALUES (?, ?, ?, ?, ?, ?)
  `);
  const selectCandidateAttachments = database.prepare(`
    SELECT attachment_id, request_id, candidate_id, content_hash, filename, content, staged_file_id
    FROM candidate_attachments
    WHERE request_id = ?
  `);
  const insertCandidateAttachment = database.prepare(`
    INSERT OR REPLACE INTO candidate_attachments (
      attachment_id, request_id, candidate_id, candidate_identity_hash,
      content_hash, filename, content, staged_file_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const deleteCandidateAttachments = database.prepare(`
    DELETE FROM candidate_attachments WHERE request_id = ?
  `);
  const selectPreviewObservations = database.prepare(`
    SELECT observation_id, attachment_id, library_id, video_id, video_label,
      candidate_id, candidate_content_hash, client, outcome, beginning, middle, end, note, recorded_at
    FROM preview_observations
    WHERE request_id = ?
    ORDER BY recorded_at, observation_id
  `);
  const insertPreviewObservation = database.prepare(`
    INSERT INTO preview_observations (
      observation_id, request_id, attachment_id, library_id, video_id, video_label,
      candidate_id, candidate_content_hash, client, outcome, beginning, middle, end, note, recorded_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const selectCandidateAttachment = database.prepare(`
    SELECT attachment_id, request_id, candidate_id, content_hash, filename, content, staged_file_id
    FROM candidate_attachments
    WHERE attachment_id = ?
  `);

  const readPreparationCandidates = (candidatesJson: string): SubtitleCandidate[] => {
    const candidates = JSON.parse(candidatesJson) as SubtitleCandidate[];
    if (candidates.some((candidate) => candidate.identityEvidenceHash === undefined || candidate.contentHash === undefined)) {
      throw new Error("Prepared candidates were not migrated to durable evidence hashes");
    }
    return candidates;
  };

  const storeCandidateAttachments = (
    requestId: string,
    candidates: SubtitleCandidate[],
    attachments: CandidatePreparation["attachments"],
  ) => {
    const candidatesById = new Map(candidates.map((candidate) => [candidate.id, candidate]));
    for (const attachment of attachments) {
      const candidate = candidatesById.get(attachment.candidateId);
      if (candidate === undefined) continue;
      insertCandidateAttachment.run(
        randomUUID(), requestId, candidate.id, candidate.identityEvidenceHash,
        candidate.contentHash, attachment.filename,
        "content" in attachment ? attachment.content : null,
        "stagedFileId" in attachment ? attachment.stagedFileId : null,
      );
    }
  };

  database.transaction(() => {
    for (const row of preparationRows) {
      if (selectCandidateAttachments.all(row.request_id).length > 0) continue;
      const preparation = prepareSyntheticCandidates(
        { libraryId: row.library_id, id: row.video_id, label: row.video_label }, row.language,
      );
      const candidates = readPreparationCandidates(
        (database.prepare("SELECT candidates_json FROM request_preparations WHERE request_id = ?")
          .get(row.request_id) as { candidates_json: string }).candidates_json,
      );
      storeCandidateAttachments(row.request_id, candidates, preparation.attachments);
    }
  })();

  const readRequest = (requestId: string): RequestView | undefined => {
    const row = selectRequest.get(requestId) as RequestRow | undefined;
    if (row === undefined) {
      return undefined;
    }
    const lifecycleHistory = selectLifecycleHistory.all(
      requestId,
    ) as RequestLifecycleRow[];
    const preparationRow = selectPreparation.get(requestId) as {
      candidates_json: string;
      recommended_candidate_id: string | null;
      outcome: PreparationOutcome;
      explanation: string;
      next_actions_json: string;
    } | undefined;
    const preparationCandidates = preparationRow === undefined
      ? null
      : readPreparationCandidates(preparationRow.candidates_json);
    const rejectionRows = selectCandidateRejections.all(requestId) as CandidateRejectionRow[];
    const rejections = new Map(rejectionRows.map((rejection) => [
      `${rejection.candidate_id}\0${rejection.candidate_identity_hash}`,
      {
        candidateId: rejection.candidate_id,
        identityEvidenceHash: rejection.candidate_identity_hash,
        reason: rejection.reason,
      },
    ]));
    const attachmentRows = selectCandidateAttachments.all(requestId) as CandidateAttachmentRow[];
    const attachments = new Map(attachmentRows.map((attachment) => [
      `${attachment.candidate_id}\0${attachment.content_hash}`,
      {
        id: attachment.attachment_id,
        filename: attachment.filename,
        contentHash: attachment.content_hash,
        downloadUrl: `/api/candidate-attachments/${encodeURIComponent(attachment.attachment_id)}`,
      },
    ]));
    const candidates = preparationCandidates?.map((candidate) => ({
      ...candidate,
      rejection: rejections.get(`${candidate.id}\0${candidate.identityEvidenceHash}`) ?? null,
      attachment: rejections.has(`${candidate.id}\0${candidate.identityEvidenceHash}`)
        ? null
        : attachments.get(`${candidate.id}\0${candidate.contentHash}`) ?? null,
    })) ?? null;
    const originalRecommendation = preparationRow?.recommended_candidate_id;
    const preparationOutcome = preparationRow?.outcome;
    const preparationExplanation = preparationRow?.explanation;
    const preparationNextActions = preparationRow === undefined
      ? []
      : readNextActions(preparationRow.next_actions_json);
    const recommendationWasRejected = candidates?.find(
      (candidate) => candidate.id === originalRecommendation,
    )?.rejection != null;
    const preparation = candidates === null ? null : {
      outcome: preparationOutcome ?? "candidates-found",
      explanation: preparationExplanation ?? "Prepared bounded candidates for review.",
      nextActions: preparationNextActions,
      candidates,
      recommendedCandidateId: recommendationWasRejected ? null : originalRecommendation ?? null,
    };
    const observationRows = selectPreviewObservations.all(requestId) as PreviewObservationRow[];
    const previewObservations = observationRows.map((observation): PreviewObservation => ({
      id: observation.observation_id,
      attachmentId: observation.attachment_id,
      video: {
        libraryId: observation.library_id,
        id: observation.video_id,
        label: observation.video_label,
      },
      candidateId: observation.candidate_id,
      candidateContentHash: observation.candidate_content_hash,
      client: observation.client,
      outcome: observation.outcome,
      sample: {
        beginning: observation.beginning,
        middle: observation.middle,
        end: observation.end,
      },
      note: observation.note,
      recordedAt: observation.recorded_at,
    }));
    return {
      ...toRequestSummary(row), lifecycleHistory, preparation,
      ...(previewObservations.length === 0 ? {} : { previewObservations }),
    };
  };

  const createRequest = database.transaction(
    (command: Extract<RequestCommand, { type: "create-request" }>): string => {
      const version = command.request.version + 1;
      const row = insertRequest.get(
        command.request.id,
        version,
        command.video.libraryId,
        command.video.id,
        command.video.label,
        command.video.savedVideoId ?? null,
        command.video.openSubtitlesSearchIdentity === undefined
          ? null
          : JSON.stringify(command.video.openSubtitlesSearchIdentity),
        command.language,
        "active",
      ) as RequestRow | undefined;
      if (row === undefined) {
        const existing = selectRequestByVideoLanguage.get(
          command.video.libraryId,
          command.video.id,
          command.language,
        ) as RequestRow | undefined;
        if (existing !== undefined) {
          return existing.request_id;
        }
        throw new RequestVersionConflictError();
      }
      insertLifecycleHistory.run(row.request_id, row.version, row.lifecycle);
      return row.request_id;
    },
  );
  const deferActiveRequest = database.transaction(
    (request: { id: string; version: number }) => {
      const row = deferRequest.get(request.id, request.version) as
        | RequestRow
        | undefined;
      if (row === undefined) {
        throw new RequestVersionConflictError();
      }
      insertLifecycleHistory.run(row.request_id, row.version, row.lifecycle);
    },
  );
  const retryDeferredRequest = database.transaction(
    (request: { id: string; version: number }) => {
      const row = retryRequest.get(request.id, request.version) as
        | RequestRow
        | undefined;
      if (row === undefined) {
        throw new RequestVersionConflictError();
      }
      insertLifecycleHistory.run(row.request_id, row.version, row.lifecycle);
    },
  );
  const prepareActiveRequest = database.transaction(
    (request: { id: string; version: number }) => {
      const row = selectRequest.get(request.id) as RequestRow | undefined;
      if (row === undefined || row.version !== request.version || row.lifecycle !== "active") {
        throw new RequestVersionConflictError();
      }
      const existing = selectPreparation.get(request.id) as {
        candidates_json: string;
        recommended_candidate_id: string | null;
        outcome: PreparationOutcome;
        explanation: string;
        next_actions_json: string;
      } | undefined;
      if (existing !== undefined) return;
      const preparation = preparationAdapter.prepare(toPreparationVideo(row), row.language);
      insertPreparation.run(
        request.id,
        JSON.stringify(preparation.candidates),
        preparation.recommendedCandidateId,
        preparation.outcome,
        preparation.explanation,
        JSON.stringify(preparation.nextActions),
      );
      storeCandidateAttachments(request.id, preparation.candidates, preparation.attachments);
    },
  );
  const retryPreparation = database.transaction(
    (request: { id: string; version: number }) => {
      const row = selectRequest.get(request.id) as RequestRow | undefined;
      if (row === undefined || row.version !== request.version || row.lifecycle !== "active") {
        throw new RequestVersionConflictError();
      }
      const preparation = preparationAdapter.prepare(toPreparationVideo(row), row.language);
      replacePreparation.run(
        JSON.stringify(preparation.candidates), preparation.recommendedCandidateId,
        preparation.outcome, preparation.explanation, JSON.stringify(preparation.nextActions), request.id,
      );
      deleteCandidateAttachments.run(request.id);
      storeCandidateAttachments(request.id, preparation.candidates, preparation.attachments);
    },
  );
  const recordPreviewObservation = database.transaction(
    (command: Extract<RequestCommand, { type: "record-preview-observation" }>) => {
      const client = command.client.trim();
      const note = command.note?.trim() ?? "";
      const validOutcomes = new Set<PreviewOutcome>(["usable", "not-usable", "inconclusive"]);
      const validSamples = new Set<PreviewSampleStatus>(["checked", "not-checked", "failed"]);
      if (client.length === 0 || client.length > 200) {
        throw new PreviewObservationValidationError("A preview client is required");
      }
      if (!validOutcomes.has(command.outcome) || !validSamples.has(command.sample.beginning) ||
          !validSamples.has(command.sample.middle) || !validSamples.has(command.sample.end)) {
        throw new PreviewObservationValidationError("Preview outcome and beginning, middle, and end sample statuses are required");
      }
      if (note.length > 2000) {
        throw new PreviewObservationValidationError("Preview notes are limited to 2000 characters");
      }
      const row = selectRequest.get(command.request.id) as RequestRow | undefined;
      if (row === undefined || row.version !== command.request.version) {
        throw new RequestVersionConflictError();
      }
      const attachment = selectCandidateAttachment.get(command.attachmentId) as CandidateAttachmentRow | undefined;
      if (attachment === undefined || attachment.request_id !== row.request_id) {
        throw new PreviewObservationValidationError("Preview attachment is not owned by this request");
      }
      const preparationRow = selectPreparation.get(command.request.id) as { candidates_json: string } | undefined;
      const candidate = preparationRow === undefined
        ? undefined
        : readPreparationCandidates(preparationRow.candidates_json).find((item) =>
          item.id === attachment.candidate_id && item.contentHash === attachment.content_hash);
      if (candidate === undefined) {
        throw new PreviewObservationValidationError("Preview attachment is not a current prepared candidate");
      }
      const rejection = (selectCandidateRejections.all(command.request.id) as CandidateRejectionRow[]).some((item) =>
        item.candidate_id === candidate.id && item.candidate_identity_hash === candidate.identityEvidenceHash);
      if (rejection) {
        throw new PreviewObservationValidationError("Rejected candidates cannot be previewed");
      }
      insertPreviewObservation.run(
        randomUUID(), command.request.id, attachment.attachment_id,
        row.library_id, row.video_id, row.video_label, candidate.id, candidate.contentHash,
        client, command.outcome, command.sample.beginning, command.sample.middle, command.sample.end,
        note.length === 0 ? null : note, new Date().toISOString(),
      );
    },
  );

  const rejectPreparedCandidate = database.transaction(
    (command: Extract<RequestCommand, { type: "reject-candidate" }>) => {
      const reason = command.reason.trim();
      if (reason.length === 0) {
        throw new CandidateRejectionValidationError("A rejection reason is required");
      }
      const row = selectRequest.get(command.request.id) as RequestRow | undefined;
      if (row === undefined || row.version !== command.request.version || row.lifecycle !== "active") {
        throw new RequestVersionConflictError();
      }
      const preparationRow = selectPreparation.get(command.request.id) as {
        candidates_json: string;
      } | undefined;
      const candidates = preparationRow === undefined
        ? []
        : readPreparationCandidates(preparationRow.candidates_json);
      const candidate = candidates.find((item) =>
        item.id === command.candidate.id &&
        item.identityEvidenceHash === command.candidate.identityEvidenceHash);
      if (candidate === undefined) {
        throw new CandidateRejectionValidationError("Reject an explicitly prepared candidate with unchanged evidence");
      }
      insertCandidateRejection.run(
        row.request_id,
        row.library_id,
        row.video_id,
        candidate.id,
        candidate.identityEvidenceHash,
        reason,
      );
    },
  );

  const workflow: RequestWorkflow = {
    issue(command) {
      let requestId = command.request.id;
      switch (command.type) {
        case "create-request":
          requestId = createRequest(command);
          break;
        case "defer-request":
          deferActiveRequest(command.request);
          break;
        case "retry-request":
          retryDeferredRequest(command.request);
          break;
        case "prepare-request":
          prepareActiveRequest(command.request);
          break;
        case "retry-preparation":
          retryPreparation(command.request);
          break;
        case "reject-candidate":
          rejectPreparedCandidate(command);
          break;
        case "record-preview-observation":
          recordPreviewObservation(command);
          break;
      }
      const view = readRequest(requestId);
      if (view === undefined) {
        throw new Error("Applied request command did not produce a request view");
      }
      return view;
    },

    getRequest(requestId) {
      return readRequest(requestId);
    },

    getCandidateAttachment(attachmentId) {
      const attachment = selectCandidateAttachment.get(attachmentId) as CandidateAttachmentRow | undefined;
      if (attachment === undefined || attachment.request_id === undefined) return undefined;
      const request = selectRequest.get(attachment.request_id) as RequestRow | undefined;
      const preparation = selectPreparation.get(attachment.request_id) as { candidates_json: string } | undefined;
      if (request === undefined || preparation === undefined) return undefined;
      const candidate = readPreparationCandidates(preparation.candidates_json).find((item) =>
        item.id === attachment.candidate_id && item.contentHash === attachment.content_hash);
      if (candidate === undefined) return undefined;
      const rejected = (selectCandidateRejections.all(attachment.request_id) as CandidateRejectionRow[]).some((item) =>
        item.candidate_id === candidate.id && item.candidate_identity_hash === candidate.identityEvidenceHash);
      if (rejected) return undefined;
      const content = attachment.content ?? (
        attachment.staged_file_id === null ? undefined : options.candidateFiles?.read(attachment.staged_file_id)
      );
      if (content === undefined) return undefined;
      return {
        filename: attachment.filename,
        contentHash: attachment.content_hash,
        content,
      };
    },

    listRequests(query) {
      const rows = selectRequestsByLifecycle.all(query.lifecycle) as RequestRow[];
      return { requests: rows.map(toRequestSummary) };
    },

    close() {
      database.close();
    },
  };

  return workflow;
}
