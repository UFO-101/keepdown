import {
    PREVIEW_SOURCE_END_LINE_ATTRIBUTE,
    PREVIEW_SOURCE_ANCHOR_SELECTOR,
    PREVIEW_SOURCE_START_LINE_ATTRIBUTE,
    VIEW_MODE_SPLIT
} from './constants.js';
import {getMarkdownLineEntries} from './utils.js';

const SCROLLABLE_OVERFLOW_PATTERN = /(auto|scroll|overlay)/;

// Re-evaluates the split-view scroll sync wiring and schedules a fresh alignment.
export function refreshScrollSync(context) {
    if (
        context.viewMode !== VIEW_MODE_SPLIT ||
        !context.preview?.isConnected ||
        !context.noteContent?.isConnected
    ) {
        teardownScrollSync(context);
        return;
    }

    const nextEditorScrollHost = findEditorScrollHost(context.noteContent, context.modalNote);
    if (!nextEditorScrollHost) {
        teardownScrollSync(context);
        return;
    }

    if (!context.editorScrollListener) {
        context.editorScrollListener = () => {
            scheduleScrollSync(context);
        };
    }

    if (context.editorScrollHost !== nextEditorScrollHost) {
        context.editorScrollHost?.removeEventListener('scroll', context.editorScrollListener);
        context.editorScrollHost = nextEditorScrollHost;
        context.editorScrollHost.addEventListener('scroll', context.editorScrollListener, {
            passive: true
        });
    }

    context.previewScrollHost = context.preview;
    if (!context.previewResizeObserver) {
        context.previewResizeObserver = new ResizeObserver(() => {
            invalidateScrollSync(context);
            scheduleScrollSync(context);
        });
    }
    context.previewResizeObserver.disconnect();
    context.previewResizeObserver.observe(context.previewScrollHost);

    invalidateScrollSync(context);
    scheduleScrollSync(context);
}

// Marks cached line and anchor geometry as stale so the next sync recomputes it.
export function invalidateScrollSync(context) {
    context.sourceLineMetrics = null;
    context.previewAnchorMetrics = null;
}

// Schedules a single frame of editor-to-preview alignment.
export function scheduleScrollSync(context) {
    if (
        context.viewMode !== VIEW_MODE_SPLIT ||
        !context.editorScrollHost?.isConnected ||
        !context.previewScrollHost?.isConnected ||
        context.scrollSyncFrame
    ) {
        return;
    }

    context.scrollSyncFrame = requestAnimationFrame(() => {
        context.scrollSyncFrame = 0;
        syncPreviewToEditor(context);
    });
}

// Disconnects scroll sync listeners, observers, and cached metrics.
export function teardownScrollSync(context) {
    if (context.scrollSyncFrame) {
        cancelAnimationFrame(context.scrollSyncFrame);
        context.scrollSyncFrame = 0;
    }

    if (context.editorScrollHost && context.editorScrollListener) {
        context.editorScrollHost.removeEventListener('scroll', context.editorScrollListener);
    }

    context.previewResizeObserver?.disconnect();
    context.previewResizeObserver = null;
    context.editorScrollHost = null;
    context.previewScrollHost = null;
    context.sourceLineMetrics = null;
    context.previewAnchorMetrics = null;
}

// Finds the Keep-owned scrollable element that actually moves while editing.
function findEditorScrollHost(noteContent, modalNote) {
    let fallback = null;
    let current = noteContent;

    while (current && current !== modalNote) {
        if (isPotentialScrollHost(current)) {
            fallback ||= current;
            if (isActivelyScrollable(current)) {
                return current;
            }
        }

        current = current.parentElement;
    }

    if (modalNote && isPotentialScrollHost(modalNote)) {
        fallback ||= modalNote;
        if (isActivelyScrollable(modalNote)) {
            return modalNote;
        }
    }

    return fallback;
}

