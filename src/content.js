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
import {renderMarkdownWithAnchors} from './markdown-renderer.js';
import {
    invalidateScrollSync,
    refreshScrollSync,
    teardownScrollSync
} from './scroll-sync.js';
import {
    applyPreviewTheme,
    normalizePreviewTheme,
    setupPreviewThemeSync
} from './preview-theme.js';
import {
    DEFAULT_EDITOR_MODAL_WIDTH,
    DEFAULT_MARKDOWN_ENABLED_KEY,
    DEFAULT_PREVIEW_MODAL_WIDTH,
    DEFAULT_PRESERVE_SOFT_LINE_BREAKS,
    DEFAULT_SCROLL_SYNC_ENABLED,
    DEFAULT_SPLIT_MODAL_WIDTH,
    EDITOR_MODAL_WIDTH_KEY,
    EXTENSION_OWNED_SELECTOR,
    MAX_EDITOR_MODAL_WIDTH,
    MAX_MARKDOWN_MODAL_WIDTH,
    MIN_EDITOR_MODAL_WIDTH,
    MIN_MARKDOWN_MODAL_WIDTH,
    MODAL_SELECTOR,
    NOTE_CONTENT_SELECTORS,
    NOTE_MARKDOWN_MODE_PREFIX,
    NOTE_SOURCE_COLUMN_SELECTOR,
    PIN_BUTTON_SELECTOR,
    PREVIEW_MODAL_WIDTH_KEY,
    PRESERVE_SOFT_LINE_BREAKS_KEY,
    PREVIEW_THEME_KEY,
    SCROLL_SYNC_ENABLED_KEY,
    SPLIT_MODAL_WIDTH_KEY,
    VIEW_MODE_EDITOR,
    VIEW_MODE_LABELS,
    VIEW_MODE_PREVIEW,
    VIEW_MODE_SPLIT,
    VIEW_MODES
} from './constants.js';

console.log('Keep Markdown extension loaded!');

// Current synced modal width for editor-only mode.
let currentEditorModalWidth = DEFAULT_EDITOR_MODAL_WIDTH;

// Current synced modal width for split editor-preview mode.
let currentSplitModalWidth = DEFAULT_SPLIT_MODAL_WIDTH;

// Current synced modal width for preview-only mode.
let currentPreviewModalWidth = DEFAULT_PREVIEW_MODAL_WIDTH;

// Global default for opening notes in markdown mode.
let defaultMarkdownEnabled = true;

// Current synced paragraph line break preference for markdown panels.
let preserveSoftLineBreaks = DEFAULT_PRESERVE_SOFT_LINE_BREAKS;

// Current synced preference for editor-to-preview scroll alignment.
let scrollSyncEnabled = DEFAULT_SCROLL_SYNC_ENABLED;

// Guards document-wide modal scans so multiple mutations collapse into one pass.
let scanScheduled = false;

// Split panes need a minimum fixed viewport before editor-to-preview scroll sync can work.
const MIN_SPLIT_PANE_HEIGHT = 180;

// Leaves room for Keep's footer and modal padding below the split panes.
const SPLIT_PANE_BOTTOM_PADDING = 24;

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

// Applies the paragraph white-space mode used by markdown preview blocks.
function applySoftLineBreakPreference(enabled = preserveSoftLineBreaks) {
    const root = document.documentElement;

    preserveSoftLineBreaks = enabled === true;
    root.style.setProperty(
        '--keep-md-preview-paragraph-white-space',
        preserveSoftLineBreaks ? 'pre-line' : 'normal'
    );
}

// Validates values loaded from storage before applying them to the note.
function isValidViewMode(mode) {
    return VIEW_MODES.includes(mode);
}

// Builds the per-note local storage key for view mode persistence.
function getNoteModeStorageKey(noteKey) {
    return noteKey ? `${NOTE_MARKDOWN_MODE_PREFIX}${noteKey}` : null;
}

// Maps note view modes to the width preference bucket they should use.
function getModalWidthTarget(mode) {
    if (mode === VIEW_MODE_PREVIEW) {
        return 'preview';
    }

    return mode === VIEW_MODE_EDITOR ? 'editor' : 'split';
}

