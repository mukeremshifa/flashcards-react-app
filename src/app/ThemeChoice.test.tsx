import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ThemeProvider } from './theme';
import { ThemeChoice } from './ThemeChoice';

/**
 * P1 through P5 shipped a one-way switch.
 *
 * `theme.tsx` has always supported three states and kept a live `matchMedia`
 * listener so that `system` tracks the OS after mount. The control on top of it
 * was a single button that flipped light↔dark, which meant the first click was
 * a permanent, irreversible opt-out of the third state — there was no way back
 * to `system` short of clearing local storage.
 *
 * The failure is invisible from inside the component: a two-state toggle looks
 * completely correct until you ask it for the state it cannot express. So this
 * asserts reachability of all three, and that the control reports the *chosen*
 * theme rather than the resolved one — under `system` at night those differ, and
 * showing Dark as selected would be a lie about why the app is dark.
 */

const STORAGE_KEY = 'synapsedeck.theme';

/** jsdom has no matchMedia; the provider reads it on first render. */
function stubMatchMedia(prefersDark: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockImplementation((query: string) => ({
      matches: prefersDark,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
}

function renderChoice() {
  return render(
    <ThemeProvider>
      <ThemeChoice />
    </ThemeProvider>,
  );
}

const radio = (name: string) => screen.getByRole('radio', { name });

beforeEach(() => {
  localStorage.clear();
  document.documentElement.classList.remove('dark');
  stubMatchMedia(false);
});

describe('ThemeChoice', () => {
  it('offers all three themes, not a two-way flip', () => {
    renderChoice();

    expect(radio('Light')).toBeInTheDocument();
    expect(radio('Dark')).toBeInTheDocument();
    expect(radio('System')).toBeInTheDocument();
  });

  it('can reach light, dark and system, in any order', async () => {
    const user = userEvent.setup();
    renderChoice();

    // System is the default for an account that has never chosen.
    expect(radio('System')).toBeChecked();

    await user.click(radio('Dark'));
    expect(radio('Dark')).toBeChecked();
    expect(document.documentElement).toHaveClass('dark');

    await user.click(radio('Light'));
    expect(radio('Light')).toBeChecked();
    expect(document.documentElement).not.toHaveClass('dark');

    // The step that was impossible before P6.
    await user.click(radio('System'));
    expect(radio('System')).toBeChecked();
    expect(localStorage.getItem(STORAGE_KEY)).toBe('system');
  });

  it('shows System as chosen even when the OS resolves it to dark', () => {
    stubMatchMedia(true);
    renderChoice();

    expect(document.documentElement).toHaveClass('dark');
    // Resolved dark, chosen system. Marking Dark here would tell the user they
    // had made a choice they never made.
    expect(radio('System')).toBeChecked();
    expect(radio('Dark')).not.toBeChecked();
  });

  it('restores a stored choice rather than starting over each load', () => {
    localStorage.setItem(STORAGE_KEY, 'light');
    stubMatchMedia(true);
    renderChoice();

    expect(radio('Light')).toBeChecked();
    expect(document.documentElement).not.toHaveClass('dark');
  });
});
