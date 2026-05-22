import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
import { applyTheme, readInitialTheme } from "./theme/applyTheme";

// Paint the theme class on <html> before React mounts so the very first
// frame is in the right palette (no flash on reload). The backend can
// override this once /api/config resolves — see AppContext.
applyTheme(readInitialTheme());

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