// Returns the synced storage key for a width preference bucket.
function getModalWidthStorageKey(target) {
    if (target === 'editor') {
        return EDITOR_MODAL_WIDTH_KEY;
    }

    return target === 'preview' ? PREVIEW_MODAL_WIDTH_KEY : SPLIT_MODAL_WIDTH_KEY;
}

// Returns the min/max range for a width preference bucket.
function getModalWidthLimits(target) {
    if (target === 'editor') {
        return {
            min: MIN_EDITOR_MODAL_WIDTH,
            max: MAX_EDITOR_MODAL_WIDTH
        };
    }

    return {
        min: MIN_MARKDOWN_MODAL_WIDTH,
        max: MAX_MARKDOWN_MODAL_WIDTH
    };
}

// Editor width is pixel-based; Split and Preview widths are viewport percentages.
function getModalWidthUnit(target) {
    return target === 'editor' ? 'px' : '%';
}

// Validates values loaded from storage before applying them to the note.
function normalizeModalWidth(target, width, fallback) {
    const limits = getModalWidthLimits(target);

    return clampNumber(width, limits.min, limits.max, fallback);
}

// Returns the current in-memory width for a width preference bucket.
function getModalWidthForTarget(target) {
    if (target === 'editor') {
        return currentEditorModalWidth;
    }

    return target === 'preview' ? currentPreviewModalWidth : currentSplitModalWidth;
}

// Returns the current in-memory width used by a note view mode.
function getModalWidthForMode(mode) {
    return getModalWidthForTarget(getModalWidthTarget(mode));
}

// Updates the active in-memory width and refreshes live modals.
function setModalWidthForTarget(target, width) {
    const fallback = getModalWidthForTarget(target);
    const normalizedWidth = normalizeModalWidth(target, width, fallback);

    if (target === 'editor') {
        currentEditorModalWidth = normalizedWidth;
    } else if (target === 'preview') {
        currentPreviewModalWidth = normalizedWidth;
    } else {
        currentSplitModalWidth = normalizedWidth;
    }

    updateModalDimensions();
    updateAllResizeHandles();
    refreshAllScrollSyncContexts();

    return normalizedWidth;
}

// Ignore extension-owned DOM and class churn on managed modals so scans only run for real Keep changes.
function shouldIgnoreModalScan(mutations) {
    return mutations.length > 0 && mutations.every((mutation) => {
        if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
            const managedModal = mutation.target.closest?.(MODAL_SELECTOR);
            if (managedModal && modalContexts.has(managedModal)) {
                return true;
            }
        }

        return shouldIgnoreMutations([mutation], EXTENSION_OWNED_SELECTOR);
    });
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
    preview.className = 'keep-md-preview is-render-pending';
    preview.id = `keep-md-preview-${noteId}`;
    return preview;
}

// Keep's shared modal wheel handlers should not steal wheel gestures from split panes.
function stopSplitPaneWheelPropagation(event) {
    if (canScrollSplitPane(event.currentTarget, event.deltaY)) {
        event.stopPropagation();
    }
}

// Allows wheel events to bubble when the pane is already at an edge.
function canScrollSplitPane(element, deltaY) {
    if (!element || deltaY === 0) {
        return false;
    }

    const maxScrollTop = Math.max(element.scrollHeight - element.clientHeight, 0);
    if (maxScrollTop <= 1) {
        return false;
    }

    return deltaY < 0
        ? element.scrollTop > 1
        : element.scrollTop < maxScrollTop - 1;
}

