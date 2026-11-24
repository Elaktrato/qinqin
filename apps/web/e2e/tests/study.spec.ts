// Flow 2: a study session with two card types mixed in one session (#132),
// changing a grade with Z and with the Back button (#131), and what the
// server stores for it.

import type { Page } from '@playwright/test';
import { expect, seedRandom, test } from '../support/fixtures';
import { addCards } from '../support/study';

/** New vocab cards (Recognise: the word is the prompt). */
const NEW_WORDS = ['私', '学校', '行く', '飲む'];
/** Words studied three days ago, each with a new reverse card (Recall: the meaning is the prompt). */
const KNOWN_WORDS = ['水', '本', '食べる', '読む'];
/** The fixture pack's meaning of each word (apps/web/e2e/fixtures/packs/e2e-ja). */
const GLOSS: Record<string, string> = { 水: 'water', 本: 'book', 食べる: 'to eat', 読む: 'to read' };

type CardType = 'Recognise' | 'Recall';

interface Face {
	n: number;
	type: CardType;
	/** The word the card is about. */
	word: string;
}

const card = (page: Page) => page.getByRole('article', { name: /^(Recognise|Recall) card$/ });

/**
 * The card on the face now, read from what a learner sees: the heading's
 * accessible name ("Recall card, 4 of 8") and the prompt — the word of a
 * Recognise card, the meaning of a Recall card.
 */
async function face(page: Page): Promise<Face> {
	const heading = card(page).getByRole('heading', { level: 1 });
	await expect(heading).toHaveAccessibleName(/^(Recognise|Recall) card, \d+ of \d+$/);
	const name = /"((Recognise|Recall) card, (\d+) of \d+)"/.exec(await heading.ariaSnapshot());
	if (!name) throw new Error(`unexpected card heading ${await heading.ariaSnapshot()}`);
	const type = name[2] as CardType;
	let word: string | undefined;
	if (type === 'Recognise') {
		for (const w of NEW_WORDS) if ((await card(page).getByText(w, { exact: true }).count()) > 0) word = w;
	} else {
		const meaning = (await card(page).getByRole('region', { name: 'Meaning' }).innerText()).trim();
		word = Object.keys(GLOSS).find((w) => GLOSS[w] === meaning);
	}
	if (!word) throw new Error(`no fixture word on the ${type} card`);
	return { n: Number(name[3]), type, word };
}

async function showAnswer(page: Page): Promise<void> {
	await page.getByRole('button', { name: 'Show answer' }).click();
}

async function grade(page: Page, name: 'Again' | 'Hard' | 'Good' | 'Easy'): Promise<void> {
	await page.getByRole('button', { name: new RegExp(`^${name}\\b`) }).click();
}

/** Takes focus out of a Recall card's answer field, where Z is a letter. */
async function leaveTextField(page: Page): Promise<void> {
	await page.evaluate(() => {
		const el = document.activeElement;
		if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) el.blur();
	});
}

/** Waits for card n of 8 and reads it. */
async function cardAt(page: Page, n: number): Promise<Face> {
	await expect(page.getByText(new RegExp(`^${n} / 8`))).toBeVisible();
	// The counter can change a frame before the new card's face has rendered:
	// read the face until it is card n with a fixture word on it (a condition,
	// not a sleep; it fails after the timeout like any other expectation).
	let f: Face | undefined;
	await expect(async () => {
		f = await face(page);
		expect(f.n).toBe(n);
	}).toPass({ timeout: 10_000 });
	return f as Face;
}

