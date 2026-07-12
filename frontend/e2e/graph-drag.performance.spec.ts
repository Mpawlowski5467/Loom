import { expect, test, type Page } from "@playwright/test";
import type { LoomGraphDebugHook } from "../src/graph/graphDebug";

type FixtureSize = 500 | 2000;
type Point = { x: number; y: number };
type LongTaskSample = { startTime: number; duration: number };

interface PositionSnapshot {
  dragged: Point;
  neighbors: Record<string, Point>;
  neighborViewports: Record<string, Point>;
  all: Record<string, Point>;
}

interface PhaseProbeSnapshot {
  renderCount: number;
  frameGaps: number[];
  longTasks: LongTaskSample[];
}

interface DragProbeSnapshot extends PhaseProbeSnapshot {
  inputToPaint: number[];
  paintAlignmentErrors: number[];
  liveCursorLag: number[];
}

interface ProbeSnapshot {
  startedAt: number;
  releasedAt: number | null;
  settledAt: number | null;
  stoppedAt: number;
  longTaskSupported: boolean;
  grabOffset: Point;
  mouseMoves: number;
  matchedPaints: number;
  coalescedInputs: number;
  droppedInputs: number;
  unmatchedRenders: number;
  finalReturn: { nodeId: string; maxError: number };
  drag: DragProbeSnapshot;
  release: PhaseProbeSnapshot;
}

interface SeriesSummary {
  count: number;
  mean: number;
  p50: number;
  p95: number;
  max: number;
}

interface GraphPerfProbe {
  start: () => void;
  stop: () => void;
  status: () => {
    releasedAt: number | null;
    settledAt: number | null;
  };
  snapshot: () => ProbeSnapshot;
}

declare global {
  interface Window {
    __loomGraph?: LoomGraphDebugHook;
    __loomGraphPerf?: GraphPerfProbe;
  }
}

const DRAG_STEPS = 36;
const DRAG_DURATION_MS = 600;
const PAINT_MATCH_TOLERANCE_PX = 2;
const RETURN_EPSILON = 1e-9;
const RANDOM_SEED = 0x5eed_1234;

const BUDGETS = {
  500: {
    buildMs: 3_000,
    dragDurationMax: 1_200,
    elasticReturnMs: 3_000,
    inputToPaintP95: 40,
    inputToPaintMax: 80,
    paintAlignmentP95: 2,
    paintAlignmentMax: 4,
    liveCursorLagP95: 16,
    liveCursorLagMax: 28,
    frameGapP95: 34,
    longestTask: 100,
    totalLongTasks: 150,
  },
  2000: {
    buildMs: 8_000,
    dragDurationMax: 1_200,
    elasticReturnMs: 3_000,
    inputToPaintP95: 50,
    inputToPaintMax: 100,
    paintAlignmentP95: 2,
    paintAlignmentMax: 4,
    liveCursorLagP95: 20,
    liveCursorLagMax: 36,
    frameGapP95: 34,
    longestTask: 100,
    totalLongTasks: 150,
  },
} as const;

function fixtureNodeId(size: FixtureSize, index = 0): string {
  return `perf-${size}-${String(index).padStart(4, "0")}`;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function summarize(values: readonly number[]): SeriesSummary {
  if (values.length === 0) {
    return { count: 0, mean: 0, p50: 0, p95: 0, max: 0 };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const percentile = (p: number): number =>
    sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)]!;
  return {
    count: sorted.length,
    mean: round(sorted.reduce((sum, value) => sum + value, 0) / sorted.length),
    p50: round(percentile(0.5)),
    p95: round(percentile(0.95)),
    max: round(sorted[sorted.length - 1]!),
  };
}

function summarizeLongTasks(tasks: readonly LongTaskSample[]): {
  count: number;
  longest: number;
  total: number;
} {
  return {
    count: tasks.length,
    longest: round(Math.max(0, ...tasks.map((task) => task.duration))),
    total: round(tasks.reduce((sum, task) => sum + task.duration, 0)),
  };
}

