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

/**
 * The origin index.html commits to, read back out of its own og:url.
 *
 * The social tags have to be absolute — several scrapers will not resolve a relative
 * og:image against the page — which is why the origin is duplicated into
 * public/robots.txt and public/sitemap.xml. Deriving it here rather than hardcoding
 * it means the test follows the domain instead of having to be edited alongside it.
 */
// `\s+` rather than a single space: Prettier wraps a <meta> across lines once it
// passes printWidth, and og:image already is. A regex that assumed one line would
// start returning undefined the day the domain got a few characters longer.
const siteOrigin = html.match(
  /property="og:url"\s+content="(https?:\/\/[^"/]+)\/?"/,
)?.[1];

/**
 * Every asset in `public/` that index.html points at, root-relative or absolute.
 *
 * Absolute same-origin URLs count: when og:image stopped being `/og-image.png` and
 * became a full URL, a path-only matcher silently stopped checking it existed, which
 * is the exact 404 this file is here to prevent.
 */
function referencedByHtml(): string[] {
  const paths = new Set<string>();
  for (const match of html.matchAll(/(?:href|content)="([^"]+)"/g)) {
    const value = match[1];
    if (!value) continue;

    let path: string | null = null;
    if (value.startsWith('/')) path = value.slice(1);
    else if (siteOrigin && value.startsWith(`${siteOrigin}/`))
      path = value.slice(siteOrigin.length + 1);

    if (path && /\.(png|ico|svg|webmanifest|txt|xml)$/.test(path)) paths.add(path);
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

  it('states one origin across index.html, robots.txt and sitemap.xml', () => {
    // The sitemap protocol requires a fully-qualified <loc>, and scrapers need an
    // absolute og:image, so the origin is written in three files that nothing forces
    // to agree. Every failure here is invisible in the running app: the site renders
    // perfectly while shared links preview a 404 and the sitemap indexes nothing.
    expect(siteOrigin, 'index.html has no absolute og:url').toBeTruthy();

    const robots = read('public/robots.txt');
    const sitemap = read('public/sitemap.xml');

    expect(robots).toContain(`Sitemap: ${siteOrigin}/sitemap.xml`);
    expect(sitemap).toContain(`<loc>${siteOrigin}/</loc>`);

    // P7 shipped a __SITE_ORIGIN__ placeholder on purpose, to fail loudly rather than
    // invent a domain. It may survive in a comment as history; it may not survive in
    // anything a crawler reads.
    const directives = (body: string) =>
      body.replace(/<!--[\s\S]*?-->/g, '').replace(/^\s*#.*$/gm, '');
    expect(directives(robots)).not.toContain('__SITE_ORIGIN__');
    expect(directives(sitemap)).not.toContain('__SITE_ORIGIN__');
    expect(directives(html)).not.toContain('__SITE_ORIGIN__');
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
