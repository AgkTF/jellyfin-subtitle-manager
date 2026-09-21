import { expect } from "@playwright/test";

import { test } from "./application.js";

test.use({ preparationMode: "opensubtitles" });

test("reviews one durable fixture-backed OpenSubtitles candidate after restart", async ({ page, application }) => {
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
  await expect(candidates.getByRole("listitem")).toHaveCount(1);
  await expect(candidates).toContainText("opensubtitles-v1 · subtitle 918273 · file 456789");
  await expect(candidates).toContainText("unmeasured timing");
  await expect(candidates).toContainText("unmeasured completeness");
  await expect(candidates).toContainText("real provider traffic remains disabled");
  await expect(detail.getByRole("region", { name: "Publication approval" })
    .getByRole("button", { name: "Review publication approval" })).toBeDisabled();

  await application.restart();
  await page.reload();
  await page.getByRole("row", { name: /Quiet Orbit \(2025\).*Arabic.*Active/ }).click();
  await expect(page.getByRole("region", { name: "Prepared subtitle candidates" }).getByRole("listitem")).toHaveCount(1);
  await expect(page.getByRole("region", { name: "Prepared subtitle candidates" }))
    .toContainText("Quiet.Orbit.2025.1080p.WEB-DL");
});
