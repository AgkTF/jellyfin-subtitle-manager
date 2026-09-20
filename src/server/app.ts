import { randomUUID } from "node:crypto";

import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance } from "fastify";

import {
  CandidateRejectionValidationError,
  PreviewObservationValidationError,
  RequestVersionConflictError,
  type RequestWorkflow,
} from "./request-workflow.js";
import {
  openSyntheticSavedInventory,
  type SavedInventoryAdapter,
} from "./saved-inventory.js";

interface ServerOptions {
  clientRoot?: string;
  logger?: boolean;
  workflow?: RequestWorkflow;
  inventory?: SavedInventoryAdapter;
}

interface CreateRequestBody {
  videoId: string;
  identityId: string;
  language: "en" | "ar";
}

interface RequestParams {
  requestId: string;
}

interface TransitionRequestBody {
  version: number;
}

interface RejectCandidateBody extends TransitionRequestBody {
  candidateId: string;
  identityEvidenceHash: string;
  reason: string;
}

interface PreviewObservationBody extends TransitionRequestBody {
  attachmentId: string;
  client: string;
  outcome: "usable" | "not-usable" | "inconclusive";
  sample: {
    beginning: "checked" | "not-checked" | "failed";
    middle: "checked" | "not-checked" | "failed";
    end: "checked" | "not-checked" | "failed";
  };
  note?: string;
}

interface AttachmentParams {
  attachmentId: string;
}

