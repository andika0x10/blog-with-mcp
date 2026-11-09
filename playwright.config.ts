import { defineConfig } from "@playwright/test";
const production = process.env.PLAYWRIGHT_PRODUCTION === "1";
const baseURL = `http://127.0.0.1:${production ? 4173 : 5173}`;
process.env.LOCAL_SITE_URL = baseURL;
export default defineConfig({
  testDir: "./tests/browser",
  fullyParallel: false,
  workers: 1,
  use: { baseURL, browserName: "chromium", trace: "retain-on-failure" },
  globalSetup: "./tests/browser/setup.ts",
  webServer: { command: production ? "npm run build && npm run start -- --host 127.0.0.1 --port 4173 --strictPort" : "npm run dev -- --host 127.0.0.1", url:baseURL, reuseExistingServer:!production && !process.env.CI, timeout:120000 },
});
