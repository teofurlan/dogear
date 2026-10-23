const CACHE_NAME = 'dogear-offline-v1';
const PRECACHE_ASSETS = [
  '/offline.html',
  '/favicon.svg',
  '/icon.svg',
  '/icon-192.png',
  '/manifest.webmanifest'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(PRECACHE_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
    ))
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const request = event.request;

  // Cache strictly handles GET requests
  if (request.method !== 'GET') {
    return;
  }

  const url = new URL(request.url);

  // Strict privacy boundary: never intercept, store or mock API calls, auth tokens, or callbacks
  if (
    url.pathname.startsWith('/api/') ||
    url.hostname.includes('auth0.com') ||
    url.pathname.includes('/callback') ||
    url.searchParams.has('code') ||
    url.searchParams.has('state')
  ) {
    return;
  }

  // HTML navigation requests: network-first with offline.html fallback
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match('/offline.html'))
    );
    return;
  }

  // Static pre-cached offline assets: cache-first
  if (PRECACHE_ASSETS.includes(url.pathname)) {
    event.respondWith(
      caches.match(request).then(cached => cached || fetch(request))
    );
  }
});
