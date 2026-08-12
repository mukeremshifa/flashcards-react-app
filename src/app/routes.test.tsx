import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// The route table as text, so the specifiers under test are the ones that ship.
import routesSource from './routes.tsx?raw';

// The route table reaches AuthProvider, which reaches the Supabase client, which
// refuses to construct without real env values. None of that is under test here.
vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: () => Promise.resolve({ data: { session: null }, error: null }),
      onAuthStateChange: () => ({
        data: { subscription: { unsubscribe: () => {} } },
      }),
    },
  },
}));

const { AppRoutes } = await import('./routes');

describe('the route table', () => {
  it('answers an unknown path with the 404 page', () => {
    render(
      <MemoryRouter initialEntries={['/decks/../nope']}>
        <AppRoutes />
      </MemoryRouter>,
    );

    expect(screen.getByText('Page not found')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to dashboard' })).toBeInTheDocument();
  });

  /**
   * A lazy route's import path is not checked by the compiler in any way a user
   * feels: it fails at runtime, in a chunk nobody loads until they click. This
   * reads the specifiers out of routes.tsx itself rather than repeating them, so
   * a renamed page cannot pass by being renamed in two places at once.
   */
  it('resolves every lazily imported page', async () => {
    const lazyImports = [
      ...routesSource.matchAll(/import\('(@\/[^']+)'\)[^;]*?default: module\.(\w+),/g),
    ].flatMap(([, specifier, exportName]) =>
      specifier && exportName ? [{ specifier, exportName }] : [],
    );

    // Six split routes as of P4 task 4. A drop to zero would make this test pass
    // by testing nothing.
    expect(lazyImports).toHaveLength(6);

    const modules = import.meta.glob<Record<string, unknown>>('/src/features/**/*.tsx');

    for (const { specifier, exportName } of lazyImports) {
      const path = `${specifier.replace('@/', '/src/')}.tsx`;
      const load = modules[path];
      expect(load, `${specifier} does not resolve to a file`).toBeDefined();

      const module = await load!();
      expect(module[exportName], `${specifier} has no export ${exportName}`).toBeTypeOf(
        'function',
      );
    }
  });
});
