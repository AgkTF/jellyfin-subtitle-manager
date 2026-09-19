import { expect } from "@playwright/test";

import { test as base } from "./application.js";
import { guardReadOnlyJourney } from "./read-only-guard.js";

const test = base.extend<{ readOnlyJourney: void }>({
  readOnlyJourney: [async ({ page, application }, use) => {
    const { url, requests, server } = application;
    const externalRequests: string[] = [];
    await page.route("**/*", async (route) => {
      if (new URL(route.request().url()).origin !== url) {
        externalRequests.push(route.request().url());
        await route.abort();
      } else {
        await route.continue();
      }
    });
    const guard = guardReadOnlyJourney();
    try {
      await use();
      expect(guard.attempts).toEqual([]);
      expect(externalRequests).toEqual([]);
      // Observe state through the public application API, not SQLite internals.
      const response = await server.inject({ method: "GET", url: "/api/requests" });
      expect(response.json()).toEqual({ active: [], deferred: [] });
      expect(requests.every((request) =>
        request === "GET /" || request === "GET /api/requests" ||
        request === "GET /api/inventory" || request === "POST /api/inventory/refresh" ||
        request.startsWith("GET /assets/") ||
        request === "GET /favicon.ico",
      )).toBe(true);
    } finally {
      guard.restore();
    }
  }, { auto: true }],
});

test("supports keyboard-only inspection without focusing the underlying workspace", async ({ page, application }) => {
  await page.goto(application.url);
  const opener = page.getByRole("button", { name: "Request subtitles" });
  await opener.focus();
  await page.keyboard.press("Enter");
  const picker = page.getByRole("dialog", { name: "Inspect saved inventory" });
  await expect(picker.getByRole("searchbox")).toBeFocused();
  await page.keyboard.type("Harbor");
  await page.keyboard.press("Enter");
  await expect(picker.getByRole("button", { name: "Inspect ambiguous video" })).toBeVisible();
  // Search field -> Search -> retained-errors disclosure -> saved video.
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
  await expect(picker.getByRole("radio")).toHaveCount(2);
  await page.keyboard.press("Tab");
  await page.keyboard.press("Space");
  await expect(picker.getByRole("radio", { name: /Harbor Signal \(2024\)/ })).toBeChecked();
  await page.keyboard.press("ArrowDown");
  await expect(picker.getByRole("radio", { name: /Harbor Signal \(2025\)/ })).toBeChecked();
  for (const [key, destination] of [
    ["Tab", picker.getByRole("button", { name: "Close picker" })],
    ["Shift+Tab", picker.getByRole("radio", { name: /Harbor Signal \(2025\)/ })],
  ] as const) {
    // Native dialogs can stop at browser chrome or the scrollable dialog itself.
    for (let step = 0; step < 10; step++) {
      await page.keyboard.press(key);
      expect(await picker.evaluate((dialog) =>
        document.activeElement === document.body || dialog.contains(document.activeElement),
      )).toBe(true);
      if (await destination.evaluate((element) => element === document.activeElement)) break;
    }
    await expect(destination).toBeFocused();
  }
  await page.keyboard.press("Escape");
  await expect(opener).toBeFocused();
});

test("refreshes only after explicit action and ignores repeated clicks", async ({ page, application }) => {
  await page.goto(application.url);
  expect(application.requests).not.toContain("POST /api/inventory/refresh");
  await page.getByRole("button", { name: "Request subtitles" }).click();
  const picker = page.getByRole("dialog", { name: "Inspect saved inventory" });
  await picker.getByRole("searchbox").fill("Orbit");
  await picker.getByRole("button", { name: "Search", exact: true }).click();
  await picker.getByRole("button", { name: "Inspect Quiet Orbit (2025)" }).click();
  expect(application.requests).not.toContain("POST /api/inventory/refresh");

  const refresh = picker.getByRole("button", { name: "Refresh saved inventory" });
  await refresh.evaluate((button) => {
    if (!(button instanceof HTMLButtonElement)) throw new Error("Expected refresh button");
    button.click();
    button.click();
  });

  await expect(picker.getByRole("button", { name: "Refreshing…" })).toBeDisabled();
  await expect(picker.getByRole("status").filter({ hasText: "Refreshing synthetic inventory…" })).toBeVisible();
  await expect(picker.getByText("Refresh complete. Saved evidence was replaced.")).toBeVisible();
  await expect(picker.getByText("2026-02-16T08:30:00Z", { exact: true })).toBeVisible();
  await expect(picker.getByText("Retained scan errors (0)")).toBeVisible();
  await expect(picker.getByRole("region", { name: "Selected video" })).toHaveCount(0);
  expect(application.requests.filter((request) => request === "POST /api/inventory/refresh")).toHaveLength(1);
});

