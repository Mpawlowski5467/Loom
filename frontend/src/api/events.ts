/**
 * Typed, payload-free refresh signals delivered over one shared SSE channel.
 *
 * Each event names the smallest resource domain that must be re-fetched. The
 * legacy broad vault event remains available for filesystem changes that do
 * not pass through a typed API route. Subscribers declare domains rather than
 * listening to every vault mutation, which prevents unrelated reloads.
 */

import { API_BASE } from "./client";

export type LoomEventType =
  | "capture-changed"
  | "capture-job-changed"
  | "note-changed"
  | "vault-changed"
  | "standup-schedule-changed";

export type LoomEventDomain =
  | "captures"
  | "capture-jobs"
  | "notes"
  | "vault"
  | "standup-schedules";

const EVENTS_BY_DOMAIN: Readonly<Record<LoomEventDomain, LoomEventType>> = {
  captures: "capture-changed",
  "capture-jobs": "capture-job-changed",
  notes: "note-changed",
  vault: "vault-changed",
  "standup-schedules": "standup-schedule-changed",
};

const EVENT_TYPES = Object.values(EVENTS_BY_DOMAIN);
type EventListener = (type: LoomEventType) => void;

const listeners = new Map<LoomEventType, Set<EventListener>>();
const sourceHandlers = new Map<LoomEventType, globalThis.EventListener>();
let source: EventSource | null = null;

/** Resolve against the same backend base used by the JSON API client. */
export function eventStreamUrl(apiBase = API_BASE): string {
  return `${apiBase}/api/events/stream`;
}

function openSharedSource(): void {
  if (source || typeof EventSource === "undefined") return;

  // EventSource is same-origin here (UI + API are served from one port). It
  // reconnects automatically after transient errors.
  source = new EventSource(eventStreamUrl());
  for (const type of EVENT_TYPES) {
    const handler = () => {
      for (const listener of listeners.get(type) ?? []) listener(type);
    };
    sourceHandlers.set(type, handler);
    source.addEventListener(type, handler);
  }
  // `hello` and `: keepalive` frames intentionally need no handler.
}

function closeSharedSourceWhenIdle(): void {
  if (!source) return;
  const hasListeners = Array.from(listeners.values()).some(
    (entries) => entries.size > 0,
  );
  if (hasListeners) return;

  for (const [type, handler] of sourceHandlers) {
    source.removeEventListener(type, handler);
  }
  sourceHandlers.clear();
  source.close();
  source = null;
}

/**
 * Subscribe to one or more resource domains over the process-wide SSE stream.
 * Returns an idempotent unsubscribe function.
 */
export function subscribeEventDomains(
  domains: readonly LoomEventDomain[],
  onEvent: EventListener,
): () => void {
  // No-op in SSR, jsdom without a stub, and older browsers. Callers can still
  // subscribe unconditionally and retain their explicit reconcile fallback.
  if (typeof EventSource === "undefined") return () => {};

  const eventTypes = Array.from(
    new Set(domains.map((domain) => EVENTS_BY_DOMAIN[domain])),
  );
  // A per-subscription wrapper prevents two subscriptions that happen to use
  // the same callback reference from unregistering each other.
  const listener: EventListener = (type) => onEvent(type);
  for (const type of eventTypes) {
    let entries = listeners.get(type);
    if (!entries) {
      entries = new Set();
      listeners.set(type, entries);
    }
    entries.add(listener);
  }
  openSharedSource();

  let active = true;
  return () => {
    if (!active) return;
    active = false;
    for (const type of eventTypes) {
      const entries = listeners.get(type);
      entries?.delete(listener);
      if (entries?.size === 0) listeners.delete(type);
    }
    closeSharedSourceWhenIdle();
  };
}
