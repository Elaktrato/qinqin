// Browser end-to-end tests (#157): the real binary with the built SPA, a
// throw-away data directory and a free port per worker. Chromium only.
// Run: `npm run e2e` in apps/web (docs/wiki/Development.md).

import { defineConfig, devices } from '@playwright/test';

const ci = !!process.env.CI;

export default defineConfig({
	testDir: './tests',
	globalSetup: './support/global-setup.ts',
	outputDir: './test-results',
	// Flaky tests are fixed or quarantined (test.fixme with an issue), never retried.
	retries: 0,
	forbidOnly: ci,
	workers: 2,
	timeout: 60_000,
	expect: { timeout: 10_000 },
	reporter: ci ? [['list'], ['html', { open: 'never', outputFolder: './playwright-report' }]] : 'list',
	use: {
		...devices['Desktop Chrome'],
		deviceScaleFactor: 1,
		locale: 'en-US',
		timezoneId: 'UTC',
		serviceWorkers: 'allow',
		trace: 'retain-on-failure',
		screenshot: 'only-on-failure',
		video: 'retain-on-failure',
		// A browser other than the one this Playwright version installs (a local
		// pre-installed Chromium): QINQIN_E2E_CHROMIUM=/path/to/chrome.
		launchOptions: process.env.QINQIN_E2E_CHROMIUM ? { executablePath: process.env.QINQIN_E2E_CHROMIUM } : {}
	},
	projects: [{ name: 'chromium' }]
});
