import {micromark} from 'micromark';
import {gfm, gfmHtml} from 'micromark-extension-gfm';
import {math, mathHtml} from 'micromark-extension-math';
import {
    clampNumber,
    findFirstMatchingElement,
    getLocalStorage,
    getMarkdownText,
    getSyncStorage,
    hasOwn,
    setLocalStorage,
    setSyncStorage,
    shouldIgnoreMutations
} from './utils.js';
import {
    DEFAULT_EDITOR_MODAL_WIDTH,
    DEFAULT_MARKDOWN_ENABLED_KEY,
    DEFAULT_MARKDOWN_MODAL_WIDTH,
    EDITOR_MODAL_WIDTH_KEY,
    EXTENSION_OWNED_SELECTOR,
    MARKDOWN_MODAL_WIDTH_KEY,
    MAX_MODAL_WIDTH,
    MIN_MODAL_WIDTH,
    MODAL_SELECTOR,
    NOTE_CONTENT_SELECTORS,
    NOTE_MARKDOWN_MODE_PREFIX,
    NOTE_SOURCE_COLUMN_SELECTOR,
    PIN_BUTTON_SELECTOR,
    VIEW_MODE_EDITOR,
    VIEW_MODE_LABELS,
    VIEW_MODE_PREVIEW,
    VIEW_MODE_SPLIT,
    VIEW_MODES
} from './constants.js';

console.log('Keep Markdown extension loaded!');

// Current synced modal width for editor-only mode.
let currentEditorModalWidth = DEFAULT_EDITOR_MODAL_WIDTH;

// Current synced modal width for modes that include markdown preview.
let currentMarkdownModalWidth = DEFAULT_MARKDOWN_MODAL_WIDTH;

// Global default for opening notes in markdown mode.
let defaultMarkdownEnabled = true;

// Guards document-wide modal scans so multiple mutations collapse into one pass.
let scanScheduled = false;

// Stores one live context per Keep modal element.
const modalContexts = new WeakMap();

// Iterable set of live modal contexts for cleanup and storage sync updates.
const modalContextSet = new Set();

// Google Keep's editor markup changes often, so selectors are tried from oldest to newest.
function findNoteContent(root) {
    return findFirstMatchingElement(root, NOTE_CONTENT_SELECTORS);
}

// Finds the Keep layout column that owns the editor node.
function getSourceColumn(noteContent) {
    return noteContent.closest(NOTE_SOURCE_COLUMN_SELECTOR) || noteContent;
}

