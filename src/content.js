import {micromark} from 'micromark';
import {gfm, gfmHtml} from 'micromark-extension-gfm';
import {math, mathHtml} from 'micromark-extension-math';

const MODAL_SELECTOR = '.VIpgJd-TUo6Hb';
const NOTE_CONTENT_SELECTORS = [
    '.h1U9Be-YPqjbf',
    '.IZ65Hb-vIzZGf-L9AdLc-haAclf',
    '.IZ65Hb-qJTHM-haAclf [role="combobox"]',
    '.IZ65Hb-qJTHM-haAclf [role="textbox"]:not([aria-label="Title"])',
    '[contenteditable="true"][aria-multiline="true"][role="textbox"]:not([aria-label="Title"])'
];
const NOTE_SOURCE_COLUMN_SELECTOR = '.IZ65Hb-qJTHM-haAclf, .fmcmS-h1U9Be-LS81yb';
const PIN_BUTTON_SELECTOR = '.IZ65Hb-s2gQvd > [aria-label="Pin note"], .IZ65Hb-s2gQvd > .IZ65Hb-nQ1Faf';
const MODAL_WIDTH_KEY = 'modalWidth';
const DEFAULT_MARKDOWN_ENABLED_KEY = 'defaultMarkdownEnabled';
const NOTE_MARKDOWN_ENABLED_PREFIX = 'noteMarkdownEnabled:';

let currentModalWidth = 75;
let defaultMarkdownEnabled = true;
let scanScheduled = false;

const modalContexts = new WeakMap();
const modalContextSet = new Set();

function hasOwn(object, key) {
    return Object.prototype.hasOwnProperty.call(object, key);
}

function getSyncStorage(keys) {
    return new Promise((resolve) => {
        chrome.storage.sync.get(keys, resolve);
    });
}

function getLocalStorage(keys) {
    return new Promise((resolve) => {
        chrome.storage.local.get(keys, resolve);
    });
}

function setLocalStorage(items) {
    return new Promise((resolve) => {
        chrome.storage.local.set(items, resolve);
    });
}

function findMatchingElement(root, selector) {
    if (root.matches?.(selector)) {
        return root;
    }

    return root.querySelector(selector);
}

function findNoteContent(root) {
    for (const selector of NOTE_CONTENT_SELECTORS) {
        const element = findMatchingElement(root, selector);
        if (element) {
            return {element, selector};
        }
    }

    return null;
}

function getSourceColumn(noteContent) {
    return noteContent.closest(NOTE_SOURCE_COLUMN_SELECTOR) || noteContent;
}

function getText(element) {
    return (element?.innerText || element?.textContent || '').trim();
}

function getMarkdownText(noteContent) {
    return getText(noteContent)
        .replace(/\u00a0/g, ' ')
        .replace(/^"(.*)"$/gm, '$1')
        .replace(/\\n/g, '\n')
        .replace(/\\"([^"]+)\\"/g, '"$1"')
        .trim();
}

