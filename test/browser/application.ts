import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { test as base } from "@playwright/test";
import type { FastifyInstance } from "fastify";

import { buildServer } from "../../src/server/app.js";
import type { InventoryRefreshAttempt } from "../../src/server/inventory-contract.js";
import {
  createOpenSubtitlesPreparation,
  type OpenSubtitlesHttpTransport,
} from "../../src/server/opensubtitles-preparation.js";
import { openPrivateCandidateStore } from "../../src/server/private-candidate-store.js";
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
  restart(): Promise<void>;
}

export const test = base.extend<{
  application: Application;
  refreshScenario: RefreshScenario;
  preparationMode: "synthetic" | "opensubtitles";
}>({
  refreshScenario: [{ outcome: "success", delayMs: 100 }, { option: true }],
  preparationMode: ["synthetic", { option: true }],
  application: async ({ refreshScenario, preparationMode }, use) => {
    const directory = await mkdtemp(path.join(tmpdir(), "subtitle-manager-"));
    const databasePath = path.join(directory, "workflow.sqlite");
    const candidateFiles = preparationMode === "opensubtitles"
      ? openPrivateCandidateStore({ root: path.join(directory, "candidate-files") })
      : undefined;
    const payload = (fileId: number) => Buffer.from(`1\r\n00:00:01,000 --> 00:00:03,000\r\nFixture subtitle ${fileId}.\r\n`, "utf8");
    const transport: OpenSubtitlesHttpTransport = {
      request(request) {
        const url = new URL(request.url);
        if (request.method === "GET" && url.hostname === "api.opensubtitles.com") {
          return {
            status: 200,
            headers: { "content-type": "application/json" },
            body: Buffer.from(JSON.stringify({
              total_pages: 1, total_count: 3, per_page: 50, page: 1,
              data: [
                { id: "918273", attributes: { language: "ar", release: "Quiet.Orbit.2025.1080p.WEB-DL", foreign_parts_only: false, hearing_impaired: false, machine_translated: false, ai_translated: false, moviehash_match: false, from_trusted: true, download_count: 100, files: [{ file_id: 456789, file_name: "Quiet.Orbit.2025.ar.srt" }] } },
                { id: "918274", attributes: { language: "ar", release: "Quiet.Orbit.2025.BluRay", foreign_parts_only: false, hearing_impaired: false, machine_translated: false, ai_translated: false, moviehash_match: false, from_trusted: true, download_count: 80, files: [{ file_id: 456790, file_name: "Quiet.Orbit.2025.bluray.ar.srt" }] } },
                { id: "918275", attributes: { language: "ar", release: "Quiet.Orbit.2025.HDTV", foreign_parts_only: false, hearing_impaired: true, machine_translated: false, ai_translated: false, moviehash_match: false, from_trusted: false, download_count: 60, files: [{ file_id: 456791, file_name: "Quiet.Orbit.2025.hdtv.ar.srt" }] } },
              ],
            }), "utf8"),
          };
        }
        if (request.method === "POST" && url.pathname === "/api/v1/download") {
          const fileId = JSON.parse(request.body?.toString("utf8") ?? "{}").file_id as number;
          return {
            status: 200,
            headers: { "content-type": "application/json" },
            body: Buffer.from(JSON.stringify({ link: `https://fixture-payload.invalid/download/${fileId}` }), "utf8"),
          };
        }
        if (request.method === "GET" && url.hostname === "fixture-payload.invalid") {
          const fileId = Number(url.pathname.split("/").at(-1));
          return { status: 200, headers: { "content-type": "application/x-subrip" }, body: payload(fileId) };
        }
        throw new Error(`Unexpected fixture HTTP request: ${request.method} ${request.url}`);
      },
    };
    const preparation = candidateFiles === undefined ? undefined : createOpenSubtitlesPreparation({
      transport,
      candidateFiles,
      apiKey: "browser-fixture-api-key",
      token: "browser-fixture-token",
      payloadOrigins: ["https://fixture-payload.invalid"],
    });
    const openWorkflow = () => openRequestWorkflow({ databasePath, preparation, candidateFiles });
    let workflow = openWorkflow();
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
    const requests: string[] = [];
    let server = buildServer({ clientRoot: path.resolve("dist/client"), inventory, workflow });
    server.addHook("onRequest", async (request) => {
      requests.push(`${request.method} ${request.url.split("?")[0]}`);
    });
    await server.listen({ host: "127.0.0.1", port: 0 });
    const address = server.server.address();
    if (address === null || typeof address === "string") throw new Error("Expected loopback TCP address");
    const port = address.port;
    const application: Application = {
      url: `http://127.0.0.1:${port}`,
      requests,
      get server() { return server; },
      get workflow() { return workflow; },
      async restart() {
        server.server.closeAllConnections();
        await server.close();
        workflow.close();
        workflow = openWorkflow();
        server = buildServer({ clientRoot: path.resolve("dist/client"), inventory, workflow });
        server.addHook("onRequest", async (request) => {
          requests.push(`${request.method} ${request.url.split("?")[0]}`);
        });
        await server.listen({ host: "127.0.0.1", port });
      },
    };
    try {
      await use(application);
    } finally {
      server.server.closeAllConnections();
      await server.close();
      workflow.close();
      candidateFiles?.close();
      await rm(directory, { recursive: true, force: true });
    }
  },
});
