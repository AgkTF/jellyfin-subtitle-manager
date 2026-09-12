import Database from "better-sqlite3";

export type SubtitleLanguage = "en" | "ar";

export interface VideoIdentity {
  libraryId: string;
  id: string;
  label: string;
}

export type RequestLifecycle = "active" | "deferred";

export interface RequestView {
  id: string;
  version: number;
  video: VideoIdentity;
  language: SubtitleLanguage;
  lifecycle: RequestLifecycle;
}

export interface RequestListView {
  requests: RequestView[];
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

function toRequestView(row: RequestRow): RequestView {
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

  database.exec(`
    CREATE TABLE IF NOT EXISTS subtitle_requests (
      request_id TEXT PRIMARY KEY,
      version INTEGER NOT NULL,
      library_id TEXT NOT NULL,
      video_id TEXT NOT NULL,
      video_label TEXT NOT NULL,
      language TEXT NOT NULL,
      lifecycle TEXT NOT NULL
    ) STRICT
  `);

  const insertRequest = database.prepare(`
    INSERT INTO subtitle_requests (
      request_id, version, library_id, video_id, video_label, language, lifecycle
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(request_id) DO NOTHING
    RETURNING request_id, version, library_id, video_id, video_label, language, lifecycle
  `);
  const selectRequest = database.prepare(`
    SELECT request_id, version, library_id, video_id, video_label, language, lifecycle
    FROM subtitle_requests
    WHERE request_id = ?
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

  const workflow: RequestWorkflow = {
    issue(command) {
      switch (command.type) {
        case "create-request": {
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
            throw new RequestVersionConflictError();
          }
          return toRequestView(row);
        }
        case "defer-request": {
          const row = deferRequest.get(
            command.request.id,
            command.request.version,
          ) as RequestRow | undefined;
          if (row === undefined) {
            throw new RequestVersionConflictError();
          }
          return toRequestView(row);
        }
        case "retry-request": {
          const row = retryRequest.get(
            command.request.id,
            command.request.version,
          ) as RequestRow | undefined;
          if (row === undefined) {
            throw new RequestVersionConflictError();
          }
          return toRequestView(row);
        }
      }
    },

    getRequest(requestId) {
      const row = selectRequest.get(requestId) as RequestRow | undefined;
      return row === undefined ? undefined : toRequestView(row);
    },

    listRequests(query) {
      const rows = selectRequestsByLifecycle.all(query.lifecycle) as RequestRow[];
      return { requests: rows.map(toRequestView) };
    },

    close() {
      database.close();
    },
  };

  return workflow;
}
