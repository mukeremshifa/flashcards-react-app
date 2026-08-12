import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { TriangleAlert } from 'lucide-react';

import { EmptyState } from '@/components/EmptyState';
import { Button } from '@/components/ui/button';

/**
 * The one failure mode a deployed SPA must not have.
 *
 * An exception anywhere in the tree unmounts everything above it and leaves a
 * white page — indistinguishable, from the outside, from the site being down.
 * React still has no hook for this, so this stays a class component.
 *
 * There is deliberately no reporting service (P4: a third-party script on a page
 * that renders untrusted LLM output is a security decision v1 does not need to
 * make). `console.error` is the whole of the telemetry.
 */

type FallbackProps = {
  error: Error;
  /** Clears the caught error and re-renders the children. */
  reset: () => void;
};

type Props = {
  children: ReactNode;
  fallback: (props: FallbackProps) => ReactNode;
  /**
   * Changing this clears a caught error.
   *
   * Without it a user who navigates away stays on the fallback forever: the
   * boundary's state survives the route change, so the new page never renders.
   * A `key` on the boundary would also reset it, but it would remount the whole
   * subtree on every navigation — including the auth provider at the root.
   */
  resetKey?: string;
};

type State = { error: Error | null };

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Unhandled render error:', error, info.componentStack);
  }

  override componentDidUpdate(previous: Props) {
    if (this.state.error && previous.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  private readonly reset = () => {
    this.setState({ error: null });
  };

  override render() {
    const { error } = this.state;
    if (error) return this.props.fallback({ error, reset: this.reset });
    return this.props.children;
  }
}

/** The recovery card: what happened, a way to retry, and a way out. */
function ErrorFallback({ error, reset }: FallbackProps) {
  return (
    <EmptyState
      icon={<TriangleAlert />}
      title="Something went wrong"
      description={
        <>
          <p>
            This page hit an unexpected error and stopped rendering. Your decks and your
            review history are stored server-side — nothing was lost.
          </p>
          {error.message && (
            <p className="mt-2 font-mono text-xs break-words">{error.message}</p>
          )}
        </>
      }
      action={
        <div className="flex flex-wrap justify-center gap-2">
          <Button onClick={reset}>Try again</Button>
          <Button variant="outline" asChild>
            <Link to="/dashboard">Back to dashboard</Link>
          </Button>
        </div>
      }
    />
  );
}

/**
 * The boundary as the app uses it: standard fallback, reset on navigation.
 *
 * Must be rendered inside the router — both the reset key and the way out of
 * the fallback are route-based.
 */
export function RouteErrorBoundary({ children }: { children: ReactNode }) {
  const location = useLocation();
  return (
    <ErrorBoundary
      resetKey={location.pathname}
      fallback={props => <ErrorFallback {...props} />}
    >
      {children}
    </ErrorBoundary>
  );
}
