// Supabase configuration
const SUPABASE_URL = window.__SUPABASE_URL__;
const SUPABASE_KEY = window.__SUPABASE_KEY__;
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// IndexedDB configuration
const DB_NAME = 'HealthingSubsDB';
const DB_VERSION = 1;
const STORE_NAME = 'offline_submissions';
const VALID_IDS_STORE_NAME = 'valid_private_ids_cache';

let db;
let html5Qrcode = null;
let scanTarget = null; // 'privateId' or 'healthKey'

// DOM elements
const privateIdInput = document.getElementById('privateIdInput');
const keyInput = document.getElementById('keyInput');
const submitBtn = document.getElementById('submitBtn');
const checkHistoryBtn = document.getElementById('checkHistoryBtn');
const scanPrivateIdBtn = document.getElementById('scanPrivateIdBtn');
const scanKeyBtn = document.getElementById('scanKeyBtn');
const cancelScanBtn = document.getElementById('cancelScanBtn');
const messageDiv = document.getElementById('message');
const mainForm = document.getElementById('mainForm');
const historyReport = document.getElementById('historyReport');
const historyList = document.getElementById('historyList');
const backToFormBtn = document.getElementById('backToFormBtn');
const scannerSection = document.getElementById('scannerSection');
const offlineStatusDiv = document.getElementById('offlineStatus');
const syncBtn = document.getElementById('syncBtn');
const offlineCountSpan = document.getElementById('offlineCount');

// --- IndexedDB Functions ---

const openDatabase = () => {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        
        request.onupgradeneeded = (event) => {
            db = event.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
            }
            if (!db.objectStoreNames.contains(VALID_IDS_STORE_NAME)) {
                db.createObjectStore(VALID_IDS_STORE_NAME, { keyPath: 'private_id' });
            }
        };
        
        request.onsuccess = (event) => {
            db = event.target.result;
            resolve(db);
        };
        
        request.onerror = (event) => {
            console.error('IndexedDB error:', event.target.errorCode);
            reject('Could not open IndexedDB.');
        };
    });
};

