import { expect, type Locator, type Page } from "@playwright/test";

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

async function definitionValue(container: Locator, term: string): Promise<string> {
  return (await container.locator("dt", { hasText: term }).locator("+ dd").textContent())?.trim() ?? "";
}

async function recordPreview(page: Page): Promise<void> {
  const preview = page.getByRole("region", { name: "Selected candidate preview" });
  await preview.getByLabel("Client used").fill("Existing desktop player 1.0");
  await preview.getByLabel("Preview outcome").selectOption("usable");
  await preview.getByLabel("Beginning sample").selectOption("checked");
  await preview.getByLabel("Middle sample").selectOption("checked");
  await preview.getByLabel("End sample").selectOption("checked");
  await preview.getByRole("button", { name: "Record preview observation" }).click();
}

for (const viewport of [
  { name: "desktop", width: 1440, height: 1000 },
  { name: "mobile", width: 390, height: 844 },
]) {
  test(`${viewport.name} reviews an exact but disabled publication approval`, async ({ page, application }) => {
    await page.setViewportSize(viewport);
    await page.goto(application.url);
    await createPreparedArabicRequest(page);

    const candidates = page.getByRole("region", { name: "Prepared subtitle candidates" });
    const firstCandidate = candidates.getByRole("listitem").first();
    const candidateId = await definitionValue(firstCandidate, "Candidate ID");
    const contentHash = await definitionValue(firstCandidate, "Content SHA-256");
    const identityHash = await definitionValue(firstCandidate, "Identity evidence hash");
    const destination = (await definitionValue(firstCandidate, "Proposed destination")).split(" · ")[0];
    await recordPreview(page);

    const publication = page.getByRole("region", { name: "Publication approval" });
    const verification = page.getByRole("region", { name: "Client verification" });
    await publication.getByRole("button", { name: "Review publication approval" }).click();

    await expect(publication).toContainText("Request version 1");
    await expect(publication).toContainText("Quiet Orbit (2025)");
    await expect(publication).toContainText("quiet-orbit-2025");
    await expect(publication).toContainText(candidateId);
    await expect(publication).toContainText(contentHash);
    await expect(publication).toContainText(identityHash);
    await expect(publication).toContainText(destination);
    await expect(publication).toContainText("without replacing any existing subtitle");
    await expect(publication).toContainText("without modifying the media file or changing track defaults");
    await expect(publication.getByRole("button", { name: "Approve and publish — unavailable in Slice 1" }))
      .toBeDisabled();
    await expect(publication).toContainText("No publication operation has been created");
    await expect(verification).toContainText("No Jellyfin check is pending");
    await expect(verification).not.toContainText("confirmed");

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);

    const request = await page.evaluate(async () => {
      const response = await fetch("/api/requests");
      return (await response.json() as { active: Array<{ id: string; version: number }> }).active[0];
    });
    const directPublication = await page.evaluate(async ({ requestId, version, candidateId, contentHash, destination }) => {
      const response = await fetch(`/api/requests/${encodeURIComponent(requestId)}/publish`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ version, candidateId, contentHash, destination }),
      });
      await response.text();
      const current = await fetch(`/api/requests/${encodeURIComponent(requestId)}`);
      return { status: response.status, current: await current.json() as unknown };
    }, { requestId: request.id, version: request.version, candidateId, contentHash, destination });
    expect(directPublication.status).toBe(404);
    expect(application.requests.filter((entry) => entry.includes("/publish"))).toHaveLength(1);
    expect(JSON.stringify(directPublication.current)).not.toMatch(/publication|published|accepted|jellyfin/i);
  });
}

test("candidate, destination, and request-version changes invalidate the reviewed approval context", async ({ page, application }) => {
  await page.goto(application.url);
  await createPreparedArabicRequest(page);
  await recordPreview(page);

  const candidates = page.getByRole("region", { name: "Prepared subtitle candidates" });
  const firstCandidate = candidates.getByRole("listitem").first();
  const firstDestination = await definitionValue(firstCandidate, "Proposed destination");
  const publication = page.getByRole("region", { name: "Publication approval" });
  await publication.getByRole("button", { name: "Review publication approval" }).click();
  await expect(publication).toContainText("Request version 1");

  const secondCandidate = candidates.getByRole("listitem").nth(1);
  await secondCandidate.getByRole("button", { name: "Select Synthetic candidate 2" }).click();
  expect(await definitionValue(secondCandidate, "Proposed destination")).not.toBe(firstDestination);
  await expect(publication).toContainText("The previously reviewed publication context is no longer current");
  await expect(publication).not.toContainText("Request version 1");

  await firstCandidate.getByRole("button", { name: "Select Synthetic candidate 1" }).click();
  await publication.getByRole("button", { name: "Review publication approval" }).click();
  await page.getByRole("region", { name: "Subtitle request detail" })
    .getByRole("button", { name: "Defer request" }).click();
  await expect(publication).toContainText("The previously reviewed publication context is no longer current");
  await expect(publication).not.toContainText("Request version 1");
  await expect(publication.getByRole("button", { name: "Review publication approval" })).toBeDisabled();
  expect(application.requests.filter((entry) => entry.includes("/publish"))).toHaveLength(0);
});
