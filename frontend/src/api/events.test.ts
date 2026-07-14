import { afterEach, describe, expect, it, vi } from "vitest";
import { API_BASE } from "./client";
import { eventStreamUrl, subscribeEventDomains } from "./events";

class FakeEventSource {
  url: string;
  listeners: Record<string, Array<() => void>> = {};
  closed = false;

  constructor(url: string) {
    this.url = url;
  }

  addEventListener(type: string, listener: () => void): void {
    (this.listeners[type] ??= []).push(listener);
  }

  removeEventListener(type: string, listener: () => void): void {
    this.listeners[type] = (this.listeners[type] ?? []).filter(
      (entry) => entry !== listener,
    );
  }

  emit(type: string): void {
    for (const listener of this.listeners[type] ?? []) listener();
  }

  close(): void {
    this.closed = true;
  }
}

describe("subscribeEventDomains", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("routes typed events by domain over one shared connection", () => {
    const instances: FakeEventSource[] = [];
    const EventSourceMock = vi.fn((url: string) => {
      const instance = new FakeEventSource(url);
      instances.push(instance);
      return instance;
    });
    vi.stubGlobal("EventSource", EventSourceMock);

    const onCaptures = vi.fn();
    const onJobs = vi.fn();
    const unsubscribeCaptures = subscribeEventDomains(["captures"], onCaptures);
    const unsubscribeJobs = subscribeEventDomains(["capture-jobs"], onJobs);

    expect(EventSourceMock).toHaveBeenCalledTimes(1);
    expect(instances[0]?.url).toBe(`${API_BASE}/api/events/stream`);

    instances[0]!.emit("capture-changed");
    expect(onCaptures).toHaveBeenCalledWith("capture-changed");
    expect(onJobs).not.toHaveBeenCalled();

    instances[0]!.emit("note-changed");
    expect(onCaptures).toHaveBeenCalledTimes(1);
    expect(onJobs).not.toHaveBeenCalled();

    instances[0]!.emit("capture-job-changed");
    expect(onJobs).toHaveBeenCalledWith("capture-job-changed");
    expect(onCaptures).toHaveBeenCalledTimes(1);

    unsubscribeCaptures();
    expect(instances[0]!.closed).toBe(false);
    instances[0]!.emit("capture-changed");
    expect(onCaptures).toHaveBeenCalledTimes(1);

    unsubscribeJobs();
    expect(instances[0]!.closed).toBe(true);
  });

  it("deduplicates repeated domains and makes unsubscribe idempotent", () => {
    let instance: FakeEventSource | undefined;
    vi.stubGlobal(
      "EventSource",
      vi.fn((url: string) => {
        instance = new FakeEventSource(url);
        return instance;
      }),
    );
    const onEvent = vi.fn();
    const unsubscribe = subscribeEventDomains(
      ["notes", "notes", "vault"],
      onEvent,
    );

    instance!.emit("note-changed");
    instance!.emit("vault-changed");
    expect(onEvent.mock.calls).toEqual([["note-changed"], ["vault-changed"]]);

    unsubscribe();
    unsubscribe();
    expect(instance!.closed).toBe(true);
  });

  it("no-ops safely when EventSource is unavailable", () => {
    vi.stubGlobal("EventSource", undefined);
    const onEvent = vi.fn();
    const unsubscribe = subscribeEventDomains(["vault"], onEvent);

    expect(() => unsubscribe()).not.toThrow();
    expect(onEvent).not.toHaveBeenCalled();
  });

  it("uses a relative URL for same-origin builds and the dev API base otherwise", () => {
    expect(eventStreamUrl("")).toBe("/api/events/stream");
    expect(eventStreamUrl("http://localhost:8000")).toBe(
      "http://localhost:8000/api/events/stream",
    );
  });
});
