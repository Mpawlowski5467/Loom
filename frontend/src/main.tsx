import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
import { applyTheme, readInitialTheme } from "./theme/applyTheme";
import {
  osThemeMode,
  readFollowOsTheme,
  themeForOsMode,
} from "./theme/themeAuto";
import {
  applyAppearance,
  readInitialAppearance,
} from "./theme/applyAppearance";

// Paint the theme class on <html> before React mounts so the very first
// frame is in the right palette (no flash on reload). When the user follows
// the OS, resolve light/dark from the system preference; otherwise use the
// last-applied theme. The backend can override this once /api/config resolves
// (unless following the OS — see useLoomConfig).
const bootTheme = readFollowOsTheme()
  ? themeForOsMode(osThemeMode(), readInitialTheme())
  : readInitialTheme();
applyTheme(bootTheme);
applyAppearance(readInitialAppearance());

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