async function waitForGraph(page: Page, size: FixtureSize): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate(
          (expected) =>
            window.__loomGraph?.ready === true &&
            window.__loomGraph.graph.order === expected,
          size,
        ),
      { timeout: 120_000, message: `wait for ${size}-node Sigma graph` },
    )
    .toBe(true);

  // The reset is scheduled 200ms after construction and animates for 600ms.
  // Observe the real camera and a node's viewport position instead of relying
  // on one fixed sleep: a loaded machine can delay either timer substantially.
  const trackedId = fixtureNodeId(size);
  let previous: Point | null = null;
  let stableSamples = 0;
  let sawAnimation = false;
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const sample = await page.evaluate((id) => {
      const debug = window.__loomGraph!;
      return {
        point: debug.graphToViewport(id),
        animated: debug.sigma.getCamera().isAnimated(),
        readyAge:
          debug.readyAt === null ? 0 : performance.now() - debug.readyAt,
      };
    }, trackedId);
    sawAnimation ||= sample.animated;
    const eligible =
      !sample.animated && (sawAnimation || sample.readyAge >= 1_000);
    if (eligible && sample.point && previous) {
      const movement = Math.hypot(
        sample.point.x - previous.x,
        sample.point.y - previous.y,
      );
      stableSamples = movement <= 0.25 ? stableSamples + 1 : 0;
      if (stableSamples >= 3) return;
    } else {
      stableSamples = 0;
    }
    previous = sample.point;
    await page.waitForTimeout(75);
  }
  throw new Error(`${size}-node graph camera did not become stable`);
}