test.describe("refresh outcomes", () => {
  test.describe("failed synthetic refresh", () => {
    test.use({ refreshScenario: { outcome: "failed", delayMs: 50 } });

    test("keeps the previous saved evidence visibly stale after failure", async ({ page, application }) => {
      await page.goto(application.url);
      await page.getByRole("button", { name: "Request subtitles" }).click();
      const picker = page.getByRole("dialog", { name: "Inspect saved inventory" });
      await expect(picker.getByText("2026-01-15T12:00:00Z", { exact: true })).toBeVisible();

      await picker.getByRole("button", { name: "Refresh saved inventory" }).click();

      await expect(picker.getByRole("alert")).toContainText("Refresh failed: Synthetic refresh could not read /synthetic/offline.");
      await expect(picker.getByRole("alert")).toContainText("Previous saved evidence from 2026-01-15T12:00:00Z is still displayed and was not newly verified.");
      await expect(picker.getByText("2026-01-15T12:00:00Z", { exact: true })).toBeVisible();
      await expect(picker.getByText("Synthetic scan: /synthetic/unreadable could not be listed.")).toBeVisible();
      await picker.getByRole("searchbox").fill("Orbit");
      await picker.getByRole("button", { name: "Search", exact: true }).click();
      await expect(picker.getByRole("alert")).toContainText("was not newly verified");
      await picker.getByRole("button", { name: "Close picker" }).click();
      await page.getByRole("button", { name: "Request subtitles" }).click();
      await expect(page.getByRole("dialog", { name: "Inspect saved inventory" }).getByRole("alert"))
        .toContainText("was not newly verified");
      expect(application.requests.filter((request) => request === "POST /api/inventory/refresh")).toHaveLength(1);
    });
  });

  test.describe("partial synthetic refresh", () => {
    test.use({ refreshScenario: { outcome: "partial", delayMs: 50 } });

    test("labels the replacement snapshot partial and shows its errors", async ({ page, application }) => {
      await page.goto(application.url);
      await page.getByRole("button", { name: "Request subtitles" }).click();
      const picker = page.getByRole("dialog", { name: "Inspect saved inventory" });

      await picker.getByRole("button", { name: "Refresh saved inventory" }).click();

      await expect(picker.getByRole("alert")).toContainText("Refresh completed with errors. The saved scan at 2026-02-16T09:00:00Z is partial");
      await expect(picker.getByText("2026-02-16T09:00:00Z", { exact: true })).toBeVisible();
      await expect(picker.getByText(/Synthetic partial refresh: \/synthetic\/cloud-archive could not be probed/)).toBeVisible();
      await picker.getByRole("searchbox").fill("Cloud.Archive");
      await picker.getByRole("button", { name: "Search", exact: true }).click();
      await expect(picker.getByText("No saved videos match. Try another title, release or file.")).toBeVisible();
      expect(application.requests.filter((request) => request === "POST /api/inventory/refresh")).toHaveLength(1);
    });
  });
});

test("shows empty results and recovers from a failed inventory read", async ({ page, application }) => {
  await page.goto(application.url);
  await page.getByRole("button", { name: "Request subtitles" }).click();
  const picker = page.getByRole("dialog", { name: "Inspect saved inventory" });
  await picker.getByRole("searchbox").fill("no-such-synthetic-title");
  await picker.getByRole("searchbox").press("Enter");
  await expect(picker.getByText("No saved videos match. Try another title, release or file.")).toBeVisible();
  await expect(picker.getByText("Synthetic scan: /synthetic/unreadable could not be listed.")).toBeVisible();
  // Fail only the HTTP boundary, then retry against the real application.
  await page.route("**/api/inventory?*", (route) => route.abort(), { times: 1 });
  await picker.getByRole("searchbox").fill("Orbit");
  await picker.getByRole("searchbox").press("Enter");
  await expect(picker.getByRole("alert")).toHaveText("Saved inventory could not be loaded. Search again to retry.");
  await expect(picker.getByRole("button", { name: /Inspect Quiet Orbit/ })).toHaveCount(0);
  await picker.getByRole("button", { name: "Search", exact: true }).click();
  await expect(picker.getByRole("button", { name: "Inspect Quiet Orbit (2025)" })).toBeVisible();
});

