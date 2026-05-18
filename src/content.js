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

let currentModalWidth = 75;  // Only keep width default
let scanScheduled = false;

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

function getMarkdownText(noteContent) {
    return (noteContent.innerText || noteContent.textContent || '')
        .replace(/\u00a0/g, ' ')
        .replace(/^"(.*)"$/gm, '$1')    // Remove surrounding quotes
        .replace(/\\n/g, '\n')          // Handle newlines
        .replace(/\\"([^"]+)\\"/g, '"$1"') // Fix escaped quotes
        .trim();
}

// Create preview panel
function createPreviewPanel(noteId) {
    const preview = document.createElement('div');
    preview.className = 'keep-md-preview';
    preview.id = `keep-md-preview-${noteId}`;
    return preview;
}

function handleNoteOpen(modalNote) {
    // Check if preview already exists
    if (modalNote.querySelector('.keep-md-preview')) {
        return;
    }

    // Find the note content within the modal
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

    // Create a flex container for side-by-side layout
    const container = document.createElement('div');
    container.className = 'keep-md-container';
    
    // Move the note content column into the container
    sourceColumn.classList.add('keep-md-source');
    parent.insertBefore(container, sourceColumn);
    container.appendChild(sourceColumn);

    // Create preview
    const preview = createPreviewPanel(Date.now());
    container.appendChild(preview);

    // Function to update preview
    const updatePreview = () => {
        const latestNoteContentMatch = findNoteContent(sourceColumn) || findNoteContent(modalNote);
        if (!latestNoteContentMatch) {
            return;
        }

        const markdownText = getMarkdownText(latestNoteContentMatch.element);
        
        preview.innerHTML = micromark(markdownText, {
            extensions: [gfm(), math()],
            htmlExtensions: [gfmHtml(), mathHtml()]
        });
    };

    // Initial render
    updatePreview();

    // Watch for content changes
    const observer = new MutationObserver(() => {
        updatePreview();
    });

    observer.observe(sourceColumn, {
        childList: true,
        characterData: true,
        subtree: true
    });
}

function updateModalDimensions(width) {
    // Update stored width value
    if (width) currentModalWidth = width;
    
    const style = document.createElement('style');
    style.textContent = `
        /* Modal width only */
        .VIpgJd-TUo6Hb.XKSfm-L9AdLc:has(.keep-md-preview) {
            width: ${currentModalWidth}vw !important;
            height: auto !important;
            max-height: 95vh !important;
        }

        /* Allow modal to scroll if content is very tall */
        .VIpgJd-TUo6Hb.XKSfm-L9AdLc:has(.keep-md-preview) .IZ65Hb-n0tgWb,
        .VIpgJd-TUo6Hb.XKSfm-L9AdLc:has(.keep-md-preview) .IZ65Hb-TBnied,
        .VIpgJd-TUo6Hb.XKSfm-L9AdLc:has(.keep-md-preview) .IZ65Hb-s2gQvd {
            height: auto !important;
            overflow-y: auto !important;
        }

        /* Container takes natural height */
        .keep-md-container {
            height: auto !important;
        }
    `;
    
    // Remove any previous style element we added
    const existingStyle = document.getElementById('keep-md-modal-style');
    if (existingStyle) {
        existingStyle.remove();
    }
    
    style.id = 'keep-md-modal-style';
    document.head.appendChild(style);
}

// Update the message listener to only handle width
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'updateModalWidth') {
        updateModalDimensions(message.value);
    }
});

// Initialize
function init() {
    // Load saved width
    chrome.storage.sync.get(['modalWidth'], function(result) {
        if (result.modalWidth) currentModalWidth = result.modalWidth;
        updateModalDimensions();
    });
    
    scanOpenModals();

    // Watch for changes to the entire document
    const observer = new MutationObserver(() => {
        scheduleModalScan();
    });

    // Observe everything
    observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['class']
    });
}

function scanOpenModals() {
    const modals = Array.from(document.querySelectorAll(MODAL_SELECTOR))
        .filter((modal) => !modal.querySelector('.keep-md-preview'));

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

// Start when the page is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
} 
