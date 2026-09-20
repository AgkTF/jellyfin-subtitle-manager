import { expect } from "@playwright/test";

import { test } from "./application.js";

async function createRequest(page: import("@playwright/test").Page, title: string) {
  await page.getByRole("button", { name: "Request subtitles" }).click();
  const picker = page.getByRole("dialog", { name: "Inspect saved inventory" });
  await picker.getByRole("searchbox").fill(title);
  await picker.getByRole("button", { name: "Search", exact: true }).click();
  await picker.getByRole("button", { name: `Inspect ${title}` }).click();
  await picker.getByRole("radio", { name: "Arabic" }).check();
  await picker.getByRole("button", { name: "Create request" }).click();
  await page.getByRole("row", { name: new RegExp(`${title.replace(/[()]/g, "\\$&")}.*Arabic.*Active`) }).click();
  const detail = page.getByRole("region", { name: "Subtitle request detail" });
  await detail.getByRole("button", { name: "Prepare synthetic candidates" }).click();
  return detail;
}

test("keeps no-candidate, blocked, and failed preparation outcomes distinct after restart", async ({ page, application }) => {
  await page.goto(application.url);
  const noCandidate = await createRequest(page, "No Suitable Candidate (2025)");
  await expect(noCandidate).toContainText("no-suitable-candidate");
  await expect(noCandidate).toContainText("No suitable Arabic subtitle candidate");
  await expect(noCandidate.getByRole("button", { name: "Retry preparation" })).toHaveCount(0);

  const blocked = await createRequest(page, "Blocked Preparation (2025)");
  await expect(blocked).toContainText("blocked");
  await expect(blocked).toContainText("requires an explicit identity");
  await expect(blocked.getByRole("button", { name: "Retry preparation" })).toBeVisible();

  const failed = await createRequest(page, "Failed Preparation (2025)");
  await expect(failed).toContainText("failed");
  await expect(failed).toContainText("No candidate was downloaded");

  await application.restart();
  await page.reload();
  for (const title of ["No Suitable Candidate (2025)", "Blocked Preparation (2025)", "Failed Preparation (2025)"]) {
    const row = page.getByRole("row", { name: new RegExp(`${title.replace(/[()]/g, "\\$&")}.*Arabic.*Active`) });
    await row.click();
    await expect(page.getByRole("region", { name: "Subtitle request detail" })).toContainText(
      title.includes("No Suitable") ? "no-suitable-candidate" : title.includes("Blocked") ? "blocked" : "failed",
    );
  }
});
