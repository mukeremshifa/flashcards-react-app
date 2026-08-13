import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The one regression P5 had to clean up, made impossible to reintroduce quietly.
 *
 * Before P5 the app was a shadcn scaffold with Tailwind palette classes sprinkled
 * through it — `bg-emerald-500` on a button here, `text-slate-700` on a label
 * there — none of which move when the theme does, and all of which look nearly
 * right in light mode and wrong in dark. P5 removed the last of them and moved
 * every colour into `globals.css`. Nothing stopped them coming back, and a
 * screen reaching past the tokens for "just this one colour" is exactly the kind
 * of edit that passes review because it looks fine on the reviewer's machine.
 *
 * Two rules, both mechanical:
 *
 * 1. **No numbered Tailwind palette class anywhere in `src/`.** Unnumbered
 *    `white` and `black` are deliberately allowed: `text-white` on the
 *    destructive field and `bg-black/50` on a modal overlay are absolutes, not
 *    points on a scale that a theme is supposed to move.
 * 2. **No literal colour in code.** Hex, `rgb()` and `hsl()` are all banned in
 *    source — the tokens are `oklch()` and they live in one file. Comments are
 *    exempt and have to be: the header of `globals.css` documents the accent as
 *    `#D0F861`, which is the whole point of writing it down.
 */

const SRC = join(process.cwd(), 'src');
const EXTENSIONS = ['.ts', '.tsx', '.css'];

/** Tailwind's default palette, minus the two absolutes. */
const PALETTE = [
  'slate',
  'gray',
  'zinc',
  'neutral',
  'stone',
  'red',
  'orange',
  'amber',
  'yellow',
  'lime',
  'green',
  'emerald',
  'teal',
  'cyan',
  'sky',
  'blue',
  'indigo',
  'violet',
  'purple',
  'fuchsia',
  'pink',
  'rose',
].join('|');

const PALETTE_CLASS = new RegExp(`\\b(?:${PALETTE})-(?:50|[1-9]50|[1-9]00)\\b`, 'g');
const LITERAL_COLOUR = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/g;

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap(entry => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return EXTENSIONS.some(extension => path.endsWith(extension)) ? [path] : [];
  });
}

/**
 * Block comments and whole-line `//` comments, removed.
 *
 * Deliberately not a parser: a `//` mid-line is left alone because that is what
 * a URL inside a string looks like, and this file's job is to be impossible to
 * argue with rather than to be clever.
 */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

function hits(pattern: RegExp, transform: (source: string) => string): string[] {
  const found: string[] = [];
  for (const path of sourceFiles(SRC)) {
    // This file names every banned token in order to ban them.
    if (path === join(SRC, 'test', 'palette.test.ts')) continue;

    const lines = transform(readFileSync(path, 'utf8')).split('\n');
    lines.forEach((line, index) => {
      for (const match of line.matchAll(pattern)) {
        found.push(`${relative(process.cwd(), path)}:${index + 1} — ${match[0]}`);
      }
    });
  }
  return found;
}

describe('the palette is closed', () => {
  it('finds source files to check at all', () => {
    // A broken walk would make every assertion below pass by testing nothing.
    expect(sourceFiles(SRC).length).toBeGreaterThan(40);
  });

  it('uses no numbered Tailwind palette class', () => {
    const found = hits(PALETTE_CLASS, source => source);
    expect(found, `use a token from globals.css instead:\n${found.join('\n')}`).toEqual(
      [],
    );
  });

  it('hardcodes no colour outside a comment', () => {
    const found = hits(LITERAL_COLOUR, withoutComments);
    expect(found, `colours belong in globals.css:\n${found.join('\n')}`).toEqual([]);
  });
});