const getOfflineSubmissions = () => {
    return new Promise((resolve, reject) => {
        if (!db) return reject('Database not initialized.');
        const transaction = db.transaction([STORE_NAME], 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.getAll();
        request.onsuccess = (event) => resolve(event.target.result);
        request.onerror = (event) => reject(event.target.errorCode);
    });
};

const deleteSyncedSubmissions = (ids) => {
    return new Promise((resolve, reject) => {
        if (!db) return reject('Database not initialized.');
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        for (const id of ids) {
            store.delete(id).onerror = (event) => {
                console.error('Failed to delete submission with ID', id, ':', event.target.errorCode);
            };
        }
        transaction.oncomplete = () => resolve();
        transaction.onerror = (event) => reject(event.target.errorCode);
    });
};

const updatePrivateIdCache = async () => {
    if (!navigator.onLine) return;
    try {
        const { data, error } = await supabase.from('valid_private_ids').select('private_id');
        if (error) throw error;
        
        const transaction = db.transaction([VALID_IDS_STORE_NAME], 'readwrite');
        const store = transaction.objectStore(VALID_IDS_STORE_NAME);
        store.clear(); // Clear old cache
        for (const id of data) {
            store.add(id);
        }
    } catch (error) {
        console.error('Failed to update private ID cache:', error);
    }
};

const isPrivateIdValid = async (privateId) => {
    if (!privateId) {
        displayMessage("Private ID cannot be empty.", 'error');
        return false;
    }
    
    // First, check the local cache
    if (db) {
        const transaction = db.transaction([VALID_IDS_STORE_NAME], 'readonly');
        const store = transaction.objectStore(VALID_IDS_STORE_NAME);
        const request = store.get(privateId);
        
        return new Promise((resolve, reject) => {
            request.onsuccess = (event) => {
                if (event.target.result) {
                    resolve(true);
                } else {
                    // If not in cache, and online, check Supabase
                    if (navigator.onLine) {
                        checkOnlineValidation();
                    } else {
                        displayMessage("Invalid Private ID. Cannot validate while offline.", 'error');
                        resolve(false);
                    }
                }
            };
            request.onerror = () => {
                console.error('IndexedDB read error.');
                resolve(false);
            };
            
            const checkOnlineValidation = async () => {
                const { data, error } = await supabase
                    .from('valid_private_ids')
                    .select('private_id')
                    .eq('private_id', privateId)
                    .single();
                
                if (error) {
                    displayMessage("Invalid Private ID.", 'error');
                    resolve(false);
                } else {
                    // Update cache for future use
                    const addTransaction = db.transaction([VALID_IDS_STORE_NAME], 'readwrite');
                    addTransaction.objectStore(VALID_IDS_STORE_NAME).add({ private_id: privateId });
                    resolve(true);
                }
            };
        });
    }
    
    // Fallback if IndexedDB is not available
    if (navigator.onLine) {
        const { data, error } = await supabase.from('valid_private_ids').select('private_id').eq('private_id', privateId).single();
        if (error) {
            displayMessage("Invalid Private ID.", 'error');
            return false;
        }
        return true;
    }

    displayMessage("Cannot validate private ID while offline.", 'error');
    return false;
};

// --- Supabase & Application Logic ---

const processSupabaseSubmission = async (privateId, key) => {
    try {
        // Step 1: Check if the Healthing Key exists and is unused
        const { data: keyData, error: keyError } = await supabase
            .from('valid_healthing_codes')
            .select('is_used')
            .eq('healthing_code', key)
            .single();

        if (keyError && keyError.code === 'PGRST116') {
            throw new Error("Invalid Healthing Key.");
        }
        if (keyError) {
            throw keyError;
        }

        if (keyData.is_used) {
            throw new Error("This Healthing Key has already been used.");
        }

        // Step 2: If Key is valid and unused, log the submission
        const { error: submissionError } = await supabase
            .from('submissions')
            .insert({
                private_id: privateId,
                healthing_code: key,
            });

        if (submissionError) {
            throw submissionError;
        }

        // Step 3: Mark the Healthing Key as used
        const { error: updateError } = await supabase
            .from('valid_healthing_codes')
            .update({ is_used: true })
            .eq('healthing_code', key);

        if (updateError) {
            throw updateError;
        }

        return { success: true, message: `Submission successful! Healthing Key is now used.` };

    } catch (error) {
        return { success: false, message: `An error occurred: ${error.message}` };
    }
};

const saveOfflineSubmission = (privateId, key) => {
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const submission = { privateId, key, timestamp: new Date().toISOString() };
    const request = store.add(submission);
    
    request.onsuccess = () => {
        displayMessage('Submission saved offline. It will sync when you are back online.', 'info');
        updateOfflineCount();
        keyInput.value = '';
    };
    
    request.onerror = () => {
        displayMessage('Failed to save submission offline.', 'error');
    };
};

const syncOfflineSubmissions = async () => {
    if (!navigator.onLine) return;

    try {
        const offlineSubmissions = await getOfflineSubmissions();
        if (offlineSubmissions.length === 0) return;

        displayMessage(`Syncing ${offlineSubmissions.length} offline submission(s)...`, 'info');

        const syncedIds = [];
        for (const submission of offlineSubmissions) {
            displayMessage(`Attempting to sync Private ID: ${submission.privateId}, Key: ${submission.key}...`, 'info');
            const result = await processSupabaseSubmission(submission.privateId, submission.key);
            
            if (result.success) {
                displayMessage(`Successfully synced submission for Private ID: ${submission.privateId}`, 'success');
                syncedIds.push(submission.id);
            } else {
                displayMessage(`Failed to sync for Private ID: ${submission.privateId}. Reason: ${result.message}`, 'error');
            }
        }
        
        await deleteSyncedSubmissions(syncedIds);
        updateOfflineCount();
        displayMessage('Sync complete.', 'success');
        
    } catch (error) {
        console.error('Sync process failed:', error);
        displayMessage('Sync process failed. Please try again later.', 'error');
    }
};

const updateOnlineStatus = () => {
    if (navigator.onLine) {
        offlineStatusDiv.classList.add('hidden');
        syncOfflineSubmissions();
        updatePrivateIdCache();
    } else {
        offlineStatusDiv.classList.remove('hidden');
        offlineStatusDiv.textContent = 'You are currently offline. Submissions will be saved locally.';
    }
};

// --- Event Listeners and Initial Setup ---

window.addEventListener('online', updateOnlineStatus);
window.addEventListener('offline', updateOnlineStatus);

document.addEventListener('DOMContentLoaded', () => {
    openDatabase().then(() => {
        updateOnlineStatus();
        updateOfflineCount();
    }).catch(err => {
        displayMessage(`App cannot function offline: ${err}`, 'error');
    });

    const urlParams = new URLSearchParams(window.location.search);
    const privateIdFromUrl = urlParams.get('privateId');
    if (privateIdFromUrl) {
        privateIdInput.value = privateIdFromUrl;
        displayMessage('Private ID found in URL. Ready to check history or submit.', 'success');
    }
});

const displayMessage = (text, type) => {
    messageDiv.textContent = text;
    messageDiv.classList.remove('bg-red-100', 'text-red-700', 'bg-green-100', 'text-green-700', 'bg-slate-100', 'text-slate-700');
    if (type === 'error') {
        messageDiv.classList.add('bg-red-100', 'text-red-700');
    } else if (type === 'success') {
        messageDiv.classList.add('bg-green-100', 'text-green-700');
    } else if (type === 'info') {
        messageDiv.classList.add('bg-slate-100', 'text-slate-700');
    }
};

checkHistoryBtn.addEventListener('click', async () => {
    const privateId = privateIdInput.value.trim();
    if (!navigator.onLine) {
         displayMessage("History can only be checked while online.", 'error');
         return;
    }
    if (await isPrivateIdValid(privateId)) {
        await fetchAndDisplayHistory(privateId);
        mainForm.classList.add('hidden');
        historyReport.classList.remove('hidden');
        displayMessage('', 'none');
    }
});

submitBtn.addEventListener('click', async () => {
    const privateId = privateIdInput.value.trim();
    const key = keyInput.value.trim();

    if (!key) {
        displayMessage("Healthing Key cannot be empty.", 'error');
        return;
    }
    
    const isValid = await isPrivateIdValid(privateId);
    
    if (navigator.onLine) {
        if (!isValid) return;
        const result = await processSupabaseSubmission(privateId, key);
        if (result.success) {
            displayMessage(result.message, 'success');
            keyInput.value = '';
        } else {
            displayMessage(result.message, 'error');
        }
    } else {
        if (!isValid) {
            displayMessage("Cannot save offline submission with an invalid Private ID.", 'error');
            return;
        }
        saveOfflineSubmission(privateId, key);
    }
});

syncBtn.addEventListener('click', () => {
    syncOfflineSubmissions();
});

const fetchAndDisplayHistory = async (privateId) => {
    try {
        const { data, error } = await supabase
            .from('submission_history')
            .select('*')
            .eq('private_id', privateId)
            .order('timestamp', { ascending: false });

        if (error) {
            throw error;
        }

        historyList.innerHTML = '';
        if (data.length === 0) {
            historyList.innerHTML = '<p class="text-gray-400 text-center">No submission history found for this ID.</p>';
            return;
        }

        data.forEach(item => {
            const submissionTime = new Date(item.timestamp).toLocaleString();
            const historyItem = document.createElement('div');
            historyItem.classList.add('p-3', 'bg-gray-700', 'rounded-lg', 'border', 'border-gray-600', 'text-gray-200');
            historyItem.innerHTML = `
                <p><strong>Key:</strong> ${item.healthing_key}</p>
                <p class="text-xs text-gray-400">Submitted: ${submissionTime}</p>
            `;
            historyList.appendChild(historyItem);
        });
    } catch (error) {
        console.error('Error fetching history:', error.message);
        displayMessage(`Error fetching history: ${error.message}`, 'error');
    }
};

const stopScanner = () => {
    scannerSection.classList.add('hidden');
    mainForm.classList.remove('hidden');
    displayMessage('', 'none');

    if (html5Qrcode && html5Qrcode.getState() !== 0) {
        html5Qrcode.stop().catch(err => {
            console.warn("Html5Qrcode.stop() failed, but UI is updated:", err);
        });
    }
    html5Qrcode = null;
};

backToFormBtn.addEventListener('click', () => {
    historyReport.classList.add('hidden');
    mainForm.classList.remove('hidden');
    displayMessage('', 'none');
    keyInput.value = '';
});

const startScanner = (target) => {
    scanTarget = target;
    mainForm.classList.add('hidden');
    scannerSection.classList.remove('hidden');
    document.getElementById('scanner-title').textContent = `Scan ${target === 'privateId' ? 'Private ID' : 'Healthing Key'}`;
    displayMessage('Initializing camera...', 'info');

    html5Qrcode = new Html5Qrcode("qr-reader");

    const onScanSuccess = (decodedText) => {
        if (scanTarget === 'privateId') {
            privateIdInput.value = decodedText;
            displayMessage('Private ID scanned successfully.', 'success');
        } else {
            keyInput.value = decodedText;
            displayMessage('Healthing Key scanned. Submitting...', 'info');
        }
        
        stopScanner();

        if (scanTarget === 'healthKey') {
            setTimeout(() => {
                submitBtn.click();
            }, 200);
        }
    };

    const onScanError = (errorMessage) => {};

    html5Qrcode.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 250, height: 250 } },
        onScanSuccess,
        onScanError
    ).catch(err => {
        displayMessage(`Could not start scanning: ${err.message}. Please check camera permissions.`, 'error');
        console.error("Failed to start scanning:", err);
        stopScanner();
    });
};

scanPrivateIdBtn.addEventListener('click', () => {
    startScanner('privateId');
});
scanKeyBtn.addEventListener('click', () => {
    startScanner('healthKey');
});
cancelScanBtn.addEventListener('click', () => {
    stopScanner();
});
