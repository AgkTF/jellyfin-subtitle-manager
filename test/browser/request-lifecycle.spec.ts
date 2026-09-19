import { expect } from "@playwright/test";

import { test } from "./application.js";

async function createArabicRequest(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: "Request subtitles" }).click();
  const picker = page.getByRole("dialog", { name: "Inspect saved inventory" });
  await picker.getByRole("searchbox").fill("Orbit");
  await picker.getByRole("button", { name: "Search", exact: true }).click();
  await picker.getByRole("button", { name: "Inspect Quiet Orbit (2025)" }).click();
  await picker.getByRole("radio", { name: "Arabic" }).check();
  await picker.getByRole("button", { name: "Create request" }).click();
}

test("defers and explicitly retries a subtitle request through its detail view", async ({ page, application }) => {
  await page.goto(application.url);
  await createArabicRequest(page);

  await page.getByRole("row", { name: /Quiet Orbit \(2025\).*Arabic.*Active/ }).click();
  const detail = page.getByRole("region", { name: "Subtitle request detail" });
  await expect(detail.getByText("Lifecycle history")).toBeVisible();
  await expect(detail.getByText("Active · version 1")).toBeVisible();
  await detail.getByRole("button", { name: "Defer request" }).click();

  await expect(page.getByRole("heading", { name: "Deferred requests" })).toBeVisible();
  const deferredRow = page.getByRole("row", { name: /Quiet Orbit \(2025\).*Arabic.*Deferred/ });
  await expect(deferredRow).toBeVisible();
  await expect(detail.getByText("Deferred · version 2")).toBeVisible();

  await application.restart();
  await page.reload();
  await page.getByRole("button", { name: "Deferred 1" }).first().click();
  await expect(deferredRow).toBeVisible();
  await deferredRow.click();
  await detail.getByRole("button", { name: "Retry request" }).click();

  await expect(page.getByRole("heading", { name: "Active requests" })).toBeVisible();
  await expect(page.getByRole("row", { name: /Quiet Orbit \(2025\).*Arabic.*Active/ })).toBeVisible();
  await expect(detail.getByText("Active · version 3")).toBeVisible();
  await expect(detail.getByText("Deferred · version 2")).toBeVisible();

  await application.restart();
  await page.reload();
  await expect(page.getByRole("row", { name: /Quiet Orbit \(2025\).*Arabic.*Active/ })).toBeVisible();
  expect(application.workflow.getRequest(application.workflow.listRequests({ lifecycle: "active" }).requests[0].id))
    .toMatchObject({
      version: 3,
      lifecycle: "active",
      lifecycleHistory: [
        { version: 1, lifecycle: "active" },
        { version: 2, lifecycle: "deferred" },
        { version: 3, lifecycle: "active" },
      ],
    });
  expect(application.requests.filter((request) => request.startsWith("POST "))).toEqual([
    "POST /api/requests",
    expect.stringMatching(/^POST \/api\/requests\/[^/]+\/defer$/),
    expect.stringMatching(/^POST \/api\/requests\/[^/]+\/retry$/),
  ]);
});
