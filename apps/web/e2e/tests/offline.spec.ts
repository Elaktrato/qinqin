// Flow 4: the installed-app path. The service worker caches the app and
// today's cards; offline the learner studies them, the reviews wait on the
// device, and back online they reach the server exactly once.

import { expect, test } from '../support/fixtures';
import { addCards } from '../support/study';

const WORDS = ['私', '学校', '行く', '飲む'];
/** The outbox of reviews not yet sent (docs/contracts/pwa/outbox-v2.json). */
const OUTBOX_KEY = 'qinqin.study.pending.v2';

test('reviews graded offline are sent once when the browser is back online', async ({ page, context, learner }) => {
	await addCards(learner, 'ja', WORDS.map((written) => ({ kind: 'vocab' as const, written })));
	const ws = learner.workspaces.ja;

	// Online: the worker installs and takes control after a reload, then the
	// app saves today's cards for offline use (Settings → Account → App says so).
	await page.goto('/');
	await page.evaluate(async () => {
		await navigator.serviceWorker.ready;
	});
	await page.reload();
	await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
	await page.goto('/settings?tab=account');
	await expect(page.getByText(/Offline: ready - 4 cards saved/)).toBeVisible({ timeout: 30_000 });

	// Offline: the study page and the session come from the saved copies.
	await context.setOffline(true);
	await page.goto('/study');
	// The line at the top says so: "You're offline…", or "Can't reach the server…"
	// when the page noticed the failed requests before the browser's offline event.
	await expect(page.getByRole('status').filter({ hasText: /You're offline|Can't reach the server/ })).toBeVisible();
	await expect(page.getByRole('region', { name: 'This session' })).toContainText(/0\s*due\s*·\s*4\s*new/);
	await page.getByRole('button', { name: 'Start studying' }).click();
	const seen: string[] = [];
	for (let n = 1; n <= WORDS.length; n++) {
		await expect(page.getByText(new RegExp(`^${n} / ${WORDS.length}`))).toBeVisible();
		const word = page.getByRole('article', { name: 'Recognise card' }).getByText(new RegExp(`^(${WORDS.join('|')})$`));
		seen.push(await word.innerText());
		await page.getByRole('button', { name: 'Show answer' }).click();
		await page.getByRole('button', { name: /^Good\b/ }).click();
	}
	await expect(page.getByText('Session complete')).toBeVisible();
	expect(seen.sort()).toEqual([...WORDS].sort());
	await expect(page.getByText(`You're offline. ${WORDS.length} reviews are saved on this device`)).toBeVisible();
	// Nothing reached the server while offline.
	expect(await learner.api.reviews(ws)).toHaveLength(0);

	// Online again: the outbox drains on its own.
	await context.setOffline(false);
	await expect(page.getByText('All reviews sent.')).toBeVisible();
	await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), OUTBOX_KEY)).toBeNull();
	const sent = await learner.api.reviews(ws);
	expect(sent).toHaveLength(WORDS.length);
	const cards = await Promise.all(WORDS.map(async (w) => `c-vocab-${await learner.entryId('ja', w)}`));
	expect(sent.map((r) => r.payload.cardId).sort()).toEqual(cards.sort());
	expect(new Set(sent.map((r) => r.id)).size).toBe(WORDS.length);

	// A reload (which drains the outbox again at boot) sends nothing twice.
	await page.reload();
	await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
	await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), OUTBOX_KEY)).toBeNull();
	const after = await learner.api.reviews(ws);
	expect(after.map((r) => r.id).sort()).toEqual(sent.map((r) => r.id).sort());
});
