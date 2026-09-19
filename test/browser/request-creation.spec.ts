import { expect } from "@playwright/test";

import { test } from "./application.js";

test("creates an English or Arabic request for one unambiguous identity and preserves it after restart", async ({ page, application }) => {
  await page.goto(application.url);
  await page.getByRole("button", { name: "Request subtitles" }).click();
  const picker = page.getByRole("dialog", { name: "Inspect saved inventory" });
  await picker.getByRole("searchbox").fill("Orbit");
  await picker.getByRole("button", { name: "Search", exact: true }).click();
  await picker.getByRole("button", { name: "Inspect Quiet Orbit (2025)" }).click();
  await picker.getByRole("radio", { name: "Arabic" }).check();
  await picker.getByRole("button", { name: "Create request" }).click();

  await expect(page.getByRole("heading", { name: "Active requests" })).toBeVisible();
  await expect(page.getByRole("row", { name: /Quiet Orbit \(2025\).*Arabic.*Active/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Active 1" }).first()).toBeVisible();

  await application.restart();
  await page.reload();
  await expect(page.getByRole("row", { name: /Quiet Orbit \(2025\).*Arabic.*Active/ })).toBeVisible();
  expect(application.workflow.listRequests({ lifecycle: "active" }).requests).toHaveLength(1);
});

test("does not allow a request from ambiguous saved evidence", async ({ page, application }) => {
  await page.goto(application.url);
  await page.getByRole("button", { name: "Request subtitles" }).click();
  const picker = page.getByRole("dialog", { name: "Inspect saved inventory" });
  await picker.getByRole("searchbox").fill("Harbor");
  await picker.getByRole("button", { name: "Search", exact: true }).click();
  await picker.getByRole("button", { name: "Inspect ambiguous video" }).click();
  await expect(picker.getByText("Choose an identity. Saved evidence is ambiguous; no identity has been selected.")).toBeVisible();
  await expect(picker.getByRole("button", { name: "Create request" })).toBeDisabled();
  await picker.getByRole("button", { name: "Close picker" }).click();
  await page.close();
});
