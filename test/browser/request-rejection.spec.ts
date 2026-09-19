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

test("rejects one prepared candidate with a durable reason without silently recommending it again", async ({ page, application }) => {
  await page.goto(application.url);
  await createPreparedArabicRequest(page);

  const detail = page.getByRole("region", { name: "Subtitle request detail" });
  const candidates = detail.getByRole("region", { name: "Prepared subtitle candidates" });
  const firstCandidate = candidates.getByRole("listitem").nth(0);
  const secondCandidate = candidates.getByRole("listitem").nth(1);

  await firstCandidate.getByRole("textbox", { name: "Reason for rejecting Synthetic candidate 1" })
    .fill("The timing drifts after the opening scene.");
  await firstCandidate.getByRole("button", { name: "Reject Synthetic candidate 1" }).click();

  await expect(firstCandidate).toContainText("Rejected: The timing drifts after the opening scene.");
  await expect(firstCandidate).not.toContainText("· Recommended");
  await expect(secondCandidate).toContainText("· Alternative");
  await expect(candidates).toContainText("No current recommendation; the prior recommendation was rejected.");
  await expect(candidates).toContainText("1 rejected candidate");
  await expect(detail).toContainText("Active · version 1");
  expect(application.requests.filter((request) => request.includes("/prepare"))).toHaveLength(1);
  expect(application.requests.filter((request) => request.includes("/reject"))).toHaveLength(1);

  await application.restart();
  await page.reload();
  await page.getByRole("row", { name: /Quiet Orbit \(2025\).*Arabic.*Active/ }).click();
  await expect(page.getByRole("region", { name: "Prepared subtitle candidates" }))
    .toContainText("Rejected: The timing drifts after the opening scene.");

  await detail.getByRole("button", { name: "Defer request" }).click();
  await expect(detail.getByRole("button", { name: /Reject Synthetic candidate/ })).toHaveCount(0);
  await detail.getByRole("button", { name: "Retry request" }).click();
  await expect(candidates).toContainText("Rejected: The timing drifts after the opening scene.");
  await expect(secondCandidate).toContainText("· Alternative");
  await expect(candidates).toContainText("No current recommendation; the prior recommendation was rejected.");

  const request = await page.evaluate(async () => {
    const response = await fetch("/api/requests");
    const body = await response.json() as { active: Array<{ id: string; version: number }> };
    return body.active[0];
  });
  const repeatedPreparation = await page.evaluate(async ({ requestId, version }) => {
    const response = await fetch(`/api/requests/${encodeURIComponent(requestId)}/prepare`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ version }),
    });
    return { status: response.status, body: await response.json() as unknown };
  }, { requestId: request.id, version: request.version });
  expect(repeatedPreparation.status).toBe(200);
  expect(repeatedPreparation.body).toMatchObject({
    preparation: {
      candidates: [
        { rejection: { reason: "The timing drifts after the opening scene." } },
        { rejection: null },
        { rejection: null },
      ],
    },
  });
});

test("requires a non-empty rejection reason", async ({ page, application }) => {
  await page.goto(application.url);
  await createPreparedArabicRequest(page);

  const firstCandidate = page.getByRole("region", { name: "Prepared subtitle candidates" })
    .getByRole("listitem").nth(0);
  const reject = firstCandidate.getByRole("button", { name: "Reject Synthetic candidate 1" });
  await expect(reject).toBeDisabled();
  await firstCandidate.getByRole("textbox", { name: "Reason for rejecting Synthetic candidate 1" }).fill("   ");
  await expect(reject).toBeDisabled();
  expect(application.requests.filter((request) => request.includes("/reject"))).toHaveLength(0);
});
