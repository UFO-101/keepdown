// Synced setting key for editor-only modal width.
const EDITOR_MODAL_WIDTH_KEY = 'editorModalWidth';

// Synced setting key for markdown preview modal width.
const MARKDOWN_MODAL_WIDTH_KEY = 'markdownModalWidth';

// Synced setting key for the global default markdown behavior.
const DEFAULT_MARKDOWN_ENABLED_KEY = 'defaultMarkdownEnabled';

// Synced setting key for the markdown preview theme.
const PREVIEW_THEME_KEY = 'previewTheme';

// Synced setting key for preserving soft line breaks in paragraphs.
const PRESERVE_SOFT_LINE_BREAKS_KEY = 'preserveSoftLineBreaks';

// Synced setting key for editor-to-preview scroll synchronization.
const SCROLL_SYNC_ENABLED_KEY = 'scrollSyncEnabled';

// Default width used when the note is in Editor mode.
const DEFAULT_EDITOR_MODAL_WIDTH = '64';

// Default width used when the note shows markdown preview.
const DEFAULT_MARKDOWN_MODAL_WIDTH = '75';

// Preview theme options exposed in popup settings.
const PREVIEW_THEME_SYSTEM = 'system';
const PREVIEW_THEME_DARK = 'dark';
const PREVIEW_THEME_LIGHT = 'light';

// Default preview theme follows the browser color-scheme preference.
const DEFAULT_PREVIEW_THEME = PREVIEW_THEME_SYSTEM;

// Default behavior keeps CommonMark soft line breaks collapsed.
const DEFAULT_PRESERVE_SOFT_LINE_BREAKS = false;

// Default behavior keeps the preview aligned with editor scrolling.
const DEFAULT_SCROLL_SYNC_ENABLED = true;