test('a mixed session: both card types interleave, Z and Back change a grade', async ({ page, learner }) => {
	await addCards(
		learner,
		'ja',
		[
			...NEW_WORDS.map((written) => ({ kind: 'vocab' as const, written })),
			...KNOWN_WORDS.map((written) => ({ kind: 'reverse' as const, written })),
			...KNOWN_WORDS.map((written) => ({ kind: 'vocab' as const, written, reviewedDaysAgo: 3 }))
		],
		['reverse']
	);
	// Repeatability only: nothing below depends on where a type lands.
	await seedRandom(page, 132);
	const ws = learner.workspaces.ja;
	const before = (await learner.api.reviews(ws)).length;

	await page.goto('/study');
	await expect(page.getByRole('region', { name: 'This session' })).toContainText(/0\s*due\s*·\s*8\s*new/);
	await page.getByRole('button', { name: 'Start studying' }).click();
	await expect(page).toHaveURL(/\/study\/session$/);

	const faces: Face[] = [];
	let typedZ = false;
	/** At the first Recall card, wherever it lands: Z typed into its answer field is a letter, not Back. */
	const checkZInAnswerField = async (f: Face) => {
		if (typedZ || f.type !== 'Recall') return;
		typedZ = true;
		const answer = page.getByRole('textbox', { name: 'Type the word' });
		await expect(answer).toBeFocused();
		await page.keyboard.press('z');
		await expect(answer).toHaveValue('z');
		await expect(page.getByText(/^Graded /)).toHaveCount(0);
		await answer.fill('');
	};

	// Card 1: Again by mistake, then Z shows card 1 again and Good replaces the grade (#131).
	faces.push(await cardAt(page, 1));
	await checkZInAnswerField(faces[0]);
	await showAnswer(page);
	await grade(page, 'Again');
	const second = await cardAt(page, 2);
	await checkZInAnswerField(second);
	await leaveTextField(page);
	await page.keyboard.press('z');
	await expect(page.getByText('Graded Again')).toBeVisible();
	await expect(card(page)).toContainText(faces[0].word);
	await expect(card(page)).not.toContainText(second.word);
	await grade(page, 'Good');
	await expect(page.getByText('Graded Again')).toBeHidden();
	// Back on the card that was current, unanswered.
	expect(await cardAt(page, 2)).toEqual(second);
	await expect(page.getByRole('button', { name: 'Show answer' })).toBeVisible();

	// Cards 2..8; card 3 is graded Hard, then changed to Easy with the Back button.
	for (let n = 2; n <= 8; n++) {
		const f = await cardAt(page, n);
		faces.push(f);
		await checkZInAnswerField(f);
		await showAnswer(page);
		if (n === 3) {
			await grade(page, 'Hard');
			const fourth = await cardAt(page, 4);
			await page.getByRole('button', { name: /^Back to the card graded before/ }).click();
			await expect(page.getByText('Graded Hard')).toBeVisible();
			await expect(card(page)).toContainText(f.word);
			await expect(card(page)).not.toContainText(fourth.word);
			await grade(page, 'Easy');
			await expect(page.getByText('Graded Hard')).toBeHidden();
			expect(await cardAt(page, 4)).toEqual(fourth);
		} else {
			await grade(page, 'Good');
		}
	}
	await expect(page.getByText('Session complete')).toBeVisible();
	expect(typedZ, 'the session had a Recall card').toBe(true);

	// #132: both types in one session, interleaved rather than one block each.
	const types = faces.map((f) => f.type);
	expect(types.filter((t) => t === 'Recognise')).toHaveLength(4);
	expect(types.filter((t) => t === 'Recall')).toHaveLength(4);
	const switches = types.slice(1).filter((t, i) => t !== types[i]).length;
	expect(switches, `type order ${types.join(', ')}`).toBeGreaterThan(1);
	expect(new Set(faces.map((f) => `${f.type} ${f.word}`)).size).toBe(8);

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
	const targetOf = (g: number) => reviews.find((r) => r.id === replacements.find((x) => x.payload.grade === g)?.payload.replaces);
	expect(targetOf(3)?.payload.grade).toBe(1);
	expect(targetOf(4)?.payload.grade).toBe(2);
	// The replaced reviews are those of cards 1 and 3.
	const cardIdOf = async (f: Face) => `c-${f.type === 'Recognise' ? 'vocab' : 'reverse'}-${await learner.entryId('ja', f.word)}`;
	expect(targetOf(3)?.payload.cardId).toBe(await cardIdOf(faces[0]));
	expect(targetOf(4)?.payload.cardId).toBe(await cardIdOf(faces[2]));
});
