import { randomUUID } from "node:crypto";

import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance } from "fastify";

import type { RequestWorkflow } from "./request-workflow.js";
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
  }

  if (options.clientRoot !== undefined) {
    void server.register(fastifyStatic, {
      root: options.clientRoot,
    });
  }

  return server;
}
