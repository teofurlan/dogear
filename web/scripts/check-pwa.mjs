import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve, extname, sep} from 'node:path';
import {pathToFileURL} from 'node:url';

const root = resolve('web/dist');
const modulePath = process.env.PLAYWRIGHT_MODULE;
const executablePath = process.env.CHROME_PATH;
if (!modulePath || !executablePath) {
  throw new Error('Set PLAYWRIGHT_MODULE and CHROME_PATH to existing local installations.');
}
const {chromium} = await import(pathToFileURL(resolve(modulePath, 'index.mjs')).href);
const types = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json'};
const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const requested = resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
    if (requested !== root && !requested.startsWith(root + sep)) throw new Error('Invalid path');
    const bytes = await readFile(requested);
    response.writeHead(200, {'content-type': types[extname(requested)] ?? 'application/octet-stream', 'cache-control': 'no-store'});
    response.end(bytes);
  } catch {
    response.writeHead(404);
    response.end('Not found');
  }
});
let browser;
try {
  await new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  const port = server.address().port;
  const origin = `http://127.0.0.1:${port}`;
  browser = await chromium.launch({headless: true, executablePath});
  const context = await browser.newContext({serviceWorkers: 'allow', viewport: {width: 1280, height: 900}});
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    return url.origin === origin ? route.continue() : route.abort();
  });
  context.setDefaultTimeout(5000);
  const page = await context.newPage();
  const check = (condition, message) => { if (!condition) throw new Error(message); };
  await page.goto(`${origin}/offline.html`, {waitUntil: 'domcontentloaded'});
  await page.evaluate(async () => {
    const unrelated = await caches.open('unrelated-cache');
    await unrelated.put(new Request(new URL('/sentinel', location.origin)), new Response('keep'));
    const previous = await caches.open('dogear-offline-v1');
    await previous.put(new Request(new URL('/old', location.origin)), new Response('replace'));
  });
  await page.goto(origin, {waitUntil: 'networkidle'});
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload({waitUntil: 'networkidle'});
  await page.evaluate(() => navigator.serviceWorker.ready);
  const initial = await page.evaluate(async () => {
    const registrations = await navigator.serviceWorker.getRegistrations();
    const cacheNames = await window.caches.keys();
    const entries = await window.caches.open('dogear-offline-v2').then(cache => cache.keys());
    return {controlled: Boolean(navigator.serviceWorker.controller), registrations: registrations.length, caches: cacheNames, entries: entries.map(request => new URL(request.url).pathname)};
  });
  check(initial.controlled && initial.registrations === 1, 'Built app did not register and control the page.');
  check(initial.caches.includes('dogear-offline-v2') && initial.entries.join() === '/offline.html', 'Offline cache contains unexpected entries.');

  const preserved = await page.evaluate(async () => ({
    unrelated: await caches.has('unrelated-cache'),
    oldDogear: await caches.has('dogear-offline-v1'),
    sentinel: await caches.open('unrelated-cache').then(cache => cache.match('/sentinel').then(Boolean))
  }));
  check(preserved.unrelated && preserved.sentinel && !preserved.oldDogear, 'Activation did not preserve/remove the intended caches.');

  await context.setOffline(true);
  await page.goto(origin, {waitUntil: 'domcontentloaded'});
  await page.waitForSelector('h1');
  check((await page.locator('h1').innerText()).includes('offline'), 'Offline root did not show the public fallback.');
  for (const width of [1280, 390]) {
    await page.setViewportSize({width, height: 844});
    const layout = await page.evaluate(() => ({width: innerWidth, scroll: document.documentElement.scrollWidth, button: Boolean(document.querySelector('button[onclick*="reload"]'))}));
    check(layout.scroll <= layout.width && layout.button, `Offline page overflow or retry missing at ${width}px.`);
  }
  const cacheBefore = await page.evaluate(() => caches.open('dogear-offline-v2').then(cache => cache.keys()).then(keys => keys.map(key => key.url).sort()));
  // Keep the controlled page alive: failed navigations create opaque error pages.
  for (const path of ['/api', '/api/books', '/auth/callback', '/?code=isolated-test', '/?state=isolated-test']) {
    const probe = await context.newPage();
    try {
      let failed = false;
      try { await probe.goto(`${origin}${path}`, {waitUntil: 'domcontentloaded', timeout: 3000}); } catch { failed = true; }
      check(failed, `Disallowed request ${path} was replaced while offline.`);
    } finally {
      await probe.close();
    }
  }
  const cacheAfter = await page.evaluate(() => caches.open('dogear-offline-v2').then(cache => cache.keys()).then(keys => keys.map(key => key.url).sort()));
  check(JSON.stringify(cacheBefore) === JSON.stringify(cacheAfter) && cacheAfter.length === 1 && cacheAfter[0].endsWith('/offline.html'), 'Disallowed offline requests changed cache contents.');
  await Promise.all([
    page.waitForEvent('domcontentloaded'),
    page.getByRole('button', {name: 'Try reconnecting'}).click()
  ]);
  check((await page.locator('h1').innerText()).includes('offline'), 'Retry while offline did not retain the fallback.');
  await context.setOffline(false);
  await Promise.all([
    page.waitForEvent('domcontentloaded'),
    page.getByRole('button', {name: 'Try reconnecting'}).click()
  ]);
  check(await page.getByRole('button', {name: 'Try reconnecting'}).count() === 0, 'Reconnection did not return to the app.');
  console.log('PWA browser smoke passed: production registration/control, named cache boundaries, update preservation, offline root/retry/reconnect, and API/callback/query bypass. External requests were blocked; no login or OS installation was performed.');
  await context.close();
} finally {
  await browser?.close();
  await new Promise(resolveClose => server.close(() => resolveClose()));
}
