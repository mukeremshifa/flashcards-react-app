import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { TriangleAlert } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

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

/**
 * The recovery card: what happened, a way to retry, and a way out.
 *
 * A solid card rather than the dashed `EmptyState` this borrowed through P4–P5.
 * An empty state says "there is nothing here yet", which is a normal thing for a
 * page to say; a caught exception is not that, and wearing the same clothes made
 * a real failure look like an unfinished screen. This is the one screen in the
 * app whose entire job is to be reassuring, so P6 built it like a screen that
 * meant to exist.
 */
function ErrorFallback({ error, reset }: FallbackProps) {
  return (
    <Card className="mx-auto max-w-lg py-8">
      <CardContent className="flex flex-col items-center space-y-4 text-center">
        <span className="bg-muted text-muted-foreground flex size-12 items-center justify-center rounded-full">
          <TriangleAlert className="size-6" aria-hidden />
        </span>

        <div className="space-y-2">
          <h1 className="font-serif text-2xl tracking-tight">Something went wrong</h1>
          <p className="text-muted-foreground text-sm leading-relaxed">
            This page hit an unexpected error and stopped rendering. Your decks and your
            review history are stored server-side — nothing was lost.
          </p>
        </div>

        {error.message && (
          <p className="bg-muted text-muted-foreground w-full rounded-md px-3 py-2 text-left font-mono text-xs break-words">
            {error.message}
          </p>
        )}

        <div className="flex flex-wrap justify-center gap-2 pt-1">
          <Button onClick={reset}>Try again</Button>
          <Button variant="outline" asChild>
            <Link to="/dashboard">Back to dashboard</Link>
          </Button>
        </div>
      </CardContent>
    </Card>
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
