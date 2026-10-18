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

// Appearance attributes are already on <html>: the inline script in
// index.html paints them before this bundle loads, and ThemeProvider takes
// over from there.
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
