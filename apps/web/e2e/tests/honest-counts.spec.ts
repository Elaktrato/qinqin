// #288 and #289 at phone size: a Japanese deck where only some words have an
// example sentence. The study modal offers Word Salad only when a word can make
// one, its "This session" is the session's length, and the session's counter
// never shrinks under the learner (it went 0/20, 0/1, "no cards").

import type { Page } from '@playwright/test';
import { expect, test } from '../support/fixtures';
import type { Learner } from '../support/fixtures';
import { addCards } from '../support/study';

const PHONE = { width: 360, height: 740 };
test.use({ viewport: PHONE, hasTouch: true, isMobile: true });

// Studied three days ago (Easy): nothing of Vocab is due, so only the companions are new.
const WORDS = ['私', '学校', '行く', '水'];

async function addSentence(learner: Learner, written: string, hanzi: string): Promise<void> {
	const id = await learner.entryId('ja', written);
	await learner.api.post(`/api/entries/${id}/sentences`, { hanzi });
}

async function openModal(page: Page) {
	await page.goto('/');
	await page.getByRole('region', { name: 'Flashcards' }).getByRole('link', { name: 'Study' }).click();
	const sheet = page.getByRole('dialog', { name: 'Study' });
	await expect(sheet).toBeVisible();
	return sheet;
}

async function noHorizontalScroll(page: Page): Promise<void> {
	const overflow = await page.evaluate(() => {
		const root = document.scrollingElement ?? document.documentElement;
		return root.scrollWidth - root.clientWidth;
	});
	expect(overflow, 'no horizontal scroll at 360 px').toBeLessThanOrEqual(0);
}

test('Word Salad is hidden with the reason while no word has a sentence', async ({ page, learner }) => {
	await addCards(learner, 'ja', WORDS.map((written) => ({ kind: 'vocab' as const, written, reviewedDaysAgo: 3 })));
	const sheet = await openModal(page);
	await expect(sheet).toContainText('Word Salad: no example sentences for these words yet.');
	await expect(sheet.getByRole('checkbox', { name: 'Word Salad' })).toHaveCount(0);
	await expect(sheet.getByRole('button', { name: 'Start studying' })).toBeDisabled();
	await noHorizontalScroll(page);
});

test('half the words have a sentence: the modal count is the session length, and the counter holds', async ({ page, learner }) => {
	await addCards(learner, 'ja', WORDS.map((written) => ({ kind: 'vocab' as const, written, reviewedDaysAgo: 3 })));
	await addSentence(learner, '学校', '学校に行く。');
	await addSentence(learner, '水', '水を飲む。');
	const sheet = await openModal(page);
	const salad = sheet.getByRole('checkbox', { name: 'Word Salad' });
	await expect(salad).not.toBeChecked();
	await salad.check();
	await expect(sheet).toContainText('This session: 2 cards');
	await noHorizontalScroll(page);
	await sheet.getByRole('button', { name: 'Start studying' }).click();
	await expect(page).toHaveURL(/\/study\/session$/);

	for (const n of [1, 2]) {
		await expect(page.getByText(new RegExp(`^${n} / 2`))).toBeVisible();
		await noHorizontalScroll(page);
		await page.getByRole('button', { name: 'Show answer' }).click();
		await page.getByRole('button', { name: /^Good\b/ }).click();
	}
	await expect(page.getByText('Session complete')).toBeVisible();
	await expect(page.getByText(/no cards/i)).toHaveCount(0);
});
