import { defineConfig, transformWithEsbuild } from 'vite';

export default defineConfig(({mode}) => {
    // Development builds keep logs; production builds remove logs and debugger statements.
    const isProduction = mode === 'production';

    return {
        plugins: [
            {
                name: 'keepdown-drop-debug-in-production',
                async renderChunk(code, chunk) {
                    if (!isProduction) {
                        return null;
                    }

                    return transformWithEsbuild(code, chunk.fileName, {
                        drop: ['console', 'debugger'],
                        minify: false,
                        target: 'esnext'
                    });
                }
            }
        ],
        esbuild: isProduction
            ? {
                drop: ['console', 'debugger']
            }
            : {},
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
