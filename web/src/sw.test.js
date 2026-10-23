// @vitest-environment node
import {existsSync, readFileSync} from 'node:fs';
import {expect, test} from 'vitest';

const offlineHtmlPath = new URL('../public/offline.html', import.meta.url);
const swJsPath = new URL('../public/sw.js', import.meta.url);

test('offline.html exists, is self-contained and explains offline limitations', () => {
  expect(existsSync(offlineHtmlPath), 'web/public/offline.html must exist').toBe(true);
  const html = readFileSync(offlineHtmlPath, 'utf8');

  // Must be clean HTML5
  expect(html).toMatch(/<!doctype html>/i);
  expect(html).toContain('dogear');
  expect(html).toContain('offline');

  // Must explain that offline capture and book entry are not available
  expect(html.toLowerCase()).toMatch(/not (?:available|implemented)|require(?:s)? (?:a |an )?(?:internet |network )?connection/);

  // Must use brand colors
  expect(html).toContain('#e9e9e5');
  expect(html).toContain('#191919');
  expect(html).toContain('#c8302d');

  // Self-contained: no remote scripts or stylesheets
  expect(html).not.toMatch(/<script\b[^>]*\bsrc=["']https?:/i);
  expect(html).not.toMatch(/<link\b[^>]*\bhref=["']https?:/i);
});

test('sw.js exists, defines versioned cache and restricts pre-cached assets', () => {
  expect(existsSync(swJsPath), 'web/public/sw.js must exist').toBe(true);
  const swCode = readFileSync(swJsPath, 'utf8');

  // Must define a scoped offline cache
  expect(swCode).toMatch(/dogear-offline-v\d+/);

  // Must include offline.html in pre-cache list
  expect(swCode).toContain('/offline.html');

  // PRECACHE_ASSETS array must only contain static public assets
  const match = swCode.match(/const\s+PRECACHE_ASSETS\s*=\s*\[([\s\S]*?)\];/);
  expect(match).not.toBeNull();
  const precacheContent = match[1];
  expect(precacheContent).not.toContain('/api/');
  expect(precacheContent).not.toContain('/src/');
  expect(precacheContent).not.toContain('index.html');
});

test('sw.js strictly excludes API, auth, tokens, and non-GET requests from caching', () => {
  expect(existsSync(swJsPath), 'web/public/sw.js must exist').toBe(true);
  const swCode = readFileSync(swJsPath, 'utf8');

  // Explicit bypass for /api/
  expect(swCode).toMatch(/\/api\//);

  // Explicit bypass or exclusion for Auth0 / auth tokens / callbacks
  expect(swCode.toLowerCase()).toMatch(/auth0|token|callback/);

  // Only GET requests should ever be considered for caching
  expect(swCode).toContain('GET');

  // Must never cache API responses or book data
  expect(swCode).not.toMatch(/caches\.open\([^)]*\)\.then\([^)]*put\([^)]*api/i);
});