// Creates a single view mode button using Keep-style DOM attributes.
function createViewModeButton(context, mode) {
    const button = document.createElement('div');
    button.className = `Q0hgme-LgbsSe Q0hgme-Bz112c-LgbsSe keep-md-view-button keep-md-view-${mode} VIpgJd-LgbsSe`;
    button.dataset.viewMode = mode;
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
    handle.className = 'keep-md-resize-handle';

    const grip = document.createElement('span');
    grip.className = 'keep-md-resize-grip';
    handle.appendChild(grip);

    handle.addEventListener('pointerdown', function(event) {
        startModalResize(context, event);
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
    context.resizeHandle.title = `Resize ${label} width`;
}

// Refreshes resize handle labels after settings change.
function updateAllResizeHandles() {
    for (const context of modalContextSet) {
        updateResizeHandle(context);
    }
}

// Attaches wheel isolation only while split preview is active.
function ensureSplitPaneWheelIsolation(context) {
    if (!context.paneWheelListener) {
        context.paneWheelListener = stopSplitPaneWheelPropagation;
    }

    context.sourceColumn?.addEventListener('wheel', context.paneWheelListener, {
        capture: true,
        passive: true
    });
    context.preview?.addEventListener('wheel', context.paneWheelListener, {
        capture: true,
        passive: true
    });
}

// Removes split-pane wheel isolation when the preview is torn down.
function removeSplitPaneWheelIsolation(context) {
    if (!context.paneWheelListener) {
        return;
    }

    context.sourceColumn?.removeEventListener('wheel', context.paneWheelListener, true);
    context.preview?.removeEventListener('wheel', context.paneWheelListener, true);
}

// Removes the split-pane height override when the note is not in split mode.
function clearSplitPaneHeight(context) {
    context.modalNote.style.removeProperty('--keep-md-split-pane-height');
}

// Checks whether a layout box currently contributes visible height inside the modal.
function isVisibleLayoutElement(element) {
    if (!element?.isConnected) {
        return false;
    }

    const style = window.getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden') {
        return false;
    }

    return element.getBoundingClientRect().height > 0;
}

// Measures visible modal chrome below the note body without letting Keep add-ons shrink split panes.
function getReservedSplitPaneHeight(bodySection, modalSurface) {
    let reservedHeight = 0;
    let current = bodySection.parentElement;

    while (current && current !== modalSurface) {
        let sibling = current.nextElementSibling;
        while (sibling) {
            if (isVisibleLayoutElement(sibling)) {
                reservedHeight += sibling.getBoundingClientRect().height;
            }

            sibling = sibling.nextElementSibling;
        }

        current = current.parentElement;
    }

    return reservedHeight;
}

// Uses a viewport-based modal limit so focusing Keep fields cannot recursively resize the panes.
function getModalSurfaceHeightLimit(modalSurface) {
    const viewportLimit = Math.floor(window.innerHeight * 0.95);
    const maxHeight = Number.parseFloat(window.getComputedStyle(modalSurface).maxHeight);

    return Number.isFinite(maxHeight) && maxHeight > 0
        ? Math.min(maxHeight, viewportLimit)
        : viewportLimit;
}

// Converts only the markdown body into two independently scrollable panes.
function updateSplitPaneHeight(context) {
    if (
        context.viewMode !== VIEW_MODE_SPLIT ||
        !context.container?.isConnected ||
        !context.sourceColumn?.isConnected ||
        !context.preview?.isConnected
    ) {
        clearSplitPaneHeight(context);
        return;
    }

    const bodySection = context.sourceColumn.closest('.IZ65Hb-qJTHM-haAclf');
    const modalSurface = context.modalNote.querySelector('.IZ65Hb-n0tgWb') || context.modalNote;
    if (!bodySection || !modalSurface) {
        clearSplitPaneHeight(context);
        return;
    }

    const surfaceRect = modalSurface.getBoundingClientRect();
    const bodyRect = bodySection.getBoundingClientRect();
    const topOffset = Math.max(bodyRect.top - surfaceRect.top, 0);
    const reservedHeight = getReservedSplitPaneHeight(bodySection, modalSurface);
    const availableHeight = Math.floor(
        getModalSurfaceHeightLimit(modalSurface) - topOffset - reservedHeight - SPLIT_PANE_BOTTOM_PADDING
    );
    const splitPaneHeight = Math.max(
        MIN_SPLIT_PANE_HEIGHT,
        Number.isFinite(availableHeight) ? availableHeight : MIN_SPLIT_PANE_HEIGHT
    );
    const nextHeightValue = `${splitPaneHeight}px`;
    if (context.modalNote.style.getPropertyValue('--keep-md-split-pane-height') === nextHeightValue) {
        return;
    }

    const previousEditorScrollTop = context.editorScrollHost?.scrollTop;
    const previousPreviewScrollTop = context.previewScrollHost?.scrollTop;
    context.modalNote.style.setProperty('--keep-md-split-pane-height', nextHeightValue);
    if (Number.isFinite(previousEditorScrollTop) && context.editorScrollHost?.isConnected) {
        context.editorScrollHost.scrollTop = previousEditorScrollTop;
    }
    if (Number.isFinite(previousPreviewScrollTop) && context.previewScrollHost?.isConnected) {
        context.previewScrollHost.scrollTop = previousPreviewScrollTop;
    }
}

// Keeps split-pane layout and scroll sync in lockstep after DOM, width, or viewport changes.
function refreshContextScrollSync(context) {
    updateSplitPaneHeight(context);

    if (scrollSyncEnabled) {
        refreshScrollSync(context);
        return;
    }

    teardownScrollSync(context);
}

// Recomputes split-view scroll sync after width or layout changes.
function refreshAllScrollSyncContexts() {
    for (const context of modalContextSet) {
        refreshContextScrollSync(context);
    }
}

// Converts a pointer x-coordinate into the active mode's width unit.
function getWidthFromPointer(target, clientX) {
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
    const modalHalfWidth = clientX - (viewportWidth / 2);
    const widthPixels = modalHalfWidth * 2;

    return target === 'editor'
        ? widthPixels
        : (widthPixels / viewportWidth) * 100;
}

// Handles drag resizing and persists the final width to sync storage.
function startModalResize(context, event) {
    if (event.button !== undefined && event.button !== 0) {
        return;
    }

    const target = getModalWidthTarget(context.viewMode);
    const storageKey = getModalWidthStorageKey(target);
    let pendingWidth = getModalWidthForTarget(target);
    let didResize = false;

    event.preventDefault();
    event.stopPropagation();
    context.resizeHandle?.classList.add('is-dragging');
    document.documentElement.classList.add('keep-md-is-resizing');

    const applyPointerWidth = (clientX) => {
        pendingWidth = setModalWidthForTarget(target, getWidthFromPointer(target, clientX));
        didResize = true;
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

        if (didResize) {
            await setSyncStorage({[storageKey]: String(pendingWidth)});
        }
    };

    context.resizeHandle?.setPointerCapture?.(event.pointerId);
    document.addEventListener('pointermove', onPointerMove, true);
    document.addEventListener('pointerup', finishResize, true);
    document.addEventListener('pointercancel', finishResize, true);
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
        button.setAttribute('data-tooltip-text', label);
        button.title = label;
    }
}

