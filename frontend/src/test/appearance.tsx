import { useMemo, type ReactNode } from "react";
import { vi } from "vitest";
import {
  APPEARANCE_DEFAULTS,
  type AppearanceSettings,
} from "@/theme/appearance";
import {
  AppearanceContext,
  type AppearanceContextValue,
} from "@/theme/appearance-ctx";
import { themeMode } from "@/theme/registry";

/**
 * A static appearance context for component tests that only need the
 * provider to exist: no network, no localStorage, no <html> painting.
 * Use the real ThemeProvider (with `@/api/appearance` mocked) to test
 * appearance behavior itself.
 */
export function TestAppearanceProvider({
  children,
  settings,
  overrides,
}: {
  children: ReactNode;
  settings?: Partial<AppearanceSettings>;
  overrides?: Partial<AppearanceContextValue>;
}) {
  const value = useMemo<AppearanceContextValue>(() => {
    const s = { ...APPEARANCE_DEFAULTS, ...settings };
    return {
      settings: s,
      resolvedTheme: s.theme,
      mode: themeMode(s.theme),
      savedTo: "device",
      update: vi.fn(),
      setTheme: vi.fn(),
      toggleMode: vi.fn(),
      reload: vi.fn(async () => {}),
      ...overrides,
    };
  }, [settings, overrides]);
  return (
    <AppearanceContext.Provider value={value}>
      {children}
    </AppearanceContext.Provider>
  );
}
