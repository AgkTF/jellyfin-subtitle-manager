import { existsSync } from "node:fs";

import { defineConfig, devices } from "@playwright/test";

const systemChromium = "/usr/bin/chromium";
const executablePath =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ??
  (existsSync(systemChromium) ? systemChromium : undefined);

export default defineConfig({
  testDir: "./test/browser",
  fullyParallel: false,
  use: {
    ...devices["Desktop Chrome"],
    headless: true,
    launchOptions: { executablePath },
  },
});
