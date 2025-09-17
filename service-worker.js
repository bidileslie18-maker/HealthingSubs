// service-worker.js

// Import the Supabase client library.
importScripts('https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm');

const SUPABASE_URL = 'https://wprgkybgolraukwjexth.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndwcmdreWJnb2xyYXVrd2pleHRoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTc2NjA5MzAsImV4cCI6MjA3MzIzNjkzMH0.5j9oUoRJNac37pU7MIspfK6Ei4Vol4NnMMCty1adGDA';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const CACHE_NAME = 'healthing-app-cache-v2'; // Increment the cache version
const urlsToCache = [
  '/',
  '/index.html',
  '/offline-db.js',
  '/manifest.json',
  'https://cdn.tailwindcss.com',
  'https://unpkg.com/html5-qrcode',
  'https://fonts.googleapis.com/css2?family=Lato:ital,wght@0,100;0,300;0,400;0,700;0,900;1,100;1,300;1,400;1,700;1,900&display=swap',
  'https://fonts.googleapis.com/css2?family=Dancing+Script:wght@400;700&display=swap',
  'https://fonts.gstatic.com'
];

const DB_NAME = 'HealthingAppDB';
const STORE_NAME = 'submissions';

// 1. Installation: Cache the necessary assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('Opened cache');
        return cache.addAll(urlsToCache);
      })
  );
});

// 2. Activation: Clean up old caches
self.addEventListener('activate', (event) => {
  const cacheWhitelist = [CACHE_NAME];
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheWhitelist.indexOf(cacheName) === -1) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});

// 3. Fetching: Implement a "Cache-First, with Network Fallback" strategy
self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((response) => {
      // Return cached response if it exists
      if (response) {
        return response;
      }
      // If no cache match, fetch from the network
      return fetch(event.request);
    }).catch(() => {
      // If network request also fails (e.g., offline), handle the error
      // You can return a custom offline page or a simple response.
      return new Response("You are offline. Please connect to the internet to access this page.", {
        status: 503,
        statusText: "Service Unavailable",
        headers: new Headers({ "Content-Type": "text/html" })
      });
    })
  );
});

// 4. Synchronization: Handle background data uploads when online
self.addEventListener('sync', (event) => {
    if (event.tag === 'sync-submissions') {
        event.waitUntil(syncSubmissions());
    }
});

async function syncSubmissions() {
    console.log('Attempting to sync offline submissions...');
    try {
        const db = await new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME);
            request.onsuccess = (e) => resolve(e.target.result);
            request.onerror = (e) => reject(e.target.error);
        });

        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const submissions = await new Promise((resolve, reject) => {
            const request = store.getAll();
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject('Failed to get offline submissions');
        });

        if (submissions.length === 0) {
            console.log('No offline submissions to sync.');
            return;
        }

        for (const submission of submissions) {
            try {
                const { data: keyData, error: keyError } = await supabase
                    .from('healthing_keys')
                    .select('is_used')
                    .eq('key', submission.healthing_key)
                    .single();

                if (keyData?.is_used) {
                    await new Promise((resolve, reject) => {
                        const deleteReq = store.delete(submission.id);
                        deleteReq.onsuccess = () => resolve();
                        deleteReq.onerror = () => reject('Failed to delete duplicate key from IndexedDB');
                    });
                    console.log(`Duplicate key "${submission.healthing_key}" rejected and removed.`);
                    continue;
                }

                const { error: submissionError } = await supabase
                    .from('submission_history')
                    .insert({
                        private_id: submission.private_id,
                        healthing_key: submission.healthing_key,
                        timestamp: submission.timestamp
                    });

                if (submissionError) {
                    throw new Error(`Supabase submission error for key ${submission.healthing_key}: ${submissionError.message}`);
                }

                const { error: updateError } = await supabase
                    .from('healthing_keys')
                    .update({ is_used: true })
                    .eq('key', submission.healthing_key);

                if (updateError) {
                    throw new Error(`Supabase update error for key ${submission.healthing_key}: ${updateError.message}`);
                }

                await new Promise((resolve, reject) => {
                    const deleteReq = store.delete(submission.id);
                    deleteReq.onsuccess = () => resolve();
                    deleteReq.onerror = () => reject('Failed to delete from IndexedDB after successful sync');
                });
                console.log(`Successfully synced and removed submission for key: ${submission.healthing_key}`);
            } catch (error) {
                console.error(`Sync error for key ${submission.healthing_key}:`, error);
            }
        }
        console.log('All available offline submissions have been processed.');
    } catch (error) {
        console.error('Failed to sync submissions:', error);
    }
}

