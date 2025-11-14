let isRecording = false;
let settings = {
    skipPasswords: true,
    screenshotThrottle: 700,
    denylistDomains: [],
    denylistSelectors: []
};
let lastScreenshotTime = 0;
let currentUrl = window.location.href;
let eventListeners = {};
let extensionInvalidated = false;

function checkExtensionContext() {
    if (!chrome.runtime?.id) {
        if (!extensionInvalidated) {
            extensionInvalidated = true;
            showReloadWarning();
        }
        return false;
    }
    return true;
}

function showReloadWarning() {
    const existingWarning = document.getElementById('extension-reload-warning');
    if (existingWarning) return;

    const warning = document.createElement('div');
    warning.id = 'extension-reload-warning';
    warning.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: #ef4444;
        color: white;
        padding: 16px 24px;
        border-radius: 12px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        z-index: 999999;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        font-size: 14px;
        font-weight: 600;
        cursor: pointer;
        animation: slideIn 0.3s ease;
    `;
    warning.innerHTML = `
        ⚠️ Extension Reloaded<br>
        <span style="font-size: 12px; font-weight: normal; opacity: 0.9;">Click to reload page</span>
    `;
    warning.onclick = () => window.location.reload();
    document.body.appendChild(warning);

    if (!document.getElementById('extension-warning-styles')) {
        const style = document.createElement('style');
        style.id = 'extension-warning-styles';
        style.textContent = `
            @keyframes slideIn {
                from { transform: translateX(400px); opacity: 0; }
                to { transform: translateX(0); opacity: 1; }
            }
        `;
        document.head.appendChild(style);
    }
}

chrome.storage.local.get(['isRecording', 'settings'], (data) => {
    if (!checkExtensionContext()) return;

    isRecording = data.isRecording || false;
    if (data.settings) {
        settings = { ...settings, ...data.settings };
    }

    if (isRecording) {
        setupEventListeners();
        startUrlPolling();
    }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'startRecording') {
        startRecording();
    } else if (message.action === 'stopRecording') {
        stopRecording();
    } else if (message.action === 'updateSettings') {
        settings = { ...settings, ...message.settings };
    }
});

function startRecording() {
    isRecording = true;
    setupEventListeners();
    startUrlPolling();
    monkeypatchHistoryAPI();
    setupMutationObserver();
}

function stopRecording() {
    isRecording = false;
    removeEventListeners();
    stopUrlPolling();
    stopMutationObserver();
}

function shouldFilterElement(element) {
    for (const selector of settings.denylistSelectors) {
        if (selector && element.matches && element.matches(selector)) {
            return true;
        }
    }

    const currentDomain = window.location.hostname;
    for (const domain of settings.denylistDomains) {
        if (domain && currentDomain.includes(domain)) {
            return true;
        }
    }

    return false;
}

function setupEventListeners() {
    eventListeners.click = async (e) => {
        if (shouldFilterElement(e.target)) return;

        const elementDesc = getElementDescription(e.target);
        await captureEvent({
            type: 'click',
            description: `Clicked on ${elementDesc}`,
            coordinates: { x: e.clientX, y: e.clientY },
            element: elementDesc,
            url: window.location.href
        }, true);
    };
    document.addEventListener('click', eventListeners.click, true);

    eventListeners.keydown = async (e) => {
        const importantKeys = ['Enter', 'Escape', 'Tab', ' '];
        if (importantKeys.includes(e.key)) {
            const elementDesc = getElementDescription(e.target);
            await captureEvent({
                type: 'keypress',
                description: `Pressed ${e.key === ' ' ? 'Space' : e.key} on ${elementDesc}`,
                key: e.key,
                element: elementDesc,
                url: window.location.href
            }, true);
        }

        if (e.key === 'Enter' && !e.shiftKey) {
            const target = e.target;
            if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' ||
                target.getAttribute('contenteditable') === 'true') {
                await captureInputCommit(target, 'enter');
            }
        }
    };
    document.addEventListener('keydown', eventListeners.keydown, true);

    eventListeners.blur = async (e) => {
        const target = e.target;
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' ||
            target.getAttribute('contenteditable') === 'true') {
            await captureInputCommit(target, 'blur');
        }
    };
    document.addEventListener('blur', eventListeners.blur, true);

    eventListeners.submit = async (e) => {
        const formDesc = getElementDescription(e.target);
        await captureEvent({
            type: 'form_submit',
            description: `Form submitted: ${formDesc}`,
            element: formDesc,
            url: window.location.href
        }, true);
    };
    document.addEventListener('submit', eventListeners.submit, true);

    eventListeners.visibilitychange = async () => {
        if (document.hidden) {
            await captureEvent({
                type: 'tab_hidden',
                description: 'Tab became hidden',
                url: window.location.href
            }, false);
        } else {
            await captureEvent({
                type: 'tab_visible',
                description: 'Tab became visible',
                url: window.location.href
            }, true);
        }
    };
    document.addEventListener('visibilitychange', eventListeners.visibilitychange);

    eventListeners.popstate = async () => {
        await captureEvent({
            type: 'navigation',
            description: `Navigated to ${window.location.href}`,
            url: window.location.href,
            previousUrl: currentUrl
        }, true);
        currentUrl = window.location.href;
    };
    window.addEventListener('popstate', eventListeners.popstate);
}

function removeEventListeners() {
    if (eventListeners.click) {
        document.removeEventListener('click', eventListeners.click, true);
    }
    if (eventListeners.keydown) {
        document.removeEventListener('keydown', eventListeners.keydown, true);
    }
    if (eventListeners.blur) {
        document.removeEventListener('blur', eventListeners.blur, true);
    }
    if (eventListeners.submit) {
        document.removeEventListener('submit', eventListeners.submit, true);
    }
    if (eventListeners.visibilitychange) {
        document.removeEventListener('visibilitychange', eventListeners.visibilitychange);
    }
    if (eventListeners.popstate) {
        window.removeEventListener('popstate', eventListeners.popstate);
    }
    eventListeners = {};
}

async function captureInputCommit(element, trigger) {
    if (settings.skipPasswords && element.type === 'password') {
        return;
    }

    let value = '';
    if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') {
        value = element.value;
    } else if (element.getAttribute('contenteditable') === 'true') {
        value = element.textContent || element.innerText;
    }

    if (value && value.trim()) {
        const elementDesc = getElementDescription(element);
        await captureEvent({
            type: 'input_commit',
            description: `Input committed (${trigger}) on ${elementDesc}`,
            typedText: value,
            element: elementDesc,
            trigger: trigger,
            url: window.location.href
        }, true);
    }
}

function monkeypatchHistoryAPI() {
    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;

    history.pushState = function(...args) {
        const result = originalPushState.apply(this, args);
        if (isRecording) {
            const newUrl = args[2] ? new URL(args[2], window.location.origin).href : window.location.href;
            handleNavigation(newUrl);
        }
        return result;
    };

    history.replaceState = function(...args) {
        const result = originalReplaceState.apply(this, args);
        if (isRecording) {
            const newUrl = args[2] ? new URL(args[2], window.location.origin).href : window.location.href;
            handleNavigation(newUrl);
        }
        return result;
    };
}

async function handleNavigation(newUrl) {
    if (newUrl !== currentUrl) {
        await captureEvent({
            type: 'navigation',
            description: `Navigated to ${newUrl}`,
            url: newUrl,
            previousUrl: currentUrl
        }, true);
        currentUrl = newUrl;
    }
}

let urlCheckInterval;
function startUrlPolling() {
    urlCheckInterval = setInterval(() => {
        if (isRecording && window.location.href !== currentUrl) {
            handleNavigation(window.location.href);
        }
    }, 1000);
}

function stopUrlPolling() {
    if (urlCheckInterval) {
        clearInterval(urlCheckInterval);
    }
}

function getElementDescription(element) {
    let desc = element.tagName.toLowerCase();

    if (element.id) {
        desc += `#${element.id}`;
    }

    if (element.className && typeof element.className === 'string') {
        const classes = element.className.split(' ').filter(c => c).slice(0, 2).join('.');
        if (classes) {
            desc += `.${classes}`;
        }
    }

    if (element.textContent) {
        const text = element.textContent.trim().substring(0, 30);
        if (text) {
            desc += ` "${text}${element.textContent.length > 30 ? '...' : ''}"`;
        }
    }

    return desc;
}

