import { expect } from "@playwright/test";

import { test } from "./application.js";

test("opens an empty request workspace without starting work", async ({ page, application }) => {
  const { requests: applicationRequests, workflow } = application;
  await page.goto(application.url);

  await expect(
    page.getByRole("heading", { level: 1, name: "Subtitle requests" }),
  ).toBeVisible();
  await expect(page.getByText("Subtitle manager", { exact: true })).toBeVisible();
  await expect(page.getByText("Local review workspace", { exact: true })).toBeVisible();
  await expect(page.getByText("Workspace / Requests", { exact: true })).toBeVisible();

  const requestTable = page.getByRole("table", {
    name: "Active subtitle requests",
  });
  await expect(
    requestTable.getByRole("columnheader", { name: "Title and release" }),
  ).toBeVisible();
  await expect(
    requestTable.getByRole("columnheader", { name: "Language" }),
  ).toBeVisible();
  await expect(
    requestTable.getByRole("columnheader", { name: "State / next action" }),
  ).toBeVisible();

  const requestNavigation = page.getByRole("navigation", { name: "Requests" });
  await expect(
    requestNavigation.getByRole("button", { name: "Active 0" }),
  ).toBeVisible();
  await expect(
    requestNavigation.getByRole("button", { name: "Deferred 0" }),
  ).toBeVisible();
  await expect(
    requestNavigation.getByRole("button", { name: "Finished 0" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Active requests" })).toBeVisible();
  await expect(
    page.getByText("Nothing in this request group.", { exact: true }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Deferred 0" }).first().click();
  await expect(page.getByRole("heading", { name: "Deferred requests" })).toBeVisible();
  await page.getByRole("button", { name: "Finished 0" }).first().click();
  await expect(page.getByRole("heading", { name: "Finished requests" })).toBeVisible();

  expect(applicationRequests).toContain("GET /api/requests");
  expect(applicationRequests.every((request) => request.startsWith("GET "))).toBe(true);
  expect(workflow.listRequests({ lifecycle: "active" }).requests).toEqual([]);
  expect(workflow.listRequests({ lifecycle: "deferred" }).requests).toEqual([]);
});
