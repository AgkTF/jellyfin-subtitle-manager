import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { expect, test } from "@playwright/test";

import { buildServer } from "../../src/server/app.js";
import { openRequestWorkflow } from "../../src/server/request-workflow.js";

test("opens an empty request workspace without starting work", async ({ page }) => {
  const stateDirectory = await mkdtemp(path.join(tmpdir(), "subtitle-manager-"));
  const workflow = openRequestWorkflow({
    databasePath: path.join(stateDirectory, "workflow.sqlite"),
  });
  const server = buildServer({
    clientRoot: path.resolve("dist/client"),
    workflow,
  });

  await server.listen({ host: "127.0.0.1", port: 0 });
  const address = server.server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Expected the application to listen on a loopback TCP port");
  }

  const applicationRequests: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).port === String(address.port)) {
      applicationRequests.push(`${request.method()} ${new URL(request.url()).pathname}`);
    }
  });

  try {
    await page.goto(`http://127.0.0.1:${address.port}`);

    await expect(
      page.getByRole("heading", { level: 1, name: "Subtitle requests" }),
    ).toBeVisible();
    const requestNavigation = page.getByRole("navigation", { name: "Requests" });
    await expect(
      requestNavigation.getByRole("button", { name: "Active 0" }),
    ).toBeVisible();
    await expect(
      requestNavigation.getByRole("button", { name: "Deferred 0" }),
    ).toBeVisible();
    await expect(
      requestNavigation.getByRole("button", { name: "Finished 0" }),
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: "Active requests" })).toBeVisible();
    await expect(
      page.getByText("Nothing in this request group.", { exact: true }),
    ).toBeVisible();

    await page.getByRole("button", { name: "Deferred 0" }).first().click();
    await expect(page.getByRole("heading", { name: "Deferred requests" })).toBeVisible();
    await page.getByRole("button", { name: "Finished 0" }).first().click();
    await expect(page.getByRole("heading", { name: "Finished requests" })).toBeVisible();

    expect(applicationRequests).toContain("GET /api/requests");
    expect(applicationRequests.every((request) => request.startsWith("GET "))).toBe(
      true,
    );
    expect(workflow.listRequests({ lifecycle: "active" }).requests).toEqual([]);
    expect(workflow.listRequests({ lifecycle: "deferred" }).requests).toEqual([]);
  } finally {
    await server.close();
    workflow.close();
    await rm(stateDirectory, { recursive: true, force: true });
  }
});