// Renders markdown into the preview panel when the source text changes.
function updatePreview(context) {
    if (!context.preview) {
        return false;
    }

    const latestNoteContentMatch = findNoteContent(context.sourceColumn) || findNoteContent(context.modalNote);
    if (!latestNoteContentMatch) {
        return false;
    }

    context.noteContent = latestNoteContentMatch.element;
    const markdownText = getMarkdownText(latestNoteContentMatch.element);
    // Avoid rewriting preview DOM when Keep re-scans the same unchanged note content.
    if (context.lastMarkdownText === markdownText && context.preview.hasChildNodes()) {
        return false;
    }

    const renderedPreview = renderMarkdownWithAnchors(markdownText);
    context.lastMarkdownText = markdownText;
    context.preview.innerHTML = renderedPreview.html;
    context.renderedAnchors = renderedPreview.anchors;
    invalidateScrollSync(context);
    return true;
}

// Batches preview renders so mutation bursts only trigger one markdown pass per frame.
function schedulePreviewUpdate(context) {
    if (!context.preview?.isConnected || context.previewUpdateScheduled) {
        return;
    }

    context.previewUpdateScheduled = true;
    requestAnimationFrame(() => {
        context.previewUpdateScheduled = false;
        if (!context.preview?.isConnected) {
            return;
        }

        const didUpdate = updatePreview(context);
        if (didUpdate) {
            refreshContextScrollSync(context);
        }
    });
}

