// offline-db.js
const DB_NAME = 'HealthingAppDB';
const DB_VERSION = 1;
const STORE_NAME = 'submissions';
let db;
function openDatabase() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: 'id' });
            }
        };
        request.onsuccess = (event) => {
            db = event.target.result;
            resolve(db);
        };
        request.onerror = (event) => {
            reject('IndexedDB error: ' + event.target.errorCode);
        };
    });
}
export async function saveOfflineSubmission(privateId, key) {
    if (!db) {
        await openDatabase();
    }
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const submission = {
        id: Date.now(),
        private_id: privateId,
        healthing_key: key,
        timestamp: new Date().toISOString()
    };
    return new Promise((resolve, reject) => {
        const request = store.add(submission);
        request.onsuccess = () => {
            console.log('Submission saved to IndexedDB.');
            resolve();
        };
        request.onerror = (event) => {
            console.error('Error saving to IndexedDB:', event.target.error);
            reject(event.target.error);
        };
    });
}
export async function getOfflineSubmissions() {
    if (!db) {
        await openDatabase();
    }
    const transaction = db.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    return new Promise((resolve, reject) => {
        const request = store.getAll();
        request.onsuccess = () => {
            resolve(request.result);
        };
        request.onerror = (event) => {
            reject(event.target.error);
        };
    });
}
export async function deleteOfflineSubmission(id) {
    if (!db) {
        await openDatabase();
    }
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    return new Promise((resolve, reject) => {
        const request = store.delete(id);
        request.onsuccess = () => {
            console.log('Submission deleted from IndexedDB.');
            resolve();
        };
        request.onerror = (event) => {
            reject(event.target.error);
        };
    });
}
