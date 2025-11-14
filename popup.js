let isRecording = false;
let eventCount = 0;

chrome.storage.local.get(['isRecording', 'events', 'settings'], (data) => {
    isRecording = data.isRecording || false;
    eventCount = (data.events || []).length;

    updateUI();
    updateEventCount();

    if (data.settings) {
        document.getElementById('skipPasswords').checked = data.settings.skipPasswords !== false;
        document.getElementById('throttle').value = data.settings.screenshotThrottle || 700;
        document.getElementById('denylistDomains').value = (data.settings.denylistDomains || []).join(', ');
        document.getElementById('denylistSelectors').value = (data.settings.denylistSelectors || []).join(', ');
    }
});

document.getElementById('startBtn').addEventListener('click', async () => {
    isRecording = true;
    await chrome.storage.local.set({ isRecording: true });

    const tabs = await chrome.tabs.query({});
    tabs.forEach(tab => {
        chrome.tabs.sendMessage(tab.id, { action: 'startRecording' }).catch(() => {});
    });

    await addEvent({
        type: 'recording_started',
        description: 'Recording session started',
        timestamp: new Date().toISOString(),
        url: (await chrome.tabs.query({ active: true, currentWindow: true }))[0].url
    });

    updateUI();
    updateEventCount();
});

document.getElementById('stopBtn').addEventListener('click', async () => {
    isRecording = false;
    await chrome.storage.local.set({ isRecording: false });

    const tabs = await chrome.tabs.query({});
    tabs.forEach(tab => {
        chrome.tabs.sendMessage(tab.id, { action: 'stopRecording' }).catch(() => {});
    });

    await addEvent({
        type: 'recording_stopped',
        description: 'Recording session stopped',
        timestamp: new Date().toISOString(),
        url: (await chrome.tabs.query({ active: true, currentWindow: true }))[0].url
    });

    updateUI();
    updateEventCount();
});

document.getElementById('clearBtn').addEventListener('click', async () => {
    if (confirm('Clear all recorded events?')) {
        await chrome.storage.local.set({ events: [] });
        eventCount = 0;
        updateEventCount();
    }
});

document.getElementById('viewBtn').addEventListener('click', () => {
    chrome.tabs.create({ url: 'viewer.html' });
});

document.getElementById('exportBtn').addEventListener('click', async () => {
    const data = await chrome.storage.local.get(['events']);
    const events = data.events || [];

    if (events.length === 0) {
        alert('No events to export!');
        return;
    }

    const tab = await chrome.tabs.create({ url: 'viewer.html' });

    setTimeout(() => {
        chrome.tabs.sendMessage(tab.id, { action: 'exportPDF' }).catch(() => {});
    }, 1000);
});

document.getElementById('skipPasswords').addEventListener('change', saveSettings);
document.getElementById('throttle').addEventListener('change', saveSettings);
document.getElementById('denylistDomains').addEventListener('change', saveSettings);
document.getElementById('denylistSelectors').addEventListener('change', saveSettings);

async function saveSettings() {
    const domains = document.getElementById('denylistDomains').value;
    const selectors = document.getElementById('denylistSelectors').value;

    const settings = {
        skipPasswords: document.getElementById('skipPasswords').checked,
        screenshotThrottle: parseInt(document.getElementById('throttle').value) || 700,
        denylistDomains: domains ? domains.split(',').map(d => d.trim()).filter(d => d) : [],
        denylistSelectors: selectors ? selectors.split(',').map(s => s.trim()).filter(s => s) : []
    };
    await chrome.storage.local.set({ settings });

    const tabs = await chrome.tabs.query({});
    tabs.forEach(tab => {
        chrome.tabs.sendMessage(tab.id, { action: 'updateSettings', settings }).catch(() => {});
    });
}

async function addEvent(event) {
    const data = await chrome.storage.local.get(['events']);
    const events = data.events || [];
    events.push({ ...event, id: Date.now() + Math.random() });
    await chrome.storage.local.set({ events });
    eventCount = events.length;
}

function updateUI() {
    const status = document.getElementById('status');
    const startBtn = document.getElementById('startBtn');
    const stopBtn = document.getElementById('stopBtn');

    if (isRecording) {
        status.textContent = '🔴 Recording';
        status.className = 'status recording';
        startBtn.disabled = true;
        stopBtn.disabled = false;
    } else {
        status.textContent = '⚫ Not Recording';
        status.className = 'status stopped';
        startBtn.disabled = false;
        stopBtn.disabled = true;
    }
}

function updateEventCount() {
    document.getElementById('eventCount').textContent = eventCount;
}
