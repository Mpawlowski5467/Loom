import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";
import { TriangleAlert } from "lucide-react";
import { BootError } from "./BootScreen";

interface ErrorBoundaryProps {
  children: ReactNode;
  /**
   * What failed ("the graph", "this view"). A labelled boundary's fallback
   * fills only its own area; the unlabelled root one covers the window.
   */
  label?: string;
  /** Render-prop fallback; overrides the default full-screen fallback. */
  fallback?: (error: Error, reset: () => void) => ReactNode;
  /**
   * Changing this value resets the boundary — pass the active tab so switching
   * views recovers a view that threw without a full page reload.
   */
  resetKey?: unknown;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Catches render-time errors so one bad note or graph build degrades to a
 * recoverable message instead of white-screening the whole app (React 19
 * unwinds the entire tree on an uncaught render error).
 *
 * Error boundaries have no hook equivalent — a class component is the only way
 * to implement ``getDerivedStateFromError``/``componentDidCatch``, so this is a
 * deliberate exception to the functional-components-only rule.
 */
export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidUpdate(prev: ErrorBoundaryProps): void {
    // Recover when the reset key changes (e.g. the user switched tabs).
    if (this.state.error && prev.resetKey !== this.props.resetKey) {
      this.reset();
    }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Surface to the console for the trace inspector / dev tools; the app has
    // no remote error sink, and agents log to their own folders server-side.
    console.error("Render error caught by ErrorBoundary:", error, info);
  }

  reset = (): void => {
    this.setState({ error: null });
  };

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    if (this.props.fallback) return this.props.fallback(error, this.reset);

    const what = this.props.label ?? "the app";
    return (
      <BootError
        icon={TriangleAlert}
        message={
          <>
            Something went wrong rendering {what}. The error was contained —
            your notes are safe on disk.
          </>
        }
        actionLabel="Try again"
        onAction={this.reset}
        contained={this.props.label !== undefined}
      />
    );
  }
}
