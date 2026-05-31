import { defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vite.config";

export default mergeConfig(
  viteConfig,
  defineConfig({
    esbuild: {
      jsx: "automatic",
    },
    test: {
      environment: "jsdom",
      setupFiles: ["./src/test/setup.ts"],
      globals: false,
      // userEvent-driven interaction tests can brush the default 5s timeout
      // when the full suite runs under load; give them headroom to avoid flakes.
      testTimeout: 15000,
    },
  }),
);
