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
const EDITOR_MODAL_WIDTH_KEY = 'editorModalWidth';
const MARKDOWN_MODAL_WIDTH_KEY = 'markdownModalWidth';
const DEFAULT_MARKDOWN_ENABLED_KEY = 'defaultMarkdownEnabled';
const NOTE_MARKDOWN_MODE_PREFIX = 'noteMarkdownMode:';
const DEFAULT_EDITOR_MODAL_WIDTH = 64;
const DEFAULT_MARKDOWN_MODAL_WIDTH = 75;
const MIN_MODAL_WIDTH = 50;
const MAX_MODAL_WIDTH = 95;
const VIEW_MODE_EDITOR = 'editor';
const VIEW_MODE_SPLIT = 'split';
const VIEW_MODE_PREVIEW = 'preview';
const VIEW_MODES = [VIEW_MODE_EDITOR, VIEW_MODE_SPLIT, VIEW_MODE_PREVIEW];
const VIEW_MODE_LABELS = {
    [VIEW_MODE_EDITOR]: 'Editor',
    [VIEW_MODE_SPLIT]: 'Editor and Preview',
    [VIEW_MODE_PREVIEW]: 'Preview'
};

let currentEditorModalWidth = DEFAULT_EDITOR_MODAL_WIDTH;
let currentMarkdownModalWidth = DEFAULT_MARKDOWN_MODAL_WIDTH;
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

