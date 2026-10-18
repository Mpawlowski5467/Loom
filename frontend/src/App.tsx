import { AppProvider } from "./context/AppContext";
import { AppShell } from "./components/AppShell";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { ThemeProvider } from "./theme/ThemeProvider";
import { AppearanceVaultSync } from "./theme/AppearanceVaultSync";

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider>
        <AppProvider>
          <AppearanceVaultSync />
          <AppShell />
        </AppProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
