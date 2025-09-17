// This is the service worker file that provides offline functionality and background sync.

// Define a cache name for your app's assets. Update this version number when you make changes to files.
const CACHE_NAME = 'healthing-app-cache-v3';

// List all the files to be cached. These are the "app shell" files.
const urlsToCache = [
  '/',
  '/index.html',
  '/offline-db.js',
  '/manifest.json',
  // You should add the paths to your CSS, image, and other essential files here
  // e.g., '/styles/main.css', '/images/logo.png', etc.
];

// Supabase configuration - these are needed for the sync process
const SUPABASE_URL = 'https://<your-supabase-url>.supabase.co';
const SUPABASE_ANON_KEY = 'YOUR_SUPABASE_ANON_KEY';
const TABLE_NAME = 'submission_history';
const KEYS_TABLE = 'healthing_keys';

// Import the Supabase client library directly into the service worker
importScripts('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2');

// --- Service Worker Lifecycle Events ---

// 1. Install Event: Caches the app shell files.
self.addEventListener('install', (event) => {
  console.log('Service Worker: Installing...');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('Service Worker: Caching app shell');
        return cache.addAll(urlsToCache);
      })
      .catch((err) => console.error('Service Worker: Cache installation failed', err))
  );
});

// 2. Activate Event: Cleans up old caches.
self.addEventListener('activate', (event) => {
  console.log('Service Worker: Activating...');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log('Service Worker: Deleting old cache', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  // Takes control of the clients immediately, so the page doesn't have to be reloaded.
  self.clients.claim();
});

// 3. Fetch Event: Intercepts network requests and serves cached content.
self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request)
      .then((cachedResponse) => {
        // Return the cached response if it exists.
        if (cachedResponse) {
          return cachedResponse;
        }
        // Otherwise, fetch from the network.
        return fetch(event.request).catch(() => {
          // If the network request fails and it's a navigation request, serve the offline page.
          if (event.request.mode === 'navigate') {
            return caches.match('/index.html');
          }
        });
      })
  );
});

// --- Background Sync for Offline Submissions ---

// Listen for the sync event from the app
self.addEventListener('sync', (event) => {
  console.log('Service Worker: Sync event triggered!', event.tag);
  if (event.tag === 'sync-submissions') {
    event.waitUntil(syncOfflineSubmissions());
  }
});

/**
 * Handles the synchronization of offline submissions with the Supabase database.
 * This function is triggered by the 'sync-submissions' event.
 */
async function syncOfflineSubmissions() {
  console.log('Syncing offline submissions...');
  // The global self object is the service worker. 'self.indexedDB'
  const db = self.indexedDB.open('submissions-db', 1);

  db.onsuccess = async (event) => {
    const database = event.target.result;
    const transaction = database.transaction('submissions', 'readwrite');
    const store = transaction.objectStore('submissions');
    const submissions = store.getAll();

    submissions.onsuccess = async () => {
      const offlineSubmissions = submissions.result;
      if (offlineSubmissions.length === 0) {
        console.log('No offline submissions to sync.');
        return;
      }

      const supabase = self.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

      for (const submission of offlineSubmissions) {
        try {
          console.log('Processing submission:', submission.privateID);

          // Check if the Healthing Key is valid and not used
          const { data: keyData, error: keyError } = await supabase
            .from(KEYS_TABLE)
            .select('is_used')
            .eq('healthing_key', submission.healthingKey)
            .single();

          if (keyError || !keyData || keyData.is_used) {
            console.log('Invalid or used Healthing Key. Deleting offline record.');
            // Delete the submission from IndexedDB
            const delTransaction = database.transaction('submissions', 'readwrite');
            const delStore = delTransaction.objectStore('submissions');
            delStore.delete(submission.id);
            continue; // Skip to the next submission
          }

          // Insert the submission into the main table
          const { error: insertError } = await supabase
            .from(TABLE_NAME)
            .insert({
              private_id: submission.privateID,
              timestamp: submission.timestamp,
              submission_data: submission.submissionData,
            });

          if (insertError) {
            console.error('Failed to insert submission online:', insertError);
            continue; // Skip to the next submission
          }

          // Mark the Healthing Key as used
          const { error: updateError } = await supabase
            .from(KEYS_TABLE)
            .update({ is_used: true })
            .eq('healthing_key', submission.healthingKey);

          if (updateError) {
            console.error('Failed to update Healthing Key:', updateError);
            continue;
          }

          // If all operations are successful, delete the record from IndexedDB
          const delTransaction = database.transaction('submissions', 'readwrite');
          const delStore = delTransaction.objectStore('submissions');
          delStore.delete(submission.id);
          console.log('Submission synced successfully and deleted from local DB.');

        } catch (err) {
          console.error('An error occurred during sync:', err);
        }
      }
    };
  };

  db.onerror = (event) => {
    console.error('IndexedDB error:', event.target.error);
  };
}