function setSyncStorage(items) {
    return new Promise((resolve) => {
        chrome.storage.sync.set(items, resolve);
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

function normalizeModalWidth(width, fallback) {
    const numericWidth = Number(width);
    if (!Number.isFinite(numericWidth)) {
        return fallback;
    }

    return Math.min(MAX_MODAL_WIDTH, Math.max(MIN_MODAL_WIDTH, Math.round(numericWidth)));
}

function getModalWidthTarget(mode) {
    return mode === VIEW_MODE_EDITOR ? 'editor' : 'markdown';
}

function getModalWidthStorageKey(target) {
    return target === 'editor' ? EDITOR_MODAL_WIDTH_KEY : MARKDOWN_MODAL_WIDTH_KEY;
}

function getModalWidthForTarget(target) {
    return target === 'editor' ? currentEditorModalWidth : currentMarkdownModalWidth;
}

function getModalWidthForMode(mode) {
    return getModalWidthForTarget(getModalWidthTarget(mode));
}

function setModalWidthForTarget(target, width) {
    const fallback = getModalWidthForTarget(target);
    const normalizedWidth = normalizeModalWidth(width, fallback);

    if (target === 'editor') {
        currentEditorModalWidth = normalizedWidth;
    } else {
        currentMarkdownModalWidth = normalizedWidth;
    }

    updateModalDimensions();
    updateAllResizeHandles();

    return normalizedWidth;
}

function getMutationElement(mutation) {
    if (mutation.target.nodeType === Node.ELEMENT_NODE) {
        return mutation.target;
    }

    return mutation.target.parentElement;
}

function isExtensionOwnedElement(element) {
    return Boolean(element?.closest?.(
        '.keep-md-preview, .keep-md-view-controls, .keep-md-resize-handle'
    ));
}

function shouldIgnoreModalScan(mutations) {
    return mutations.length > 0 && mutations.every((mutation) => {
        if (isExtensionOwnedElement(getMutationElement(mutation))) {
            return true;
        }

        const addedNodes = Array.from(mutation.addedNodes || []);
        const removedNodes = Array.from(mutation.removedNodes || []);
        const changedNodes = [...addedNodes, ...removedNodes];
        return changedNodes.length > 0 && changedNodes.every((node) => {
            if (node.nodeType !== Node.ELEMENT_NODE) {
                return true;
            }

            return isExtensionOwnedElement(node);
        });
    });
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
    button.title = VIEW_MODE_LABELS[mode];
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

function createResizeHandle(context) {
    const handle = document.createElement('button');
    handle.type = 'button';
    handle.className = 'keep-md-resize-handle';
    handle.setAttribute('role', 'separator');
    handle.setAttribute('aria-orientation', 'vertical');
    handle.setAttribute('aria-valuemin', String(MIN_MODAL_WIDTH));
    handle.setAttribute('aria-valuemax', String(MAX_MODAL_WIDTH));

    const grip = document.createElement('span');
    grip.className = 'keep-md-resize-grip';
    handle.appendChild(grip);

    handle.addEventListener('pointerdown', function(event) {
        startModalResize(context, event);
    }, true);
    handle.addEventListener('keydown', function(event) {
        resizeModalFromKeyboard(context, event);
    }, true);
    handle.addEventListener('mousedown', stopKeepEvent, true);
    handle.addEventListener('touchstart', stopKeepEvent, true);
    handle.addEventListener('click', function(event) {
        event.preventDefault();
        event.stopPropagation();
    }, true);

    return handle;
}

function ensureResizeHandle(context) {
    if (!context.resizeHandle?.isConnected) {
        context.modalNote.querySelector('.keep-md-resize-handle')?.remove();
        context.resizeHandle = createResizeHandle(context);
        context.modalNote.appendChild(context.resizeHandle);
    }

    updateResizeHandle(context);
}

function updateResizeHandle(context) {
    if (!context.resizeHandle) {
        return;
    }

    const label = VIEW_MODE_LABELS[context.viewMode];
    const value = getModalWidthForMode(context.viewMode);
    context.resizeHandle.setAttribute('aria-label', `Resize ${label} width`);
    context.resizeHandle.setAttribute('aria-valuenow', String(value));
    context.resizeHandle.title = `Resize ${label} width`;
}

function updateAllResizeHandles() {
    for (const context of modalContextSet) {
        updateResizeHandle(context);
    }
}

function getWidthFromPointer(clientX) {
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
    const modalHalfWidth = clientX - (viewportWidth / 2);
    return (modalHalfWidth * 2 / viewportWidth) * 100;
}

function startModalResize(context, event) {
    if (event.button !== undefined && event.button !== 0) {
        return;
    }

    const target = getModalWidthTarget(context.viewMode);
    const storageKey = getModalWidthStorageKey(target);
    let pendingWidth = getModalWidthForTarget(target);

    event.preventDefault();
    event.stopPropagation();
    context.resizeHandle?.classList.add('is-dragging');
    document.documentElement.classList.add('keep-md-is-resizing');

    const applyPointerWidth = (clientX) => {
        pendingWidth = setModalWidthForTarget(target, getWidthFromPointer(clientX));
    };

    const onPointerMove = (moveEvent) => {
        if (moveEvent.pointerId !== event.pointerId) {
            return;
        }

        moveEvent.preventDefault();
        applyPointerWidth(moveEvent.clientX);
    };

    const finishResize = async (finishEvent) => {
        if (finishEvent.pointerId !== event.pointerId) {
            return;
        }

        document.removeEventListener('pointermove', onPointerMove, true);
        document.removeEventListener('pointerup', finishResize, true);
        document.removeEventListener('pointercancel', finishResize, true);
        document.documentElement.classList.remove('keep-md-is-resizing');
        context.resizeHandle?.classList.remove('is-dragging');

        await setSyncStorage({[storageKey]: String(pendingWidth)});
    };

    context.resizeHandle?.setPointerCapture?.(event.pointerId);
    applyPointerWidth(event.clientX);
    document.addEventListener('pointermove', onPointerMove, true);
    document.addEventListener('pointerup', finishResize, true);
    document.addEventListener('pointercancel', finishResize, true);
}

function resizeModalFromKeyboard(context, event) {
    const target = getModalWidthTarget(context.viewMode);
    const storageKey = getModalWidthStorageKey(target);
    const step = event.shiftKey ? 5 : 1;
    let width = getModalWidthForTarget(target);

    if (event.key === 'ArrowLeft') {
        width -= step;
    } else if (event.key === 'ArrowRight') {
        width += step;
    } else if (event.key === 'Home') {
        width = MIN_MODAL_WIDTH;
    } else if (event.key === 'End') {
        width = MAX_MODAL_WIDTH;
    } else {
        return;
    }

    event.preventDefault();
    event.stopPropagation();

    const normalizedWidth = setModalWidthForTarget(target, width);
    setSyncStorage({[storageKey]: String(normalizedWidth)});
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
        button.title = label;
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
    if (context.lastMarkdownText === markdownText && context.preview.hasChildNodes()) {
        return;
    }

    context.lastMarkdownText = markdownText;
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
    context.lastMarkdownText = null;
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
    context.lastMarkdownText = null;
}

function updateModalModeClasses(context) {
    context.modalNote.classList.add('keep-md-modal');

    for (const mode of VIEW_MODES) {
        context.modalNote.classList.toggle(`keep-md-mode-${mode}`, mode === context.viewMode);
    }

    context.modalNote.dataset.keepMdViewMode = context.viewMode;
}

function applyViewMode(context) {
    updateModalModeClasses(context);
    ensureResizeHandle(context);
    updateViewModeControls(context);

    if (context.viewMode === VIEW_MODE_EDITOR) {
        removeMarkdownPreview(context);
        updateResizeHandle(context);
        return;
    }

    showMarkdownPreview(context);

    const isPreviewOnly = context.viewMode === VIEW_MODE_PREVIEW;
    context.container?.classList.toggle('is-preview-only', isPreviewOnly);
    context.sourceColumn.classList.toggle('keep-md-source-hidden', isPreviewOnly);
    updateResizeHandle(context);
}

function syncExistingContext(context) {
    updateModalModeClasses(context);
    ensureResizeHandle(context);
    ensureViewModeControls(context);
    updateViewModeControls(context);
    updateResizeHandle(context);

    if (context.viewMode === VIEW_MODE_EDITOR) {
        if (context.preview?.isConnected || context.container?.isConnected) {
            removeMarkdownPreview(context);
        }
        return;
    }

    if (!context.preview?.isConnected || !context.container?.isConnected) {
        applyViewMode(context);
        return;
    }

    const isPreviewOnly = context.viewMode === VIEW_MODE_PREVIEW;
    context.container.classList.toggle('is-preview-only', isPreviewOnly);
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
    context.resizeHandle?.remove();
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

        syncExistingContext(existingContext);
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
        viewControls: null,
        resizeHandle: null,
        lastMarkdownText: null
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

    context.viewControls?.remove();
    context.resizeHandle?.remove();
    context.modalNote.classList.remove('keep-md-modal');
    for (const mode of VIEW_MODES) {
        context.modalNote.classList.remove(`keep-md-mode-${mode}`);
    }
    delete context.modalNote.dataset.keepMdViewMode;

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

function updateModalDimensions(widths = {}) {
    if (hasOwn(widths, EDITOR_MODAL_WIDTH_KEY)) {
        currentEditorModalWidth = normalizeModalWidth(widths[EDITOR_MODAL_WIDTH_KEY], currentEditorModalWidth);
    }

    if (hasOwn(widths, MARKDOWN_MODAL_WIDTH_KEY)) {
        currentMarkdownModalWidth = normalizeModalWidth(widths[MARKDOWN_MODAL_WIDTH_KEY], currentMarkdownModalWidth);
    }

    const style = document.createElement('style');
    style.textContent = `
        .VIpgJd-TUo6Hb.XKSfm-L9AdLc.keep-md-modal {
            position: fixed !important;
            height: auto !important;
            max-height: 95vh !important;
            left: 50% !important;
            top: 50% !important;
            transform: translate(-50%, -50%) !important;
            overflow: visible !important;
        }

        .VIpgJd-TUo6Hb.XKSfm-L9AdLc.keep-md-mode-editor {
            width: ${currentEditorModalWidth}vw !important;
        }

        .VIpgJd-TUo6Hb.XKSfm-L9AdLc.keep-md-mode-split,
        .VIpgJd-TUo6Hb.XKSfm-L9AdLc.keep-md-mode-preview {
            width: ${currentMarkdownModalWidth}vw !important;
        }

        .VIpgJd-TUo6Hb.XKSfm-L9AdLc.keep-md-modal .IZ65Hb-n0tgWb,
        .VIpgJd-TUo6Hb.XKSfm-L9AdLc.keep-md-modal .IZ65Hb-TBnied,
        .VIpgJd-TUo6Hb.XKSfm-L9AdLc.keep-md-modal .IZ65Hb-s2gQvd,
        .VIpgJd-TUo6Hb.XKSfm-L9AdLc.keep-md-modal .IZ65Hb-r4nke-haAclf,
        .VIpgJd-TUo6Hb.XKSfm-L9AdLc.keep-md-modal .IZ65Hb-qJTHM-haAclf,
        .VIpgJd-TUo6Hb.XKSfm-L9AdLc.keep-md-modal .fmcmS-h1U9Be-LS81yb {
            width: 100% !important;
            max-width: none !important;
            height: auto !important;
            overflow-y: auto !important;
            box-sizing: border-box !important;
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
    if (message.type === 'updateModalWidths') {
        updateModalDimensions({
            [EDITOR_MODAL_WIDTH_KEY]: message.editorWidth,
            [MARKDOWN_MODAL_WIDTH_KEY]: message.markdownWidth
        });
        updateAllResizeHandles();
        return;
    }

    if (message.type === 'updateDefaultMarkdownEnabled') {
        defaultMarkdownEnabled = message.value !== false;
        refreshDefaultMarkdownContexts();
    }
});

chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'sync') {
        let dimensionsChanged = false;

        if (changes[EDITOR_MODAL_WIDTH_KEY]) {
            currentEditorModalWidth = normalizeModalWidth(
                changes[EDITOR_MODAL_WIDTH_KEY].newValue,
                currentEditorModalWidth
            );
            dimensionsChanged = true;
        }

        if (changes[MARKDOWN_MODAL_WIDTH_KEY]) {
            currentMarkdownModalWidth = normalizeModalWidth(
                changes[MARKDOWN_MODAL_WIDTH_KEY].newValue,
                currentMarkdownModalWidth
            );
            dimensionsChanged = true;
        }

        if (dimensionsChanged) {
            updateModalDimensions();
            updateAllResizeHandles();
        }

        if (changes[DEFAULT_MARKDOWN_ENABLED_KEY]) {
            defaultMarkdownEnabled = changes[DEFAULT_MARKDOWN_ENABLED_KEY].newValue !== false;
            refreshDefaultMarkdownContexts();
        }

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
    chrome.storage.sync.get([
        EDITOR_MODAL_WIDTH_KEY,
        MARKDOWN_MODAL_WIDTH_KEY,
        DEFAULT_MARKDOWN_ENABLED_KEY
    ], function(result) {
        currentEditorModalWidth = normalizeModalWidth(result[EDITOR_MODAL_WIDTH_KEY], DEFAULT_EDITOR_MODAL_WIDTH);
        currentMarkdownModalWidth = normalizeModalWidth(result[MARKDOWN_MODAL_WIDTH_KEY], DEFAULT_MARKDOWN_MODAL_WIDTH);
        defaultMarkdownEnabled = result[DEFAULT_MARKDOWN_ENABLED_KEY] !== false;
        updateModalDimensions();
        scanOpenModals();
    });

    const observer = new MutationObserver((mutations) => {
        if (shouldIgnoreModalScan(mutations)) {
            return;
        }

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
