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
export const EXTENSION_OWNED_SELECTOR = '.keep-md-preview, .keep-md-view-controls, .keep-md-resize-handle';