// Creates the split layout and attaches the live markdown preview panel.
function showMarkdownPreview(context) {
    // If the preview already exists, only refresh its content.
    if (context.preview?.isConnected) {
        schedulePreviewUpdate(context);
        return false;
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
    ensureSplitPaneWheelIsolation(context);

    // Initial render.
    updatePreview(context);
    requestAnimationFrame(() => {
        if (!context.preview?.isConnected) {
            return;
        }

        context.preview.classList.remove('is-render-pending');
        refreshContextScrollSync(context);

        if (context.observer || !context.sourceColumn?.isConnected) {
            return;
        }

        // Watch for content changes after the initial split layout settles.
        context.observer = new MutationObserver(() => {
            schedulePreviewUpdate(context);
        });

        context.observer.observe(context.sourceColumn, {
            childList: true,
            characterData: true,
            subtree: true
        });
    });
    console.log('Preview added:', context.preview.id);
    return true;
}

// Removes preview DOM and restores the editor column to Keep's modal tree.
function removeMarkdownPreview(context) {
    teardownScrollSync(context);
    removeSplitPaneWheelIsolation(context);
    clearSplitPaneHeight(context);
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
    context.renderedAnchors = null;
    context.previewUpdateScheduled = false;
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

    const createdPreview = showMarkdownPreview(context);

    const isPreviewOnly = context.viewMode === VIEW_MODE_PREVIEW;
    context.container?.classList.toggle('is-preview-only', isPreviewOnly);
    context.sourceColumn.classList.toggle('keep-md-source-hidden', isPreviewOnly);
    updateResizeHandle(context);
    if (!createdPreview) {
        refreshContextScrollSync(context);
    }
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
    refreshContextScrollSync(context);
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
    const existingContext = modalContexts.get(modalNote);
    if (existingContext) {
        const currentParts = getCurrentModalParts(modalNote);
        if (isContextStale(existingContext, currentParts)) {
            rebuildContext(existingContext);
            return;
        }

        existingContext.noteContent = currentParts?.noteContent || existingContext.noteContent;
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
        noteContent: currentParts.noteContent,
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
        lastMarkdownText: null,
        renderedAnchors: null,
        editorScrollHost: null,
        previewScrollHost: null,
        sourceLineMetrics: null,
        previewAnchorMetrics: null,
        previewUpdateScheduled: false,
        scrollSyncFrame: 0,
        previewResizeObserver: null,
        editorScrollListener: null,
        paneWheelListener: null
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
    teardownScrollSync(context);
    clearSplitPaneHeight(context);
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

// Updates CSS variables consumed by extension/styles.css.
function updateModalDimensions(widths = {}) {
    if (hasOwn(widths, EDITOR_MODAL_WIDTH_KEY)) {
        currentEditorModalWidth = normalizeModalWidth(
            'editor',
            widths[EDITOR_MODAL_WIDTH_KEY],
            currentEditorModalWidth
        );
    }

    if (hasOwn(widths, SPLIT_MODAL_WIDTH_KEY)) {
        currentSplitModalWidth = normalizeModalWidth(
            'split',
            widths[SPLIT_MODAL_WIDTH_KEY],
            currentSplitModalWidth
        );
    }

    if (hasOwn(widths, PREVIEW_MODAL_WIDTH_KEY)) {
        currentPreviewModalWidth = normalizeModalWidth(
            'preview',
            widths[PREVIEW_MODAL_WIDTH_KEY],
            currentPreviewModalWidth
        );
    }

    const root = document.documentElement;
    root.style.setProperty('--keep-md-editor-modal-width', `${currentEditorModalWidth}px`);
    root.style.setProperty('--keep-md-split-modal-width', `${currentSplitModalWidth}vw`);
    root.style.setProperty('--keep-md-preview-modal-width', `${currentPreviewModalWidth}vw`);
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
            [SPLIT_MODAL_WIDTH_KEY]: message.splitWidth,
            [PREVIEW_MODAL_WIDTH_KEY]: message.previewWidth
        });
        updateAllResizeHandles();
        refreshAllScrollSyncContexts();
        return;
    }

    if (message.type === 'updateDefaultMarkdownEnabled') {
        defaultMarkdownEnabled = message.value !== false;
        refreshDefaultMarkdownContexts();
        return;
    }

    if (message.type === 'updatePreviewTheme') {
        applyPreviewTheme(message.value);
        return;
    }

    if (message.type === 'updatePreserveSoftLineBreaks') {
        applySoftLineBreakPreference(message.value);
        refreshAllScrollSyncContexts();
        return;
    }

    if (message.type === 'updateScrollSyncEnabled') {
        scrollSyncEnabled = message.value !== false;
        refreshAllScrollSyncContexts();
    }
});

