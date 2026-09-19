import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance } from "fastify";

import type { RequestWorkflow } from "./request-workflow.js";

interface ServerOptions {
  clientRoot?: string;
  logger?: boolean;
  workflow?: RequestWorkflow;
}

export function buildServer(options: ServerOptions = {}): FastifyInstance {
  const server = Fastify({ logger: options.logger ?? false });

  server.get("/health", async () => ({ status: "ok" }));

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
