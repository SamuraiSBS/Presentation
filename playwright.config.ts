import { defineConfig, devices } from "@playwright/test";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const baseURL = process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3020";
const skipWebServer = process.env.PLAYWRIGHT_SKIP_WEBSERVER === "true";
const chromiumExecutablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || findInstalledPlaywrightChrome();

function findInstalledPlaywrightChrome(): string | undefined {
  const localAppData = process.env.LOCALAPPDATA;
  if (!localAppData) {
    return undefined;
  }

  const browsersRoot = join(localAppData, "ms-playwright");
  if (!existsSync(browsersRoot)) {
    return undefined;
  }

  for (const entry of readdirSync(browsersRoot)) {
    if (!entry.startsWith("chromium-")) {
      continue;
    }

    const candidate = join(browsersRoot, entry, "chrome-win64", "chrome.exe");
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return undefined;
}

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: [["list"]],
  use: {
    baseURL,
    launchOptions: chromiumExecutablePath ? { executablePath: chromiumExecutablePath } : undefined,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },
  webServer: skipWebServer ? undefined : {
    command: "powershell -NoProfile -ExecutionPolicy Bypass -File scripts/dev-web-fast.ps1 -Port 3020 -DemoPreview",
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "mobile",
      use: { ...devices["Pixel 5"] },
    },
  ],
});
