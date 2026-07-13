import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/inter/wght.css";
import "@fontsource-variable/fraunces/standard.css";
import "@fontsource-variable/jetbrains-mono/wght.css";
import "@fontsource-variable/manrope/wght.css";
import "@fontsource-variable/newsreader/standard.css";
import "@fontsource-variable/newsreader/standard-italic.css";
import "@fontsource-variable/atkinson-hyperlegible-next/wght.css";
import "@fontsource-variable/atkinson-hyperlegible-next/wght-italic.css";
import "@fontsource-variable/source-sans-3/wght.css";
import "@fontsource-variable/source-serif-4/wght.css";
import "@fontsource-variable/source-serif-4/wght-italic.css";
import "@fontsource-variable/source-code-pro/wght.css";
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
