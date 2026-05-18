const EDITOR_MODAL_WIDTH_KEY = 'editorModalWidth';
const MARKDOWN_MODAL_WIDTH_KEY = 'markdownModalWidth';
const DEFAULT_MARKDOWN_ENABLED_KEY = 'defaultMarkdownEnabled';

document.addEventListener('DOMContentLoaded', function() {
    const defaultMarkdownToggle = document.getElementById('default-markdown');
    const chromeApi = typeof chrome === 'undefined' ? null : chrome;
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

    if (chromeApi?.storage?.sync) {
        chromeApi.storage.sync.get([
            EDITOR_MODAL_WIDTH_KEY,
            MARKDOWN_MODAL_WIDTH_KEY,
            DEFAULT_MARKDOWN_ENABLED_KEY
        ], function(result) {
            for (const control of widthControls) {
                setWidthControl(control, result[control.key] || control.slider.value);
            }

            defaultMarkdownToggle.checked = result[DEFAULT_MARKDOWN_ENABLED_KEY] !== false;
        });
    } else {
        for (const control of widthControls) {
            updateWidthDisplay(control, control.slider.value);
        }
    }

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
    });

    defaultMarkdownToggle.addEventListener('change', function() {
        const enabled = this.checked;

        chromeApi?.storage?.sync?.set({[DEFAULT_MARKDOWN_ENABLED_KEY]: enabled});
        sendActiveTabMessage({
            type: 'updateDefaultMarkdownEnabled',
            value: enabled
        });
    });
});
