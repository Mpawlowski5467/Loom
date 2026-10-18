import { expect, test } from "@playwright/test";
import type { LoomGraphDebugHook } from "../src/graph/graphDebug";
import { expectView } from "./nav";

declare global {
  interface Window {
    __loomGraph?: LoomGraphDebugHook;
  }
}

const hiddenCount = () =>
  window
    .__loomGraph!.graph.nodes()
    .filter((id) => window.__loomGraph!.graph.getNodeAttribute(id, "hidden"))
    .length;

test("opens a node beside the graph, isolates it, pivots, clears and opens it", async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.removeItem("loom.graphDisplay");
    localStorage.removeItem("loom.graphFilter.v2");
    localStorage.removeItem("loom.demoMode");
    sessionStorage.setItem("loom.splash.seen", "1");
  });
  await page.goto("/?graphFixture=500", { waitUntil: "domcontentloaded" });
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            window.__loomGraph?.ready === true &&
            window.__loomGraph.graph.order === 500,
        ),
      { timeout: 120_000 },
    )
    .toBe(true);

  const graph = page.getByRole("application", { name: "Knowledge graph" });
  const nodePoint = await page.evaluate(() => {
    const host = document.querySelector<HTMLElement>(
      '[aria-label="Knowledge graph"]',
    );
    const point = window.__loomGraph?.graphToViewport("perf-500-0000");
    const bounds = host?.getBoundingClientRect();
    return point && bounds
      ? { x: bounds.left + point.x, y: bounds.top + point.y }
      : null;
  });
  if (!nodePoint) throw new Error("fixture hub is not rendered");

  await page.mouse.click(nodePoint.x, nodePoint.y);
  const panel = page.getByRole("complementary", { name: "Open note" });
  await expect(
    panel.getByRole("heading", { name: "Synthetic project 0000" }),
  ).toBeVisible();

  const localOnly = page.getByRole("button", { name: "Local only" });
  await localOnly.click();
  await expect(localOnly).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByText("local to Synthetic project 0000", { exact: false }),
  ).toBeVisible();
  await expect.poll(() => page.evaluate(hiddenCount)).toBeGreaterThan(400);

  await graph.press("ArrowRight");
  await expect(panel.getByRole("heading", { level: 2 })).not.toHaveText(
    "Synthetic project 0000",
  );

  await graph.press("f");
  await graph.press("Escape");
  await expect(panel).not.toBeVisible();
  await expect.poll(() => page.evaluate(hiddenCount)).toBe(0);

  await graph.press("ArrowRight");
  await graph.press("Enter");
  await expectView(page, "Notes");
});
