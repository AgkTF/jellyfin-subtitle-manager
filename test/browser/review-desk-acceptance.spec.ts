import { expect, type Page } from "@playwright/test";

import { test } from "./application.js";

async function createArabicRequest(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Request subtitles" }).click();
  const picker = page.getByRole("dialog", { name: "Inspect saved inventory" });
  await expect(picker.getByRole("searchbox")).toBeFocused();
  await picker.getByRole("searchbox").fill("Orbit");
  await picker.getByRole("button", { name: "Search", exact: true }).click();
  await picker.getByRole("button", { name: "Inspect Quiet Orbit (2025)" }).click();
  await picker.getByRole("radio", { name: "Arabic" }).check();
  await picker.getByRole("button", { name: "Create request" }).click();
}

for (const viewport of [
  { name: "desktop", width: 1440, height: 1000 },
  { name: "mobile", width: 390, height: 844 },
]) {
  test(`${viewport.name} keeps the locked Review desk hierarchy and interaction boundaries`, async ({ page, application }) => {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(application.url);

    const shell = page.getByRole("region", { name: "Subtitle review workspace" });
    const columns = await shell.evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(" ").length);
    expect(columns).toBe(viewport.width === 390 ? 1 : 3);
    expect(await page.locator("html").evaluate((element) => getComputedStyle(element).scrollBehavior)).toBe("auto");
    await expect(page.getByText("Nothing in this request group.", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Requests", exact: true })).toHaveAttribute("aria-current", "page");
    if (viewport.width !== 390) {
      await expect(page.getByRole("button", { name: "Library evidence unavailable" })).toBeDisabled();
    }
    const textContrast = await page.locator(".eyebrow").first().evaluate((element) => {
      const channels = getComputedStyle(element).color.match(/\d+/g)?.slice(0, 3).map(Number) ?? [];
      const luminance = channels.map((channel) => {
        const value = channel / 255;
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
      }).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
      return 1.05 / (luminance + 0.05);
    });
    expect(textContrast).toBeGreaterThanOrEqual(4.5);

    const opener = page.getByRole("button", { name: "Request subtitles" });
    await opener.click();
    await page.keyboard.press("Escape");
    await expect(opener).toBeFocused();

    await createArabicRequest(page);
    const row = page.getByRole("row", { name: /Quiet Orbit \(2025\)/ });
    await expect(row).toHaveJSProperty("tagName", "BUTTON");
    await row.focus();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    await expect(row).toBeFocused();
    expect(await row.evaluate((element) => getComputedStyle(element).outlineStyle)).not.toBe("none");
    await page.keyboard.press("Enter");

    const detail = page.getByRole("region", { name: "Subtitle request detail" });
    await expect(detail.getByText("Next action · prepare")).toBeVisible();
    const phases = detail.getByRole("group", { name: "Preview, publication, and client verification remain separate" });
    await expect(phases.getByText("1 · Preview")).toBeVisible();
    await expect(phases.getByText("2 · Publication")).toBeVisible();
    await expect(phases.getByText("3 · Client check")).toBeVisible();

    await detail.getByRole("button", { name: "Prepare candidates" }).click();
    const candidates = detail.getByRole("region", { name: "Prepared subtitle candidates" });
    const publication = detail.getByRole("region", { name: "Publication approval" });
    const verification = detail.getByRole("region", { name: "Client verification" });
    await expect(publication.getByRole("button", { name: "Review publication approval" })).toBeDisabled();
    await expect(verification).toContainText("No Jellyfin check is pending");

    const detailBox = await detail.boundingBox();
    for (const nestedSection of [candidates, publication, verification]) {
      const nestedBox = await nestedSection.boundingBox();
      expect(nestedBox?.x).toBeGreaterThanOrEqual((detailBox?.x ?? 0) + 10);
      expect((nestedBox?.x ?? 0) + (nestedBox?.width ?? 0))
        .toBeLessThanOrEqual((detailBox?.x ?? 0) + (detailBox?.width ?? 0) - 10);
    }
    expect(await candidates.getByRole("list").evaluate((element) => getComputedStyle(element).listStyleType))
      .toBe("none");

    await expect(candidates.getByText("Candidate decisions", { exact: true })).toBeVisible();
    await expect(candidates.getByText("No candidates have been rejected.", { exact: true })).toBeVisible();

    const preview = candidates.getByRole("region", { name: "Selected candidate preview" });
    const previewOutcome = preview.getByLabel("Preview outcome");
    expect(await previewOutcome.evaluate((element) => getComputedStyle(element).appearance)).toBe("none");
    expect(await previewOutcome.evaluate((element) => getComputedStyle(element).backgroundImage)).not.toBe("none");
    const bodyFont = await page.locator("body").evaluate((element) => getComputedStyle(element).fontFamily);
    for (const fieldId of ["preview-client", "preview-outcome", "preview-beginning", "preview-middle", "preview-end", "preview-note"]) {
      const field = page.locator(`#${fieldId}`);
      const label = page.locator(`label[for="${fieldId}"]`);
      const [fieldBox, labelBox] = await Promise.all([field.boundingBox(), label.boundingBox()]);
      expect((fieldBox?.y ?? 0) - ((labelBox?.y ?? 0) + (labelBox?.height ?? 0))).toBeGreaterThanOrEqual(8);
      expect(await field.evaluate((element) => getComputedStyle(element).fontFamily)).toBe(bodyFont);
      expect(await field.evaluate((element) => getComputedStyle(element).fontSize)).toBe("12px");
      await field.focus();
      expect(await field.evaluate((element) => getComputedStyle(element).outlineStyle)).not.toBe("none");
    }
    const recordButton = preview.getByRole("button", { name: "Record preview observation" });
    expect(await recordButton.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe("rgb(37, 92, 168)");
    const downloadBox = await preview.getByRole("link", { name: "Download selected candidate attachment" }).boundingBox();
    const manualHeadingBox = await preview.getByRole("heading", { name: "Load and check manually" }).boundingBox();
    expect((manualHeadingBox?.y ?? 0) - ((downloadBox?.y ?? 0) + (downloadBox?.height ?? 0)))
      .toBeGreaterThanOrEqual(16);

    const firstCandidate = candidates.getByRole("listitem").first();
    await expect(firstCandidate.getByText("Evidence and file details")).toBeVisible();
    await expect(firstCandidate.getByText("Candidate ID", { exact: true })).toBeHidden();
    await firstCandidate.getByText("Evidence and file details").click();
    await expect(firstCandidate.getByText("Candidate ID", { exact: true })).toBeVisible();

    const lowerAction = detail.getByRole("button", { name: "Defer request" });
    await expect(lowerAction).toBeVisible();
    if (viewport.width === 390) {
      expect((await lowerAction.boundingBox())?.height).toBeGreaterThanOrEqual(44);
    }
    await lowerAction.click();
    await expect(detail).toContainText("Deferred by you. Evidence is retained until you explicitly retry.");
    await expect(detail.getByRole("button", { name: "Retry request" })).toBeVisible();

    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth))
      .toBeLessThanOrEqual(0);
  });
}
