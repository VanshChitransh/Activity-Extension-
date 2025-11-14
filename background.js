chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'captureScreenshot') {
        captureScreenshot(sender.tab.id)
            .then(screenshot => sendResponse({ screenshot }))
            .catch(error => sendResponse({ error: error.message }));
        return true;
    }
});

async function captureScreenshot(tabId, retryCount = 0) {
    const maxRetries = 3;
    const retryDelay = 100;

    try {
        const dataUrl = await chrome.tabs.captureVisibleTab(null, {
            format: 'jpeg',
            quality: 70
        });
        return dataUrl;
    } catch (error) {
        const isTransientError =
            error.message.includes('user may be dragging') ||
            error.message.includes('cannot be edited right now') ||
            error.message.includes('tab is not in a state');

        if (isTransientError && retryCount < maxRetries) {
            console.log(`Screenshot failed (attempt ${retryCount + 1}/${maxRetries}), retrying...`);
            await new Promise(resolve => setTimeout(resolve, retryDelay * (retryCount + 1)));
            return captureScreenshot(tabId, retryCount + 1);
        }

        console.error('Screenshot capture failed:', error.message);
        throw error;
    }
}

chrome.tabs.onCreated.addListener(async (tab) => {
    const data = await chrome.storage.local.get(['isRecording']);
    if (data.isRecording) {
        const events = (await chrome.storage.local.get(['events'])).events || [];
        events.push({
            type: 'tab_created',
            description: `New tab created: ${tab.url || 'about:blank'}`,
            timestamp: new Date().toISOString(),
            tabId: tab.id,
            url: tab.url,
            id: Date.now() + Math.random()
        });
        await chrome.storage.local.set({ events });
    }
});

chrome.tabs.onActivated.addListener(async (activeInfo) => {
    const data = await chrome.storage.local.get(['isRecording']);
    if (data.isRecording) {
        const tab = await chrome.tabs.get(activeInfo.tabId);
        const events = (await chrome.storage.local.get(['events'])).events || [];
        events.push({
            type: 'tab_activated',
            description: `Switched to tab: ${tab.title || tab.url}`,
            timestamp: new Date().toISOString(),
            tabId: tab.id,
            url: tab.url,
            id: Date.now() + Math.random()
        });
        await chrome.storage.local.set({ events });
    }
});

function openDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open('ScreenRecorderDB', 1);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains('events')) {
                db.createObjectStore('events', { keyPath: 'id' });
            }
            if (!db.objectStoreNames.contains('settings')) {
                db.createObjectStore('settings');
            }
        };
    });
}

async function persistToIndexedDB(events, settings) {
    try {
        const db = await openDB();
        const transaction = db.transaction(['events', 'settings'], 'readwrite');
        const eventsStore = transaction.objectStore('events');
        const settingsStore = transaction.objectStore('settings');

        await eventsStore.clear();
        for (const event of events) {
            await eventsStore.put(event);
        }

        if (settings) {
            await settingsStore.put(settings, 'appSettings');
        }

        db.close();
    } catch (e) {
        console.error('IndexedDB persistence failed:', e);
    }
}

async function loadFromIndexedDB() {
    try {
        const db = await openDB();
        const transaction = db.transaction(['events', 'settings'], 'readonly');
        const eventsStore = transaction.objectStore('events');
        const settingsStore = transaction.objectStore('settings');

        const events = await eventsStore.getAll();
        const settings = await settingsStore.get('appSettings');

        db.close();
        return { events, settings };
    } catch (e) {
        console.error('IndexedDB load failed:', e);
        return { events: [], settings: null };
    }
}

chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local') {
        chrome.storage.local.get(['events', 'settings'], (data) => {
            persistToIndexedDB(data.events || [], data.settings);
        });
    }
});

chrome.runtime.onInstalled.addListener(async () => {
    console.log('Screen Recorder extension installed');

    const indexedData = await loadFromIndexedDB();

    const defaultSettings = {
        skipPasswords: true,
        screenshotThrottle: 700,
        denylistDomains: [],
        denylistSelectors: []
    };

    chrome.storage.local.set({
        isRecording: false,
        events: indexedData.events && indexedData.events.length > 0 ? indexedData.events : [],
        settings: indexedData.settings || defaultSettings
    });
});
