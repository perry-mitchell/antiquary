import { base, node, web } from '@antiquary/eslint-config';

export default [
    {
        ignores: [
            '**/dist/',
            '**/node_modules/',
            '**/coverage/',
            'uploads/',
            'uploads-e2e/',
            'playwright-report/',
            'test-results/',
        ],
    },
    ...base,
    {
        files: ['packages/database/**/*.ts', 'applications/server/**/*.ts', 'scripts/**/*.mjs'],
        ...node,
    },
    {
        files: ['applications/web/**/*.{ts,tsx}'],
        ...web,
    },
];
