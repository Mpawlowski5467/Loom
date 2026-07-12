import { expect, test } from "@playwright/test";
import type { LoomGraphDebugHook } from "../src/graph/graphDebug";

declare global {
  interface Window {
    __loomGraph?: LoomGraphDebugHook;
  }
}

test("selects, isolates, keyboard-pivots, fits, clears, and opens a graph node", async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.removeItem("loom.graphDisplay");
    localStorage.removeItem("loom.graphFilters");
    localStorage.removeItem("loom.demoMode");
    localStorage.setItem("loom.treeVisible", "false");
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

  const nodePoint = await page.evaluate(() => {
    const host = document.querySelector<HTMLElement>(".sigma-container");
    const point = window.__loomGraph?.graphToViewport("perf-500-0000");
    const bounds = host?.getBoundingClientRect();
    return point && bounds
      ? { x: bounds.left + point.x, y: bounds.top + point.y }
      : null;
  });
  expect(nodePoint).not.toBeNull();
  if (!nodePoint) throw new Error("fixture hub is not rendered");

  await page.mouse.click(nodePoint.x, nodePoint.y);
  const card = page.getByRole("complementary", {
    name: "Node details: Synthetic project 0000",
  });
  await expect(card).toBeVisible();
  await expect(card).toContainText("66 connections");

  const neighborsOnly = card.getByRole("switch", {
    name: "Show selected note and direct neighbors only",
  });
  await neighborsOnly.check();
  await expect(neighborsOnly).toBeChecked();
  await expect(
    page.getByText("neighborhood focus", { exact: false }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const debug = window.__loomGraph!;
        return debug.graph
          .nodes()
          .filter((id) => debug.graph.getNodeAttribute(id, "hidden")).length;
      }),
    )
    .toBeGreaterThan(400);

  const graph = page.getByRole("application", { name: "Knowledge graph" });
  await graph.press("ArrowRight");
  await expect(card).not.toBeVisible();
  const pivotedCard = page.getByRole("complementary");
  await expect(pivotedCard).toBeVisible();
  await expect(pivotedCard).not.toContainText("Synthetic project 0000");

  await graph.press("f");
  await graph.press("Escape");
  await expect(pivotedCard).not.toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const debug = window.__loomGraph!;
        return debug.graph
          .nodes()
          .filter((id) => debug.graph.getNodeAttribute(id, "hidden")).length;
      }),
    )
    .toBe(0);

  await graph.press("ArrowRight");
  await graph.press("Enter");
  await expect(page.getByRole("tab", { name: "Thread" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
});