async function installProbe(
  page: Page,
  nodeId: string,
  homePositions: Record<string, Point>,
): Promise<void> {
  await page.evaluate(
    ({ targetId, homes, matchTolerance, returnEpsilon }) => {
      const debug = window.__loomGraph;
      const host = document.querySelector<HTMLElement>(".sigma-container");
      if (!debug?.ready || !host) {
        throw new Error("graph debug hook is not ready");
      }

      type Phase = "idle" | "drag" | "release" | "settled";
      type PointerSample = { at: number; expectedCenter: Point };

      let active = false;
      let phase: Phase = "idle";
      let startedAt = 0;
      let releasedAt: number | null = null;
      let settledAt: number | null = null;
      let stoppedAt = 0;
      let grabOffset: Point | null = null;
      let mouseMoves = 0;
      let matchedPaints = 0;
      let coalescedInputs = 0;
      let droppedInputs = 0;
      let unmatchedRenders = 0;
      let dragRenderCount = 0;
      let releaseRenderCount = 0;
      let lastRafAt: number | null = null;
      let finalReturn = {
        nodeId: targetId,
        maxError: Number.POSITIVE_INFINITY,
      };

      const pendingInputs: PointerSample[] = [];
      const dragFrameGaps: number[] = [];
      const releaseFrameGaps: number[] = [];
      const inputToPaint: number[] = [];
      const paintAlignmentErrors: number[] = [];
      const liveCursorLag: number[] = [];
      const longTasks: LongTaskSample[] = [];

      const longTaskSupported =
        typeof PerformanceObserver !== "undefined" &&
        PerformanceObserver.supportedEntryTypes.includes("longtask");
      let observer: PerformanceObserver | null = null;

      const localPoint = (event: MouseEvent): Point => {
        const bounds = host.getBoundingClientRect();
        return {
          x: event.clientX - bounds.left,
          y: event.clientY - bounds.top,
        };
      };

      const distance = (a: Point, b: Point): number =>
        Math.hypot(a.x - b.x, a.y - b.y);

      const calculateReturnError = (): {
        nodeId: string;
        maxError: number;
      } => {
        let nodeId = targetId;
        let maxError = 0;
        for (const [id, home] of Object.entries(homes)) {
          const current = {
            x: Number(debug.graph.getNodeAttribute(id, "x")),
            y: Number(debug.graph.getNodeAttribute(id, "y")),
          };
          const error = distance(current, home);
          if (error > maxError) {
            nodeId = id;
            maxError = error;
          }
        }
        return { nodeId, maxError };
      };

      const recordLongTasks = (entries: readonly PerformanceEntry[]): void => {
        for (const entry of entries) {
          longTasks.push({
            startTime: entry.startTime,
            duration: entry.duration,
          });
        }
      };

      const flushLongTasks = (): void => {
        if (observer) recordLongTasks(observer.takeRecords());
      };

      const clippedLongTasks = (from: number, to: number): LongTaskSample[] => {
        if (from <= 0 || to < from) return [];
        return longTasks.flatMap((entry) => {
          const start = Math.max(from, entry.startTime);
          const end = Math.min(to, entry.startTime + entry.duration);
          return end > start
            ? [{ startTime: start, duration: end - start }]
            : [];
        });
      };

      const onMouseDown = (event: MouseEvent): void => {
        const center =
          debug.renderedToViewport(targetId) ?? debug.graphToViewport(targetId);
        if (!center) return;
        const pointer = localPoint(event);
        grabOffset = {
          x: center.x - pointer.x,
          y: center.y - pointer.y,
        };
      };

      const onMouseMove = (event: MouseEvent): void => {
        if (!active || phase !== "drag" || !grabOffset) return;
        const pointer = localPoint(event);
        pendingInputs.push({
          at: performance.now(),
          expectedCenter: {
            x: pointer.x + grabOffset.x,
            y: pointer.y + grabOffset.y,
          },
        });
        mouseMoves += 1;
      };

      const onMouseUp = (): void => {
        if (!active || phase !== "drag") return;
        releasedAt = performance.now();
        phase = "release";
        droppedInputs += pendingInputs.length;
        pendingInputs.length = 0;
      };

      const onAfterRender = (): void => {
        if (!active) return;
        const now = performance.now();

        if (phase === "drag") {
          dragRenderCount += 1;
          if (pendingInputs.length === 0) return;
          const rendered = debug.renderedToViewport(targetId);
          if (!rendered) return;

          let bestIndex = -1;
          let bestError = Number.POSITIVE_INFINITY;
          for (let index = 0; index < pendingInputs.length; index += 1) {
            const error = distance(
              rendered,
              pendingInputs[index]!.expectedCenter,
            );
            if (error < bestError) {
              bestError = error;
              bestIndex = index;
            }
          }

          if (bestIndex >= 0 && bestError <= matchTolerance) {
            const painted = pendingInputs[bestIndex]!;
            const newest = pendingInputs[pendingInputs.length - 1]!;
            inputToPaint.push(now - painted.at);
            paintAlignmentErrors.push(bestError);
            liveCursorLag.push(distance(rendered, newest.expectedCenter));
            coalescedInputs += bestIndex;
            pendingInputs.splice(0, bestIndex + 1);
            matchedPaints += 1;
          } else {
            // This render processed an older display cache or unrelated graph
            // state. It must not be paired with the newest pointer timestamp.
            unmatchedRenders += 1;
          }
          return;
        }

        if (phase !== "release") return;
        releaseRenderCount += 1;
        const home = homes[targetId]!;
        const targetError = Math.hypot(
          Number(debug.graph.getNodeAttribute(targetId, "x")) - home.x,
          Number(debug.graph.getNodeAttribute(targetId, "y")) - home.y,
        );
        // Elastic finish assigns the exact home to the dragged body and then
        // performs one synchronous full refresh. Use that as the cheap signal
        // to verify every node once, rather than scanning 2,000 nodes per frame.
        if (targetError <= returnEpsilon) {
          finalReturn = calculateReturnError();
          if (finalReturn.maxError <= returnEpsilon) {
            settledAt = now;
            phase = "settled";
          }
        }
      };

      const onAnimationFrame = (now: number): void => {
        if (active && (phase === "drag" || phase === "release")) {
          if (lastRafAt !== null) {
            const gaps = phase === "drag" ? dragFrameGaps : releaseFrameGaps;
            gaps.push(now - lastRafAt);
          }
          lastRafAt = now;
        } else if (!active) {
          lastRafAt = null;
        }
        requestAnimationFrame(onAnimationFrame);
      };

      window.addEventListener("mousedown", onMouseDown, true);
      window.addEventListener("mousemove", onMouseMove, true);
      window.addEventListener("mouseup", onMouseUp, true);
      debug.sigma.on("afterRender", onAfterRender);
      requestAnimationFrame(onAnimationFrame);

      if (longTaskSupported) {
        observer = new PerformanceObserver((list) => {
          recordLongTasks(list.getEntries());
        });
        observer.observe({ type: "longtask", buffered: false });
      }

      window.__loomGraphPerf = {
        start: () => {
          if (!grabOffset) {
            throw new Error("drag probe did not observe the native mousedown");
          }
          pendingInputs.length = 0;
          dragFrameGaps.length = 0;
          releaseFrameGaps.length = 0;
          inputToPaint.length = 0;
          paintAlignmentErrors.length = 0;
          liveCursorLag.length = 0;
          longTasks.length = 0;
          mouseMoves = 0;
          matchedPaints = 0;
          coalescedInputs = 0;
          droppedInputs = 0;
          unmatchedRenders = 0;
          dragRenderCount = 0;
          releaseRenderCount = 0;
          releasedAt = null;
          settledAt = null;
          stoppedAt = 0;
          lastRafAt = null;
          finalReturn = {
            nodeId: targetId,
            maxError: Number.POSITIVE_INFINITY,
          };
          startedAt = performance.now();
          phase = "drag";
          active = true;
        },
        stop: () => {
          stoppedAt = performance.now();
          active = false;
          flushLongTasks();
        },
        status: () => ({ releasedAt, settledAt }),
        snapshot: () => {
          flushLongTasks();
          finalReturn = calculateReturnError();
          const dragEndedAt = releasedAt ?? stoppedAt;
          const releaseEndedAt = settledAt ?? stoppedAt;
          return {
            startedAt,
            releasedAt,
            settledAt,
            stoppedAt,
            longTaskSupported,
            grabOffset: grabOffset ?? { x: 0, y: 0 },
            mouseMoves,
            matchedPaints,
            coalescedInputs,
            droppedInputs,
            unmatchedRenders,
            finalReturn,
            drag: {
              renderCount: dragRenderCount,
              frameGaps: [...dragFrameGaps],
              inputToPaint: [...inputToPaint],
              paintAlignmentErrors: [...paintAlignmentErrors],
              liveCursorLag: [...liveCursorLag],
              longTasks: clippedLongTasks(startedAt, dragEndedAt),
            },
            release: {
              renderCount: releaseRenderCount,
              frameGaps: [...releaseFrameGaps],
              longTasks:
                releasedAt === null
                  ? []
                  : clippedLongTasks(releasedAt, releaseEndedAt),
            },
          };
        },
      };
    },
    {
      targetId: nodeId,
      homes: homePositions,
      matchTolerance: PAINT_MATCH_TOLERANCE_PX,
      returnEpsilon: RETURN_EPSILON,
    },
  );
}

