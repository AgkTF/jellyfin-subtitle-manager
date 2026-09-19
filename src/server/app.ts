import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance } from "fastify";

import type { RequestWorkflow } from "./request-workflow.js";
import { searchSavedInventory } from "./saved-inventory.js";

interface ServerOptions {
  clientRoot?: string;
  logger?: boolean;
  workflow?: RequestWorkflow;
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

  server.get<{ Querystring: { q?: string } }>("/api/inventory", {
    schema: {
      querystring: {
        type: "object",
        properties: { q: { type: "string", maxLength: 200 } },
        additionalProperties: false,
      },
    },
  }, async (request) => searchSavedInventory(request.query.q ?? ""));

  const workflow = options.workflow;
  if (workflow !== undefined) {
    server.get("/api/requests", async () => ({
      active: workflow.listRequests({ lifecycle: "active" }).requests,
      deferred: workflow.listRequests({ lifecycle: "deferred" }).requests,
    }));
  }

  if (options.clientRoot !== undefined) {
    void server.register(fastifyStatic, {
      root: options.clientRoot,
    });
  }

  return server;
}
