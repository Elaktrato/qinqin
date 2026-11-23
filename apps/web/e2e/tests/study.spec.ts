// Flow 2: a study session with two card types mixed in one session (#132),
// changing a grade with Z and with the Back button (#131), and what the
// server stores for it.

import type { Page } from '@playwright/test';
import { expect, seedRandom, test } from '../support/fixtures';
import { addCards } from '../support/study';

/** New vocab cards (Recognise). */
const NEW_WORDS = ['私', '学校', '行く', '飲む'];
/** Words studied three days ago, each with a new reverse card (Recall). */
const KNOWN_WORDS = ['水', '本', '食べる', '読む'];

/** The card type shown now: the card's heading ("Recall card, 4 of 8" reads "Recall"). */
async function currentType(page: Page): Promise<'Recognise' | 'Recall'> {
	const heading = page.getByRole('heading', { level: 1, name: /^(Recognise|Recall) card, \d+ of \d+$/ });
	await expect(heading).toBeVisible();
	return (await heading.innerText()).trim() as 'Recognise' | 'Recall';
}

async function showAnswer(page: Page): Promise<void> {
	await page.getByRole('button', { name: 'Show answer' }).click();
}

async function grade(page: Page, name: 'Again' | 'Hard' | 'Good' | 'Easy'): Promise<void> {
	await page.getByRole('button', { name: new RegExp(`^${name}\\b`) }).click();
}

test('a mixed session: both card types interleave, Z and Back change a grade', async ({ page, learner }) => {
	await addCards(
		learner,
		'ja',
		[
			...NEW_WORDS.map((written) => ({ kind: 'vocab' as const, written })),
			...KNOWN_WORDS.map((written) => ({ kind: 'vocab' as const, written, reviewedDaysAgo: 3 })),
			...KNOWN_WORDS.map((written) => ({ kind: 'reverse' as const, written }))
		],
		['reverse']
	);
	await seedRandom(page, 132);
	const ws = learner.workspaces.ja;
	const before = (await learner.api.reviews(ws)).length;

	await page.goto('/study');
	await expect(page.getByRole('region', { name: 'This session' })).toContainText(/0\s*due\s*·\s*8\s*new/);
	await page.getByRole('button', { name: 'Start studying' }).click();
	await expect(page).toHaveURL(/\/study\/session$/);

	const types: string[] = [];
	// Card 1: Again by mistake, then Z and Good (#131).
	await expect(page.getByText('1 / 8')).toBeVisible();
	types.push(await currentType(page));
	await showAnswer(page);
	await grade(page, 'Again');
	await expect(page.getByText(/^2 \/ 8/)).toBeVisible();
	// With this seed card 2 is a Recall card, its answer field focused: there Z
	// is a letter of the answer, not Back.
	const answer = page.getByRole('textbox', { name: 'Type the word' });
	await expect(answer).toBeFocused();
	await page.keyboard.press('z');
	await expect(answer).toHaveValue('z');
	await expect(page.getByText('Graded Again')).toBeHidden();
	await answer.fill('');
	await answer.blur();
	await page.keyboard.press('z');
	await expect(page.getByText('Graded Again')).toBeVisible();
	await grade(page, 'Good');
	await expect(page.getByText('Graded Again')).toBeHidden();

	// Cards 2..8; card 3 is graded Hard, then changed to Easy with the Back button.
	for (let n = 2; n <= 8; n++) {
		await expect(page.getByText(new RegExp(`^${n} / 8`))).toBeVisible();
		types.push(await currentType(page));
		await showAnswer(page);
		if (n === 3) {
			await grade(page, 'Hard');
			await page.getByRole('button', { name: /^Back to the card graded before/ }).click();
			await expect(page.getByText('Graded Hard')).toBeVisible();
			await grade(page, 'Easy');
			await expect(page.getByText('Graded Hard')).toBeHidden();
		} else {
			await grade(page, 'Good');
		}
	}
	await expect(page.getByText('Session complete')).toBeVisible();

	// #132: both types in one session, interleaved rather than one block each.
	expect(types.filter((t) => t === 'Recognise')).toHaveLength(4);
	expect(types.filter((t) => t === 'Recall')).toHaveLength(4);
	const switches = types.slice(1).filter((t, i) => t !== types[i]).length;
	expect(switches, `type order ${types.join(', ')}`).toBeGreaterThan(1);

	// The server holds one review per card plus the two replacements, each
	// replacement naming the review it voids (events/review-replace.json).
	await expect.poll(async () => (await learner.api.reviews(ws)).length - before).toBe(10);
	const reviews = (await learner.api.reviews(ws)).slice(before);
	const replacements = reviews.filter((r) => r.payload.replaces);
	expect(replacements.map((r) => r.payload.grade).sort()).toEqual([3, 4]);
	const replaced = new Set(replacements.map((r) => r.payload.replaces));
	const counted = reviews.filter((r) => !replaced.has(r.id));
	expect(counted).toHaveLength(8);
	expect(new Set(counted.map((r) => r.payload.cardId)).size).toBe(8);
	for (const r of replacements) {
		const target = reviews.find((t) => t.id === r.payload.replaces);
		expect(target?.payload.cardId).toBe(r.payload.cardId);
	}
	expect(reviews.find((r) => r.id === replacements.find((x) => x.payload.grade === 3)?.payload.replaces)?.payload.grade).toBe(1);
	expect(reviews.find((r) => r.id === replacements.find((x) => x.payload.grade === 4)?.payload.replaces)?.payload.grade).toBe(2);
});
