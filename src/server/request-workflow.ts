import Database from "better-sqlite3";

import {
  prepareSyntheticCandidates,
  type SyntheticPreparation,
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

export interface RequestView extends RequestSummary {
  lifecycleHistory: RequestLifecycleEntry[];
  preparation: SyntheticPreparation | null;
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
      recommended_candidate_id TEXT NOT NULL
    ) STRICT;

    INSERT OR IGNORE INTO request_lifecycle_history (request_id, version, lifecycle)
    SELECT request_id, version, lifecycle FROM subtitle_requests;
  `);

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
    SELECT candidates_json, recommended_candidate_id
    FROM request_preparations
    WHERE request_id = ?
  `);
  const insertPreparation = database.prepare(`
    INSERT OR IGNORE INTO request_preparations (request_id, candidates_json, recommended_candidate_id)
    VALUES (?, ?, ?)
  `);

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
      recommended_candidate_id: string;
    } | undefined;
    const preparation = preparationRow === undefined ? null : {
      candidates: JSON.parse(preparationRow.candidates_json) as SyntheticPreparation["candidates"],
      recommendedCandidateId: preparationRow.recommended_candidate_id,
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
        recommended_candidate_id: string;
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
