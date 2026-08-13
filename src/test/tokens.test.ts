import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Contracts about the token file, not about how anything looks.
 *
 * SPEC §10 says styling is explicitly not tested, and this does not test styling:
 * it asserts three invariants that a human cannot re-check on every edit, and
 * whose violation is silent. A token declared in `:root` and forgotten in `.dark`
 * renders one theme's text on the other theme's ground. A grey that drifts off
 * chroma 0 tints the whole app toward the accent. And a grade colour "fixed" in
 * isolation can destroy the greyscale separability the ramp is built on.
 */

// vitest runs with jsdom, where `import.meta.url` is an http: URL — resolve
// from the project root instead, which is vitest's cwd.
const css = readFileSync(join(process.cwd(), 'src/styles/globals.css'), 'utf8');

function block(selector: string): string {
  const start = css.indexOf(`${selector} {`);
  expect(start, `${selector} block missing from globals.css`).toBeGreaterThan(-1);
  return css.slice(start, css.indexOf('\n}', start));
}

type Oklch = { L: number; C: number; h: number };

function tokensIn(selector: string): Map<string, Oklch | null> {
  const found = new Map<string, Oklch | null>();
  for (const match of block(selector).matchAll(/--([\w-]+):\s*([^;]+);/g)) {
    const name = match[1];
    const value = match[2];
    if (!name || !value) continue;
    const oklch = /^oklch\(([\d.]+)\s+([\d.]+)\s+([\d.]+)\)$/.exec(value.trim());
    found.set(
      name,
      oklch ? { L: Number(oklch[1]), C: Number(oklch[2]), h: Number(oklch[3]) } : null,
    );
  }
  return found;
}

const light = tokensIn(':root');
const dark = tokensIn('.dark');

/** The only tokens allowed to carry chroma. Everything else is a neutral. */
const CHROMATIC = new Set([
  'primary',
  'ring',
  'destructive',
  'grade-again',
  'grade-hard',
  'grade-good',
  'grade-easy',
]);

const RAMP = ['grade-again', 'grade-hard', 'grade-good', 'grade-easy'] as const;

describe('design tokens', () => {
  it('parses both themes out of globals.css', () => {
    expect(light.size).toBeGreaterThan(15);
    expect(dark.size).toBeGreaterThan(15);
  });

  it('declares every :root colour token in .dark as well', () => {
    // --radius is structural and intentionally not re-declared per theme.
    const missing = [...light.keys()].filter(
      name => name !== 'radius' && !dark.has(name),
    );
    expect(missing, `tokens missing from .dark: ${missing.join(', ')}`).toEqual([]);
  });

  it('introduces no token in .dark that :root does not define', () => {
    const extra = [...dark.keys()].filter(name => !light.has(name));
    expect(extra, `tokens only in .dark: ${extra.join(', ')}`).toEqual([]);
  });

  it.each([
    ['light', light],
    ['dark', dark],
  ])('keeps every neutral at chroma 0 in %s', (_theme, tokens) => {
    const tinted = [...tokens]
      .filter(([name, value]) => value && !CHROMATIC.has(name) && value.C !== 0)
      .map(([name, value]) => `${name} (C=${value?.C})`);
    expect(tinted, `neutrals must be achromatic: ${tinted.join(', ')}`).toEqual([]);
  });

  it.each([
    ['light', light],
    ['dark', dark],
  ])('keeps the grade ramp increasing in lightness in %s', (_theme, tokens) => {
    const lightnesses = RAMP.map(name => {
      const value = tokens.get(name);
      expect(value, `${name} must be an oklch() literal`).toBeTruthy();
      return value!.L;
    });

    // Strictly increasing is what keeps the four separable with no colour vision
    // at all — a red-to-green sweep is the axis deuteranopia flattens.
    for (let i = 1; i < lightnesses.length; i++) {
      expect(
        lightnesses[i],
        `${RAMP[i]} (${lightnesses[i]}) must be lighter than ${RAMP[i - 1]} (${lightnesses[i - 1]})`,
      ).toBeGreaterThan(lightnesses[i - 1]!);
    }

    // And far enough apart to survive being printed in greyscale.
    for (let i = 1; i < lightnesses.length; i++) {
      expect(lightnesses[i]! - lightnesses[i - 1]!).toBeGreaterThanOrEqual(0.08);
    }
  });

  it('ends the grade ramp on the brand accent', () => {
    // Easy *is* --primary. If someone changes one and not the other, the chart
    // and the button stop agreeing and the ramp loses its point.
    expect(light.get('grade-easy')).toEqual(light.get('primary'));
    expect(dark.get('grade-easy')).toEqual(dark.get('primary'));
  });

  it('keeps --primary light enough that it can only ever be a field', () => {
    // The rule the whole palette rests on: near-white, so ink goes on top of it
    // and it is never text. If this drops, re-read the header of globals.css
    // before "fixing" the test.
    for (const [theme, tokens] of [
      ['light', light],
      ['dark', dark],
    ] as const) {
      const primary = tokens.get('primary');
      expect(primary, `${theme} --primary must be oklch()`).toBeTruthy();
      expect(primary!.L, `${theme} --primary is no longer a light field`).toBeGreaterThan(
        0.85,
      );
    }
    expect(light.get('primary-foreground')!.L).toBeLessThan(0.3);
    expect(dark.get('primary-foreground')!.L).toBeLessThan(0.3);
  });
});
