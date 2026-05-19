// Checks whether an object owns a key without walking its prototype chain.
export function hasOwn(object, key) {
    return Object.prototype.hasOwnProperty.call(object, key);
}

// Reads values from chrome.storage.sync using a promise-friendly API.
export function getSyncStorage(keys) {
    return new Promise((resolve) => {
        chrome.storage.sync.get(keys, resolve);
    });
}

// Writes values to chrome.storage.sync using a promise-friendly API.
export function setSyncStorage(items) {
    return new Promise((resolve) => {
        chrome.storage.sync.set(items, resolve);
    });
}

// Reads values from chrome.storage.local using a promise-friendly API.
export function getLocalStorage(keys) {
    return new Promise((resolve) => {
        chrome.storage.local.get(keys, resolve);
    });
}

// Writes values to chrome.storage.local using a promise-friendly API.
export function setLocalStorage(items) {
    return new Promise((resolve) => {
        chrome.storage.local.set(items, resolve);
    });
}

// Finds a selector match, allowing the root element itself to be the match.
export function findMatchingElement(root, selector) {
    if (root.matches?.(selector)) {
        return root;
    }

    return root.querySelector(selector);
}

// Returns the first matching selector result from an ordered selector list.
export function findFirstMatchingElement(root, selectors) {
    for (const selector of selectors) {
        const element = findMatchingElement(root, selector);
        if (element) {
            return {element, selector};
        }
    }

    return null;
}

// Reads visible text with a textContent fallback for Keep's editable DOM.
export function getText(element) {
    return (element?.innerText || element?.textContent || '').trim();
}

// Extracts one editor line while preserving intentional blank lines.
export function getLineText(element) {
    return (element.textContent || '')
        .replace(/\u00a0/g, ' ')
        .replace(/\r?\n|\r/g, '')
        .trimEnd();
}

// Normalizes one Keep editor line into the markdown text used by the renderer.
export function normalizeMarkdownLineText(value) {
    return value
        .replace(/^"(.*)"$/, '$1') // Remove surrounding quotes.
        .replace(/\\n/g, '\n') // Restore escaped newlines.
        .replace(/\\"([^"]+)\\"/g, '"$1"'); // Restore escaped quotes.
}

// Trims edge-only blank lines so line numbering matches the final markdown text.
function trimMarkdownLineEntries(entries) {
    let start = 0;
    let end = entries.length - 1;

    while (start <= end && entries[start].text.trim() === '') {
        start += 1;
    }

    while (end >= start && entries[end].text.trim() === '') {
        end -= 1;
    }

    return start > end ? [] : entries.slice(start, end + 1);
}

// Extracts markdown line entries and preserves the DOM element that owns each line.
export function getMarkdownLineEntries(noteContent) {
    const lineElements = Array.from(noteContent.querySelectorAll('p, div[role="presentation"]'));
    const entries = lineElements.length > 0
        ? lineElements.flatMap((element) => {
            const parts = normalizeMarkdownLineText(getLineText(element)).split('\n');
            return parts.map((text, partIndex) => ({
                element,
                text,
                partIndex,
                partCount: parts.length
            }));
        })
        : normalizeMarkdownLineText(getText(noteContent)).split('\n').map((text, partIndex, parts) => ({
            element: noteContent,
            text,
            partIndex,
            partCount: parts.length
        }));

    return trimMarkdownLineEntries(entries);
}

// Extracts markdown text from Keep's paragraph-based editor structure.
export function getMarkdownText(noteContent) {
    return getMarkdownLineEntries(noteContent)
        .map((entry) => entry.text)
        .join('\n')
        .trim();
}

// Clamps a numeric value to an inclusive range, falling back when parsing fails.
export function clampNumber(value, min, max, fallback) {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) {
        return fallback;
    }

    return Math.min(max, Math.max(min, Math.round(numericValue)));
}

// Returns the element associated with a mutation target.
export function getMutationElement(mutation) {
    if (mutation.target.nodeType === Node.ELEMENT_NODE) {
        return mutation.target;
    }

    return mutation.target.parentElement;
}

// Checks whether an element is inside a subtree matching the selector.
export function isElementWithinSelector(element, selector) {
    return Boolean(element?.closest?.(selector));
}

// Detects mutation batches that were caused entirely by an ignored subtree.
export function shouldIgnoreMutations(mutations, ignoredSelector) {
    return mutations.length > 0 && mutations.every((mutation) => {
        if (isElementWithinSelector(getMutationElement(mutation), ignoredSelector)) {
            return true;
        }

        const addedNodes = Array.from(mutation.addedNodes || []);
        const removedNodes = Array.from(mutation.removedNodes || []);
        const changedNodes = [...addedNodes, ...removedNodes];
        return changedNodes.length > 0 && changedNodes.every((node) => {
            if (node.nodeType !== Node.ELEMENT_NODE) {
                return true;
            }

            return isElementWithinSelector(node, ignoredSelector);
        });
    });
}
