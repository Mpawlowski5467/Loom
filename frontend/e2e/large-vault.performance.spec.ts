import { expect, test, type Page } from "@playwright/test";
import type { LoomGraphDebugHook } from "../src/graph/graphDebug";

type LargeFixtureSize = 5000 | 10000;

declare global {
  interface Window {
    __loomGraph?: LoomGraphDebugHook;
  }
}

const BUILD_BUDGET_MS: Record<LargeFixtureSize, number> = {
  5000: 20_000,
  10000: 40_000,
};

async function waitForGraph(
  page: Page,
  size: LargeFixtureSize,
): Promise<number> {
  await expect
    .poll(
      () =>
        page.evaluate(
          (expected) =>
            window.__loomGraph?.ready === true &&
            window.__loomGraph.graph.order === expected,
          size,
        ),
      { timeout: 120_000 },
    )
    .toBe(true);
  return page.evaluate(
    () => window.__loomGraph?.readyAt ?? Number.POSITIVE_INFINITY,
  );
}

test.describe("Large-vault browser profile", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.removeItem("loom.graphDisplay");
      localStorage.removeItem("loom.graphFilters");
      localStorage.removeItem("loom.demoMode");
      localStorage.setItem("loom.treeVisible", "false");
      sessionStorage.setItem("loom.splash.seen", "1");
    });
  });

  for (const size of [5000, 10000] as const) {
    test(`${size} notes build and expose a bounded expanded tree`, async ({
      page,
    }, testInfo) => {
      await page.goto(`/?graphFixture=${size}`, {
        waitUntil: "domcontentloaded",
      });
      const readyAtMs = await waitForGraph(page, size);

      expect(readyAtMs).toBeLessThan(BUILD_BUDGET_MS[size]);
      await expect(page.locator(".graph-stats")).toContainText(`${size} nodes`);
      await expect(page.locator(".graph-perf-note")).toContainText(
        "animations paused",
      );

      await page.getByRole("button", { name: "Toggle file tree" }).click();
      const topics = page
        .locator(".tree-section")
        .filter({ hasText: "topics" });
      await topics.getByRole("button", { name: "Expand folder" }).click();

      await expect(page.locator(".tree-row")).toHaveCount(200);
      await expect(page.locator(".tree-show-more")).toBeVisible();
      const metrics = await page.evaluate(() => ({
        readyAtMs: window.__loomGraph?.readyAt ?? null,
        graphNodes: window.__loomGraph?.graph.order ?? 0,
        renderedTreeRows: document.querySelectorAll(".tree-row").length,
      }));
      await testInfo.attach(`large-vault-${size}.json`, {
        body: JSON.stringify(metrics, null, 2),
        contentType: "application/json",
      });
    });
  }
});
