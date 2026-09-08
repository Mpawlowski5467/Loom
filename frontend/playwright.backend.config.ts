import { defineConfig } from "@playwright/test";

// Keep fixture traffic separate from a user's ordinary Loom server on 8000.
const apiPort = Number(process.env.LOOM_BROWSER_API_PORT ?? "18076");
if (!Number.isInteger(apiPort) || apiPort < 1024 || apiPort > 65535) {
  throw new Error(
    "LOOM_BROWSER_API_PORT must be an integer from 1024 to 65535",
  );
}
const apiBase = `http://127.0.0.1:${apiPort}`;

/** Real FastAPI + filesystem browser checks; the backend supplies a fixture provider. */
export default defineConfig({
  testDir: "./e2e/backend",
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  outputDir: "test-results/backend",
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:4176",
    browserName: "chromium",
    headless: true,
    viewport: { width: 1440, height: 900 },
    reducedMotion: "reduce",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: [
    {
      command: `cd .. && PYTHONPATH=backend \${LOOM_BROWSER_PYTHON:-backend/.venv/bin/python} backend/scripts/browser_test_server.py --port ${apiPort}`,
      url: `${apiBase}/api/live`,
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: "npm run dev -- --host 127.0.0.1 --port 4176 --strictPort",
      url: "http://127.0.0.1:4176",
      reuseExistingServer: false,
      timeout: 120_000,
      env: { VITE_API_BASE: apiBase },
    },
  ],
});