async function captureEvent(eventData, needsScreenshot) {
    if (!chrome.runtime?.id) {
        console.warn('Extension context invalidated. Please reload the page.');
        return;
    }

    const event = {
        ...eventData,
        timestamp: new Date().toISOString(),
        id: Date.now() + Math.random()
    };

    if (needsScreenshot && canTakeScreenshot()) {
        try {
            const response = await chrome.runtime.sendMessage({ action: 'captureScreenshot' });
            if (response && response.screenshot) {
                event.screenshot = response.screenshot;
                lastScreenshotTime = Date.now();
            } else if (response && response.error) {
                console.warn('Screenshot capture error:', response.error);
                event.screenshotError = 'Screenshot unavailable';
            }
        } catch (e) {
            if (e.message && e.message.includes('Extension context invalidated')) {
                console.warn('Extension was reloaded. Please refresh this page to continue recording.');
                isRecording = false;
                return;
            }
            console.warn('Screenshot failed:', e.message || e);
            event.screenshotError = 'Screenshot unavailable';
        }
    }

    try {
        const data = await chrome.storage.local.get(['events']);
        const events = data.events || [];
        events.push(event);
        await chrome.storage.local.set({ events });
    } catch (e) {
        if (e.message && e.message.includes('Extension context invalidated')) {
            console.warn('Extension was reloaded. Please refresh this page.');
            isRecording = false;
        } else {
            console.error('Failed to save event:', e);
        }
    }
}

