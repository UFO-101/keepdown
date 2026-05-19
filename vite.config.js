import { defineConfig } from "vite";

export default defineConfig(({mode}) => {
    return {
        build: {
            outDir: 'extension/dist',
            rollupOptions: {
                input: 'src/content.js',
                output: {
                    dir: 'extension/dist',
                    entryFileNames: 'content.js',
                    format: 'iife'
                }
            },
            minify: false,
            sourcemap: false,
            target: 'esnext'
        }
    };
});