async function snapshotPositions(
  page: Page,
  nodeId: string,
): Promise<PositionSnapshot> {
  return page.evaluate((id) => {
    const debug = window.__loomGraph!;
    const point = (node: string): Point => ({
      x: Number(debug.graph.getNodeAttribute(node, "x")),
      y: Number(debug.graph.getNodeAttribute(node, "y")),
    });
    const neighbors = debug.graph.neighbors(id);
    const nodes = debug.graph.nodes();
    return {
      dragged: point(id),
      neighbors: Object.fromEntries(
        neighbors.map((node) => [node, point(node)]),
      ),
      neighborViewports: Object.fromEntries(
        neighbors.flatMap((node) => {
          const viewport = debug.graphToViewport(node);
          return viewport ? [[node, viewport]] : [];
        }),
      ),
      all: Object.fromEntries(nodes.map((node) => [node, point(node)])),
    };
  }, nodeId);
}

async function drivePacedDrag(
  page: Page,
  start: Point,
  delta: Point,
): Promise<void> {
  await page.evaluate(
    ({ from, movement, steps, duration }) =>
      new Promise<void>((resolve) => {
        const startedAt = performance.now();
        let step = 1;

        const dispatchNext = (): void => {
          const eventAt = startedAt + (duration * step) / steps;
          const wait = Math.max(0, eventAt - performance.now());
          window.setTimeout(() => {
            document.dispatchEvent(
              new MouseEvent("mousemove", {
                bubbles: true,
                cancelable: true,
                view: window,
                button: 0,
                buttons: 1,
                clientX: from.x + (movement.x * step) / steps,
                clientY: from.y + (movement.y * step) / steps,
              }),
            );
            if (step >= steps) {
              resolve();
              return;
            }
            step += 1;
            dispatchNext();
          }, wait);
        };

        dispatchNext();
      }),
    {
      from: start,
      movement: delta,
      steps: DRAG_STEPS,
      duration: DRAG_DURATION_MS,
    },
  );
}