// Rebuilds geometry caches and aligns the preview to the editor's current viewport.
function syncPreviewToEditor(context) {
    const editorScrollHost = context.editorScrollHost;
    const previewScrollHost = context.previewScrollHost;
    if (!editorScrollHost || !previewScrollHost) {
        return;
    }

    if (!context.sourceLineMetrics || !context.previewAnchorMetrics) {
        context.sourceLineMetrics = buildSourceLineMetrics(context.noteContent, editorScrollHost);
        context.previewAnchorMetrics = buildPreviewAnchorMetrics(previewScrollHost);
    }

    const maxPreviewScroll = Math.max(previewScrollHost.scrollHeight - previewScrollHost.clientHeight, 0);
    if (maxPreviewScroll <= 0) {
        previewScrollHost.scrollTop = 0;
        return;
    }

    const maxEditorScroll = Math.max(editorScrollHost.scrollHeight - editorScrollHost.clientHeight, 0);
    const sourceLineMetrics = context.sourceLineMetrics;
    const previewAnchorMetrics = context.previewAnchorMetrics;
    if (sourceLineMetrics.length === 0 || previewAnchorMetrics.length === 0) {
        previewScrollHost.scrollTop = maxEditorScroll > 0
            ? (editorScrollHost.scrollTop / maxEditorScroll) * maxPreviewScroll
            : 0;
        return;
    }

    const visibleLine = getVisibleSourceLine(sourceLineMetrics, editorScrollHost.scrollTop);
    const targetScrollTop = getPreviewScrollTopForLine({
        currentLine: visibleLine.line + visibleLine.progress,
        anchors: previewAnchorMetrics,
        previewScrollHost,
        totalSourceLines: sourceLineMetrics[sourceLineMetrics.length - 1].line
    });

    previewScrollHost.scrollTop = clampNumber(
        targetScrollTop,
        0,
        maxPreviewScroll,
        maxEditorScroll > 0 ? (editorScrollHost.scrollTop / maxEditorScroll) * maxPreviewScroll : 0
    );
}

// Measures each logical markdown line relative to the editor scroll host.
function buildSourceLineMetrics(noteContent, scrollHost) {
    const entries = getMarkdownLineEntries(noteContent);
    if (entries.length === 0) {
        return [];
    }

    const layoutCache = new Map();
    const hostRect = scrollHost.getBoundingClientRect();
    return entries.map((entry, index) => {
        let layout = layoutCache.get(entry.element);
        if (!layout) {
            const rect = entry.element.getBoundingClientRect();
            layout = {
                top: scrollHost.scrollTop + rect.top - hostRect.top,
                height: rect.height
            };
            layoutCache.set(entry.element, layout);
        }

        const lineHeight = Math.max(layout.height / Math.max(entry.partCount, 1), 1);
        return {
            line: index + 1,
            top: layout.top + (entry.partIndex * lineHeight),
            height: lineHeight
        };
    });
}

// Measures preview blocks that carry markdown source line metadata.
function buildPreviewAnchorMetrics(previewScrollHost) {
    const previewRect = previewScrollHost.getBoundingClientRect();

    return Array.from(previewScrollHost.querySelectorAll(PREVIEW_SOURCE_ANCHOR_SELECTOR))
        .map((element, order) => {
            const startLine = Number(element.getAttribute(PREVIEW_SOURCE_START_LINE_ATTRIBUTE));
            const endLine = Number(element.getAttribute(PREVIEW_SOURCE_END_LINE_ATTRIBUTE));
            if (!Number.isFinite(startLine) || !Number.isFinite(endLine)) {
                return null;
            }

            const rect = element.getBoundingClientRect();
            return {
                element,
                order,
                startLine,
                endLine,
                top: previewScrollHost.scrollTop + rect.top - previewRect.top,
                height: rect.height,
                depth: getAnchorDepth(element, previewScrollHost)
            };
        })
        .filter(Boolean)
        .sort((left, right) => (
            left.startLine - right.startLine ||
            (left.endLine - left.startLine) - (right.endLine - right.startLine) ||
            right.depth - left.depth ||
            left.order - right.order
        ));
}

// Finds the logical source line that sits at the top of the editor viewport.
function getVisibleSourceLine(metrics, scrollTop) {
    const index = findLastMetricBeforeOrAt(metrics, scrollTop);
    const metric = metrics[Math.max(index, 0)];
    const progress = metric.height > 0
        ? clampNumber((scrollTop - metric.top) / metric.height, 0, 1, 0)
        : 0;

    return {
        line: metric.line,
        progress
    };
}

