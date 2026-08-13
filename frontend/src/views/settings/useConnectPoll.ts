import { useCallback, useEffect, useRef } from "react";
import { useApp } from "../../context/app-ctx";

/**
 * Poll a connector until the backend reports a completed sign-in (the OAuth
 * callback lands in another browser tab). Shared by the connector cards.
 */

export const CONNECT_POLL_ATTEMPTS = 20;
export const CONNECT_POLL_INTERVAL_MS = 3_000;

export function useConnectPoll<T>({
  reload,
  apply,
  isConnected,
  account,
  toastLabel,
}: {
  reload: () => Promise<T>;
  apply: (next: T) => void;
  isConnected: (next: T) => boolean;
  account: (next: T) => string;
  toastLabel: string;
}): { startPolling: () => void; cancelPolling: () => void } {
  const { pushToast } = useApp();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelPolling = useCallback(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  useEffect(() => cancelPolling, [cancelPolling]);

  const startPolling = useCallback(() => {
    cancelPolling();
    const tick = (attemptsLeft: number) => {
      if (attemptsLeft <= 0) return;
      timer.current = setTimeout(() => {
        reload()
          .then((next) => {
            apply(next);
            if (isConnected(next)) {
              const name = account(next);
              pushToast({
                icon: "✓",
                agent: "connector",
                body: `${toastLabel} connected${name ? ` — ${name}` : ""}`,
              });
            } else {
              tick(attemptsLeft - 1);
            }
          })
          .catch(() => tick(attemptsLeft - 1));
      }, CONNECT_POLL_INTERVAL_MS);
    };
    tick(CONNECT_POLL_ATTEMPTS);
  }, [
    account,
    apply,
    cancelPolling,
    isConnected,
    pushToast,
    reload,
    toastLabel,
  ]);

  return { startPolling, cancelPolling };
}