function canTakeScreenshot() {
    const now = Date.now();
    return (now - lastScreenshotTime) >= settings.screenshotThrottle;
}

let mutationObserver = null;

function setupMutationObserver() {
    const hostname = window.location.hostname;

    const siteSelectors = {
        'www.youtube.com': [
            'input#search',
            'ytd-searchbox',
            'input[name="search_query"]'
        ],
        'www.instagram.com': [
            'input[placeholder*="Search"]',
            'input[type="text"][aria-label*="Search"]'
        ],
        'm.youtube.com': [
            'input[type="text"]'
        ]
    };

    const selectors = siteSelectors[hostname];
    if (!selectors) return;

    mutationObserver = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            if (mutation.type === 'childList') {
                for (const selector of selectors) {
                    const elements = document.querySelectorAll(selector);
                    elements.forEach(element => {
                        if (!element.dataset.observerAttached) {
                            element.dataset.observerAttached = 'true';
                            element.addEventListener('input', async (e) => {
                                if (isRecording && e.target.value) {
                                    clearTimeout(element.captureTimeout);
                                    element.captureTimeout = setTimeout(async () => {
                                        await captureEvent({
                                            type: 'site_specific_input',
                                            description: `[${hostname}] Input in ${selector}: "${e.target.value}"`,
                                            typedText: e.target.value,
                                            selector: selector,
                                            url: window.location.href
                                        }, true);
                                    }, 1000);
                                }
                            });
                        }
                    });
                }
            }
        }
    });

    mutationObserver.observe(document.body, {
        childList: true,
        subtree: true
    });

    for (const selector of selectors) {
        const elements = document.querySelectorAll(selector);
        elements.forEach(element => {
            if (!element.dataset.observerAttached) {
                element.dataset.observerAttached = 'true';
                element.addEventListener('input', async (e) => {
                    if (isRecording && e.target.value) {
                        clearTimeout(element.captureTimeout);
                        element.captureTimeout = setTimeout(async () => {
                            await captureEvent({
                                type: 'site_specific_input',
                                description: `[${hostname}] Input in ${selector}: "${e.target.value}"`,
                                typedText: e.target.value,
                                selector: selector,
                                url: window.location.href
                            }, true);
                        }, 1000);
                    }
                });
            }
        });
    }
}

function stopMutationObserver() {
    if (mutationObserver) {
        mutationObserver.disconnect();
        mutationObserver = null;
    }
}