test.describe("Graph drag performance", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript((seed) => {
      let state = seed >>> 0;
      Math.random = () => {
        state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
        return state / 0x1_0000_0000;
      };
      localStorage.removeItem("loom.graphDisplay");
      localStorage.removeItem("loom.graphFilters");
      localStorage.removeItem("loom.demoMode");
      localStorage.setItem("loom.treeVisible", "false");
      sessionStorage.setItem("loom.splash.seen", "1");
    }, RANDOM_SEED);
  });

  for (const size of [500, 2000] as const) {
    test(`${size} nodes track the cursor and spring home within budget`, async ({
      page,
    }, testInfo) => {
      const requestedNodeId = fixtureNodeId(size);
      await page.goto(`/?graphFixture=${size}`, {
        waitUntil: "domcontentloaded",
      });
      await waitForGraph(page, size);

      // Dense layouts can place a nearer node over the deterministic hub.
      // With the seeded layout this fallback is reproducible, and the report
      // records both ids so the measured spring workload is unambiguous.
      const nodeId = await page.evaluate((requested) => {
        const debug = window.__loomGraph!;
        const point = debug.graphToViewport(requested);
        return point ? (debug.nodeAtViewport(point) ?? requested) : requested;
      }, requestedNodeId);

      const host = page.locator(".sigma-container");
      const bounds = await host.boundingBox();
      expect(bounds).not.toBeNull();
      const startLocal = await page.evaluate(
        (id) => window.__loomGraph?.graphToViewport(id) ?? null,
        nodeId,
      );
      expect(startLocal).not.toBeNull();
      if (!bounds || !startLocal) throw new Error("drag node is not rendered");

      const homes = await snapshotPositions(page, nodeId);
      const start = {
        x: bounds.x + startLocal.x,
        y: bounds.y + startLocal.y,
      };
      const dx = startLocal.x < bounds.width / 2 ? 165 : -165;
      const dy = startLocal.y < bounds.height / 2 ? 75 : -75;

      await installProbe(page, nodeId, homes.all);
      await page.mouse.move(start.x, start.y);
      await page.mouse.down();
      await expect
        .poll(() =>
          page.evaluate(() => window.__loomGraph?.isDragging() ?? false),
        )
        .toBe(true);

      await page.evaluate(() => window.__loomGraphPerf!.start());
      await drivePacedDrag(page, start, { x: dx, y: dy });
      await page.waitForTimeout(50);

      const reaction = await page.evaluate(
        ({ initialViewports }) => {
          const debug = window.__loomGraph!;
          let id = "";
          let displacementPx = 0;
          for (const [neighbor, initial] of Object.entries(initialViewports)) {
            const current = debug.graphToViewport(neighbor);
            if (!current) continue;
            const distance = Math.hypot(
              current.x - initial.x,
              current.y - initial.y,
            );
            if (distance > displacementPx) {
              id = neighbor;
              displacementPx = distance;
            }
          }
          return { id, displacementPx };
        },
        { initialViewports: homes.neighborViewports },
      );

      // The page-side capture listener timestamps the native mouseup before
      // Sigma's release handler. Keep the probe active until its afterRender
      // listener observes the exact all-node home state.
      await page.mouse.up();
      await expect
        .poll(() =>
          page.evaluate(
            () => window.__loomGraphPerf!.status().releasedAt !== null,
          ),
        )
        .toBe(true);

      let status = await page.evaluate(() => window.__loomGraphPerf!.status());
      const returnDeadline = Date.now() + 20_000;
      while (status.settledAt === null && Date.now() < returnDeadline) {
        await page.waitForTimeout(50);
        status = await page.evaluate(() => window.__loomGraphPerf!.status());
      }

      await page.evaluate(() => window.__loomGraphPerf!.stop());
      const raw = await page.evaluate(() => window.__loomGraphPerf!.snapshot());

      const inputToPaint = summarize(raw.drag.inputToPaint);
      const paintAlignment = summarize(raw.drag.paintAlignmentErrors);
      const liveCursorLag = summarize(raw.drag.liveCursorLag);
      const dragFrameGap = summarize(raw.drag.frameGaps);
      const releaseFrameGap = summarize(raw.release.frameGaps);
      const dragLongTasks = summarizeLongTasks(raw.drag.longTasks);
      const releaseLongTasks = summarizeLongTasks(raw.release.longTasks);
      const buildMs = await page.evaluate(() => {
        const debug = window.__loomGraph!;
        return debug.readyAt === null
          ? null
          : debug.readyAt - debug.buildStartedAt;
      });
      const returnMs =
        raw.releasedAt === null || raw.settledAt === null
          ? 20_000
          : raw.settledAt - raw.releasedAt;

      const report = {
        fixture: {
          nodes: size,
          seed: `0x${RANDOM_SEED.toString(16)}`,
          requestedNode: requestedNodeId,
          draggedNode: nodeId,
          reactedNode: reaction.id,
        },
        buildMs: buildMs === null ? null : round(buildMs),
        reactionPx: round(reaction.displacementPx),
        sampleMatching: {
          grabOffsetPx: {
            x: round(raw.grabOffset.x),
            y: round(raw.grabOffset.y),
          },
          mouseMoves: raw.mouseMoves,
          matchedPaints: raw.matchedPaints,
          coalescedInputs: raw.coalescedInputs,
          droppedAtRelease: raw.droppedInputs,
          unmatchedRenders: raw.unmatchedRenders,
        },
        elasticReturn: {
          durationMs: round(returnMs),
          checkedNodes: Object.keys(homes.all).length,
          worstNode: raw.finalReturn.nodeId,
          finalError: round(raw.finalReturn.maxError),
          exact: raw.finalReturn.maxError <= RETURN_EPSILON,
        },
        phases: {
          drag: {
            durationMs:
              raw.releasedAt === null
                ? null
                : round(raw.releasedAt - raw.startedAt),
            sigmaRenders: raw.drag.renderCount,
            inputToPaintMs: inputToPaint,
            paintAlignmentErrorPx: paintAlignment,
            liveCursorLagPx: liveCursorLag,
            frameGapMs: dragFrameGap,
            longTasks: raw.drag.longTasks.map((task) => ({
              startTime: round(task.startTime),
              duration: round(task.duration),
            })),
            longTaskSummary: dragLongTasks,
          },
          release: {
            durationMs: round(returnMs),
            sigmaRenders: raw.release.renderCount,
            frameGapMs: releaseFrameGap,
            longTasks: raw.release.longTasks.map((task) => ({
              startTime: round(task.startTime),
              duration: round(task.duration),
            })),
            longTaskSummary: releaseLongTasks,
          },
        },
        longTaskSupported: raw.longTaskSupported,
        budgets: BUDGETS[size],
      };

      await testInfo.attach(`graph-drag-${size}.json`, {
        body: JSON.stringify(report, null, 2),
        contentType: "application/json",
      });
      console.log(`[graph benchmark ${size}] ${JSON.stringify(report)}`);

      expect(reaction.id, "at least one direct neighbor reacts").not.toBe("");
      expect(reaction.displacementPx).toBeGreaterThan(1);
      expect(raw.releasedAt, "native mouseup was observed").not.toBeNull();
      expect(
        raw.settledAt,
        "elastic simulation reached exact home",
      ).not.toBeNull();
      expect(
        raw.finalReturn.maxError,
        "every graph node returns exactly home",
      ).toBeLessThanOrEqual(RETURN_EPSILON);
      expect(returnMs).toBeLessThanOrEqual(BUDGETS[size].elasticReturnMs);
      expect(buildMs).not.toBeNull();
      expect(buildMs ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(
        BUDGETS[size].buildMs,
      );
      expect(raw.releasedAt! - raw.startedAt).toBeLessThanOrEqual(
        BUDGETS[size].dragDurationMax,
      );
      expect(raw.longTaskSupported, "Long Tasks API is available").toBe(true);
      expect(raw.mouseMoves).toBeGreaterThanOrEqual(DRAG_STEPS);
      expect(raw.drag.renderCount).toBeGreaterThanOrEqual(10);
      expect(raw.release.renderCount).toBeGreaterThan(0);
      expect(inputToPaint.count).toBeGreaterThanOrEqual(8);
      expect(paintAlignment.count).toBeGreaterThanOrEqual(8);
      expect(liveCursorLag.count).toBeGreaterThanOrEqual(8);
      expect(dragFrameGap.count).toBeGreaterThanOrEqual(20);
      expect(releaseFrameGap.count).toBeGreaterThan(0);
      expect(inputToPaint.p95).toBeLessThanOrEqual(
        BUDGETS[size].inputToPaintP95,
      );
      expect(inputToPaint.max).toBeLessThanOrEqual(
        BUDGETS[size].inputToPaintMax,
      );
      expect(paintAlignment.p95).toBeLessThanOrEqual(
        BUDGETS[size].paintAlignmentP95,
      );
      expect(paintAlignment.max).toBeLessThanOrEqual(
        BUDGETS[size].paintAlignmentMax,
      );
      expect(liveCursorLag.p95).toBeLessThanOrEqual(
        BUDGETS[size].liveCursorLagP95,
      );
      expect(liveCursorLag.max).toBeLessThanOrEqual(
        BUDGETS[size].liveCursorLagMax,
      );
      expect(dragFrameGap.p95).toBeLessThanOrEqual(BUDGETS[size].frameGapP95);
      expect(releaseFrameGap.p95).toBeLessThanOrEqual(
        BUDGETS[size].frameGapP95,
      );
      expect(dragLongTasks.longest).toBeLessThanOrEqual(
        BUDGETS[size].longestTask,
      );
      expect(dragLongTasks.total).toBeLessThanOrEqual(
        BUDGETS[size].totalLongTasks,
      );
      expect(releaseLongTasks.longest).toBeLessThanOrEqual(
        BUDGETS[size].longestTask,
      );
      expect(releaseLongTasks.total).toBeLessThanOrEqual(
        BUDGETS[size].totalLongTasks,
      );
    });
  }
});
