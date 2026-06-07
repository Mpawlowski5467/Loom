import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createFrameLoop, type FrameTick } from "./frameLoop";

/**
 * A controllable requestAnimationFrame: callbacks queue up and only run when
 * the test calls ``flush()``. Each flush advances a virtual clock so ticks see
 * a monotonically increasing ``now``.
 */
function installRaf() {
  let queue: FrameRequestCallback[] = [];
  let now = 0;
  let nextId = 1;

  const raf = vi.fn((cb: FrameRequestCallback): number => {
    queue.push(cb);
    return nextId++;
  });
  const caf = vi.fn();

  vi.stubGlobal("requestAnimationFrame", raf);
  vi.stubGlobal("cancelAnimationFrame", caf);

  return {
    raf,
    caf,
    /** Run one frame: drain the current queue at the given timestamp. */
    flush(step = 16) {
      now += step;
      const pending = queue;
      queue = [];
      for (const cb of pending) cb(now);
    },
    get queued() {
      return queue.length;
    },
  };
}

describe("createFrameLoop", () => {
  let clock: ReturnType<typeof installRaf>;

  beforeEach(() => {
    clock = installRaf();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does not start a frame loop until the first tick is added", () => {
    createFrameLoop(() => {});
    expect(clock.raf).not.toHaveBeenCalled();
  });

  it("starts running once a tick is registered", () => {
    const loop = createFrameLoop(() => {});
    loop.add(() => false);
    expect(clock.raf).toHaveBeenCalledTimes(1);
  });

  it("calls onRefresh once per frame when any tick reports a change", () => {
    const onRefresh = vi.fn();
    const loop = createFrameLoop(onRefresh);
    loop.add(() => true);
    loop.add(() => true);
    clock.flush();
    // Two dirty ticks coalesce into a single refresh.
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("skips onRefresh on frames where no tick reports a change", () => {
    const onRefresh = vi.fn();
    const loop = createFrameLoop(onRefresh);
    loop.add(() => false);
    clock.flush();
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it("passes the frame timestamp through to ticks", () => {
    const seen: number[] = [];
    const tick: FrameTick = (now) => {
      seen.push(now);
      return false;
    };
    const loop = createFrameLoop(() => {});
    loop.add(tick);
    clock.flush(16);
    clock.flush(16);
    expect(seen).toEqual([16, 32]);
  });

  it("keeps requesting subsequent frames while ticks remain", () => {
    const loop = createFrameLoop(() => {});
    loop.add(() => false);
    clock.flush();
    clock.flush();
    // One initial request + one re-request per flushed frame.
    expect(clock.raf).toHaveBeenCalledTimes(3);
  });

  it("reports the live tick count via size", () => {
    const loop = createFrameLoop(() => {});
    expect(loop.size).toBe(0);
    const remove = loop.add(() => false);
    expect(loop.size).toBe(1);
    remove();
    expect(loop.size).toBe(0);
  });

  it("stops the loop when the last tick is removed", () => {
    const loop = createFrameLoop(() => {});
    const remove = loop.add(() => false);
    remove();
    expect(clock.caf).toHaveBeenCalled();
  });

  it("keeps running while at least one tick remains", () => {
    const loop = createFrameLoop(() => {});
    const removeA = loop.add(() => false);
    loop.add(() => false);
    removeA();
    // Removing one of two ticks must not stop the loop.
    expect(clock.caf).not.toHaveBeenCalled();
    expect(loop.size).toBe(1);
  });

  it("removed ticks no longer fire on subsequent frames", () => {
    const live = vi.fn(() => false);
    const removed = vi.fn(() => false);
    const loop = createFrameLoop(() => {});
    loop.add(live);
    const remove = loop.add(removed);
    remove();
    clock.flush();
    expect(live).toHaveBeenCalledTimes(1);
    expect(removed).not.toHaveBeenCalled();
  });

  it("stops cleanly when the sole tick removes itself mid-frame (no zombie loop)", () => {
    const loop = createFrameLoop(() => {});
    let remove: (() => void) | null = null;
    // A self-removing tick: the only animator unsubscribes during its own
    // frame (mirrors a scene tween completing and stop()-ing the loop).
    remove = loop.add(() => {
      remove?.();
      return false;
    });
    expect(clock.queued).toBe(1);
    clock.flush();
    // After the tick removes itself, the loop must NOT reschedule another
    // frame — otherwise it spins forever with an empty tick set.
    expect(loop.size).toBe(0);
    expect(clock.queued).toBe(0);
    // And a subsequent flush has nothing to run.
    clock.flush();
    expect(clock.queued).toBe(0);
  });
});
