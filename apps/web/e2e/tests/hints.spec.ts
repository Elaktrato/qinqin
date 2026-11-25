// Flow: a hint on a flashcard (#215). The Recognise card hides the reading until the Hint button or the H
// key asks for it; asking suggests Hard instead of Good and the review records meta.hints
// (docs/contracts/cards/hints.json). The settings change which hints a card offers.

import { expect, seedRandom, test } from '../support/fixtures';
import { addCards } from '../support/study';

test('asking for a hint suggests Hard and is recorded in meta.hints', async ({ page, learner }) => {
	await addCards(learner, 'ja', [{ kind: 'vocab', written: '私' }]);
	await seedRandom(page, 215);
	const ws = learner.workspaces.ja;
	const before = (await learner.api.reviews(ws)).length;

	await page.goto('/study');
	await page.getByRole('dialog', { name: 'Study' }).getByRole('button', { name: 'Start studying' }).click();
	await expect(page).toHaveURL(/\/study\/session$/);

	const card = page.getByRole('article', { name: /^Recognise card$/ });
	// The reading is hidden at first and the Hint button is offered.
	await expect(card.locator('[data-hint="reading"]')).toHaveCount(0);
	await page.keyboard.press('h');
	await expect(card.locator('[data-hint="reading"]')).toBeVisible();
	await expect(page.getByRole('button', { name: 'Hint' })).toHaveCount(0);

	await page.getByRole('button', { name: 'Show answer' }).click();
	// The hint lowered the suggestion: Hard holds the focus, not Good.
	await expect(page.getByRole('button', { name: /^Hard\b/ })).toBeFocused();
	await page.getByRole('button', { name: /^Hard\b/ }).click();

	await expect.poll(async () => (await learner.api.reviews(ws)).length - before).toBe(1);
	const review = (await learner.api.reviews(ws)).slice(before)[0];
	expect(review.payload.grade).toBe(2);
	expect(review.payload.meta).toMatchObject({ hints: 1 });
});

test('turning the reading hint off in Settings removes the Hint button', async ({ page, learner }) => {
	await addCards(learner, 'ja', [{ kind: 'vocab', written: '私' }]);
	await seedRandom(page, 215);

	// Settings → Study → Hints: reading on Recognise cards, Never.
	await page.goto('/settings?tab=study');
	const saved = page.waitForResponse((r) => r.request().method() === 'PUT' && /\/api\/workspaces\/\d+$/.test(r.url()));
	await page.getByLabel('Reading on Recognise cards').selectOption('never');
	await saved;
	await expect(page.getByLabel('Reading on Recognise cards')).toHaveValue('never');

	await page.goto('/study');
	await page.getByRole('dialog', { name: 'Study' }).getByRole('button', { name: 'Start studying' }).click();
	await expect(page).toHaveURL(/\/study\/session$/);
	await expect(page.getByRole('button', { name: 'Hint' })).toHaveCount(0);
	await page.keyboard.press('h');
	await expect(page.locator('[data-hint="reading"]')).toHaveCount(0);
});
