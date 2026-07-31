#!/usr/bin/env node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium } from "../../frontend/node_modules/playwright/index.mjs";

const appUrl = process.argv[2] ?? "http://localhost:5173/";
const outputPath =
  process.argv[3] ??
  path.resolve("docs/trailer/loom-dynamic-demo.webm");
const recordingDir = await fs.mkdtemp(path.join(os.tmpdir(), "loom-demo-"));

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1280, height: 720 },
  recordVideo: {
    dir: recordingDir,
    size: { width: 1280, height: 720 },
  },
});
const page = await context.newPage();

const pause = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

async function graphReady(expectedNodes) {
  await page.waitForFunction(
    (count) => {
      const hook = window.__loomGraph;
      const visibleNodes = hook?.graph
        .nodes()
        .filter((id) => !hook.graph.getNodeAttribute(id, "hidden")).length;
      return (
        hook?.ready === true &&
        (count == null || visibleNodes === count)
      );
    },
    expectedNodes,
    { timeout: 30_000 },
  );
}

async function graphNodePoint() {
  const host = page.locator('[aria-label="Knowledge graph"]');
  const box = await host.boundingBox();
  if (!box) throw new Error("Graph viewport is not visible");

  const point = await page.evaluate(() => {
    const hook = window.__loomGraph;
    if (!hook) return null;
    const dimensions = hook.sigma.getDimensions();
    const candidates = hook.graph
      .nodes()
      .map((id) => ({
        id,
        degree: hook.graph.degree(id),
        point: hook.renderedToViewport(id),
        hidden: hook.graph.getNodeAttribute(id, "hidden"),
      }))
      .filter(
        (candidate) =>
          !candidate.hidden &&
          candidate.point &&
          candidate.point.x > 120 &&
          candidate.point.x < dimensions.width - 180 &&
          candidate.point.y > 90 &&
          candidate.point.y < dimensions.height - 100,
      )
      .sort((left, right) => right.degree - left.degree);
    return candidates[0] ?? null;
  });
  if (!point?.point) throw new Error("No draggable graph node is visible");
  return {
    id: point.id,
    x: box.x + point.point.x,
    y: box.y + point.point.y,
  };
}

try {
  // Loom keeps an SSE refresh channel open, so networkidle never arrives.
  await page.goto(appUrl, {
    waitUntil: "domcontentloaded",
    timeout: 30_000,
  });
  await page.evaluate(() => {
    const cursor = document.createElement("div");
    cursor.id = "loom-demo-cursor";
    Object.assign(cursor.style, {
      position: "fixed",
      zIndex: "999999",
      width: "20px",
      height: "20px",
      margin: "-10px 0 0 -10px",
      border: "2px solid #a83a2c",
      borderRadius: "50%",
      background: "rgba(168,58,44,.16)",
      boxShadow: "0 0 0 6px rgba(168,58,44,.08)",
      pointerEvents: "none",
      transition: "transform 120ms ease, background 120ms ease",
      left: "640px",
      top: "360px",
    });
    document.body.append(cursor);
    window.addEventListener("pointermove", (event) => {
      cursor.style.left = `${event.clientX}px`;
      cursor.style.top = `${event.clientY}px`;
    });
    window.addEventListener("pointerdown", () => {
      cursor.style.transform = "scale(.72)";
      cursor.style.background = "rgba(168,58,44,.34)";
    });
    window.addEventListener("pointerup", () => {
      cursor.style.transform = "scale(1)";
      cursor.style.background = "rgba(168,58,44,.16)";
    });
  });

  await graphReady(null);
  // Establish the full vault for a beat, then move immediately into a legible
  // project map. Graph is one capability in the story, not the entire story.
  await pause(180);
  await page
    .getByRole("button", { name: "Show only project notes (78)" })
    .click();
  await graphReady(78);
  await page.getByRole("button", { name: "Fit visible nodes" }).click();
  await pause(420);

  const target = await graphNodePoint();
  await page.mouse.move(target.x, target.y, { steps: 18 });
  await pause(120);
  await page.mouse.down();
  await page.mouse.move(target.x + 155, target.y - 70, { steps: 28 });
  await pause(120);
  await page.mouse.up();
  await pause(220);

  // One quick camera move demonstrates that the map is directly manipulable.
  await page.mouse.move(760, 390, { steps: 8 });
  await page.mouse.wheel(0, -360);
  await pause(220);
  await page.getByRole("button", { name: "Fit visible nodes" }).click();
  await pause(220);

  // Flash two distinct spatial views, then leave Graph before it dominates.
  await page
    .getByRole("button", { name: "Display settings", exact: true })
    .click();
  await page.getByRole("radio", { name: "Rings" }).click();
  await pause(380);
  await page.getByRole("radio", { name: "Galaxy" }).click();
  await pause(440);
  await page
    .getByRole("button", { name: "Display settings", exact: true })
    .click();
  await pause(160);

  // Select a real visible node with Loom's keyboard graph navigation, pause on
  // its details card, then open the note into Thread.
  const graphHost = page.locator('[aria-label="Knowledge graph"]');
  await graphHost.focus();
  await graphHost.press("ArrowDown");
  const openNote = page.getByRole("button", { name: "Open note" });
  await openNote.waitFor({ state: "visible", timeout: 10_000 });
  await pause(260);
  await openNote.click();
  await page
    .locator(".thread-view")
    .waitFor({ state: "visible", timeout: 10_000 });
  await pause(1_000);
  await page.mouse.move(860, 500, { steps: 12 });
  await page.mouse.wheel(0, 460);
  await pause(1_300);
  await page.mouse.wheel(0, -180);
  await pause(1_000);

  // Show both agent surfaces so Board communicates orchestration, not just a
  // static set of cards.
  await page.getByRole("tab", { name: "Board" }).click();
  await pause(1_600);
  await page.getByRole("radio", { name: "pulse" }).click();
  await pause(1_700);
  await page.getByRole("radio", { name: "cards" }).click();
  await pause(1_400);

  await page.getByRole("tab", { name: "Inbox" }).click();
  await pause(900);
  const reviewCapture = page.getByRole("button", {
    name: "Select Local-First Software — Ink and Switch Local-First Software — Ink and Switch needs review captures/ · manual · 06:43 · 07-26 · attempt 1/3",
  });
  if ((await reviewCapture.count()) === 1) {
    await reviewCapture.click();
    await pause(3_100);
  }
} finally {
  const video = page.video();
  await context.close();
  await browser.close();
  if (!video) throw new Error("Playwright did not create a recording");
  const recordedPath = await video.path();
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.copyFile(recordedPath, outputPath);
}

console.log(outputPath);
