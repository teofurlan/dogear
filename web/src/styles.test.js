// @vitest-environment node
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
import {afterAll, expect, test} from 'vitest';

const dom = new JSDOM('<style></style>', {url: 'http://localhost/'});
const style = dom.window.document.querySelector('style');
style.textContent = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');
afterAll(() => dom.window.close());

const rule = selector => [...style.sheet.cssRules].find(item => item.selectorText?.replace(/\s+/g, ' ') === selector)?.style;

test('the wordmark has a comfortable touch target without changing its lettering', () => {
  expect(rule('.wordmark').getPropertyValue('display')).toBe('inline-flex');
  expect(rule('.wordmark').getPropertyValue('min-height')).toBe('44px');
  expect(rule('.wordmark').getPropertyValue('font-size')).toBe('1.75rem');
});

test('library headings can wrap around their count on narrow screens', () => {
  expect(rule('.heading-row').getPropertyValue('flex-wrap')).toBe('wrap');
  expect(rule('.heading-row h1').getPropertyValue('overflow-wrap')).toBe('anywhere');
  expect(rule('.catalog-count').getPropertyValue('font-variant-numeric')).toBe('tabular-nums');
});

test('control feedback excludes disabled buttons and preserves their cursor states', () => {
  expect(rule('.login-panel button:hover:not(:disabled)')?.getPropertyValue('background')).toBeTruthy();
  expect(rule('.login-panel button:active:not(:disabled)')?.getPropertyValue('background')).toBeTruthy();
  expect(rule('.load-more:hover:not(:disabled)')?.getPropertyValue('background')).toBe('rgb(220, 220, 213)');
  expect(rule('button:disabled').getPropertyValue('cursor')).toBe('not-allowed');
  expect(rule('.login-panel button').getPropertyValue('cursor')).toBe('');
  expect(rule('.signout-button, .retry-button').getPropertyValue('cursor')).toBe('');
});

test('disabled buttons use not-allowed cursor by default and wait cursor only when busy', () => {
  expect(rule('button:disabled').getPropertyValue('cursor')).toBe('not-allowed');
  expect(rule('button[aria-busy="true"]').getPropertyValue('cursor')).toBe('wait');

  const doc = dom.window.document;
  const button = doc.createElement('button');
  doc.body.appendChild(button);

  button.disabled = true;
  expect(dom.window.getComputedStyle(button).cursor).toBe('not-allowed');

  button.setAttribute('aria-busy', 'true');
  expect(dom.window.getComputedStyle(button).cursor).toBe('wait');

  button.disabled = false;
  expect(dom.window.getComputedStyle(button).cursor).toBe('wait');

  button.removeAttribute('aria-busy');
  expect(dom.window.getComputedStyle(button).cursor).toBe('pointer');

  button.remove();
});

test('book titles request the bundled display weight rather than an unavailable face', () => {
  expect(rule('.book-grid .book-title').getPropertyValue('font-weight')).toBe('700');
});

test('back button has underline and pointer cursor', () => {
  expect(rule('.back-button').getPropertyValue('text-decoration')).toMatch(/underline/);
  expect(rule('.back-button').getPropertyValue('cursor')).toBe('pointer');
});

test('pending badge has red background and bold text', () => {
  expect(rule('.pending-badge').getPropertyValue('background')).toBe('var(--catalog-red)');
  expect(rule('.pending-badge').getPropertyValue('font-weight')).toBe('600');
});

test('library search input has catalog ink text and red caret', () => {
  expect(rule('.library-search').getPropertyValue('color')).toBe('var(--catalog-ink)');
  expect(rule('.library-search').getPropertyValue('caret-color')).toBe('var(--catalog-red)');
});
