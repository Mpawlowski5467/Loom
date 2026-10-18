import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
// Fonts are bundled (no CDN at runtime): Geist for the UI, Geist Mono for
// paths, hashes and timestamps, Newsreader for the optional serif editor.
import "@fontsource-variable/geist/wght.css";
import "@fontsource-variable/geist-mono/wght.css";
import "@fontsource-variable/newsreader/standard.css";
import "@fontsource-variable/newsreader/standard-italic.css";
import "./index.css";
import App from "./App.tsx";

// Appearance attributes are already on <html>: the inline script in
// index.html paints them before this bundle loads, and ThemeProvider takes
// over from there.
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
