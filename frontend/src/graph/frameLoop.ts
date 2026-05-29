/**
 * A single requestAnimationFrame coordinator for the graph's animations.
 *
 * Breathing, scene tweens, travelers, and the lens used to each own a
 * standalone rAF loop and call ``sigma.refresh()`` independently — so two or
 * three repaints could stack inside one frame. They now register a tick here
 * instead. Each tick returns whether it changed Sigma-managed state; the loop
 * coalesces those into at most one ``onRefresh()`` per frame.
 *
 * The loop auto-starts when the first tick is added and auto-stops when the
 * last one is removed, so an idle graph (e.g. the large-graph perf budget that
 * registers no animators) holds zero rAF callbacks.
 */
export type FrameTick = (now: number) => boolean;

export interface FrameLoop {
  /** Register a tick. Returns an unsubscribe fn. */
  add: (tick: FrameTick) => () => void;
  stop: () => void;
  readonly size: number;
}

export function createFrameLoop(onRefresh: () => void): FrameLoop {
  const ticks = new Set<FrameTick>();
  let raf = 0;
  let running = false;

  const frame = (now: number): void => {
    let needsRefresh = false;
    for (const tick of ticks) {
      if (tick(now)) needsRefresh = true;
    }
    if (needsRefresh) onRefresh();
    raf = requestAnimationFrame(frame);
  };

  const start = (): void => {
    if (running) return;
    running = true;
    raf = requestAnimationFrame(frame);
  };

  const stop = (): void => {
    running = false;
    cancelAnimationFrame(raf);
  };

  const add = (tick: FrameTick): (() => void) => {
    ticks.add(tick);
    start();
    return () => {
      ticks.delete(tick);
      if (ticks.size === 0) stop();
    };
  };

  return {
    add,
    stop,
    get size() {
      return ticks.size;
    },
  };
}
