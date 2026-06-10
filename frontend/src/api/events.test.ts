import { afterEach, describe, expect, it, vi } from "vitest";
import { subscribeVaultEvents } from "./events";

class FakeEventSource {
  url: string;
  listeners: Record<string, Array<() => void>> = {};
  closed = false;
  constructor(url: string) {
    this.url = url;
  }
  addEventListener(type: string, fn: () => void): void {
    (this.listeners[type] ??= []).push(fn);
  }
  removeEventListener(type: string, fn: () => void): void {
    this.listeners[type] = (this.listeners[type] ?? []).filter((f) => f !== fn);
  }
  emit(type: string): void {
    for (const fn of this.listeners[type] ?? []) fn();
  }
  close(): void {
    this.closed = true;
  }
}

describe("subscribeVaultEvents", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("invokes the callback on a vault-changed event and closes on unsubscribe", () => {
    let instance: FakeEventSource | undefined;
    vi.stubGlobal(
      "EventSource",
      vi.fn((url: string) => {
        instance = new FakeEventSource(url);
        return instance;
      }),
    );

    const onEvent = vi.fn();
    const unsubscribe = subscribeVaultEvents(onEvent);

    expect(instance?.url).toBe("/api/events/stream");
    instance!.emit("vault-changed");
    expect(onEvent).toHaveBeenCalledWith("vault-changed");

    unsubscribe();
    expect(instance!.closed).toBe(true);
    // No further delivery after unsubscribe.
    instance!.emit("vault-changed");
    expect(onEvent).toHaveBeenCalledTimes(1);
  });

  it("no-ops safely when EventSource is unavailable", () => {
    vi.stubGlobal("EventSource", undefined);
    const onEvent = vi.fn();
    const unsubscribe = subscribeVaultEvents(onEvent);
    expect(typeof unsubscribe).toBe("function");
    // Calling the returned unsubscribe must not throw.
    expect(() => unsubscribe()).not.toThrow();
  });
});