// Keep exposes a stable note id in the URL hash while a note is open.
function getLocationNoteKey() {
    const match = window.location.hash.match(/^#(?:NOTE|LIST)\/([^/?#&]+)/i);
    return match?.[1] ? `hash:${match[1]}` : null;
}

// Returns the default mode to use when a note has no per-note override.
function getDefaultViewMode() {
    return defaultMarkdownEnabled ? VIEW_MODE_SPLIT : VIEW_MODE_EDITOR;
}

// Validates values loaded from storage before applying them to the note.
function isValidViewMode(mode) {
    return VIEW_MODES.includes(mode);
}

// Builds the per-note local storage key for view mode persistence.
function getNoteModeStorageKey(noteKey) {
    return noteKey ? `${NOTE_MARKDOWN_MODE_PREFIX}${noteKey}` : null;
}

// Editor mode and markdown modes intentionally keep separate modal width preferences.
function normalizeModalWidth(width, fallback) {
    return clampNumber(width, MIN_MODAL_WIDTH, MAX_MODAL_WIDTH, fallback);
}

// Maps note view modes to the width preference bucket they should use.
function getModalWidthTarget(mode) {
    return mode === VIEW_MODE_EDITOR ? 'editor' : 'markdown';
}

// Returns the synced storage key for a width preference bucket.
function getModalWidthStorageKey(target) {
    return target === 'editor' ? EDITOR_MODAL_WIDTH_KEY : MARKDOWN_MODAL_WIDTH_KEY;
}

// Returns the current in-memory width for a width preference bucket.
function getModalWidthForTarget(target) {
    return target === 'editor' ? currentEditorModalWidth : currentMarkdownModalWidth;
}

// Returns the current in-memory width used by a note view mode.
function getModalWidthForMode(mode) {
    return getModalWidthForTarget(getModalWidthTarget(mode));
}

// Updates the active in-memory width and refreshes live modals.
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

// Ignore mutations caused by our own injected DOM so preview rendering does not re-trigger scans.
function shouldIgnoreModalScan(mutations) {
    return shouldIgnoreMutations(mutations, EXTENSION_OWNED_SELECTOR);
}

// Loads the per-note mode override or falls back to the global default behavior.
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

// Create preview panel.
function createPreviewPanel(noteId) {
    console.log('Creating preview panel:', noteId);

    const preview = document.createElement('div');
    preview.className = 'keep-md-preview';
    preview.id = `keep-md-preview-${noteId}`;
    return preview;
}

// Creates a single view mode button using Keep-style DOM attributes.
function createViewModeButton(context, mode) {
    const button = document.createElement('div');
    button.className = `Q0hgme-LgbsSe Q0hgme-Bz112c-LgbsSe keep-md-view-button keep-md-view-${mode} VIpgJd-LgbsSe`;
    button.dataset.viewMode = mode;
    button.setAttribute('role', 'button');
    button.setAttribute('tabindex', '0');
    button.title = VIEW_MODE_LABELS[mode];
    return button;
}

// Insert the Editor / Split / Preview buttons next to Keep's native pin control.
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

// Stops Keep's own delegated handlers from treating extension controls as note clicks.
function stopKeepEvent(event) {
    event.stopPropagation();
}

// Ensures the mode switcher exists and stays anchored beside the pin button.
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

// Create a right-edge resize handle that writes back to the active mode's width setting.
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

// Ensures the resize handle exists for the current modal context.
function ensureResizeHandle(context) {
    if (!context.resizeHandle?.isConnected) {
        context.modalNote.querySelector('.keep-md-resize-handle')?.remove();
        context.resizeHandle = createResizeHandle(context);
        context.modalNote.appendChild(context.resizeHandle);
    }

    updateResizeHandle(context);
}

// Updates resize handle labels and ARIA value for the active note mode.
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

// Refreshes resize handle labels after settings change.
function updateAllResizeHandles() {
    for (const context of modalContextSet) {
        updateResizeHandle(context);
    }
}

// Converts a pointer x-coordinate into centered viewport width percentage.
function getWidthFromPointer(clientX) {
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
    const modalHalfWidth = clientX - (viewportWidth / 2);
    return (modalHalfWidth * 2 / viewportWidth) * 100;
}

// Handles drag resizing and persists the final width to sync storage.
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

// Allows keyboard users to adjust modal width with arrow keys.
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

// Reflects the active view mode in button classes and accessibility labels.
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

// Renders markdown into the preview panel when the source text changes.
function updatePreview(context) {
    if (!context.preview) {
        return;
    }

    const latestNoteContentMatch = findNoteContent(context.sourceColumn) || findNoteContent(context.modalNote);
    if (!latestNoteContentMatch) {
        return;
    }

    const markdownText = getMarkdownText(latestNoteContentMatch.element);
    // Avoid rewriting preview DOM when Keep re-scans the same unchanged note content.
    if (context.lastMarkdownText === markdownText && context.preview.hasChildNodes()) {
        return;
    }

    context.lastMarkdownText = markdownText;
    context.preview.innerHTML = micromark(markdownText, {
        extensions: [gfm(), math()],
        htmlExtensions: [gfmHtml(), mathHtml()]
    });
}

// Creates the split layout and attaches the live markdown preview panel.
function showMarkdownPreview(context) {
    // If the preview already exists, only refresh its content.
    if (context.preview?.isConnected) {
        updatePreview(context);
        return;
    }

    const parent = context.sourceColumn.parentElement;
    if (!parent) {
        return;
    }

    // Create a flex container for side-by-side layout.
    const container = document.createElement('div');
    container.className = 'keep-md-container';

    // Move the note content into the container.
    context.sourceColumn.classList.add('keep-md-source');
    parent.insertBefore(container, context.sourceColumn);
    container.appendChild(context.sourceColumn);

    // Create preview.
    context.container = container;
    context.preview = createPreviewPanel(Date.now());
    context.lastMarkdownText = null;
    container.appendChild(context.preview);

    // Watch for content changes.
    context.observer = new MutationObserver(() => {
        updatePreview(context);
    });

    context.observer.observe(context.sourceColumn, {
        childList: true,
        characterData: true,
        subtree: true
    });

    // Initial render.
    updatePreview(context);
    console.log('Preview added:', context.preview.id);
}

// Removes preview DOM and restores the editor column to Keep's modal tree.
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

// Applies mode-specific classes to the Keep modal for CSS targeting.
function updateModalModeClasses(context) {
    context.modalNote.classList.add('keep-md-modal');

    for (const mode of VIEW_MODES) {
        context.modalNote.classList.toggle(`keep-md-mode-${mode}`, mode === context.viewMode);
    }

    context.modalNote.dataset.keepMdViewMode = context.viewMode;
}

// Apply the selected view mode and keep the note-level controls in sync.
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

// Existing modal scans should not re-render markdown unless the editor DOM was rebuilt.
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

// Persists a user-selected note mode and updates the live modal.
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

// Reads the current editor, layout column, and note key from a Keep modal.
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

// Detects when Keep reused a modal shell but replaced the editor subtree.
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

// Tears down stale context state and reopens the modal from current DOM.
function rebuildContext(context) {
    removeMarkdownPreview(context);
    context.viewControls?.remove();
    context.resizeHandle?.remove();
    destroyContext(context);
    handleNoteOpen(context.modalNote);
}

// Initializes or refreshes extension state for a Keep note modal.
async function handleNoteOpen(modalNote) {
    console.log('Modal opened:', modalNote);

    const existingContext = modalContexts.get(modalNote);
    if (existingContext) {
        if (existingContext.preview?.isConnected) {
            console.log('Preview already exists');
        }

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
        console.log('No note content found');
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

// Disconnects observers and removes extension-owned controls for a modal context.
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

// Drops contexts whose Keep modal elements are no longer connected.
function cleanupDisconnectedContexts() {
    for (const context of modalContextSet) {
        if (!context.modalNote.isConnected) {
            destroyContext(context);
        }
    }
}

// Rebuilds the injected modal style from the current width settings.
function updateModalDimensions(widths = {}) {
    // Update stored width values before regenerating the modal override style.
    if (hasOwn(widths, EDITOR_MODAL_WIDTH_KEY)) {
        currentEditorModalWidth = normalizeModalWidth(widths[EDITOR_MODAL_WIDTH_KEY], currentEditorModalWidth);
    }

    if (hasOwn(widths, MARKDOWN_MODAL_WIDTH_KEY)) {
        currentMarkdownModalWidth = normalizeModalWidth(widths[MARKDOWN_MODAL_WIDTH_KEY], currentMarkdownModalWidth);
    }

    const style = document.createElement('style');
    style.textContent = `
        /* Target the outer modal container. */
        .VIpgJd-TUo6Hb.XKSfm-L9AdLc.keep-md-modal {
            position: fixed !important;
            height: auto !important;
            max-height: 95vh !important;
            left: 50% !important;
            top: 50% !important;
            transform: translate(-50%, -50%) !important;
            overflow: visible !important;
        }

        /* Editor-only width. */
        .VIpgJd-TUo6Hb.XKSfm-L9AdLc.keep-md-mode-editor {
            width: ${currentEditorModalWidth}vw !important;
        }

        /* Shared width for Editor and Preview / Preview modes. */
        .VIpgJd-TUo6Hb.XKSfm-L9AdLc.keep-md-mode-split,
        .VIpgJd-TUo6Hb.XKSfm-L9AdLc.keep-md-mode-preview {
            width: ${currentMarkdownModalWidth}vw !important;
        }

        /* Allow modal to scroll if content is very tall. */
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

        /* Container takes natural height. */
        .keep-md-container {
            height: auto !important;
        }
    `;

    // Remove any previous style element we added.
    const existingStyle = document.getElementById('keep-md-modal-style');
    if (existingStyle) {
        existingStyle.remove();
    }

    style.id = 'keep-md-modal-style';
    document.head.appendChild(style);
}

// Reapplies the global default mode to notes that do not have per-note overrides.
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

// Handles direct messages from the popup without waiting for storage change events.
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

// Synchronizes live modals when popup settings or note mode overrides change.
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

// Initializes settings, performs the first modal scan, and starts watching Keep DOM changes.
function init() {
    console.log('Initializing Keep Markdown');

    // Load saved settings.
    chrome.storage.sync.get([
        EDITOR_MODAL_WIDTH_KEY,
        MARKDOWN_MODAL_WIDTH_KEY,
        DEFAULT_MARKDOWN_ENABLED_KEY
    ], function(result) {
        currentEditorModalWidth = normalizeModalWidth(result[EDITOR_MODAL_WIDTH_KEY], DEFAULT_EDITOR_MODAL_WIDTH);
        currentMarkdownModalWidth = normalizeModalWidth(result[MARKDOWN_MODAL_WIDTH_KEY], DEFAULT_MARKDOWN_MODAL_WIDTH);
        defaultMarkdownEnabled = result[DEFAULT_MARKDOWN_ENABLED_KEY] !== false;
        updateModalDimensions();
        if (document.querySelector(MODAL_SELECTOR)) {
            console.log('Found existing modal');
        }

        scanOpenModals();
    });

    // Watch for Keep opening or rebuilding note modals.
    const observer = new MutationObserver((mutations) => {
        console.log('Mutation detected:', mutations.length, 'changes');

        if (shouldIgnoreModalScan(mutations)) {
            return;
        }

        for (const mutation of mutations) {
            for (const node of mutation.addedNodes) {
                if (node.classList?.contains(MODAL_SELECTOR.slice(1))) {
                    console.log('Modal added:', node);
                }
            }

            if (
                mutation.type === 'attributes' &&
                mutation.target.classList?.contains(MODAL_SELECTOR.slice(1))
            ) {
                console.log('Modal attributes changed:', mutation.target);
            }
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

// Scans the document for currently open Keep note modals.
function scanOpenModals() {
    cleanupDisconnectedContexts();

    const modals = document.querySelectorAll(MODAL_SELECTOR);
    for (const modal of modals) {
        handleNoteOpen(modal);
    }
}

// Debounce document-wide scans into a single animation frame.
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
