// @vitest-environment node
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {expect, test} from 'vitest';

const workerSource = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');

function harness({network = async () => new Response('online')} = {}) {
  const listeners = new Map();
  const cacheData = new Map();
  const cacheCalls = [];
  let claimed = 0;
  let skipped = 0;
  const caches = {
    async open(name) {
      cacheCalls.push(['open', name]);
      if (!cacheData.has(name)) cacheData.set(name, new Map());
      return cache(name);
    },
    async keys() { return [...cacheData.keys()]; },
    async delete(name) { cacheCalls.push(['delete', name]); return cacheData.delete(name); },
    async match(request) {
      for (const entries of cacheData.values()) if (entries.has(String(request))) return entries.get(String(request));
      return undefined;
    }
  };
  function cache(name) {
    const entries = cacheData.get(name);
    return {
      async addAll(urls) {
        for (const path of urls) {
          const url = new URL(path, 'https://dogear.test');
          const response = await network(new Request(url));
          entries.set(url.href, response);
        }
      },
      async match(request) { return entries.get(String(request.url ?? request)); },
      async put(request, response) { entries.set(String(request.url ?? request), response); },
      async keys() { return [...entries.keys()].map(url => new Request(url)); }
    };
  }
  const self = {
    location: new URL('https://dogear.test/sw.js'),
    addEventListener(type, callback) { listeners.set(type, callback); },
    skipWaiting() { skipped++; },
    clients: {claim() { claimed++; }}
  };
  vm.runInNewContext(workerSource, {self, caches, fetch: network, URL, Request, Response, Promise});
  async function dispatch(type, props = {}) {
    const waits = [];
    const event = {...props, waitUntil(promise) { waits.push(promise); }};
    listeners.get(type)(event);
    await Promise.all(waits);
    return event;
  }
  async function request(input, init = {}) {
    const {mode = 'navigate', ...requestInit} = init;
    const req = new Request(new URL(input, 'https://dogear.test'), requestInit);
    Object.defineProperty(req, 'mode', {value: mode});
    let responsePromise;
    await dispatch('fetch', {request: req, respondWith(promise) { responsePromise = Promise.resolve(promise); }});
    return responsePromise ? responsePromise : null;
  }
  return {dispatch, request, cacheData, cacheCalls, counts: () => ({claimed, skipped})};
}

test('install pre-caches only the same-origin public offline document without HTTP cache or credentials', async () => {
  const seen = [];
  const worker = harness({network: async request => { seen.push(request); return new Response('ok'); }});
  await worker.dispatch('install', {waitUntil: Promise.resolve()});
  expect(seen.map(r => new URL(r.url).pathname)).toEqual(['/offline.html']);
  expect(seen.every(r => r.cache === 'no-store' && r.credentials === 'omit' && r.redirect === 'error')).toBe(true);
  expect([...worker.cacheData.values()][0].size).toBe(1);
});

test('activation deletes only superseded Dogear offline caches and claims in lifetime', async () => {
  const worker = harness();
  worker.cacheData.set('unrelated-cache', new Map());
  worker.cacheData.set('dogear-offline-v0', new Map());
  worker.cacheData.set('dogear-offline-v2', new Map());
  await worker.dispatch('activate');
  expect([...worker.cacheData.keys()]).toEqual(['unrelated-cache', 'dogear-offline-v2']);
  expect(worker.counts().claimed).toBe(1);
});

test('root navigation uses the network and never stores its response', async () => {
  const worker = harness();
  await worker.dispatch('install');
  const online = await worker.request('/', {mode: 'navigate'});
  expect(await online.text()).toBe('online');
  expect([...worker.cacheData.get('dogear-offline-v2').keys()]).toEqual(['/offline.html']);
});

test('root navigation falls back to only the named offline document on network failure', async () => {
  let failRoot = false;
  const worker = harness({network: async request => {
    if (failRoot && new URL(request.url).pathname === '/') throw new Error('offline');
    return new Response(new URL(request.url).pathname === '/offline.html' ? 'offline page' : 'online page');
  }});
  await worker.dispatch('install');
  failRoot = true;
  const fallback = await worker.request('/', {mode: 'navigate'});
  expect(await fallback.text()).toBe('offline page');
  expect([...worker.cacheData.get('dogear-offline-v2').keys()]).toEqual(['/offline.html']);
});

test.each([
  ['/api/books', {mode: 'navigate'}], ['/api', {mode: 'navigate'}],
  ['/?code=secret', {mode: 'navigate'}], ['/?state=secret', {mode: 'navigate'}],
  ['/auth/callback', {mode: 'navigate'}], ['/books', {mode: 'navigate'}],
  ['/', {mode: 'navigate', headers: {Authorization: 'Bearer secret'}}],
  ['/', {method: 'POST', mode: 'navigate'}],
  ['https://auth.example.test/', {mode: 'navigate'}],
  ['/icon.svg', {mode: 'no-cors'}]
])('bypasses disallowed request %s without responding or caching it', async (path, init) => {
  const worker = harness();
  const response = await worker.request(path, init);
  expect(response).toBeNull();
  expect([...worker.cacheData.values()].flatMap(entries => [...entries.keys()])).toEqual([]);
});

test('public offline document remains a standalone usable retry screen', () => {
  const html = readFileSync(new URL('../public/offline.html', import.meta.url), 'utf8');
  expect(html.toLowerCase()).toContain('offline');
  expect(html.toLowerCase()).toMatch(/retry|reload|try again/);
});
