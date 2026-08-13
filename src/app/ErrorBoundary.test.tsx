import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import { ErrorBoundary, RouteErrorBoundary } from './ErrorBoundary';

/**
 * The boundary is the one component that is never exercised by using the app.
 * If it is wrong, nobody finds out until the failure it exists to contain —
 * which is exactly when a white page is least recoverable.
 */

// React logs every caught error itself, and the boundary logs one more. Both are
// deliberate in production and pure noise here.
beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

function Boom({ failing }: { failing: () => boolean }) {
  if (failing()) throw new Error('kaboom');
  return <p>Working content</p>;
}

describe('ErrorBoundary', () => {
  it('renders the fallback instead of unmounting the tree', () => {
    render(
      <ErrorBoundary fallback={({ error }) => <p>caught: {error.message}</p>}>
        <Boom failing={() => true} />
      </ErrorBoundary>,
    );

    expect(screen.getByText('caught: kaboom')).toBeInTheDocument();
    expect(screen.queryByText('Working content')).not.toBeInTheDocument();
  });

  it('logs the error rather than swallowing it', () => {
    render(
      <ErrorBoundary fallback={() => <p>fallback</p>}>
        <Boom failing={() => true} />
      </ErrorBoundary>,
    );

    expect(console.error).toHaveBeenCalledWith(
      'Unhandled render error:',
      expect.objectContaining({ message: 'kaboom' }),
      expect.anything(),
    );
  });

  it('re-renders the children when the fallback resets', async () => {
    const user = userEvent.setup();
    let failing = true;

    render(
      <MemoryRouter>
        <RouteErrorBoundary>
          <Boom failing={() => failing} />
        </RouteErrorBoundary>
      </MemoryRouter>,
    );

    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    expect(screen.getByText('kaboom')).toBeInTheDocument();

    // Whatever broke has stopped breaking — a fallback with no way out is a
    // white page with extra steps.
    failing = false;
    await user.click(screen.getByRole('button', { name: 'Try again' }));

    expect(screen.getByText('Working content')).toBeInTheDocument();
    expect(screen.queryByText('Something went wrong')).not.toBeInTheDocument();
  });

  it('clears itself when the route changes', async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter initialEntries={['/broken']}>
        <RouteErrorBoundary>
          <Routes>
            <Route path="/broken" element={<Boom failing={() => true} />} />
            <Route path="/dashboard" element={<p>Dashboard</p>} />
          </Routes>
        </RouteErrorBoundary>
      </MemoryRouter>,
    );

    expect(screen.getByText('Something went wrong')).toBeInTheDocument();

    // Without a reset on navigation the boundary's state outlives the route and
    // the user stays on the fallback forever.
    await user.click(screen.getByRole('link', { name: 'Back to dashboard' }));

    expect(screen.getByText('Dashboard')).toBeInTheDocument();
    expect(screen.queryByText('Something went wrong')).not.toBeInTheDocument();
  });
});
