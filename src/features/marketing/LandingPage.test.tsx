import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import { ThemeProvider } from '@/app/theme';
import { LandingPage } from './LandingPage';

/**
 * Two things about the front door, and the second one is the reason P7 was the
 * risky phase.
 *
 * **What it links to.** The page has exactly one job — get a stranger to an
 * account — and a typo in one `to=` breaks it in a way no other test in this
 * repo would ever exercise.
 *
 * **What it imports.** `/` is the only route a visitor with no session reaches,
 * and one `import { useDecks } from '@/lib/queries'` would pull in Supabase and
 * TanStack Query; the moment a query hook rendered, the page would start making
 * authenticated requests on behalf of somebody who has not asked for anything,
 * and 401 in the console of every first impression. The rule is a boundary, not
 * a byte count, so it is checked as one — and checked *transitively*, because
 * the way it will actually be broken is not a direct import of `queries.ts` but
 * an innocuous-looking import of a component that has one.
 *
 * Note what this test file does not need to set up: no `QueryClientProvider`, no
 * `AuthProvider`, no Supabase mock. If a future edit makes any of those
 * necessary, the boundary has already gone.
 */

const SRC = join(process.cwd(), 'src');
const ENTRY = join(SRC, 'features', 'marketing', 'LandingPage.tsx');

/**
 * Comments stripped first, and not as a nicety: `LandingPage.tsx`'s own docblock
 * writes out `import { useDecks } from '@/lib/queries'` as the example of what
 * must never appear, so a scanner that reads comments fails on the file that
 * documents the rule.
 */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/** Every module specifier a file pulls in — static, type-only, or dynamic. */
function specifiersIn(source: string): string[] {
  const code = withoutComments(source);
  return [
    ...code.matchAll(/\bfrom\s*['"]([^'"]+)['"]/g),
    ...code.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]/g),
    ...code.matchAll(/^\s*import\s*['"]([^'"]+)['"]/gm),
  ].flatMap(match => (match[1] ? [match[1]] : []));
}

/** `@/x` and `./x` to a file on disk. Bare package names resolve to null. */
function resolveLocal(specifier: string, fromDir: string): string | null {
  const base = specifier.startsWith('@/')
    ? join(SRC, specifier.slice(2))
    : specifier.startsWith('.')
      ? join(fromDir, specifier)
      : null;
  if (base === null) return null;

  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    join(base, 'index.ts'),
    join(base, 'index.tsx'),
  ]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

/** Every file the landing page reaches, and every package it reaches them past. */
function moduleGraph() {
  const files = new Set<string>();
  const packages = new Set<string>();
  const queue = [ENTRY];

  while (queue.length > 0) {
    const file = queue.pop()!;
    if (files.has(file)) continue;
    files.add(file);

    for (const specifier of specifiersIn(readFileSync(file, 'utf8'))) {
      const resolved = resolveLocal(specifier, dirname(file));
      if (resolved === null) packages.add(specifier);
      else if (!files.has(resolved)) queue.push(resolved);
    }
  }

  return {
    files: [...files].map(file => relative(SRC, file).replace(/\\/g, '/')),
    packages,
  };
}

/** jsdom has no matchMedia; ThemeProvider reads it on first render. */
function stubMatchMedia() {
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
}

function renderLanding() {
  return render(
    <ThemeProvider>
      <MemoryRouter>
        <LandingPage />
      </MemoryRouter>
    </ThemeProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  stubMatchMedia();
});

describe('the landing page', () => {
  it('sends every sign-in link to /login and every sign-up link to /signup', () => {
    renderLanding();

    const signIn = screen.getAllByRole('link', { name: /^sign in$/i });
    const signUp = screen.getAllByRole('link', { name: /^create account$/i });

    expect(signIn.length).toBeGreaterThan(0);
    expect(signUp.length).toBeGreaterThan(0);
    for (const link of signIn) expect(link).toHaveAttribute('href', '/login');
    for (const link of signUp) expect(link).toHaveAttribute('href', '/signup');
  });

  it('keeps the headline the social card was rasterised with', () => {
    renderLanding();

    // public/og-image.png already reads "Forgetting is the schedule.". If the two
    // drift, the link preview and the page it previews disagree, and nobody finds
    // out until the link is posted somewhere. Change both, in one commit.
    const source = readFileSync(
      join(process.cwd(), 'scripts', 'build-brand-assets.mjs'),
      'utf8',
    );
    expect(source).toContain('>Forgetting is<');
    expect(source).toContain('>the schedule.<');
    expect(
      screen.getByRole('heading', { level: 1, name: 'Forgetting is the schedule.' }),
    ).toBeInTheDocument();
  });
});

describe('the landing page module graph', () => {
  const { files, packages } = moduleGraph();

  it('reaches enough files to be checking anything', () => {
    // A resolver that quietly returns null for everything would make every
    // assertion below pass by walking a graph of one.
    expect(files.length).toBeGreaterThan(6);
    expect(files).toContain('features/marketing/showcase/GradeRamp.tsx');
    expect(files).toContain('app/ThemeChoice.tsx');
  });

  it('never reaches the data layer', () => {
    const forbidden = files.filter(
      file => file.startsWith('lib/queries') || file.startsWith('lib/supabase'),
    );
    expect(
      forbidden,
      `the landing page must make no authenticated request: ${forbidden.join(', ')}`,
    ).toEqual([]);
  });

  it('never reaches another feature', () => {
    const foreign = files.filter(
      file => file.startsWith('features/') && !file.startsWith('features/marketing/'),
    );
    expect(
      foreign,
      `copy the markup into showcase/ instead of importing it: ${foreign.join(', ')}`,
    ).toEqual([]);
  });

  it('pulls in neither Supabase, TanStack Query, the scheduler nor the charts', () => {
    // The four heavy dependencies a marketing page has no business owning. Named
    // rather than derived: an allowlist of packages would be edited to pass.
    const banned = [
      '@supabase/supabase-js',
      '@tanstack/react-query',
      'ts-fsrs',
      'recharts',
    ];
    const found = banned.filter(name => packages.has(name));
    expect(found, `imported by something the landing page reaches: ${found}`).toEqual([]);
  });
});
