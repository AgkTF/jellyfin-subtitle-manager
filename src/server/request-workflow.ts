import Database from "better-sqlite3";

import {
  prepareSyntheticCandidates,
  type PreparationOutcome,
  type SubtitleCandidate,
} from "./synthetic-preparation.js";

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

export interface PreparedCandidateView extends SubtitleCandidate {
  rejection: CandidateRejection | null;
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
      video: VideoIdentity;
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
    };

export interface RequestWorkflow {
  issue(command: RequestCommand): RequestView;
  getRequest(requestId: string): RequestView | undefined;
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

interface RequestRow {
  request_id: string;
  version: number;
  library_id: string;
  video_id: string;
  video_label: string;
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

export function openRequestWorkflow(options: {
  databasePath: string;
}): RequestWorkflow {
  const database = new Database(options.databasePath);
  database.pragma("foreign_keys = ON");

  database.exec(`
    CREATE TABLE IF NOT EXISTS subtitle_requests (
      request_id TEXT PRIMARY KEY,
      version INTEGER NOT NULL,
      library_id TEXT NOT NULL,
      video_id TEXT NOT NULL,
      video_label TEXT NOT NULL,
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

    INSERT OR IGNORE INTO request_lifecycle_history (request_id, version, lifecycle)
    SELECT request_id, version, lifecycle FROM subtitle_requests;
  `);

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
      r.request_id, r.version, r.library_id, r.video_id, r.video_label, r.language, r.lifecycle,
      p.candidates_json, p.outcome, p.explanation, p.next_actions_json
    FROM request_preparations p
    JOIN subtitle_requests r ON r.request_id = p.request_id
  `).all() as PreparationMigrationRow[];
  const updatePreparationCandidates = database.prepare(`
    UPDATE request_preparations SET candidates_json = ? WHERE request_id = ?
  `);
  database.transaction(() => {
    for (const row of preparationRows) {
      const stored = JSON.parse(row.candidates_json) as Array<
        Omit<SubtitleCandidate, "identityEvidenceHash"> & {
          identityEvidenceHash?: string;
          evidenceHash?: string;
        }
      >;
      if (stored.every((candidate) => candidate.identityEvidenceHash !== undefined)) continue;
      const generated = prepareSyntheticCandidates(
        { libraryId: row.library_id, id: row.video_id, label: row.video_label },
        row.language,
      ).candidates;
      const migrated = stored.map((candidate) => {
        if (candidate.identityEvidenceHash !== undefined) return candidate;
        const { evidenceHash, ...candidateEvidence } = candidate;
        const identityEvidenceHash = evidenceHash ?? generated.find(
          (item) => item.id === candidate.id,
        )?.identityEvidenceHash;
        if (identityEvidenceHash === undefined) {
          throw new Error(`Prepared candidate ${candidate.id} cannot be migrated to identity evidence`);
        }
        return { ...candidateEvidence, identityEvidenceHash };
      });
      updatePreparationCandidates.run(JSON.stringify(migrated), row.request_id);
    }
  })();

  const insertRequest = database.prepare(`
    INSERT INTO subtitle_requests (
      request_id, version, library_id, video_id, video_label, language, lifecycle
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT DO NOTHING
    RETURNING request_id, version, library_id, video_id, video_label, language, lifecycle
  `);
  const selectRequest = database.prepare(`
    SELECT request_id, version, library_id, video_id, video_label, language, lifecycle
    FROM subtitle_requests
    WHERE request_id = ?
  `);
  const selectRequestByVideoLanguage = database.prepare(`
    SELECT request_id, version, library_id, video_id, video_label, language, lifecycle
    FROM subtitle_requests
    WHERE library_id = ? AND video_id = ? AND language = ?
  `);
  const deferRequest = database.prepare(`
    UPDATE subtitle_requests
    SET version = version + 1, lifecycle = 'deferred'
    WHERE request_id = ? AND version = ? AND lifecycle = 'active'
    RETURNING request_id, version, library_id, video_id, video_label, language, lifecycle
  `);
  const retryRequest = database.prepare(`
    UPDATE subtitle_requests
    SET version = version + 1, lifecycle = 'active'
    WHERE request_id = ? AND version = ? AND lifecycle = 'deferred'
    RETURNING request_id, version, library_id, video_id, video_label, language, lifecycle
  `);
  const selectRequestsByLifecycle = database.prepare(`
    SELECT request_id, version, library_id, video_id, video_label, language, lifecycle
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

  const readPreparationCandidates = (candidatesJson: string): SubtitleCandidate[] => {
    const candidates = JSON.parse(candidatesJson) as SubtitleCandidate[];
    if (candidates.some((candidate) => candidate.identityEvidenceHash === undefined)) {
      throw new Error("Prepared candidates were not migrated to identity evidence hashes");
    }
    return candidates;
  };

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
    const candidates = preparationCandidates?.map((candidate) => ({
      ...candidate,
      rejection: rejections.get(`${candidate.id}\0${candidate.identityEvidenceHash}`) ?? null,
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
    return { ...toRequestSummary(row), lifecycleHistory, preparation };
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
      const preparation = prepareSyntheticCandidates(
        { libraryId: row.library_id, id: row.video_id, label: row.video_label },
        row.language,
      );
      insertPreparation.run(
        request.id,
        JSON.stringify(preparation.candidates),
        preparation.recommendedCandidateId,
        preparation.outcome,
        preparation.explanation,
        JSON.stringify(preparation.nextActions),
      );
    },
  );
  const retryPreparation = database.transaction(
    (request: { id: string; version: number }) => {
      const row = selectRequest.get(request.id) as RequestRow | undefined;
      if (row === undefined || row.version !== request.version || row.lifecycle !== "active") {
        throw new RequestVersionConflictError();
      }
      const preparation = prepareSyntheticCandidates(
        { libraryId: row.library_id, id: row.video_id, label: row.video_label },
        row.language,
      );
      replacePreparation.run(
        JSON.stringify(preparation.candidates), preparation.recommendedCandidateId,
        preparation.outcome, preparation.explanation, JSON.stringify(preparation.nextActions), request.id,
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