// Maps a source line to the best preview scroll target using anchor metadata.
function getPreviewScrollTopForLine({currentLine, anchors, previewScrollHost, totalSourceLines}) {
    const exactAnchor = selectBestExactAnchor(anchors, currentLine);
    if (exactAnchor) {
        const spanLineCount = Math.max(exactAnchor.endLine - exactAnchor.startLine + 1, 1);
        const nextAnchor = anchors.find((anchor) => anchor.startLine > currentLine);
        const spanHeight = Math.max(
            (nextAnchor ? nextAnchor.top : previewScrollHost.scrollHeight) - exactAnchor.top,
            exactAnchor.height
        );
        const progress = clampNumber(
            (currentLine - exactAnchor.startLine) / spanLineCount,
            0,
            1,
            0
        );
        return exactAnchor.top + (progress * spanHeight);
    }

    let previousAnchor = null;
    let nextAnchor = null;
    for (const anchor of anchors) {
        if (anchor.endLine < currentLine) {
            previousAnchor = anchor;
            continue;
        }

        if (anchor.startLine > currentLine) {
            nextAnchor = anchor;
            break;
        }
    }

    if (previousAnchor && nextAnchor) {
        const lineGap = Math.max(nextAnchor.startLine - previousAnchor.endLine, 1);
        const progress = clampNumber(
            (currentLine - previousAnchor.endLine) / lineGap,
            0,
            1,
            0
        );
        return previousAnchor.top + ((nextAnchor.top - previousAnchor.top) * progress);
    }

    if (previousAnchor) {
        const remainingLineCount = Math.max(totalSourceLines - previousAnchor.startLine + 1, 1);
        const progress = clampNumber(
            (currentLine - previousAnchor.startLine) / remainingLineCount,
            0,
            1,
            0
        );
        return previousAnchor.top + ((previewScrollHost.scrollHeight - previousAnchor.top) * progress);
    }

    return nextAnchor ? nextAnchor.top : 0;
}

// Chooses the smallest matching block so nested paragraphs beat wider containers.
function selectBestExactAnchor(anchors, currentLine) {
    let best = null;

    for (const anchor of anchors) {
        if (anchor.startLine > currentLine) {
            break;
        }

        if (anchor.endLine + 1 <= currentLine) {
            continue;
        }

        if (!best) {
            best = anchor;
            continue;
        }

        const bestSpan = best.endLine - best.startLine;
        const anchorSpan = anchor.endLine - anchor.startLine;
        if (
            anchorSpan < bestSpan ||
            (anchorSpan === bestSpan && anchor.depth > best.depth) ||
            (anchorSpan === bestSpan && anchor.depth === best.depth && anchor.order > best.order)
        ) {
            best = anchor;
        }
    }

    return best;
}

// Finds the last metric whose top is at or before the requested offset.
function findLastMetricBeforeOrAt(metrics, offset) {
    let low = 0;
    let high = metrics.length - 1;
    let match = 0;

    while (low <= high) {
        const middle = Math.floor((low + high) / 2);
        if (metrics[middle].top <= offset) {
            match = middle;
            low = middle + 1;
        } else {
            high = middle - 1;
        }
    }

    return match;
}

// Returns how deep a preview anchor sits inside the preview DOM tree.
function getAnchorDepth(element, root) {
    let depth = 0;
    let current = element;

    while (current && current !== root) {
        depth += 1;
        current = current.parentElement;
    }

    return depth;
}

// Checks whether an element is styled like a vertical scroll host.
function isPotentialScrollHost(element) {
    const overflowY = window.getComputedStyle(element).overflowY;
    return SCROLLABLE_OVERFLOW_PATTERN.test(overflowY);
}

// Checks whether an element currently has overflow content to scroll through.
function isActivelyScrollable(element) {
    return element.scrollHeight > element.clientHeight + 1;
}

// Clamps a number without changing the fallback behavior used elsewhere in the project.
function clampNumber(value, min, max, fallback) {
    return Number.isFinite(value)
        ? Math.min(max, Math.max(min, value))
        : fallback;
}
