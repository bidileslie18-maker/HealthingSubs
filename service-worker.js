const CACHE_NAME = 'healthingsubs-cache-v3';

self.addEventListener('install', (event) => {
  console.log('Service Worker: Install event triggered. Caching assets.');
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll([
        './healthingsubs.html',
        './manifest.json',
        'https://cdn.tailwindcss.com',
        'https://unpkg.com/html5-qrcode',
        'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm'
      ]);
    })
    .then(() => self.skipWaiting())
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
          .map((cacheName) => caches.delete(cacheName))
      );
    })
  );
});

self.addEventListener('fetch', (event) => {
  event.respondWith(
    (async () => {
      // Try to get the response from the cache first
      const cachedResponse = await caches.match(event.request);
      if (cachedResponse) {
        return cachedResponse;
      }
      
      // If not in cache, fetch from the network
      try {
        const response = await fetch(event.request);
        
        // Check if we should cache this new response
        if (response && response.status === 200 && event.request.method === 'GET') {
          const responseToCache = response.clone();
          const cache = await caches.open(CACHE_NAME);
          await cache.put(event.request, responseToCache);
        }
        
        return response;
      } catch (error) {
        // This is where we handle a network failure
        console.error('Service Worker: Fetch failed.', error);
        // We could return a custom offline page here if needed
      }
    })()
  );
});
