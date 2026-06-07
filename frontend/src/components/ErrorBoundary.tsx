import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";

interface ErrorBoundaryProps {
  children: ReactNode;
  /** Optional label for the fallback ("the graph", "this view"). */
  label?: string;
  /** Render-prop fallback; overrides the default boot-style screen. */
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
      <div className="boot-screen boot-screen-error" role="alert">
        <div className="boot-mark" aria-hidden="true" />
        <span className="boot-label">loom</span>
        <p className="boot-error-body">
          Something went wrong rendering {what}. The error was contained — your
          notes are safe on disk.
        </p>
        <button type="button" className="boot-retry" onClick={this.reset}>
          Try again
        </button>
      </div>
    );
  }
}