document.addEventListener('DOMContentLoaded', function() {
    const defaultMarkdownToggle = document.getElementById('default-markdown');
    const scrollSyncToggle = document.getElementById('scroll-sync');
    const preserveSoftBreaksToggle = document.getElementById('preserve-soft-breaks');
    const previewThemeInputs = Array.from(document.querySelectorAll('input[name="preview-theme"]'));
    const resetButton = document.getElementById('reset-settings');
    const chromeApi = typeof chrome === 'undefined' ? null : chrome;
    const systemPreviewThemeQuery = window.matchMedia?.('(prefers-color-scheme: light)');
    const widthControls = [
        {
            key: EDITOR_MODAL_WIDTH_KEY,
            messageKey: 'editorWidth',
            slider: document.getElementById('editor-width'),
            value: document.getElementById('editor-width-value')
        },
        {
            key: MARKDOWN_MODAL_WIDTH_KEY,
            messageKey: 'markdownWidth',
            slider: document.getElementById('markdown-width'),
            value: document.getElementById('markdown-width-value')
        }
    ];
    const defaultSettings = {
        [EDITOR_MODAL_WIDTH_KEY]: DEFAULT_EDITOR_MODAL_WIDTH,
        [MARKDOWN_MODAL_WIDTH_KEY]: DEFAULT_MARKDOWN_MODAL_WIDTH,
        [DEFAULT_MARKDOWN_ENABLED_KEY]: true,
        [PREVIEW_THEME_KEY]: DEFAULT_PREVIEW_THEME,
        [PRESERVE_SOFT_LINE_BREAKS_KEY]: DEFAULT_PRESERVE_SOFT_LINE_BREAKS,
        [SCROLL_SYNC_ENABLED_KEY]: DEFAULT_SCROLL_SYNC_ENABLED
    };

    // Keep the range fill and value badge in sync.
    function updateWidthDisplay(control, value) {
        const numericValue = Number(value);
        const min = Number(control.slider.min);
        const max = Number(control.slider.max);
        const progress = ((numericValue - min) / (max - min)) * 100;

        control.value.textContent = `${numericValue}%`;
        control.slider.style.setProperty('--slider-progress', `${progress}%`);
    }

    function setWidthControl(control, value) {
        control.slider.value = value;
        updateWidthDisplay(control, value);
    }

    // Falls back to the supported preview theme when storage has unknown data.
    function normalizePreviewTheme(theme) {
        return [PREVIEW_THEME_SYSTEM, PREVIEW_THEME_DARK, PREVIEW_THEME_LIGHT].includes(theme)
            ? theme
            : DEFAULT_PREVIEW_THEME;
    }

    function getSystemPreviewTheme() {
        return systemPreviewThemeQuery?.matches ? PREVIEW_THEME_LIGHT : PREVIEW_THEME_DARK;
    }

    function resolvePreviewTheme(theme) {
        return theme === PREVIEW_THEME_SYSTEM ? getSystemPreviewTheme() : theme;
    }

    // Keeps the theme radios and the sample preview card aligned.
    function setPreviewTheme(theme) {
        const normalizedTheme = normalizePreviewTheme(theme);

        document.body.dataset.previewTheme = resolvePreviewTheme(normalizedTheme);
        for (const input of previewThemeInputs) {
            input.checked = input.value === normalizedTheme;
        }
    }

    // Keeps the sample preview aligned with the paragraph line break setting.
    function setPreserveSoftBreaks(enabled) {
        const normalizedValue = enabled === true;

        document.body.dataset.preserveSoftBreaks = String(normalizedValue);
        preserveSoftBreaksToggle.checked = normalizedValue;
    }

    // Applies the full popup state after load, reset, or live storage updates.
    function applySettings(settings) {
        for (const control of widthControls) {
            setWidthControl(control, settings[control.key]);
        }

        defaultMarkdownToggle.checked = settings[DEFAULT_MARKDOWN_ENABLED_KEY] !== false;
        scrollSyncToggle.checked = settings[SCROLL_SYNC_ENABLED_KEY] !== false;
        setPreviewTheme(settings[PREVIEW_THEME_KEY]);
        setPreserveSoftBreaks(settings[PRESERVE_SOFT_LINE_BREAKS_KEY]);
    }

    // Reads current sync settings and refreshes the popup controls.
    function loadSettings() {
        if (chromeApi?.storage?.sync) {
            chromeApi.storage.sync.get([
                EDITOR_MODAL_WIDTH_KEY,
                MARKDOWN_MODAL_WIDTH_KEY,
                DEFAULT_MARKDOWN_ENABLED_KEY,
                PREVIEW_THEME_KEY,
                PRESERVE_SOFT_LINE_BREAKS_KEY,
                SCROLL_SYNC_ENABLED_KEY
            ], function(result) {
                applySettings({
                    [EDITOR_MODAL_WIDTH_KEY]: result[EDITOR_MODAL_WIDTH_KEY] || defaultSettings[EDITOR_MODAL_WIDTH_KEY],
                    [MARKDOWN_MODAL_WIDTH_KEY]: result[MARKDOWN_MODAL_WIDTH_KEY] || defaultSettings[MARKDOWN_MODAL_WIDTH_KEY],
                    [DEFAULT_MARKDOWN_ENABLED_KEY]: result[DEFAULT_MARKDOWN_ENABLED_KEY] !== false,
                    [PREVIEW_THEME_KEY]: normalizePreviewTheme(result[PREVIEW_THEME_KEY] || defaultSettings[PREVIEW_THEME_KEY]),
                    [PRESERVE_SOFT_LINE_BREAKS_KEY]: result[PRESERVE_SOFT_LINE_BREAKS_KEY] === true,
                    [SCROLL_SYNC_ENABLED_KEY]: result[SCROLL_SYNC_ENABLED_KEY] !== false
                });
            });
            return;
        }

        applySettings(defaultSettings);
    }

    function sendActiveTabMessage(message) {
        if (!chromeApi?.tabs?.query) {
            return;
        }

        chromeApi.tabs.query({active: true, currentWindow: true}, function(tabs) {
            const tabId = tabs[0]?.id;
            if (!tabId) {
                return;
            }

            chromeApi.tabs.sendMessage(tabId, message, function() {
                void chromeApi.runtime.lastError;
            });
        });
    }

    loadSettings();

    systemPreviewThemeQuery?.addEventListener('change', function() {
        const selectedTheme = previewThemeInputs.find((input) => input.checked)?.value;
        if (selectedTheme === PREVIEW_THEME_SYSTEM) {
            setPreviewTheme(PREVIEW_THEME_SYSTEM);
        }
    });

    // Save width changes and notify the content script immediately.
    for (const control of widthControls) {
        control.slider.addEventListener('input', function() {
            const value = this.value;
            const message = {
                type: 'updateModalWidths',
                [control.messageKey]: value
            };

            updateWidthDisplay(control, value);
            chromeApi?.storage?.sync?.set({[control.key]: value});
            sendActiveTabMessage(message);
        });
    }

    // Keep the popup synchronized when the in-note resize handle updates storage.
    chromeApi?.storage?.onChanged?.addListener(function(changes, areaName) {
        if (areaName !== 'sync') {
            return;
        }

        for (const control of widthControls) {
            const change = changes[control.key];
            if (!change) {
                continue;
            }

            setWidthControl(control, change.newValue || control.slider.value);
        }

        if (changes[DEFAULT_MARKDOWN_ENABLED_KEY]) {
            defaultMarkdownToggle.checked = changes[DEFAULT_MARKDOWN_ENABLED_KEY].newValue !== false;
        }

        if (changes[SCROLL_SYNC_ENABLED_KEY]) {
            scrollSyncToggle.checked = changes[SCROLL_SYNC_ENABLED_KEY].newValue !== false;
        }

        if (changes[PREVIEW_THEME_KEY]) {
            setPreviewTheme(changes[PREVIEW_THEME_KEY].newValue);
        }

        if (changes[PRESERVE_SOFT_LINE_BREAKS_KEY]) {
            setPreserveSoftBreaks(changes[PRESERVE_SOFT_LINE_BREAKS_KEY].newValue);
        }
    });

    defaultMarkdownToggle.addEventListener('change', function() {
        const enabled = this.checked;

        chromeApi?.storage?.sync?.set({[DEFAULT_MARKDOWN_ENABLED_KEY]: enabled});
        sendActiveTabMessage({
            type: 'updateDefaultMarkdownEnabled',
            value: enabled
        });
    });

    scrollSyncToggle.addEventListener('change', function() {
        const enabled = this.checked;

        chromeApi?.storage?.sync?.set({[SCROLL_SYNC_ENABLED_KEY]: enabled});
        sendActiveTabMessage({
            type: 'updateScrollSyncEnabled',
            value: enabled
        });
    });

    for (const input of previewThemeInputs) {
        input.addEventListener('change', function() {
            if (!this.checked) {
                return;
            }

            const theme = normalizePreviewTheme(this.value);
            setPreviewTheme(theme);
            chromeApi?.storage?.sync?.set({[PREVIEW_THEME_KEY]: theme});
            sendActiveTabMessage({
                type: 'updatePreviewTheme',
                value: theme
            });
        });
    }

    preserveSoftBreaksToggle.addEventListener('change', function() {
        const enabled = this.checked;

        setPreserveSoftBreaks(enabled);
        chromeApi?.storage?.sync?.set({[PRESERVE_SOFT_LINE_BREAKS_KEY]: enabled});
        sendActiveTabMessage({
            type: 'updatePreserveSoftLineBreaks',
            value: enabled
        });
    });

    resetButton?.addEventListener('click', function() {
        applySettings(defaultSettings);

        if (!chromeApi?.storage?.sync) {
            return;
        }

        chromeApi.storage.sync.set(defaultSettings, function() {
            sendActiveTabMessage({
                type: 'updateModalWidths',
                editorWidth: defaultSettings[EDITOR_MODAL_WIDTH_KEY],
                markdownWidth: defaultSettings[MARKDOWN_MODAL_WIDTH_KEY]
            });
            sendActiveTabMessage({
                type: 'updateDefaultMarkdownEnabled',
                value: defaultSettings[DEFAULT_MARKDOWN_ENABLED_KEY]
            });
            sendActiveTabMessage({
                type: 'updatePreviewTheme',
                value: defaultSettings[PREVIEW_THEME_KEY]
            });
            sendActiveTabMessage({
                type: 'updatePreserveSoftLineBreaks',
                value: defaultSettings[PRESERVE_SOFT_LINE_BREAKS_KEY]
            });
            sendActiveTabMessage({
                type: 'updateScrollSyncEnabled',
                value: defaultSettings[SCROLL_SYNC_ENABLED_KEY]
            });
            loadSettings();
        });
    });
});
