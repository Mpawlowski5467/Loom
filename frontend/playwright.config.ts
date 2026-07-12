import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 180_000,
  expect: { timeout: 20_000 },
  outputDir: "test-results/graph-performance",
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:4174",
    viewport: { width: 1440, height: 900 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },
  webServer: {
    command: "npm run dev -- --host 127.0.0.1 --port 4174 --strictPort",
    url: "http://127.0.0.1:4174",
    reuseExistingServer: false,
    timeout: 120_000,
    // Fixture mode renders offline by design. Point the background config
    // handshake at a closed local port so it fails cleanly instead of Vite's
    // SPA fallback returning index.html for `/api/config`.
    env: { VITE_API_BASE: "http://127.0.0.1:9" },
  },
  // WebGL timing under Chromium's headless SwiftShader backend measures the
  // software rasterizer rather than Loom. Keep the performance project headed
  // so it exercises the same hardware-backed path users see.
  projects: [
    {
      name: "chromium",
      use: { browserName: "chromium", headless: false },
    },
  ],
});
