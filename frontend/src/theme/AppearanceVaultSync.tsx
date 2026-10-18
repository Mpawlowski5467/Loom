import { useEffect, useRef } from "react";
import { useApp } from "@/context/app-ctx";
import { useAppearance } from "./appearance-ctx";

/**
 * Appearance is stored per vault, so re-read it when the active vault
 * changes. Renders nothing; lives inside AppProvider to see the config.
 */
export function AppearanceVaultSync(): null {
  const { config } = useApp();
  const { reload } = useAppearance();
  const vault = config?.active_vault ?? null;
  const previous = useRef(vault);

  useEffect(() => {
    if (previous.current === vault) return;
    const first = previous.current === null;
    previous.current = vault;
    // ThemeProvider already loaded once on mount; only refetch on a switch.
    if (!first) void reload();
  }, [vault, reload]);

  return null;
}