// Synchronizes live modals when popup settings or note mode overrides change.
chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'sync') {
        let dimensionsChanged = false;

        if (changes[EDITOR_MODAL_WIDTH_KEY]) {
            currentEditorModalWidth = normalizeModalWidth(
                'editor',
                changes[EDITOR_MODAL_WIDTH_KEY].newValue,
                currentEditorModalWidth
            );
            dimensionsChanged = true;
        }

        if (changes[SPLIT_MODAL_WIDTH_KEY]) {
            currentSplitModalWidth = normalizeModalWidth(
                'split',
                changes[SPLIT_MODAL_WIDTH_KEY].newValue,
                currentSplitModalWidth
            );
            dimensionsChanged = true;
        }

        if (changes[PREVIEW_MODAL_WIDTH_KEY]) {
            currentPreviewModalWidth = normalizeModalWidth(
                'preview',
                changes[PREVIEW_MODAL_WIDTH_KEY].newValue,
                currentPreviewModalWidth
            );
            dimensionsChanged = true;
        }

        if (dimensionsChanged) {
            updateModalDimensions();
            updateAllResizeHandles();
            refreshAllScrollSyncContexts();
        }

        if (changes[DEFAULT_MARKDOWN_ENABLED_KEY]) {
            defaultMarkdownEnabled = changes[DEFAULT_MARKDOWN_ENABLED_KEY].newValue !== false;
            refreshDefaultMarkdownContexts();
        }

        if (changes[PREVIEW_THEME_KEY]) {
            applyPreviewTheme(changes[PREVIEW_THEME_KEY].newValue);
        }

        if (changes[PRESERVE_SOFT_LINE_BREAKS_KEY]) {
            applySoftLineBreakPreference(changes[PRESERVE_SOFT_LINE_BREAKS_KEY].newValue);
            refreshAllScrollSyncContexts();
        }

        if (changes[SCROLL_SYNC_ENABLED_KEY]) {
            scrollSyncEnabled = changes[SCROLL_SYNC_ENABLED_KEY].newValue !== false;
            refreshAllScrollSyncContexts();
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
    setupPreviewThemeSync();

    // Load saved settings.
    chrome.storage.sync.get([
        EDITOR_MODAL_WIDTH_KEY,
        SPLIT_MODAL_WIDTH_KEY,
        PREVIEW_MODAL_WIDTH_KEY,
        DEFAULT_MARKDOWN_ENABLED_KEY,
        PREVIEW_THEME_KEY,
        PRESERVE_SOFT_LINE_BREAKS_KEY,
        SCROLL_SYNC_ENABLED_KEY
    ], function(result) {
        currentEditorModalWidth = normalizeModalWidth(
            'editor',
            result[EDITOR_MODAL_WIDTH_KEY],
            DEFAULT_EDITOR_MODAL_WIDTH
        );
        currentSplitModalWidth = normalizeModalWidth(
            'split',
            result[SPLIT_MODAL_WIDTH_KEY],
            DEFAULT_SPLIT_MODAL_WIDTH
        );
        currentPreviewModalWidth = normalizeModalWidth(
            'preview',
            result[PREVIEW_MODAL_WIDTH_KEY],
            DEFAULT_PREVIEW_MODAL_WIDTH
        );
        defaultMarkdownEnabled = result[DEFAULT_MARKDOWN_ENABLED_KEY] !== false;
        const previewTheme = normalizePreviewTheme(result[PREVIEW_THEME_KEY]);
        preserveSoftLineBreaks = result[PRESERVE_SOFT_LINE_BREAKS_KEY] === true;
        scrollSyncEnabled = result[SCROLL_SYNC_ENABLED_KEY] !== false;
        applyPreviewTheme(previewTheme);
        applySoftLineBreakPreference(preserveSoftLineBreaks);
        updateModalDimensions();
        scanOpenModals();
    });

    // Watch for Keep opening or rebuilding note modals.
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

    // Resize the split panes when the viewport changes so scroll hosts stay valid.
    window.addEventListener('resize', refreshAllScrollSyncContexts);
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
