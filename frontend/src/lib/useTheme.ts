import { useCallback, useEffect } from "react";

export type Theme = "dark" | "light";

export function useTheme() {
  const theme: Theme = "dark";

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const setTheme = useCallback((_next: Theme) => {
    // Dark-only — no-op by design.
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", "dark");
  }, []);

  return { theme, setTheme } as const;
}
