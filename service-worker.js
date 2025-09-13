const CACHE_NAME = 'healthingsubs-cache-v2';
const urlsToCache = [
  './healthingsubs.html',
  './manifest.json',
  'https://cdn.tailwindcss.com',
  'https://unpkg.com/html5-qrcode',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm'
];

self.addEventListener('install', (event) => {
  console.log('Service Worker: Install event triggered.');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('Service Worker: Caching assets.');
        return cache.addAll(urlsToCache);
      })
      .then(() => self.skipWaiting())
      .catch((error) => {
        console.error('Service Worker: Failed to cache assets.', error);
      })
  );
});

self.addEventListener('activate', (event) => {
  console.log('Service Worker: Activate event triggered.');
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.filter(cacheName => cacheName !== CACHE_NAME)
                  .map(cacheName => caches.delete(cacheName))
      );
    })
  );
});

self.addEventListener('fetch', (event) => {
  // Check if the request is for a cached asset
  const isCachedAsset = urlsToCache.some(url => event.request.url.includes(url));
  
  // Use cache-first strategy for all requests
  event.respondWith(
    caches.match(event.request)
      .then((response) => {
        // If the resource is in the cache, return it immediately
        if (response) {
          return response;
        }

        // If not, fetch from the network
        return fetch(event.request)
          .catch(() => {
            // Return a fallback response for network failures, if needed
            console.log('Service Worker: Fetch failed, no cached version available.');
          });
      })
  );
});

