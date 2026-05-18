const MODAL_WIDTH_KEY = 'modalWidth';
const DEFAULT_MARKDOWN_ENABLED_KEY = 'defaultMarkdownEnabled';

document.addEventListener('DOMContentLoaded', function() {
    const widthSlider = document.getElementById('width');
    const widthValue = document.getElementById('width-value');
    const defaultMarkdownToggle = document.getElementById('default-markdown');
    const chromeApi = typeof chrome === 'undefined' ? null : chrome;

    function updateWidthDisplay(value) {
        const numericValue = Number(value);
        const min = Number(widthSlider.min);
        const max = Number(widthSlider.max);
        const progress = ((numericValue - min) / (max - min)) * 100;

        widthValue.textContent = `${numericValue}%`;
        widthSlider.style.setProperty('--slider-progress', `${progress}%`);
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
        chromeApi.storage.sync.get([MODAL_WIDTH_KEY, DEFAULT_MARKDOWN_ENABLED_KEY], function(result) {
            const savedWidth = result[MODAL_WIDTH_KEY] || widthSlider.value;
            const defaultMarkdownEnabled = result[DEFAULT_MARKDOWN_ENABLED_KEY] !== false;

            widthSlider.value = savedWidth;
            defaultMarkdownToggle.checked = defaultMarkdownEnabled;
            updateWidthDisplay(savedWidth);
        });
    } else {
        updateWidthDisplay(widthSlider.value);
    }

    widthSlider.addEventListener('input', function() {
        const value = this.value;
        updateWidthDisplay(value);

        chromeApi?.storage?.sync?.set({[MODAL_WIDTH_KEY]: value});
        sendActiveTabMessage({
            type: 'updateModalWidth',
            value: value
        });
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
