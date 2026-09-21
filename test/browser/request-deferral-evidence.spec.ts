import { expect, type Page } from "@playwright/test";

import { test } from "./application.js";

async function createPreparedArabicRequest(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Request subtitles" }).click();
  const picker = page.getByRole("dialog", { name: "Inspect saved inventory" });
  await picker.getByRole("searchbox").fill("Orbit");
  await picker.getByRole("button", { name: "Search", exact: true }).click();
  await picker.getByRole("button", { name: "Inspect Quiet Orbit (2025)" }).click();
  await picker.getByRole("radio", { name: "Arabic" }).check();
  await picker.getByRole("button", { name: "Create request" }).click();
  await page.getByRole("row", { name: /Quiet Orbit \(2025\).*Arabic.*Active/ }).click();
  await page.getByRole("region", { name: "Subtitle request detail" })
    .getByRole("button", { name: "Prepare candidates" }).click();
}

test("preserves candidate evidence through preview, deferral, retry, and restart", async ({ page, application }) => {
  await page.goto(application.url);
  await createPreparedArabicRequest(page);

  const detail = page.getByRole("region", { name: "Subtitle request detail" });
  const candidates = detail.getByRole("region", { name: "Prepared subtitle candidates" });
  await candidates.getByRole("button", { name: "Show 2 alternatives" }).click();
  const firstCandidate = candidates.getByRole("listitem").nth(0);
  const secondCandidate = candidates.getByRole("listitem").nth(1);
  const preview = candidates.getByRole("region", { name: "Selected candidate preview" });
  const firstHash = await firstCandidate.getByText(/^[a-f0-9]{64}$/).first().textContent();
  if (firstHash === null) throw new Error("Prepared candidate did not expose an evidence hash");

  await preview.getByLabel("Client used").fill("Existing desktop player 1.0");
  await preview.getByLabel("Preview outcome").selectOption("usable");
  await preview.getByLabel("Beginning sample").selectOption("checked");
  await preview.getByLabel("Middle sample").selectOption("checked");
  await preview.getByLabel("End sample").selectOption("checked");
  await preview.getByLabel("Observation note (optional)").fill("Targeted samples remained usable.");
  await preview.getByRole("button", { name: "Record preview observation" }).click();
  await expect(candidates.getByRole("region", { name: "Recorded preview observations" }))
    .toContainText("Targeted samples remained usable.");

  await secondCandidate.getByRole("button", { name: "Select Synthetic candidate 2" }).click();
  await secondCandidate.getByRole("textbox", { name: "Reason for rejecting Synthetic candidate 2" })
    .fill("The alternative is not suitable.");
  await secondCandidate.getByRole("button", { name: "Reject Synthetic candidate 2" }).click();
  await expect(secondCandidate).toContainText("Rejected: The alternative is not suitable.");

  await detail.getByRole("button", { name: "Defer request" }).click();
  await expect(detail.getByText("Deferred · version 2")).toBeVisible();
  await expect(detail).toContainText("Targeted samples remained usable.");
  await expect(detail).toContainText("Rejected: The alternative is not suitable.");
  await expect(detail).toContainText(firstHash);

  await application.restart();
  await page.reload();
  await page.getByRole("button", { name: "Deferred 1" }).first().click();
  const deferredRow = page.getByRole("row", { name: /Quiet Orbit \(2025\).*Arabic.*Deferred/ });
  await deferredRow.click();
  await candidates.getByRole("button", { name: "Show 2 alternatives" }).click();
  await expect(detail.getByText("Deferred · version 2")).toBeVisible();
  await expect(detail).toContainText("Targeted samples remained usable.");
  await expect(detail).toContainText("Rejected: The alternative is not suitable.");
  await detail.getByRole("button", { name: "Retry request" }).click();

  await expect(detail.getByText("Active · version 3")).toBeVisible();
  await expect(detail).toContainText("Targeted samples remained usable.");
  await expect(detail).toContainText("Rejected: The alternative is not suitable.");
  await expect(detail).toContainText(firstHash);
  expect(application.requests.filter((request) => request.includes("/prepare"))).toHaveLength(1);
  expect(application.requests.filter((request) => request.includes("/preview-observations"))).toHaveLength(1);
  expect(application.requests.filter((request) => request.endsWith("/defer"))).toHaveLength(1);
  expect(application.requests.filter((request) => request.endsWith("/retry"))).toHaveLength(1);

  await application.restart();
  await page.reload();
  await page.getByRole("row", { name: /Quiet Orbit \(2025\).*Arabic.*Active/ }).click();
  await candidates.getByRole("button", { name: "Show 2 alternatives" }).click();
  await expect(detail.getByText("Active · version 3")).toBeVisible();
  await expect(detail).toContainText("Targeted samples remained usable.");
  await expect(detail).toContainText("Rejected: The alternative is not suitable.");
});
