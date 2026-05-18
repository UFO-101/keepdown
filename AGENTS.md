# Agent Instructions

- Use English for all code comments in JavaScript, CSS, HTML, and generated build-adjacent files.
- Keep comments concise and focused on intent, browser quirks, or non-obvious Google Keep DOM behavior.
- Preserve existing useful comments when refactoring; update them instead of deleting them when behavior changes.
- Keep persistent debug log messages in English and remove only temporary diagnostic logs when the related investigation is done.
- Do not leave temporary debug logs or log-only comments in committed code.
- Put shared content-script constants in `src/constants.js` with English comments.
- `npm run dev` keeps console logs for debugging; `npm run build` removes `console` and `debugger` from the production bundle.
- When editing `src/content.js`, run `npm run build` so `extension/dist/content.js` stays in sync.
