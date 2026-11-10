import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
    resolve: {
        alias: {
            '@antiquary/database': resolve(__dirname, '../../packages/database/src/index.ts'),
        },
    },
    test: {
        environment: 'node',
        testTimeout: 20_000,
        hookTimeout: 60_000,
    },
});
