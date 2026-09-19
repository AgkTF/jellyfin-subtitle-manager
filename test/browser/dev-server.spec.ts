import { expect } from "@playwright/test";
import { createServer, type ViteDevServer } from "vite";

import { test as base } from "./application.js";

const test = base.extend<{ devUrl: string }>({
  devUrl: async ({ application }, use) => {
    const previousPort = process.env.PORT;
    // Load the real vite.config.ts; only the listener/API ports vary for isolation.
    process.env.PORT = new URL(application.url).port;
    let devServer: ViteDevServer | undefined;
    try {
      devServer = await createServer({ server: { port: 0 }, logLevel: "silent" });
      await devServer.listen();
      const address = devServer.httpServer?.address();
      if (address === null || address === undefined || typeof address === "string") {
        throw new Error("Expected a loopback Vite server");
      }
      await use(`http://127.0.0.1:${address.port}`);
    } finally {
      try {
        await devServer?.close();
      } finally {
        if (previousPort === undefined) delete process.env.PORT;
        else process.env.PORT = previousPort;
      }
    }
  },
});

test("the real dev origin serves inventory JSON and the browser picker", async ({ page, request, devUrl }) => {
  const response = await request.get(`${devUrl}/api/inventory?q=Orbit`, {
    headers: { accept: "text/html" },
  });
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("application/json");
  const inventory = await response.json();
  expect(inventory.source).toBe("synthetic");
  expect(inventory.videos).toHaveLength(1);
  expect(inventory.videos[0].id).toBe("quiet-orbit");

  await page.goto(devUrl);
  await page.getByRole("button", { name: "Request subtitles" }).click();
  const picker = page.getByRole("dialog", { name: "Inspect saved inventory" });
  await picker.getByRole("searchbox").fill("Orbit");
  await picker.getByRole("searchbox").press("Enter");
  await picker.getByRole("button", { name: "Inspect Quiet Orbit (2025)" }).click();
  await expect(picker.getByRole("heading", { name: "Arabic · Unknown" })).toBeVisible();
});

test("the proxy accepts its own origin without trusting foreign origins", async ({ request, devUrl, application }) => {
  const sameOrigin = await request.get(`${devUrl}/api/inventory`, { headers: { origin: devUrl } });
  expect(sameOrigin.status()).toBe(200);
  expect(sameOrigin.headers()["content-type"]).toContain("application/json");
  for (const origin of ["https://untrusted.example", "null", "http://127.0.0.1:1"]) {
    const response = await request.get(`${devUrl}/api/inventory`, { headers: { origin } });
    expect(response.status()).toBe(403);
  }
  // Include hosts Vite permits but the application's narrower allowlist rejects.
  for (const host of ["untrusted.example", "192.0.2.1", "other.localhost"]) {
    const headerCases: Record<string, string>[] = [{ host }, { host, origin: `http://${host}` }];
    for (const headers of headerCases) {
      const response = await request.get(`${devUrl}/api/inventory`, { headers });
      expect(response.status()).toBe(403);
    }
  }
  const direct = await request.get(`${application.url}/api/inventory`, { headers: { origin: devUrl } });
  expect(direct.status()).toBe(403);
});

test("an unavailable API fails instead of falling back to successful HTML", async ({ request, devUrl, application }) => {
  await application.server.close();
  const response = await request.get(`${devUrl}/api/inventory`, { headers: { accept: "text/html" } });
  expect(response.status()).toBeGreaterThanOrEqual(500);
  expect(response.status()).toBeLessThan(600);
  expect(response.headers()["content-type"] ?? "").not.toContain("text/html");
});

test("unknown API routes return JSON errors rather than the dev page", async ({ request, devUrl }) => {
  const response = await request.get(`${devUrl}/api/not-a-route`, { headers: { accept: "text/html" } });
  expect(response.status()).toBe(404);
  expect(response.headers()["content-type"]).toContain("application/json");
});
