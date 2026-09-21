import { expect } from "@playwright/test";

import { test } from "./application.js";

test("explicitly prepares bounded synthetic candidates and retains the recommendation", async ({ page, application }) => {
  await page.goto(application.url);
  await page.getByRole("button", { name: "Request subtitles" }).click();
  const picker = page.getByRole("dialog", { name: "Inspect saved inventory" });
  await picker.getByRole("searchbox").fill("Orbit");
  await picker.getByRole("button", { name: "Search", exact: true }).click();
  await picker.getByRole("button", { name: "Inspect Quiet Orbit (2025)" }).click();
  await picker.getByRole("radio", { name: "Arabic" }).check();
  await picker.getByRole("button", { name: "Create request" }).click();
  await page.getByRole("row", { name: /Quiet Orbit \(2025\).*Arabic.*Active/ }).click();

  const detail = page.getByRole("region", { name: "Subtitle request detail" });
  await detail.getByRole("button", { name: "Prepare candidates" }).click();
  const candidates = detail.getByRole("region", { name: "Prepared subtitle candidates" });
  await expect(candidates).toContainText("Provider and network activity: none");
  await expect(candidates.getByRole("listitem")).toHaveCount(1);
  await candidates.getByRole("button", { name: "Show 2 alternatives" }).click();
  await expect(candidates.getByRole("listitem")).toHaveCount(3);
  await expect(candidates).toContainText("Recommended");
  await expect(candidates).toContainText("Arabic authorship remains unknown");
  await expect(candidates).toContainText("unmeasured");
  await expect(candidates).toContainText("publication is not enabled");
  await expect(detail.getByRole("button", { name: "Prepare candidates" })).toHaveCount(0);

  await application.restart();
  await page.reload();
  await page.getByRole("row", { name: /Quiet Orbit \(2025\).*Arabic.*Active/ }).click();
  const restoredCandidates = page.getByRole("region", { name: "Prepared subtitle candidates" });
  await restoredCandidates.getByRole("button", { name: "Show 2 alternatives" }).click();
  await expect(restoredCandidates.getByRole("listitem")).toHaveCount(3);
  expect(application.workflow.getRequest(application.workflow.listRequests({ lifecycle: "active" }).requests[0].id)?.preparation?.candidates).toHaveLength(3);
});
