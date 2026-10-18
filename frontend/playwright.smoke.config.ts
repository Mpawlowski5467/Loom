import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e/smoke",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  outputDir: "test-results/smoke",
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:4175",
    browserName: "chromium",
    headless: true,
    viewport: { width: 1440, height: 900 },
    reducedMotion: "reduce",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "npm run dev -- --host 127.0.0.1 --port 4175 --strictPort",
    url: "http://127.0.0.1:4175",
    reuseExistingServer: false,
    timeout: 120_000,
    env: { VITE_API_BASE: "http://127.0.0.1:9" },
  },
});
