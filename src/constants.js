// Google Keep's note modal shell.
export const MODAL_SELECTOR = '.VIpgJd-TUo6Hb';

// Ordered editor selectors used across old and current Keep DOM shapes.
export const NOTE_CONTENT_SELECTORS = [
    '.h1U9Be-YPqjbf',
    '.IZ65Hb-vIzZGf-L9AdLc-haAclf',
    '.IZ65Hb-qJTHM-haAclf [role="combobox"]',
    '.IZ65Hb-qJTHM-haAclf [role="textbox"]:not([aria-label="Title"])',
    '[contenteditable="true"][aria-multiline="true"][role="textbox"]:not([aria-label="Title"])'
];

// Closest layout column that should move into the markdown split container.
export const NOTE_SOURCE_COLUMN_SELECTOR = '.IZ65Hb-qJTHM-haAclf, .fmcmS-h1U9Be-LS81yb';

// Keep's native pin button anchor where the view mode controls are inserted.
export const PIN_BUTTON_SELECTOR = '.IZ65Hb-s2gQvd > [aria-label="Pin note"], .IZ65Hb-s2gQvd > .IZ65Hb-nQ1Faf';

// Synced setting key for editor-only modal width.
export const EDITOR_MODAL_WIDTH_KEY = 'editorModalWidth';

// Synced setting key for markdown preview modal width.
export const MARKDOWN_MODAL_WIDTH_KEY = 'markdownModalWidth';

// Synced setting key for the global default markdown behavior.
export const DEFAULT_MARKDOWN_ENABLED_KEY = 'defaultMarkdownEnabled';

// Synced setting key for the markdown preview theme.
export const PREVIEW_THEME_KEY = 'previewTheme';

// Synced setting key for preserving soft line breaks in paragraphs.
export const PRESERVE_SOFT_LINE_BREAKS_KEY = 'preserveSoftLineBreaks';

// Synced setting key for editor-to-preview scroll synchronization.
export const SCROLL_SYNC_ENABLED_KEY = 'scrollSyncEnabled';

// Local setting prefix for per-note view mode overrides.
export const NOTE_MARKDOWN_MODE_PREFIX = 'noteMarkdownMode:';

// Default modal width used when the note opens in editor-only mode.
export const DEFAULT_EDITOR_MODAL_WIDTH = 64;

// Default modal width used when the note opens with a preview.
export const DEFAULT_MARKDOWN_MODAL_WIDTH = 75;

// Minimum modal width allowed by sliders and drag handles.
export const MIN_MODAL_WIDTH = 50;

// Maximum modal width allowed by sliders and drag handles.
export const MAX_MODAL_WIDTH = 95;

// Dark preview theme keeps the current KeepDown look.
export const PREVIEW_THEME_DARK = 'dark';

// Light preview theme matches Keep's brighter surfaces.
export const PREVIEW_THEME_LIGHT = 'light';

// Preview theme shown in popup settings.
export const PREVIEW_THEMES = [PREVIEW_THEME_DARK, PREVIEW_THEME_LIGHT];

// Default preview theme used for new installs and resets.
export const DEFAULT_PREVIEW_THEME = PREVIEW_THEME_DARK;

// Default behavior keeps CommonMark soft line breaks collapsed.
export const DEFAULT_PRESERVE_SOFT_LINE_BREAKS = false;

// Default behavior keeps the preview aligned with editor scrolling.
export const DEFAULT_SCROLL_SYNC_ENABLED = true;

// Preview block attribute for the first markdown source line covered by a block.
export const PREVIEW_SOURCE_START_LINE_ATTRIBUTE = 'data-keep-md-source-start-line';

// Preview block attribute for the last markdown source line covered by a block.
export const PREVIEW_SOURCE_END_LINE_ATTRIBUTE = 'data-keep-md-source-end-line';

// Preview block attribute that records the mdast block kind for debugging.
export const PREVIEW_BLOCK_KIND_ATTRIBUTE = 'data-keep-md-block-kind';

// Selector used to find preview blocks that participate in scroll sync.
export const PREVIEW_SOURCE_ANCHOR_SELECTOR = `[${PREVIEW_SOURCE_START_LINE_ATTRIBUTE}][${PREVIEW_SOURCE_END_LINE_ATTRIBUTE}]`;

// Editor-only view mode.
export const VIEW_MODE_EDITOR = 'editor';

// Side-by-side editor and markdown preview view mode.
export const VIEW_MODE_SPLIT = 'split';

// Markdown preview-only view mode.
export const VIEW_MODE_PREVIEW = 'preview';

// View modes shown in the in-note mode switcher.
export const VIEW_MODES = [VIEW_MODE_EDITOR, VIEW_MODE_SPLIT, VIEW_MODE_PREVIEW];

// User-facing labels for note mode buttons and resize handle titles.
export const VIEW_MODE_LABELS = {
    [VIEW_MODE_EDITOR]: 'Editor',
    [VIEW_MODE_SPLIT]: 'Editor and Preview',
    [VIEW_MODE_PREVIEW]: 'Preview'
};

// Selector for DOM owned by this extension and ignored by document scans.
export const EXTENSION_OWNED_SELECTOR = '.keep-md-container, .keep-md-source, .keep-md-preview, .keep-md-view-controls, .keep-md-resize-handle';
