const CACHE_NAME = 'dogear-offline-v2';
const OFFLINE_DOCUMENT = '/offline.html';

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const request = new Request(new URL(OFFLINE_DOCUMENT, self.location.origin), {
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error'
    });
    const response = await fetch(request);
    if (!response.ok || response.type === 'opaque') {
      throw new Error('Offline document could not be safely cached');
    }
    const cache = await caches.open(CACHE_NAME);
    await cache.put(OFFLINE_DOCUMENT, response);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const oldCaches = (await caches.keys()).filter(name =>
      /^dogear-offline-v\d+$/.test(name) && name !== CACHE_NAME
    );
    await Promise.all(oldCaches.map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET' || request.mode !== 'navigate') return;

  const url = new URL(request.url);
  if (
    url.origin !== self.location.origin ||
    url.pathname !== '/' ||
    url.search !== '' ||
    url.hash !== '' ||
    request.headers.has('authorization')
  ) return;

  event.respondWith((async () => {
    try {
      return await fetch(request, {cache: 'no-store'});
    } catch {
      const cache = await caches.open(CACHE_NAME);
      return await cache.match(OFFLINE_DOCUMENT);
    }
  })());
});