export function buildServer(options: ServerOptions = {}): FastifyInstance {
  const server = Fastify({ logger: options.logger ?? false });

  // Loopback binding alone does not prevent DNS rebinding or cross-origin reads.
  server.addHook("onRequest", async (request, reply) => {
    const host = request.headers.host ?? "";
    const origin = request.headers.origin;
    if (!/^(localhost|127\.0\.0\.1|\[::1\])(:[0-9]{1,5})?$/.test(host) ||
        (origin !== undefined && origin !== `http://${host}`)) {
      return reply.code(403).send({ error: "Untrusted Host or Origin" });
    }
  });

  server.get("/health", async () => ({ status: "ok" }));

  const inventory = options.inventory ?? openSyntheticSavedInventory();

  server.get<{ Querystring: { q?: string } }>("/api/inventory", {
    schema: {
      querystring: {
        type: "object",
        properties: { q: { type: "string", maxLength: 200 } },
        additionalProperties: false,
      },
    },
  }, async (request) => inventory.search(request.query.q ?? ""));

  let inventoryRefreshInProgress = false;
  server.post("/api/inventory/refresh", async (_request, reply) => {
    if (inventoryRefreshInProgress) {
      return reply.code(409).send({ error: "Inventory refresh already in progress" });
    }
    inventoryRefreshInProgress = true;
    try {
      return await inventory.refresh();
    } finally {
      inventoryRefreshInProgress = false;
    }
  });

  const workflow = options.workflow;
  if (workflow !== undefined) {
    server.get("/api/requests", async () => ({
      active: workflow.listRequests({ lifecycle: "active" }).requests,
      deferred: workflow.listRequests({ lifecycle: "deferred" }).requests,
    }));

    server.post<{ Body: CreateRequestBody }>("/api/requests", {
      schema: {
        body: {
          type: "object",
          required: ["videoId", "identityId", "language"],
          properties: {
            videoId: { type: "string", minLength: 1, maxLength: 200 },
            identityId: { type: "string", minLength: 1, maxLength: 200 },
            language: { type: "string", enum: ["en", "ar"] },
          },
          additionalProperties: false,
        },
      },
    }, async (request, reply) => {
      const video = inventory.resolveIdentity(request.body.videoId, request.body.identityId);
      if (video === undefined) {
        return reply.code(422).send({ error: "Select one unambiguous saved video identity first" });
      }
      const created = workflow.issue({
        type: "create-request",
        request: { id: randomUUID(), version: 0 },
        video,
        language: request.body.language,
      });
      return reply.code(201).send(created);
    });

    server.get<{ Params: RequestParams }>("/api/requests/:requestId", async (request, reply) => {
      const view = workflow.getRequest(request.params.requestId);
      return view === undefined ? reply.code(404).send({ error: "Subtitle request was not found" }) : view;
    });

    server.get<{ Params: AttachmentParams }>("/api/candidate-attachments/:attachmentId", {
      schema: {
        params: {
          type: "object",
          required: ["attachmentId"],
          properties: { attachmentId: { type: "string", minLength: 1, maxLength: 100 } },
          additionalProperties: false,
        },
      },
    }, async (request, reply) => {
      const attachment = workflow.getCandidateAttachment(request.params.attachmentId);
      if (attachment === undefined) {
        return reply.code(404).send({ error: "Candidate attachment was not found" });
      }
      const filename = attachment.filename.replace(/[\\"\r\n]/g, "_");
      return reply
        .type("application/x-subrip")
        .header("content-disposition", `attachment; filename="${filename}"`)
        .header("x-content-sha256", attachment.contentHash)
        .send(attachment.content);
    });

    server.post<{ Params: RequestParams; Body: PreviewObservationBody }>("/api/requests/:requestId/preview-observations", {
      schema: {
        body: {
          type: "object",
          required: ["version", "attachmentId", "client", "outcome", "sample"],
          properties: {
            version: { type: "integer", minimum: 1 },
            attachmentId: { type: "string", minLength: 1, maxLength: 100 },
            client: { type: "string", minLength: 1, maxLength: 200 },
            outcome: { type: "string", enum: ["usable", "not-usable", "inconclusive"] },
            sample: {
              type: "object",
              required: ["beginning", "middle", "end"],
              properties: {
                beginning: { type: "string", enum: ["checked", "not-checked", "failed"] },
                middle: { type: "string", enum: ["checked", "not-checked", "failed"] },
                end: { type: "string", enum: ["checked", "not-checked", "failed"] },
              },
              additionalProperties: false,
            },
            note: { type: "string", maxLength: 2000 },
          },
          additionalProperties: false,
        },
      },
    }, async (request, reply) => {
      try {
        const view = workflow.issue({
          type: "record-preview-observation",
          request: { id: request.params.requestId, version: request.body.version },
          attachmentId: request.body.attachmentId,
          client: request.body.client,
          outcome: request.body.outcome,
          sample: request.body.sample,
          note: request.body.note,
        });
        return reply.code(201).send(view);
      } catch (error) {
        if (error instanceof RequestVersionConflictError) {
          return reply.code(409).send({ error: "Preview requires the current request version" });
        }
        if (error instanceof PreviewObservationValidationError) {
          return reply.code(422).send({ error: error.message });
        }
        throw error;
      }
    });

    server.post<{ Params: RequestParams; Body: TransitionRequestBody }>("/api/requests/:requestId/prepare", {
      schema: {
        body: {
          type: "object",
          required: ["version"],
          properties: { version: { type: "integer", minimum: 1 } },
          additionalProperties: false,
        },
      },
    }, async (request, reply) => {
      try {
        return workflow.issue({
          type: "prepare-request",
          request: { id: request.params.requestId, version: request.body.version },
        });
      } catch (error) {
        if (error instanceof RequestVersionConflictError) {
          return reply.code(409).send({ error: "Preparation requires the current active request" });
        }
        throw error;
      }
    });

    server.post<{ Params: RequestParams; Body: TransitionRequestBody }>("/api/requests/:requestId/retry-preparation", {
      schema: {
        body: {
          type: "object",
          required: ["version"],
          properties: { version: { type: "integer", minimum: 1 } },
          additionalProperties: false,
        },
      },
    }, async (request, reply) => {
      try {
        return workflow.issue({
          type: "retry-preparation",
          request: { id: request.params.requestId, version: request.body.version },
        });
      } catch (error) {
        if (error instanceof RequestVersionConflictError) {
          return reply.code(409).send({ error: "Preparation retry requires the current active request" });
        }
        throw error;
      }
    });

    server.post<{ Params: RequestParams; Body: RejectCandidateBody }>("/api/requests/:requestId/reject", {
      schema: {
        body: {
          type: "object",
          required: ["version", "candidateId", "identityEvidenceHash", "reason"],
          properties: {
            version: { type: "integer", minimum: 1 },
            candidateId: { type: "string", minLength: 1, maxLength: 200 },
            identityEvidenceHash: { type: "string", pattern: "^[a-f0-9]{64}$" },
            reason: { type: "string", minLength: 1, maxLength: 1000 },
          },
          additionalProperties: false,
        },
      },
    }, async (request, reply) => {
      try {
        return workflow.issue({
          type: "reject-candidate",
          request: { id: request.params.requestId, version: request.body.version },
          candidate: {
            id: request.body.candidateId,
            identityEvidenceHash: request.body.identityEvidenceHash,
          },
          reason: request.body.reason,
        });
      } catch (error) {
        if (error instanceof RequestVersionConflictError) {
          return reply.code(409).send({ error: "Candidate rejection requires the current request" });
        }
        if (error instanceof CandidateRejectionValidationError) {
          return reply.code(422).send({ error: error.message });
        }
        throw error;
      }
    });

    for (const [action, type] of [["defer", "defer-request"], ["retry", "retry-request"]] as const) {
      server.post<{ Params: RequestParams; Body: TransitionRequestBody }>(`/api/requests/:requestId/${action}`, {
        schema: {
          body: {
            type: "object",
            required: ["version"],
            properties: { version: { type: "integer", minimum: 1 } },
            additionalProperties: false,
          },
        },
      }, async (request, reply) => {
        try {
          return workflow.issue({ type, request: { id: request.params.requestId, version: request.body.version } });
        } catch (error) {
          if (error instanceof RequestVersionConflictError) {
            return reply.code(409).send({ error: "Subtitle request is no longer in that lifecycle state" });
          }
          throw error;
        }
      });
    }
  }

  if (options.clientRoot !== undefined) {
    void server.register(fastifyStatic, {
      root: options.clientRoot,
    });
  }

  return server;
}
