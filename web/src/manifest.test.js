// @vitest-environment node
import {existsSync, readFileSync} from 'node:fs';
import {expect, test} from 'vitest';

const htmlPath = new URL('../index.html', import.meta.url);
const manifestPath = new URL('../public/manifest.webmanifest', import.meta.url);
const publicDir = new URL('../public/', import.meta.url);

function getPngDimensions(buffer) {
  const isPng = buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47;
  if (!isPng) throw new Error('Not a valid PNG buffer');
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  return {width, height};
}

test('index.html links manifest, theme-color and apple-touch-icon without service worker registration', () => {
  const html = readFileSync(htmlPath, 'utf8');
  expect(html).toContain('<meta name="theme-color" content="#e9e9e5">');
  expect(html).toContain('<link rel="manifest" href="/manifest.webmanifest">');
  expect(html).toContain('<link rel="apple-touch-icon" href="/apple-touch-icon.png">');
  // Service worker is deferred to subsequent modules per S22/user constraints
  expect(html).not.toMatch(/serviceWorker\.register/);
});

test('manifest.webmanifest exists, is valid JSON and contains required PWA metadata', () => {
  expect(existsSync(manifestPath)).toBe(true);
  const raw = readFileSync(manifestPath, 'utf8');
  const manifest = JSON.parse(raw);

  expect(manifest.name).toBe('Dogear');
  expect(manifest.short_name).toBe('Dogear');
  expect(manifest.start_url).toBe('/');
  expect(manifest.scope).toBe('/');
  expect(manifest.display).toBe('standalone');
  expect(manifest.theme_color).toBe('#e9e9e5');
  expect(manifest.background_color).toBe('#e9e9e5');

  // Must not reference API routes, tokens, or photos
  const rawLower = raw.toLowerCase();
  expect(rawLower).not.toContain('/api');
  expect(rawLower).not.toContain('auth0');
  expect(rawLower).not.toContain('token');
  expect(rawLower).not.toContain('photo');
});

test('manifest defines standard and maskable icon entries pointing to real public files', () => {
  expect(existsSync(manifestPath)).toBe(true);
  const raw = readFileSync(manifestPath, 'utf8');
  const manifest = JSON.parse(raw);

  expect(Array.isArray(manifest.icons)).toBe(true);
  expect(manifest.icons.length).toBeGreaterThanOrEqual(3);

  const icon192 = manifest.icons.find(i => i.sizes === '192x192' && i.type === 'image/png');
  expect(icon192).toBeDefined();
  expect(icon192.src).toBe('/icon-192.png');

  const icon512 = manifest.icons.find(i => i.sizes === '512x512' && i.type === 'image/png');
  expect(icon512).toBeDefined();
  expect(icon512.src).toBe('/icon-512.png');

  const iconSvg = manifest.icons.find(i => i.type === 'image/svg+xml');
  expect(iconSvg).toBeDefined();
  expect(iconSvg.src).toBe('/icon.svg');

  const maskable = manifest.icons.find(i => (i.purpose || '').includes('maskable'));
  expect(maskable).toBeDefined();

  // All icon files must exist on disk in web/public
  for (const icon of manifest.icons) {
    const filename = icon.src.replace(/^\//, '');
    const filePath = new URL(filename, publicDir);
    expect(existsSync(filePath), `Icon file ${filename} must exist`).toBe(true);
  }
});

test('icon assets have valid dimensions, headers and brand palette', () => {
  // SVG icon
  const svgPath = new URL('icon.svg', publicDir);
  expect(existsSync(svgPath)).toBe(true);
  const svg = readFileSync(svgPath, 'utf8');
  expect(svg).toContain('viewBox="0 0 64 64"');
  expect(svg).toContain('fill="#191919"');
  expect(svg).toContain('fill="#c8302d"');
  expect(svg).toContain('fill="#e9e9e5"');
  expect(svg).not.toMatch(/<text\b|<script\b|(?:href|src)=["']https?:/);

  // PNG icons
  const icon192Buf = readFileSync(new URL('icon-192.png', publicDir));
  expect(getPngDimensions(icon192Buf)).toEqual({width: 192, height: 192});

  const icon512Buf = readFileSync(new URL('icon-512.png', publicDir));
  expect(getPngDimensions(icon512Buf)).toEqual({width: 512, height: 512});

  const maskableBuf = readFileSync(new URL('icon-maskable-512.png', publicDir));
  expect(getPngDimensions(maskableBuf)).toEqual({width: 512, height: 512});

  const appleTouchBuf = readFileSync(new URL('apple-touch-icon.png', publicDir));
  expect(getPngDimensions(appleTouchBuf)).toEqual({width: 180, height: 180});
});
