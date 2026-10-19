import { defineConfig } from "@playwright/test";

/**
 * Every view in every theme, captured into docs/screenshots/ with fictional
 * demo data (`?demo=1`) and the mock adapters (VITE_LOOM_MOCKS=1). Only
 * /api/config is answered; the rest of the API is unreachable on purpose.
 */
export default defineConfig({
  testDir: "./e2e/screenshots",
  fullyParallel: true,
  workers: 3,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  outputDir: "test-results/screenshots",
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:4177",
    browserName: "chromium",
    headless: true,
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    reducedMotion: "reduce",
    colorScheme: "dark",
  },
  webServer: {
    command: "npm run dev -- --host 127.0.0.1 --port 4177 --strictPort",
    url: "http://127.0.0.1:4177",
    reuseExistingServer: false,
    timeout: 120_000,
    env: { VITE_API_BASE: "http://127.0.0.1:9", VITE_LOOM_MOCKS: "1" },
  },
});
