// Flow 4: the installed-app path. The service worker caches the app and
// today's cards; offline the learner studies them, the reviews wait on the
// device, and back online they reach the server exactly once, unchanged.

import type { Page } from '@playwright/test';
import { expect, test } from '../support/fixtures';
import { addCards } from '../support/study';

const WORDS = ['私', '学校', '行く', '飲む'];
/** The grade given to each card on first sight, in order: four different grades. */
const GRADES = ['Again', 'Hard', 'Good', 'Easy'] as const;
const GRADE_VALUE = { Again: 1, Hard: 2, Good: 3, Easy: 4 } as const;

/** Online: the worker takes control after a reload, then the app saves today's cards for offline use. */
async function prepareOffline(page: Page, cards: number): Promise<void> {
	await page.goto('/');
	await page.evaluate(async () => {
		await navigator.serviceWorker.ready;
	});
	await page.reload();
	await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
	await page.goto('/settings?tab=account');
	await expect(page.getByText(new RegExp(`Offline: ready - ${cards} cards? saved`))).toBeVisible({ timeout: 30_000 });
}

test('reviews graded offline are sent once when the browser is back online', async ({ page, context, learner }) => {
	await addCards(learner, 'ja', WORDS.map((written) => ({ kind: 'vocab' as const, written })));
	const ws = learner.workspaces.ja;
	await prepareOffline(page, WORDS.length);

	// Offline: the study page and the session come from the saved copies.
	await context.setOffline(true);
	await page.goto('/study');
	// The line at the top says so: "You're offline…", or "Can't reach the server…"
	// when the page noticed the failed requests before the browser's offline event.
	await expect(page.getByRole('status').filter({ hasText: /You're offline|Can't reach the server/ })).toBeVisible();
	const modal = page.getByRole('dialog', { name: 'Study' });
	await expect(modal).toContainText(/0 due · 4 new/);
	const sessionStart = Date.now();
	await modal.getByRole('button', { name: 'Start studying' }).click();

	// Each word gets its own grade the first time. A card graded Again comes back
	// once as practice (graded Good, not recorded).
	const expected = new Map<string, number[]>();
	const done = page.getByText('Session complete');
	const showAnswer = page.getByRole('button', { name: 'Show answer' });
	let lastGrade = 0;
	for (let shown = 0; ; shown++) {
		await expect(done.or(showAnswer)).toBeVisible();
		if (await done.isVisible()) break;
		expect(shown, 'the session ends').toBeLessThan(10);
		const word = await page.getByRole('article', { name: 'Recognise card' }).getByText(new RegExp(`^(${WORDS.join('|')})$`)).innerText();
		const name = expected.has(word) ? 'Good' : GRADES[expected.size];
		if (!expected.has(word)) expected.set(word, [GRADE_VALUE[name]]);
		await showAnswer.click();
		await page.getByRole('button', { name: new RegExp(`^${name}\\b`) }).click();
		lastGrade = Date.now();
	}
	expect([...expected.keys()].sort()).toEqual([...WORDS].sort());
	const total = [...expected.values()].flat().length;
	await expect(page.getByText(`You're offline. ${total} reviews are saved on this device`)).toBeVisible();
	// Nothing reached the server while offline.
	expect(await learner.api.reviews(ws)).toHaveLength(0);

	// The server stores whole seconds: go online only in a later second than the
	// last grade, so a review stamped at sending time would be told apart.
	await expect.poll(() => Math.floor(Date.now() / 1000)).toBeGreaterThan(Math.floor(lastGrade / 1000));
	await context.setOffline(false);
	await expect(page.getByText('All reviews sent.')).toBeVisible();
	await expect.poll(async () => (await learner.api.reviews(ws)).length).toBe(total);

	// Each review reached the server once, with its grade and the time it was graded.
	const sent = await learner.api.reviews(ws);
	expect(new Set(sent.map((r) => r.id)).size).toBe(total);
	for (const word of WORDS) {
		const cardId = `c-vocab-${await learner.entryId('ja', word)}`;
		const mine = sent.filter((r) => r.payload.cardId === cardId).sort((a, b) => a.ts.localeCompare(b.ts) || a.id.localeCompare(b.id));
		expect(mine.map((r) => r.payload.grade), word).toEqual(expected.get(word));
	}
	for (const r of sent) {
		const ts = Date.parse(r.ts);
		expect(ts, `${r.payload.cardId} graded at ${r.ts}`).toBeGreaterThanOrEqual(Math.floor(sessionStart / 1000) * 1000);
		// At most the second of the last grade, which ended before the browser went online.
		expect(ts, `${r.payload.cardId} graded at ${r.ts}`).toBeLessThanOrEqual(Math.floor(lastGrade / 1000) * 1000);
	}

	// A reload sends nothing twice: once the study page has read the history
	// back from the server (no new cards left: all four were reviewed), the
	// server still holds the same reviews.
	await page.goto('/study');
	await expect(page.getByRole('dialog', { name: 'Study' })).toContainText(/\d+ due · 0 new/);
	await expect(page.getByRole('status').filter({ hasText: /reviews are saved on this device/ })).toHaveCount(0);
	const after = await learner.api.reviews(ws);
	expect(after.map((r) => r.id).sort()).toEqual(sent.map((r) => r.id).sort());
});

test('a reverse card the decks switch on is saved for offline study too', async ({ page, context, learner }) => {
	// 水 was learned three days ago (not due); its reverse card is new. 私 is a new word.
	await addCards(
		learner,
		'ja',
		[
			{ kind: 'vocab', written: '私' },
			{ kind: 'vocab', written: '水', reviewedDaysAgo: 3 },
			{ kind: 'reverse', written: '水' }
		],
		['reverse']
	);
	// The study modal is never opened online in this tab and nothing is saved:
	// the preparation must find the reverse card from the deck settings and the default setup.
	await prepareOffline(page, 2);

	await context.setOffline(true);
	await page.goto('/study');
	const modal = page.getByRole('dialog', { name: 'Study' });
	await expect(modal).toContainText(/0 due · 2 new/);
	await modal.getByRole('button', { name: 'Start studying' }).click();
	const seen: string[] = [];
	for (let n = 1; n <= 2; n++) {
		await expect(page.getByText(new RegExp(`^${n} / 2`))).toBeVisible();
		const article = page.getByRole('article', { name: /^(Recognise|Recall) card$/ });
		await expect(article).not.toContainText('Could not load this word');
		seen.push((await article.getAttribute('aria-label')) ?? '');
		await page.getByRole('button', { name: 'Show answer' }).click();
		await page.getByRole('button', { name: /^Good\b/ }).click();
	}
	await expect(page.getByText('Session complete')).toBeVisible();
	expect(seen.sort()).toEqual(['Recall card', 'Recognise card']);

	await context.setOffline(false);
	await expect(page.getByText('All reviews sent.')).toBeVisible();
	// The two new reviews, after 水's earlier one from the fixture.
	await expect
		.poll(async () => (await learner.api.reviews(learner.workspaces.ja)).slice(1).map((r) => r.payload.mode).sort())
		.toEqual(['reverse', 'vocab']);
});
