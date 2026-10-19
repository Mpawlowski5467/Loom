import { lazy, type ComponentType } from "react";
import { Navigate, Route, Routes, useLocation, useParams } from "react-router";
import { legacyRedirect, settingsPath, settingsSectionFrom } from "./routes";

const lazyView = <K extends string>(
  load: () => Promise<Record<K, ComponentType>>,
  name: K,
) => lazy(() => load().then((m) => ({ default: m[name] })));

const GraphView = lazyView(() => import("../views/GraphView"), "GraphView");
const NotesView = lazyView(
  () => import("../views/notes/NotesView"),
  "NotesView",
);
const BoardView = lazyView(() => import("../views/BoardView"), "BoardView");
const InboxView = lazyView(() => import("../views/InboxView"), "InboxView");
const ThreadsView = lazyView(
  () => import("../views/ThreadsView"),
  "ThreadsView",
);
const SettingsView = lazyView(
  () => import("../views/SettingsView"),
  "SettingsView",
);

/** `/` → the graph, or the new form of an old `?view=` URL. */
function HomeRedirect() {
  const { search } = useLocation();
  return <Navigate to={legacyRedirect(search) ?? `/graph${search}`} replace />;
}

/** `/settings` and old section ids → `/settings/<section>`. */
function SettingsRoute() {
  const { section } = useParams();
  const canonical = settingsSectionFrom(section);
  if (section !== canonical)
    return <Navigate to={settingsPath(canonical)} replace />;
  return <SettingsView />;
}

export function AppRoutes() {
  return (
    <Routes>
      <Route index element={<HomeRedirect />} />
      <Route path="graph" element={<GraphView />} />
      <Route path="notes/*" element={<NotesView />} />
      <Route path="board" element={<BoardView />} />
      <Route path="inbox" element={<InboxView />} />
      <Route path="threads/:id?" element={<ThreadsView />} />
      <Route path="settings/:section?" element={<SettingsRoute />} />
      <Route path="*" element={<Navigate to="/graph" replace />} />
    </Routes>
  );
}
