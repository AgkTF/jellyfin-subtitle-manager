import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { test as base } from "@playwright/test";
import type { FastifyInstance } from "fastify";

import { buildServer } from "../../src/server/app.js";
import { openRequestWorkflow, type RequestWorkflow } from "../../src/server/request-workflow.js";

interface Application {
  url: string;
  requests: string[];
  server: FastifyInstance;
  workflow: RequestWorkflow;
}

export const test = base.extend<{ application: Application }>({
  // No browser fixture is needed to start the real application.
  // eslint-disable-next-line no-empty-pattern
  application: async ({}, use) => {
    const directory = await mkdtemp(path.join(tmpdir(), "subtitle-manager-"));
    const workflow = openRequestWorkflow({ databasePath: path.join(directory, "workflow.sqlite") });
    const server = buildServer({ clientRoot: path.resolve("dist/client"), workflow });
    const requests: string[] = [];
    server.addHook("onRequest", async (request) => {
      requests.push(`${request.method} ${request.url.split("?")[0]}`);
    });
    try {
      await server.listen({ host: "127.0.0.1", port: 0 });
      const address = server.server.address();
      if (address === null || typeof address === "string") throw new Error("Expected loopback TCP address");
      await use({ url: `http://127.0.0.1:${address.port}`, requests, server, workflow });
    } finally {
      await server.close();
      workflow.close();
      await rm(directory, { recursive: true, force: true });
    }
  },
});
