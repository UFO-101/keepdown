import {
    DEFAULT_PREVIEW_THEME,
    KEEP_DARK_THEME_STYLESHEET_MARKER,
    KEEP_LIGHT_THEME_STYLESHEET_MARKER,
    KEEP_THEME_STYLESHEET_SELECTOR,
    PREVIEW_THEME_DARK,
    PREVIEW_THEME_LIGHT,
    PREVIEW_THEME_SYSTEM,
    PREVIEW_THEMES
} from './constants.js';

let currentPreviewTheme = DEFAULT_PREVIEW_THEME;
let systemPreviewThemeQuery = null;
let keepThemeStylesheetObserver = null;
let systemPreviewThemeFrame = 0;

// Validates preview themes loaded from storage before styling the preview panel.
export function normalizePreviewTheme(theme) {
    return PREVIEW_THEMES.includes(theme) ? theme : DEFAULT_PREVIEW_THEME;
}

// Applies the active preview theme through CSS selectors in extension/styles.css.
export function applyPreviewTheme(theme = currentPreviewTheme) {
    const normalizedTheme = normalizePreviewTheme(theme);
    const resolvedTheme = resolvePreviewTheme(normalizedTheme);
    const root = document.documentElement;

    currentPreviewTheme = normalizedTheme;
    root.dataset.keepMdPreviewTheme = resolvedTheme;
}

export function setupPreviewThemeSync() {
    setupSystemColorSchemeListener();
    setupKeepThemeStylesheetObserver();
}

function resolvePreviewTheme(theme) {
    return theme === PREVIEW_THEME_SYSTEM ? getSystemPreviewTheme() : theme;
}

// Uses Keep's own stylesheet swap first, then falls back to the browser setting.
function getSystemPreviewTheme() {
    const keepTheme = getKeepPreviewThemeFromStylesheets();
    if (keepTheme) {
        return keepTheme;
    }

    const query = window.matchMedia?.('(prefers-color-scheme: light)');
    return query?.matches ? PREVIEW_THEME_LIGHT : PREVIEW_THEME_DARK;
}

function getKeepPreviewThemeFromStylesheets() {
    const links = document.head?.querySelectorAll(KEEP_THEME_STYLESHEET_SELECTOR);
    if (!links?.length) {
        return null;
    }

    for (let index = links.length - 1; index >= 0; index -= 1) {
        const link = links[index];
        if (link.disabled || link.getAttribute('disabled') !== null) {
            continue;
        }

        const href = link.href || '';
        if (!href) {
            continue;
        }

        if (href.includes(KEEP_DARK_THEME_STYLESHEET_MARKER)) {
            return PREVIEW_THEME_DARK;
        }

        if (href.includes(KEEP_LIGHT_THEME_STYLESHEET_MARKER)) {
            return PREVIEW_THEME_LIGHT;
        }
    }

    return null;
}

function setupSystemColorSchemeListener() {
    if (systemPreviewThemeQuery || !window.matchMedia) {
        return;
    }

    systemPreviewThemeQuery = window.matchMedia('(prefers-color-scheme: light)');
    systemPreviewThemeQuery.addEventListener('change', scheduleSystemPreviewThemeRefresh);
}

function setupKeepThemeStylesheetObserver() {
    if (keepThemeStylesheetObserver || !document.head) {
        return;
    }

    keepThemeStylesheetObserver = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            if (mutation.type === 'attributes') {
                if (mutation.target?.matches?.(KEEP_THEME_STYLESHEET_SELECTOR)) {
                    scheduleSystemPreviewThemeRefresh();
                    return;
                }
                continue;
            }

            if (mutation.type === 'childList') {
                for (const node of mutation.addedNodes) {
                    if (matchesKeepThemeStylesheetNode(node)) {
                        scheduleSystemPreviewThemeRefresh();
                        return;
                    }
                }

                for (const node of mutation.removedNodes) {
                    if (matchesKeepThemeStylesheetNode(node)) {
                        scheduleSystemPreviewThemeRefresh();
                        return;
                    }
                }
            }
        }
    });

    keepThemeStylesheetObserver.observe(document.head, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['href', 'disabled', 'rel']
    });
}

function matchesKeepThemeStylesheetNode(node) {
    if (node?.nodeType !== Node.ELEMENT_NODE) {
        return false;
    }

    if (node.matches?.(KEEP_THEME_STYLESHEET_SELECTOR)) {
        return true;
    }

    return Boolean(node.querySelector?.(KEEP_THEME_STYLESHEET_SELECTOR));
}

function scheduleSystemPreviewThemeRefresh() {
    if (currentPreviewTheme !== PREVIEW_THEME_SYSTEM || systemPreviewThemeFrame) {
        return;
    }

    systemPreviewThemeFrame = requestAnimationFrame(() => {
        systemPreviewThemeFrame = 0;
        if (currentPreviewTheme === PREVIEW_THEME_SYSTEM) {
            applyPreviewTheme(currentPreviewTheme);
        }
    });
}
