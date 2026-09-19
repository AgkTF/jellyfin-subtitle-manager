import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { test as base } from "@playwright/test";
import type { FastifyInstance } from "fastify";

import { buildServer } from "../../src/server/app.js";
import type { InventoryRefreshAttempt } from "../../src/server/inventory-contract.js";
import { openRequestWorkflow, type RequestWorkflow } from "../../src/server/request-workflow.js";
import { openSyntheticSavedInventory } from "../../src/server/saved-inventory.js";

export interface RefreshScenario {
  outcome: "success" | "partial" | "failed";
  delayMs?: number;
}

interface Application {
  url: string;
  requests: string[];
  server: FastifyInstance;
  workflow: RequestWorkflow;
}

export const test = base.extend<{ application: Application; refreshScenario: RefreshScenario }>({
  refreshScenario: [{ outcome: "success", delayMs: 100 }, { option: true }],
  application: async ({ refreshScenario }, use) => {
    const directory = await mkdtemp(path.join(tmpdir(), "subtitle-manager-"));
    const workflow = openRequestWorkflow({ databasePath: path.join(directory, "workflow.sqlite") });
    const previous = openSyntheticSavedInventory().search("");
    const refresh = async (): Promise<InventoryRefreshAttempt> => {
      if (refreshScenario.delayMs !== undefined) {
        await new Promise((resolve) => setTimeout(resolve, refreshScenario.delayMs));
      }
      if (refreshScenario.outcome === "failed") {
        return { outcome: "failed", error: "Synthetic refresh could not read /synthetic/offline." };
      }
      return {
        outcome: refreshScenario.outcome,
        inventory: {
          ...previous,
          scannedAt: refreshScenario.outcome === "partial"
            ? "2026-02-16T09:00:00Z"
            : "2026-02-16T08:30:00Z",
          errors: refreshScenario.outcome === "partial"
            ? ["Synthetic partial refresh: /synthetic/cloud-archive could not be probed; its previous evidence was not carried forward."]
            : [],
          videos: refreshScenario.outcome === "partial"
            ? previous.videos.filter((video) => video.id !== "cloud-archive")
            : previous.videos,
        },
      };
    };
    const inventory = openSyntheticSavedInventory({ refresh });
    const server = buildServer({ clientRoot: path.resolve("dist/client"), inventory, workflow });
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
