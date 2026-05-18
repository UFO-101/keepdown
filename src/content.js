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
const NOTE_MARKDOWN_MODE_PREFIX = 'noteMarkdownMode:';
const VIEW_MODE_EDITOR = 'editor';
const VIEW_MODE_SPLIT = 'split';
const VIEW_MODE_PREVIEW = 'preview';
const VIEW_MODES = [VIEW_MODE_EDITOR, VIEW_MODE_SPLIT, VIEW_MODE_PREVIEW];
const VIEW_MODE_LABELS = {
    [VIEW_MODE_EDITOR]: 'Editor',
    [VIEW_MODE_SPLIT]: 'Editor and Preview',
    [VIEW_MODE_PREVIEW]: 'Preview'
};

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

function getLineText(element) {
    return (element.textContent || '')
        .replace(/\u00a0/g, ' ')
        .replace(/\r?\n|\r/g, '')
        .trimEnd();
}

function getMarkdownText(noteContent) {
    const lineElements = noteContent.querySelectorAll('p, div[role="presentation"]');
    const text = lineElements.length > 0
        ? Array.from(lineElements, getLineText).join('\n')
        : getText(noteContent);

    return text
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

function getDefaultViewMode() {
    return defaultMarkdownEnabled ? VIEW_MODE_SPLIT : VIEW_MODE_EDITOR;
}

function isValidViewMode(mode) {
    return VIEW_MODES.includes(mode);
}

function getNoteModeStorageKey(noteKey) {
    return noteKey ? `${NOTE_MARKDOWN_MODE_PREFIX}${noteKey}` : null;
}

async function loadViewModePreference(modeStorageKey) {
    const syncResult = await getSyncStorage([DEFAULT_MARKDOWN_ENABLED_KEY]);
    defaultMarkdownEnabled = syncResult[DEFAULT_MARKDOWN_ENABLED_KEY] !== false;

    if (!modeStorageKey) {
        return {
            viewMode: getDefaultViewMode(),
            hasNoteOverride: false
        };
    }

    const localResult = await getLocalStorage([modeStorageKey]);
    const savedMode = localResult[modeStorageKey];

    if (isValidViewMode(savedMode)) {
        return {
            viewMode: savedMode,
            hasNoteOverride: true
        };
    }

    return {
        viewMode: getDefaultViewMode(),
        hasNoteOverride: false
    };
}

function createPreviewPanel(noteId) {
    const preview = document.createElement('div');
    preview.className = 'keep-md-preview';
    preview.id = `keep-md-preview-${noteId}`;
    return preview;
}

function createViewModeButton(context, mode) {
    const button = document.createElement('div');
    button.className = `Q0hgme-LgbsSe Q0hgme-Bz112c-LgbsSe keep-md-view-button keep-md-view-${mode} VIpgJd-LgbsSe`;
    button.dataset.viewMode = mode;
    button.setAttribute('role', 'button');
    button.setAttribute('tabindex', '0');
    return button;
}

function createViewModeControls(context) {
    const controls = document.createElement('div');
    controls.className = 'keep-md-view-controls';

    for (const mode of VIEW_MODES) {
        controls.appendChild(createViewModeButton(context, mode));
    }

    controls.addEventListener('pointerdown', stopKeepEvent, true);
    controls.addEventListener('mousedown', stopKeepEvent, true);
    controls.addEventListener('touchstart', stopKeepEvent, true);
    controls.addEventListener('click', function(event) {
        const button = event.target.closest('.keep-md-view-button');
        if (!button || !controls.contains(button)) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();
        setNoteViewMode(context, button.dataset.viewMode);
    }, true);
    controls.addEventListener('keydown', function(event) {
        if (event.key !== 'Enter' && event.key !== ' ') {
            return;
        }

        const button = event.target.closest('.keep-md-view-button');
        if (!button || !controls.contains(button)) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();
        setNoteViewMode(context, button.dataset.viewMode);
    }, true);

    return controls;
}

function stopKeepEvent(event) {
    event.stopPropagation();
}

function ensureViewModeControls(context) {
    if (context.viewControls?.isConnected) {
        updateViewModeControls(context);
        return;
    }

    context.modalNote.querySelector('.keep-md-view-controls')?.remove();

    const pinButton = context.modalNote.querySelector(PIN_BUTTON_SELECTOR);
    if (!pinButton?.parentElement) {
        return;
    }

    const controls = createViewModeControls(context);
    pinButton.parentElement.insertBefore(controls, pinButton);
    context.viewControls = controls;
    updateViewModeControls(context);
}

function updateViewModeControls(context) {
    if (!context.viewControls) {
        return;
    }

    context.viewControls.dataset.viewMode = context.viewMode;

    for (const button of context.viewControls.querySelectorAll('.keep-md-view-button')) {
        const mode = button.dataset.viewMode;
        const isActive = mode === context.viewMode;
        const label = VIEW_MODE_LABELS[mode];

        button.classList.toggle('is-active', isActive);
        button.setAttribute('aria-pressed', String(isActive));
        button.setAttribute('aria-label', label);
        button.setAttribute('data-tooltip-text', label);
    }
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
    context.sourceColumn.classList.remove('keep-md-source-hidden');
    context.container = null;
    context.preview = null;
}

function applyViewMode(context) {
    updateViewModeControls(context);

    if (context.viewMode === VIEW_MODE_EDITOR) {
        removeMarkdownPreview(context);
        return;
    }

    showMarkdownPreview(context);

    const isPreviewOnly = context.viewMode === VIEW_MODE_PREVIEW;
    context.container?.classList.toggle('is-preview-only', isPreviewOnly);
    context.sourceColumn.classList.toggle('keep-md-source-hidden', isPreviewOnly);
}

async function setNoteViewMode(context, mode) {
    if (!isValidViewMode(mode)) {
        return;
    }

    context.viewMode = mode;
    context.hasNoteOverride = Boolean(context.modeStorageKey);

    applyViewMode(context);
    if (context.modeStorageKey) {
        await setLocalStorage({[context.modeStorageKey]: mode});
    }
}

function getCurrentModalParts(modalNote) {
    const noteContentMatch = findNoteContent(modalNote);
    if (!noteContentMatch) {
        return null;
    }

    return {
        noteContent: noteContentMatch.element,
        sourceColumn: getSourceColumn(noteContentMatch.element),
        noteKey: getLocationNoteKey()
    };
}

function isContextStale(context, currentParts) {
    if (!currentParts) {
        return !context.sourceColumn.isConnected || !context.modalNote.contains(context.sourceColumn);
    }

    if (currentParts.noteKey && currentParts.noteKey !== context.noteKey) {
        return true;
    }

    return !context.sourceColumn.isConnected ||
        !context.modalNote.contains(context.sourceColumn) ||
        currentParts.sourceColumn !== context.sourceColumn;
}

function rebuildContext(context) {
    removeMarkdownPreview(context);
    context.viewControls?.remove();
    destroyContext(context);
    handleNoteOpen(context.modalNote);
}

async function handleNoteOpen(modalNote) {
    const existingContext = modalContexts.get(modalNote);
    if (existingContext) {
        const currentParts = getCurrentModalParts(modalNote);
        if (isContextStale(existingContext, currentParts)) {
            rebuildContext(existingContext);
            return;
        }

        ensureViewModeControls(existingContext);
        applyViewMode(existingContext);
        return;
    }

    const currentParts = getCurrentModalParts(modalNote);
    if (!currentParts) {
        return;
    }

    const parent = currentParts.sourceColumn.parentElement;
    if (!parent) {
        return;
    }

    const context = {
        modalNote,
        sourceColumn: currentParts.sourceColumn,
        noteKey: currentParts.noteKey,
        modeStorageKey: getNoteModeStorageKey(currentParts.noteKey),
        viewMode: getDefaultViewMode(),
        hasNoteOverride: false,
        container: null,
        preview: null,
        observer: null,
        viewControls: null
    };

    modalContexts.set(modalNote, context);
    modalContextSet.add(context);
    ensureViewModeControls(context);

    const preference = await loadViewModePreference(context.modeStorageKey);
    if (!modalNote.isConnected) {
        destroyContext(context);
        return;
    }

    context.viewMode = preference.viewMode;
    context.hasNoteOverride = preference.hasNoteOverride;
    applyViewMode(context);
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

        context.viewMode = getDefaultViewMode();
        applyViewMode(context);
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
        if (!context.modeStorageKey) {
            continue;
        }

        const change = changes[context.modeStorageKey];
        if (!change) {
            continue;
        }

        context.hasNoteOverride = hasOwn(change, 'newValue');
        context.viewMode = context.hasNoteOverride && isValidViewMode(change.newValue)
            ? change.newValue
            : getDefaultViewMode();
        applyViewMode(context);
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
