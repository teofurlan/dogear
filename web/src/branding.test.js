// @vitest-environment node
import {readFileSync} from 'node:fs';
import {expect, test} from 'vitest';

test('favicon is linked and renders the brand without an external font', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  expect(html).toContain('<link rel="icon" type="image/svg+xml" href="/favicon.svg">');
  const svg = readFileSync(new URL('../public/favicon.svg', import.meta.url), 'utf8');
  expect(svg).toContain('viewBox="0 0 64 64"');
  expect(svg).toContain('fill="#191919"');
  expect(svg).toContain('fill="#c8302d"');
  expect(svg).not.toMatch(/<text\b|<script\b|(?:href|src)=["']https?:/);
});
