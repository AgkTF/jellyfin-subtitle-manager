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
    .getByRole("button", { name: "Prepare synthetic candidates" }).click();
}

test("downloads the selected synthetic candidate and records scoped preview evidence", async ({ page, application }) => {
  await page.goto(application.url);
  await createPreparedArabicRequest(page);

  const detail = page.getByRole("region", { name: "Subtitle request detail" });
  const candidates = detail.getByRole("region", { name: "Prepared subtitle candidates" });
  const preview = candidates.getByRole("region", { name: "Selected candidate preview" });
  await expect(preview).toContainText("Selected video: Quiet Orbit (2025)");
  await expect(preview).toContainText("locator quiet-orbit-2025");
  await expect(preview).toContainText("Candidate:");
  await expect(preview).toContainText("Content SHA-256");
  await expect(preview).toContainText("beginning");
  await expect(preview).toContainText("middle");
  await expect(preview).toContainText("end");
  await expect(preview).toContainText("not proof of what the player loaded");

  const download = preview.getByRole("link", { name: "Download selected candidate attachment" });
  const downloadUrl = await download.getAttribute("href");
  expect(downloadUrl).toMatch(/^\/api\/candidate-attachments\//);
  const attachment = await page.request.get(new URL(downloadUrl ?? "", application.url).toString());
  expect(attachment.status()).toBe(200);
  expect(attachment.headers()["content-disposition"]).toMatch(/^attachment;/);
  expect(await attachment.text()).toContain("Synthetic subtitle candidate");

  await preview.getByLabel("Client used").fill("Existing desktop player 1.0");
  await preview.getByLabel("Preview outcome").selectOption("usable");
  await preview.getByLabel("Beginning sample").selectOption("checked");
  await preview.getByLabel("Middle sample").selectOption("checked");
  await preview.getByLabel("End sample").selectOption("checked");
  await preview.getByLabel("Observation note (optional)").fill("Three targeted samples were checked.");
  await preview.getByRole("button", { name: "Record preview observation" }).click();
  await expect(preview.getByRole("region", { name: "Recorded preview observations" }))
    .toContainText("Existing desktop player 1.0 · usable");

  await application.restart();
  await page.reload();
  await page.getByRole("row", { name: /Quiet Orbit \(2025\).*Arabic.*Active/ }).click();
  await expect(page.getByRole("region", { name: "Recorded preview observations" }))
    .toContainText("Three targeted samples were checked.");
});
