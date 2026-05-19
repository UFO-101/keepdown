import katex from 'katex';
import {fromMarkdown} from 'mdast-util-from-markdown';
import {gfmFromMarkdown} from 'mdast-util-gfm';
import {mathFromMarkdown} from 'mdast-util-math';
import {toHast} from 'mdast-util-to-hast';
import {toHtml} from 'hast-util-to-html';
import {gfm} from 'micromark-extension-gfm';
import {math} from 'micromark-extension-math';
import {visit} from 'unist-util-visit';
import {
    PREVIEW_BLOCK_KIND_ATTRIBUTE,
    PREVIEW_SOURCE_END_LINE_ATTRIBUTE,
    PREVIEW_SOURCE_START_LINE_ATTRIBUTE
} from './constants.js';

const ANCHOR_NODE_TYPES = new Set([
    'blockquote',
    'code',
    'heading',
    'listItem',
    'math',
    'paragraph',
    'table',
    'thematicBreak'
]);

// Renders markdown to HTML and annotates block nodes with source line metadata.
export function renderMarkdownWithAnchors(markdownText) {
    const tree = fromMarkdown(markdownText, {
        extensions: [gfm(), math()],
        mdastExtensions: [gfmFromMarkdown(), mathFromMarkdown()]
    });
    const anchors = [];

    visit(tree, (node) => {
        const startLine = node.position?.start?.line;
        const endLine = node.position?.end?.line;
        if (!ANCHOR_NODE_TYPES.has(node.type) || !startLine || !endLine) {
            return;
        }

        node.data ||= {};
        node.data.hProperties = {
            ...node.data.hProperties,
            [PREVIEW_SOURCE_START_LINE_ATTRIBUTE]: String(startLine),
            [PREVIEW_SOURCE_END_LINE_ATTRIBUTE]: String(endLine),
            [PREVIEW_BLOCK_KIND_ATTRIBUTE]: node.type
        };
        anchors.push({
            startLine,
            endLine,
            kind: node.type
        });
    });

    const hast = toHast(tree, {
        allowDangerousHtml: false,
        handlers: {
            code: codeHandler,
            inlineMath: inlineMathHandler,
            math: mathHandler
        }
    });

    return {
        html: toHtml(hast, {allowDangerousHtml: true}),
        anchors
    };
}

// Keeps anchor metadata on the outer <pre> wrapper instead of the inner <code>.
function codeHandler(state, node) {
    const value = node.value ? `${node.value}\n` : '';
    const language = node.lang ? node.lang.split(/\s+/) : [];
    const codeProperties = {};

    if (language.length > 0) {
        codeProperties.className = [`language-${language[0]}`];
    }

    const codeElement = {
        type: 'element',
        tagName: 'code',
        properties: codeProperties,
        children: [{type: 'text', value}]
    };
    if (node.meta) {
        codeElement.data = {meta: node.meta};
    }
    state.patch(node, codeElement);

    const result = {
        type: 'element',
        tagName: 'pre',
        properties: {},
        children: [codeElement]
    };
    state.patch(node, result);
    return state.applyData(node, result);
}

// Renders inline math using the same wrapper classes as the existing micromark pipeline.
function inlineMathHandler(state, node) {
    const result = {
        type: 'element',
        tagName: 'span',
        properties: {className: ['math', 'math-inline']},
        children: [{
            type: 'raw',
            value: katex.renderToString(node.value, {displayMode: false})
        }]
    };

    state.patch(node, result);
    return state.applyData(node, result);
}

// Renders display math using the same wrapper classes as the existing micromark pipeline.
function mathHandler(state, node) {
    const result = {
        type: 'element',
        tagName: 'div',
        properties: {className: ['math', 'math-display']},
        children: [{
            type: 'raw',
            value: katex.renderToString(node.value, {displayMode: true})
        }]
    };

    state.patch(node, result);
    return state.applyData(node, result);
}
