// The Practice area without a drill for the workspace language, on a 360 px phone. Chinese (tone pairs) and
// Japanese (conjugation) both have a drill, so this spec's server also holds a one-word Korean pack
// (fixtures/no-drill; no other spec sees it): in the Korean workspace /practice still answers, says no drill applies,
// and Practice is not in the navigation.

import { test as base, expect } from '../support/fixtures';
import { fixtureNoDrill } from '../support/build';
import { PHONE, expectNoSidewaysScroll } from '../support/layout';
import { startServer, type RunningServer } from '../support/server';

const test = base.extend<object, { server: RunningServer }>({
	server: [
		async ({}, use, workerInfo) => {
			const server = await startServer(workerInfo.project.outputDir, `no-drill-w${workerInfo.workerIndex}`, { seed: fixtureNoDrill });
			await use(server);
			await server.stop();
		},
		{ scope: 'worker', timeout: 60_000 }
	]
});

test.use({ viewport: PHONE, hasTouch: true, isMobile: true });

test('without a drill for the language, /practice answers and Practice stays out of the navigation', async ({ page, learner }) => {
	expect(learner.workspaces.ko, 'a Korean workspace from the seeded pack').toBeDefined();
	await page.addInitScript((id) => localStorage.setItem('qinqin.workspace', String(id)), learner.workspaces.ko);
	await page.goto('/practice');
	await expect(page.getByText('No drills for this language yet.')).toBeVisible();
	await expectNoSidewaysScroll(page, '/practice (no drill)');
	const bar = page.getByRole('navigation', { name: 'Main' });
	await bar.getByRole('button', { name: 'More' }).click();
	await expect(page.getByRole('dialog').getByRole('link', { name: 'Grammar' })).toBeVisible();
	await expect(page.getByRole('dialog').getByRole('link', { name: 'Practice' })).toHaveCount(0);
});