test("keeps incomplete evidence unknown and preserves video probe errors", async ({ page, application }) => {
  await page.goto(application.url);
  await page.getByRole("button", { name: "Request subtitles" }).click();
  const picker = page.getByRole("dialog", { name: "Inspect saved inventory" });
  await picker.getByRole("searchbox").fill("Cloud.Archive");
  await picker.getByRole("searchbox").press("Enter");
  await picker.getByRole("button", { name: "Inspect unidentified video" }).click();
  await expect(picker.getByText("Synthetic probe failed: subtitle streams and release identity could not be read.")).toBeVisible();
  await expect(picker.getByText("File/release identity is unknown. No possible identity was retained.")).toBeVisible();
  await expect(picker.getByRole("heading", { name: "English · Unknown" })).toBeVisible();
  await expect(picker.getByRole("heading", { name: "Arabic · Unknown" })).toBeVisible();
  await expect(picker.getByText("Evidence is incomplete. Subtitle availability is unknown, not confirmed absent.")).toHaveCount(2);
  await expect(picker.getByRole("region", { name: "Selected identity evidence" })).toHaveCount(0);
});

for (const width of [1440, 390]) {
  test(`requires explicit identity choice for ambiguous evidence at ${width}px`, async ({ page, application }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(application.url);
    await page.getByRole("button", { name: "Request subtitles" }).click();
    const picker = page.getByRole("dialog", { name: "Inspect saved inventory" });
    await picker.getByRole("searchbox").fill("Harbor");
    await picker.getByRole("button", { name: "Search", exact: true }).click();
    await picker.getByRole("button", { name: "Inspect ambiguous video" }).click();
    await expect(picker.getByText("Choose an identity. Saved evidence is ambiguous; no identity has been selected.")).toBeVisible();
    await expect(picker.getByRole("region", { name: "Selected identity evidence" })).toHaveCount(0);
    const original = picker.getByRole("radio", { name: /Harbor Signal \(2024\)/ });
    const remake = picker.getByRole("radio", { name: /Harbor Signal \(2025\)/ });
    await expect(original).not.toBeChecked();
    await expect(remake).not.toBeChecked();
    await original.check();
    await expect(picker.getByRole("heading", { name: "English · Unverified" })).toBeVisible();
    await expect(picker.getByText(/Forced-only English sidecar/)).toBeVisible();
    await remake.check();
    await expect(picker.getByRole("heading", { name: "English · Unknown" })).toBeVisible();
    await expect(picker.getByText(/Arabic image-based track/)).toBeVisible();
    await expect(picker.getByText(/Forced-only English sidecar/)).toHaveCount(0);
    expect(await picker.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    // A fresh search must not carry forward a previous identity decision.
    await picker.getByRole("button", { name: "Search", exact: true }).click();
    await picker.getByRole("button", { name: "Inspect ambiguous video" }).click();
    await expect(original).not.toBeChecked();
    await expect(remake).not.toBeChecked();
    await picker.getByRole("button", { name: "Close picker" }).click();
    await expect(page.getByRole("button", { name: "Request subtitles" })).toBeFocused();
  });

  test(`inspects saved synthetic evidence without starting work at ${width}px`, async ({ page, application }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(application.url);
    const opener = page.getByRole("button", { name: "Request subtitles" });
    await opener.click();
    const picker = page.getByRole("dialog", { name: "Inspect saved inventory" });
    await expect(picker.getByText("Synthetic saved inventory", { exact: true })).toBeVisible();
    const search = picker.getByRole("searchbox", { name: "Search saved inventory" });
    await expect(search).toBeFocused();
    await search.fill("ORBIT");
    await picker.getByRole("button", { name: "Search", exact: true }).click();
    await picker.getByRole("button", { name: "Inspect Quiet Orbit (2025)" }).click();
    await expect(picker.getByText("2026-01-15T12:00:00Z", { exact: true })).toBeVisible();
    await expect(picker.getByText("Synthetic scan: /synthetic/unreadable could not be listed.")).toBeVisible();
    await expect(picker.getByText("/synthetic/Quiet.Orbit.2025.1080p.SYNTHETIC.mkv", { exact: true })).toBeVisible();
    await expect(picker.getByText("Quiet.Orbit.2025.1080p.SYNTHETIC", { exact: true })).toBeVisible();
    await expect(picker.getByText(/Saved filename and container title agree/)).toBeVisible();
    await expect(picker.getByRole("heading", { name: "English · Unverified" })).toBeVisible();
    await expect(picker.getByRole("heading", { name: "Arabic · Unknown" })).toBeVisible();
    await expect(picker.getByText(/unknown, not confirmed absent/)).toBeVisible();
    await expect(picker.getByRole("button", { name: "Create request" })).toBeDisabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await picker.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    await page.keyboard.press("Escape");
    await expect(picker).not.toBeVisible();
    await expect(opener).toBeFocused();
    expect(application.requests).toContain("GET /api/inventory");
  });
}
