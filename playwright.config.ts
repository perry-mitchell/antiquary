import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
    testDir: './e2e',
    timeout: 60_000,
    expect: { timeout: 10_000 },
    fullyParallel: false,
    workers: 1,
    retries: 0,
    reporter: [['list']],
    use: {
        baseURL: 'http://localhost:3100',
    },
    projects: [
        {
            name: 'firefox',
            use: {
                ...devices['Desktop Firefox'],
                headless: true,
            },
            testIgnore: /mobile\.spec\.ts/,
        },
        {
            name: 'mobile',
            use: {
                ...devices['Desktop Firefox'],
                headless: true,
                viewport: { width: 375, height: 667 },
            },
            testMatch: /mobile\.spec\.ts/,
        },
    ],
    webServer: {
        command: 'node scripts/e2e-server.mjs',
        url: 'http://localhost:3100/api/health',
        reuseExistingServer: false,
        timeout: 120_000,
        stdout: 'ignore',
        stderr: 'pipe',
    },
});
