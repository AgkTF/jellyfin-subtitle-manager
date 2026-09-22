import { expect } from "@playwright/test";

import { test } from "./application.js";

test.use({ preparationMode: "opensubtitles" });

test("reviews a recommendation and requests durable OpenSubtitles alternatives after restart", async ({ page, application }) => {
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
  await expect(candidates).toContainText("Arabic standard dialogue candidate for release Quiet.Orbit.2025.1080p.WEB-DL");
  await expect(candidates).toContainText("opensubtitles-v1 · subtitle 918273 · file 456789");
  await candidates.getByRole("button", { name: "Show 2 alternatives" }).click();
  await expect(candidates.getByRole("listitem")).toHaveCount(3);
  await expect(candidates).toContainText("Alternative candidate");
  await candidates.getByRole("button", { name: "Select OpenSubtitles candidate 918274" }).click();
  await expect(candidates.getByRole("region", { name: "Selected candidate preview" }))
    .toContainText("opensubtitles-918274-456790");
  await candidates.getByRole("button", { name: "Hide alternatives" }).click();
  await expect(candidates.getByRole("region", { name: "Selected candidate preview" }))
    .toContainText("opensubtitles-918273-456789");
  await expect(candidates).toContainText("unmeasured timing");
  await expect(candidates).toContainText("unmeasured completeness");
  await expect(candidates).toContainText("real provider traffic remains disabled");
  await expect(detail.getByRole("region", { name: "Publication approval" })
    .getByRole("button", { name: "Review publication approval" })).toBeDisabled();

  await application.restart();
  await page.reload();
  await page.getByRole("row", { name: /Quiet Orbit \(2025\).*Arabic.*Active/ }).click();
  const restoredCandidates = page.getByRole("region", { name: "Prepared subtitle candidates" });
  await expect(restoredCandidates.getByRole("listitem")).toHaveCount(1);
  await restoredCandidates.getByRole("button", { name: "Show 2 alternatives" }).click();
  await expect(restoredCandidates.getByRole("listitem")).toHaveCount(3);
  await expect(restoredCandidates).toContainText("Quiet.Orbit.2025.1080p.WEB-DL");
});
