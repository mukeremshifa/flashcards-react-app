import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Every icon the app promises must actually be in `public/`.
 *
 * A renamed or un-regenerated asset is a 404 that nothing else notices: the app
 * renders fine, the build passes, and the only symptom is a missing favicon or a
 * blank link preview that nobody sees until it is embarrassing.
 */

// vitest runs with jsdom, where `import.meta.url` is an http: URL — resolve
// from the project root instead, which is vitest's cwd.
const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');
const inPublic = (name: string) => existsSync(join(process.cwd(), 'public', name));

const html = read('index.html');
const manifest = JSON.parse(read('public/site.webmanifest'));

/** Every root-relative asset path index.html points at. */
function referencedByHtml(): string[] {
  const paths = new Set<string>();
  for (const match of html.matchAll(/(?:href|content)="(\/[^"]+)"/g)) {
    const value = match[1];
    if (value && /\.(png|ico|svg|webmanifest|txt|xml)$/.test(value)) {
      paths.add(value.slice(1));
    }
  }
  return [...paths];
}

describe('brand assets', () => {
  it('ships every icon index.html references', () => {
    const referenced = referencedByHtml();
    // Guard against the regex silently matching nothing and the test passing.
    expect(referenced.length).toBeGreaterThanOrEqual(5);

    const missing = referenced.filter(name => !inPublic(name));
    expect(missing, `referenced by index.html but not in public/: ${missing}`).toEqual(
      [],
    );
  });

  it('ships every icon the web manifest lists', () => {
    const icons: string[] = manifest.icons.map((icon: { src: string }) =>
      icon.src.replace(/^\//, ''),
    );
    expect(icons.length).toBeGreaterThanOrEqual(3);

    const missing = icons.filter(name => !inPublic(name));
    expect(missing, `listed in site.webmanifest but not in public/: ${missing}`).toEqual(
      [],
    );
  });

  it('provides a maskable icon as its own file', () => {
    // Android crops to a circle. A maskable entry pointing at the same artwork as
    // the normal icon gets the mark's corners shaved off.
    const maskable = manifest.icons.find((icon: { purpose?: string }) =>
      icon.purpose?.includes('maskable'),
    );
    expect(maskable, 'no maskable icon in site.webmanifest').toBeTruthy();

    const plain = manifest.icons.find(
      (icon: { sizes: string; purpose?: string }) =>
        icon.sizes === '512x512' && !icon.purpose,
    );
    expect(maskable.src).not.toBe(plain.src);
  });

  it('names the product consistently', () => {
    expect(manifest.name).toBe('SynapseDeck');
    expect(html).toContain('<title>SynapseDeck</title>');
    expect(html).not.toMatch(/<title>Flashcards<\/title>/);
  });

  it('reads the theme from storage before first paint', () => {
    // The pre-paint script and src/app/theme.tsx duplicate this key deliberately;
    // if one moves without the other, dark mode flashes white on every load.
    const key = 'synapsedeck.theme';
    expect(html).toContain(key);
    expect(read('src/app/theme.tsx')).toContain(`'${key}'`);
    expect(html.indexOf('classList.add')).toBeGreaterThan(-1);
  });

  it('loads no third-party fonts', () => {
    // The faces are self-hosted through @fontsource. A CDN link here would put a
    // third-party request back on a page that renders untrusted model output.
    expect(html).not.toMatch(/fonts\.googleapis\.com|fonts\.gstatic\.com/);
    expect(read('src/styles/globals.css')).toContain('@fontsource');
  });
});
