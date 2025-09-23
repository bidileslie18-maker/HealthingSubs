const CACHE_NAME = 'healthingsubs-cache-v4';
const OFFLINE_URL = './offline.html'; // Fallback page for network failures

self.addEventListener('install', (event) => {
  console.log('Service Worker: Install event triggered. Caching assets.');
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('Service Worker: Caching core assets.');
      return cache.addAll([
        './index.html',
        './manifest.json',
        OFFLINE_URL,
        './icons/icon-72x72.png',
        './icons/icon-96x96.png',
        './icons/icon-128x128.png',
        './icons/icon-144x144.png',
        './icons/icon-192x192.png',
        './icons/icon-512x512.png',
        'https://cdn.tailwindcss.com',
        'https://unpkg.com/html5-qrcode',
        'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm'
      ]);
    })
    .then(() => self.skipWaiting()) // Activates the new service worker immediately
    .catch((error) => {
      console.error('Service Worker: Failed to cache core assets.', error);
    })
  );
});

self.addEventListener('activate', (event) => {
  console.log('Service Worker: Activate event triggered. Deleting old caches.');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.filter((cacheName) => cacheName !== CACHE_NAME)
          .map((cacheName) => caches.delete(cacheName)) // Deletes old caches
      );
    })
  );
});

self.addEventListener('fetch', (event) => {
  // Only handle GET requests and ignore chrome-extension://
  if (event.request.method !== 'GET' || event.request.url.startsWith('chrome-extension://')) {
    return;
  }
  
  event.respondWith(
    (async () => {
      const cachedResponse = await caches.match(event.request);
      if (cachedResponse) {
        return cachedResponse; // Serve from cache if available
      }

      try {
        const response = await fetch(event.request);
        if (response && response.status === 200) {
          const responseToCache = response.clone();
          const cache = await caches.open(CACHE_NAME);
          await cache.put(event.request, responseToCache); // Cache new requests
        }
        return response; // Serve from network
      } catch (error) {
        console.error('Service Worker: Fetch failed. Serving offline page.', error);
        return caches.match(OFFLINE_URL); // Serve offline page on network failure
      }
    })()
  );
});