function getLocationNoteKey() {
    const match = window.location.hash.match(/^#(?:NOTE|LIST)\/([^/?#&]+)/i);
    return match?.[1] ? `hash:${match[1]}` : null;
}

function getNoteStorageKey(noteKey) {
    return noteKey ? `${NOTE_MARKDOWN_ENABLED_PREFIX}${noteKey}` : null;
}

async function loadMarkdownPreference(storageKey) {
    const syncResult = await getSyncStorage([DEFAULT_MARKDOWN_ENABLED_KEY]);
    defaultMarkdownEnabled = syncResult[DEFAULT_MARKDOWN_ENABLED_KEY] !== false;

    if (!storageKey) {
        return {
            enabled: defaultMarkdownEnabled,
            hasNoteOverride: false
        };
    }

    const localResult = await getLocalStorage([storageKey]);
    const hasNoteOverride = hasOwn(localResult, storageKey);

    return {
        enabled: hasNoteOverride ? localResult[storageKey] !== false : defaultMarkdownEnabled,
        hasNoteOverride
    };
}

function createPreviewPanel(noteId) {
    const preview = document.createElement('div');
    preview.className = 'keep-md-preview';
    preview.id = `keep-md-preview-${noteId}`;
    return preview;
}

function createMarkdownToggleButton(context) {
    const button = document.createElement('div');
    button.className = 'Q0hgme-LgbsSe Q0hgme-Bz112c-LgbsSe keep-md-toggle VIpgJd-LgbsSe';
    button.setAttribute('role', 'button');
    button.setAttribute('tabindex', '0');

    button.addEventListener('click', function(event) {
        event.preventDefault();
        event.stopPropagation();
        setNoteMarkdownEnabled(context, !context.markdownEnabled);
    });

    button.addEventListener('keydown', function(event) {
        if (event.key !== 'Enter' && event.key !== ' ') {
            return;
        }

        event.preventDefault();
        event.stopPropagation();
        setNoteMarkdownEnabled(context, !context.markdownEnabled);
    });

    return button;
}

function ensureMarkdownToggle(context) {
    if (context.toggleButton?.isConnected) {
        updateMarkdownToggle(context);
        return;
    }

    const existingButton = context.modalNote.querySelector('.keep-md-toggle');
    if (existingButton) {
        context.toggleButton = existingButton;
        updateMarkdownToggle(context);
        return;
    }

    const pinButton = context.modalNote.querySelector(PIN_BUTTON_SELECTOR);
    if (!pinButton?.parentElement) {
        return;
    }

    const button = createMarkdownToggleButton(context);
    pinButton.parentElement.insertBefore(button, pinButton);
    context.toggleButton = button;
    updateMarkdownToggle(context);
}

function updateMarkdownToggle(context) {
    if (!context.toggleButton) {
        return;
    }

    const label = context.markdownEnabled ? 'Disable Markdown preview' : 'Enable Markdown preview';

    context.toggleButton.classList.toggle('is-active', context.markdownEnabled);
    context.toggleButton.setAttribute('aria-pressed', String(context.markdownEnabled));
    context.toggleButton.setAttribute('aria-label', label);
    context.toggleButton.setAttribute('data-tooltip-text', label);
}

function updatePreview(context) {
    if (!context.preview) {
        return;
    }

    const latestNoteContentMatch = findNoteContent(context.sourceColumn) || findNoteContent(context.modalNote);
    if (!latestNoteContentMatch) {
        return;
    }

    const markdownText = getMarkdownText(latestNoteContentMatch.element);

    context.preview.innerHTML = micromark(markdownText, {
        extensions: [gfm(), math()],
        htmlExtensions: [gfmHtml(), mathHtml()]
    });
}

function showMarkdownPreview(context) {
    if (context.preview?.isConnected) {
        updatePreview(context);
        return;
    }

    const parent = context.sourceColumn.parentElement;
    if (!parent) {
        return;
    }

    const container = document.createElement('div');
    container.className = 'keep-md-container';

    context.sourceColumn.classList.add('keep-md-source');
    parent.insertBefore(container, context.sourceColumn);
    container.appendChild(context.sourceColumn);

    context.container = container;
    context.preview = createPreviewPanel(Date.now());
    container.appendChild(context.preview);

    context.observer = new MutationObserver(() => {
        updatePreview(context);
    });

    context.observer.observe(context.sourceColumn, {
        childList: true,
        characterData: true,
        subtree: true
    });

    updatePreview(context);
}

function removeMarkdownPreview(context) {
    if (context.observer) {
        context.observer.disconnect();
        context.observer = null;
    }

    const container = context.container || context.sourceColumn.closest('.keep-md-container');
    if (container?.parentElement) {
        container.parentElement.insertBefore(context.sourceColumn, container);
        container.remove();
    } else if (context.preview) {
        context.preview.remove();
    }

    context.sourceColumn.classList.remove('keep-md-source');
    context.container = null;
    context.preview = null;
}

function applyMarkdownState(context) {
    updateMarkdownToggle(context);

    if (context.markdownEnabled) {
        showMarkdownPreview(context);
    } else {
        removeMarkdownPreview(context);
    }
}

async function setNoteMarkdownEnabled(context, enabled) {
    context.markdownEnabled = enabled;
    context.hasNoteOverride = Boolean(context.storageKey);

    applyMarkdownState(context);
    if (context.storageKey) {
        await setLocalStorage({[context.storageKey]: enabled});
    }
}

async function handleNoteOpen(modalNote) {
    const existingContext = modalContexts.get(modalNote);
    if (existingContext) {
        const nextLocationKey = getLocationNoteKey();
        if (nextLocationKey && nextLocationKey !== existingContext.noteKey) {
            removeMarkdownPreview(existingContext);
            existingContext.toggleButton?.remove();
            destroyContext(existingContext);
            handleNoteOpen(modalNote);
            return;
        }

        ensureMarkdownToggle(existingContext);
        return;
    }

    const noteContentMatch = findNoteContent(modalNote);
    if (!noteContentMatch) {
        return;
    }

    const noteContent = noteContentMatch.element;
    const sourceColumn = getSourceColumn(noteContent);
    const parent = sourceColumn.parentElement;
    if (!parent) {
        return;
    }

    const noteKey = getLocationNoteKey();
    const context = {
        modalNote,
        sourceColumn,
        noteKey,
        storageKey: getNoteStorageKey(noteKey),
        markdownEnabled: defaultMarkdownEnabled,
        hasNoteOverride: false,
        container: null,
        preview: null,
        observer: null,
        toggleButton: null
    };

    modalContexts.set(modalNote, context);
    modalContextSet.add(context);
    ensureMarkdownToggle(context);

    const preference = await loadMarkdownPreference(context.storageKey);
    if (!modalNote.isConnected) {
        destroyContext(context);
        return;
    }

    context.markdownEnabled = preference.enabled;
    context.hasNoteOverride = preference.hasNoteOverride;
    applyMarkdownState(context);
}

function destroyContext(context) {
    if (context.observer) {
        context.observer.disconnect();
    }

    modalContexts.delete(context.modalNote);
    modalContextSet.delete(context);
}

function cleanupDisconnectedContexts() {
    for (const context of modalContextSet) {
        if (!context.modalNote.isConnected) {
            destroyContext(context);
        }
    }
}

function updateModalDimensions(width) {
    const numericWidth = Number(width);
    if (Number.isFinite(numericWidth)) {
        currentModalWidth = Math.min(95, Math.max(50, numericWidth));
    }

    const style = document.createElement('style');
    style.textContent = `
        .VIpgJd-TUo6Hb.XKSfm-L9AdLc:has(.keep-md-preview) {
            width: ${currentModalWidth}vw !important;
            height: auto !important;
            max-height: 95vh !important;
        }

        .VIpgJd-TUo6Hb.XKSfm-L9AdLc:has(.keep-md-preview) .IZ65Hb-n0tgWb,
        .VIpgJd-TUo6Hb.XKSfm-L9AdLc:has(.keep-md-preview) .IZ65Hb-TBnied,
        .VIpgJd-TUo6Hb.XKSfm-L9AdLc:has(.keep-md-preview) .IZ65Hb-s2gQvd {
            height: auto !important;
            overflow-y: auto !important;
        }

        .keep-md-container {
            height: auto !important;
        }
    `;

    const existingStyle = document.getElementById('keep-md-modal-style');
    if (existingStyle) {
        existingStyle.remove();
    }

    style.id = 'keep-md-modal-style';
    document.head.appendChild(style);
}

function refreshDefaultMarkdownContexts() {
    cleanupDisconnectedContexts();

    for (const context of modalContextSet) {
        if (context.hasNoteOverride) {
            continue;
        }

        context.markdownEnabled = defaultMarkdownEnabled;
        applyMarkdownState(context);
    }
}

chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'updateModalWidth') {
        updateModalDimensions(message.value);
        return;
    }

    if (message.type === 'updateDefaultMarkdownEnabled') {
        defaultMarkdownEnabled = message.value !== false;
        refreshDefaultMarkdownContexts();
    }
});

chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'sync' && changes[DEFAULT_MARKDOWN_ENABLED_KEY]) {
        defaultMarkdownEnabled = changes[DEFAULT_MARKDOWN_ENABLED_KEY].newValue !== false;
        refreshDefaultMarkdownContexts();
        return;
    }

    if (areaName !== 'local') {
        return;
    }

    cleanupDisconnectedContexts();

    for (const context of modalContextSet) {
        if (!context.storageKey) {
            continue;
        }

        const change = changes[context.storageKey];
        if (!change) {
            continue;
        }

        context.hasNoteOverride = hasOwn(change, 'newValue');
        context.markdownEnabled = context.hasNoteOverride ? change.newValue !== false : defaultMarkdownEnabled;
        applyMarkdownState(context);
    }
});

function init() {
    chrome.storage.sync.get([MODAL_WIDTH_KEY, DEFAULT_MARKDOWN_ENABLED_KEY], function(result) {
        if (result[MODAL_WIDTH_KEY]) {
            currentModalWidth = result[MODAL_WIDTH_KEY];
        }

        defaultMarkdownEnabled = result[DEFAULT_MARKDOWN_ENABLED_KEY] !== false;
        updateModalDimensions();
        scanOpenModals();
    });

    const observer = new MutationObserver(() => {
        scheduleModalScan();
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['class']
    });
}

function scanOpenModals() {
    cleanupDisconnectedContexts();

    const modals = document.querySelectorAll(MODAL_SELECTOR);
    for (const modal of modals) {
        handleNoteOpen(modal);
    }
}

function scheduleModalScan() {
    if (scanScheduled) {
        return;
    }

    scanScheduled = true;
    requestAnimationFrame(() => {
        scanScheduled = false;
        scanOpenModals();
    });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
