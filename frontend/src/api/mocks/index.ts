/**
 * Mock adapters for endpoints the backend doesn't have yet.
 *
 * `VITE_LOOM_MOCKS=1` swaps only those clients (each listed in
 * docs/ui-backend-gaps.md) for in-memory fixtures; every existing endpoint
 * still goes to the real backend. Fixtures use fictional data only.
 */

const flag = import.meta.env.VITE_LOOM_MOCKS as string | undefined;

export const MOCKS_ENABLED = flag === "1" || flag === "true";

/** Simulated network latency so loading states are exercised. */
export function mockDelay<T>(value: T, ms = 120): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}
