// Flow: pictures offline (#274). This spec's server also holds a small images pack (fixtures/images; no other spec
// sees it): offline preparation keeps its images package, and with the network off the entry page draws the picture
// from it, at phone width. Online, "Report picture" hides the picture for this learner and the next one shows.

import type { Page } from '@playwright/test';
import { test as base, expect } from '../support/fixtures';
import { fixtureImages } from '../support/build';
import { PHONE, expectNoSidewaysScroll } from '../support/layout';
import { startServer, type RunningServer } from '../support/server';
import { addCards } from '../support/study';

const test = base.extend<object, { server: RunningServer }>({
	server: [
		async ({}, use, workerInfo) => {
			const server = await startServer(workerInfo.project.outputDir, `pictures-w${workerInfo.workerIndex}`, { seed: fixtureImages });
			await use(server);
			await server.stop();
		},
		{ scope: 'worker', timeout: 60_000 }
	]
});

test.use({ viewport: PHONE, hasTouch: true, isMobile: true });

/** Online: the worker takes control, then the app prepares today's cards and keeps the images package. */
async function prepareOffline(page: Page): Promise<void> {
	await page.goto('/');
	await page.evaluate(async () => {
		await navigator.serviceWorker.ready;
	});
	await page.reload();
	await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
	await page.goto('/settings?tab=account');
	await expect(page.getByText(/Offline: ready - 1 card saved/)).toBeVisible({ timeout: 30_000 });
}

test('a picture shows with the network off, from the kept images package', async ({ page, context, learner }) => {
	await addCards(learner, 'ja', [{ kind: 'vocab', written: '水' }]);
	const id = await learner.entryId('ja', '水');
	// The server builds the package at start: wait until the catalogue lists it ready.
	await expect
		.poll(async () => (await learner.api.get<{ packages: { id: string; state: string }[] }>('/api/packages')).packages.find((p) => p.id === 'images.e2e-images')?.state, { timeout: 30_000 })
		.toBe('ready');
	await prepareOffline(page);
	const kept = await page.evaluate(async () => {
		const cache = await caches.open('qinqin-packages-v1');
		return (await cache.keys()).map((r) => new URL(r.url).pathname);
	});
	expect(kept).toEqual(['/api/packages/images.e2e-images']);

	await context.setOffline(true);
	await page.goto(`/entry/${id}`);
	const figure = page.getByTestId('entry-picture');
	await expect(figure.getByRole('img', { name: 'droplet' })).toBeVisible();
	await expect(figure).toContainText('qinqin e2e, CC0-1.0');
	await expectNoSidewaysScroll(page, `/entry/${id} offline with a picture`);
});

test('Report picture hides the picture for this learner; the next one shows', async ({ page, learner }) => {
	const id = await learner.entryId('ja', '水');
	await page.goto(`/entry/${id}`);
	const figure = page.getByTestId('entry-picture');
	await expect(figure.getByRole('img', { name: 'droplet' })).toBeVisible();
	await page.getByRole('button', { name: 'Report picture' }).click();
	await expect(page.getByRole('group', { name: 'What is wrong with this picture?' })).toBeVisible();
	await expectNoSidewaysScroll(page, `/entry/${id} reporting a picture`);
	await page.getByRole('button', { name: 'It shows something else' }).click();
	await expect(page.getByRole('status').filter({ hasText: 'Thanks. This picture won’t be shown for this word again.' })).toBeVisible();
	await expect(figure.getByRole('img', { name: 'book' })).toBeVisible();
	const reports = await learner.api.get<{ reports: { entryId: number; packId: string; concept: string }[] }>('/api/images/reports');
	expect(reports.reports).toEqual([{ entryId: id, packId: 'e2e-images', concept: 'DROP' }]);
	await page.reload();
	await expect(page.getByTestId('entry-picture').getByRole('img', { name: 'book' })).toBeVisible();
});
