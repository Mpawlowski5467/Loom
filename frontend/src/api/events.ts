/**
 * Live vault-change events via Server-Sent Events.
 *
 * The backend emits a `vault-changed` event whenever the file watcher rebuilds
 * the graph (an agent wrote a note, a file changed on disk, etc.). Subscribing
 * lets an open UI re-fetch instead of waiting for a manual reload. The browser's
 * EventSource reconnects automatically on transient drops.
 */

export type VaultEventType = "vault-changed";

/**
 * Open an SSE connection and invoke `onEvent` for each named vault event.
 * Returns an unsubscribe function that closes the connection.
 */
export function subscribeVaultEvents(
  onEvent: (type: VaultEventType) => void,
): () => void {
  // No-op where EventSource isn't available (jsdom/test, SSR, ancient browsers)
  // so callers can subscribe unconditionally.
  if (typeof EventSource === "undefined") {
    return () => {};
  }

  // EventSource is same-origin here (UI + API served from one port).
  const source = new EventSource("/api/events/stream");

  const handleVaultChanged = (): void => onEvent("vault-changed");
  source.addEventListener("vault-changed", handleVaultChanged);
  // `hello` / `: keepalive` frames need no handling — they just keep the
  // channel warm. Errors are left to EventSource's built-in auto-reconnect.

  return () => {
    source.removeEventListener("vault-changed", handleVaultChanged);
    source.close();
  };
}
