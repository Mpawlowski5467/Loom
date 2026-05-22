import { AppProvider } from "./context/AppContext";
import { AppShell } from "./components/AppShell";

function App() {
  return (
    <AppProvider>
      <AppShell />
    </AppProvider>
  );
}

export default App;
