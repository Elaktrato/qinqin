// #291 at phone size, in a real browser: the Word salad tiles are reordered by dragging, with a finger
// (touch events through the DevTools protocol, as a phone sends them) and with a mouse; a quick tap still
// places a tile; the page does not scroll under a dragged tile; the lifted tile stays above the finger.

import type { Locator, Page } from '@playwright/test';
import { expect, test } from '../support/fixtures';
import { addCards } from '../support/study';

const PHONE = { width: 360, height: 740 };
test.use({ viewport: PHONE, hasTouch: true, isMobile: true });

const SENTENCE = '学校に行く。';

async function openSaladCard(page: Page, learner: Parameters<typeof addCards>[0]): Promise<void> {
	// Studied three days ago (Easy): nothing of Vocab is due, so the session is the one Word Salad card.
	await addCards(learner, 'ja', [{ kind: 'vocab', written: '学校', reviewedDaysAgo: 3 }]);
	const id = await learner.entryId('ja', '学校');
	await learner.api.post(`/api/entries/${id}/sentences`, { hanzi: SENTENCE });
	await page.goto('/');
	await page.getByRole('region', { name: 'Flashcards' }).getByRole('link', { name: 'Study' }).click();
	const sheet = page.getByRole('dialog', { name: 'Study' });
	await sheet.getByRole('checkbox', { name: 'Word Salad' }).check();
	await sheet.getByRole('button', { name: 'Start studying' }).click();
	await expect(page).toHaveURL(/\/study\/session$/);
	await expect(page.getByRole('list', { name: 'Word tiles' })).toBeVisible();
}

const answer = (page: Page) => page.getByRole('list', { name: 'Your sentence' });
const bank = (page: Page) => page.getByRole('list', { name: 'Word tiles' });
const answerWords = (page: Page) => answer(page).getByRole('button').allTextContents();

async function centre(locator: Locator): Promise<{ x: number; y: number }> {
	const box = await locator.boundingBox();
	if (box === null) throw new Error('not on screen');
	return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** The order of `tokens` that spells the sentence (a short sentence: a search is enough). */
function solve(tokens: string[]): string[] {
	const order = solveFrom(SENTENCE, tokens);
	if (order === null) throw new Error(`no order of ${tokens.join(' ')} spells ${SENTENCE}`);
	return order;
}

function solveFrom(left: string, tokens: string[]): string[] | null {
	if (left === '') return tokens.length === 0 ? [] : null;
	for (const [i, t] of tokens.entries()) {
		if (!left.startsWith(t)) continue;
		const sub = solveFrom(left.slice(t.length), [...tokens.slice(0, i), ...tokens.slice(i + 1)]);
		if (sub !== null) return [t, ...sub];
	}
	return null;
}

/**
 * A finger's drag as touch events, in small steps: first into the answer row, then onto the point `to` gives
 * once the row has made room (the row is centred, so the tiles shift as the gap opens), then released.
 */
async function touchDrag(page: Page, from: Point, via: Point, to: () => Promise<Point>, during?: (at: Point) => Promise<void>) {
	const cdp = await page.context().newCDPSession(page);
	const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', p?: Point) =>
		cdp.send('Input.dispatchTouchEvent', { type, touchPoints: p === undefined ? [] : [{ x: p.x, y: p.y }] });
	const glide = async (a: Point, b: Point) => {
		for (let i = 1; i <= 6; i++) await touch('touchMove', { x: a.x + ((b.x - a.x) * i) / 6, y: a.y + ((b.y - a.y) * i) / 6 });
	};
	await touch('touchStart', from);
	await glide(from, via);
	const end = await to();
	await glide(via, end);
	await glide(end, end); // a still finger: the row settles
	if (during !== undefined) await during(end);
	await touch('touchEnd');
	await cdp.detach();
}

/** The same with the mouse. */
async function mouseDrag(page: Page, from: Point, via: Point, to: () => Promise<Point>) {
	await page.mouse.move(from.x, from.y);
	await page.mouse.down();
	await page.mouse.move(via.x, via.y, { steps: 6 });
	const end = await to();
	await page.mouse.move(end.x, end.y, { steps: 6 });
	await page.mouse.up();
}

type Point = { x: number; y: number };

/** Just inside the start edge of the first tile in the answer row (the gap opens before it). */
async function frontOfAnswer(page: Page): Promise<Point> {
	const first = await answer(page).locator('li[data-id]').first().boundingBox();
	return { x: first!.x + 2, y: first!.y + first!.height / 2 };
}

test('a finger drags tiles into place; the tile rides above the finger and the page stays put', async ({ page, learner }) => {
	await openSaladCard(page, learner);
	const tokens = await bank(page).getByRole('button').allTextContents();
	expect(tokens.length).toBeGreaterThan(1);
	const order = solve(tokens);

	// The first tile by a quick tap, as before.
	await bank(page).getByRole('button', { name: `Place ${order.at(-1)}` }).tap();
	expect(await answerWords(page)).toEqual([order.at(-1)]);

	// Every other tile is dragged from the bank to the front of the answer, last word first.
	for (const word of order.slice(0, -1).reverse()) {
		const from = await centre(bank(page).getByRole('button', { name: `Place ${word}` }));
		const scrolled = await page.evaluate(() => window.scrollY);
		await touchDrag(page, from, await centre(answer(page)), () => frontOfAnswer(page), async (finger) => {
			const ghost = await page.locator('[data-salad-ghost]').boundingBox();
			expect(ghost, 'the lifted tile is shown').not.toBeNull();
			expect(ghost!.y + ghost!.height, 'above the finger').toBeLessThan(finger.y);
			await expect(answer(page).locator('li').first()).toHaveAttribute('data-salad-gap', '');
		});
		expect(await page.evaluate(() => window.scrollY), 'the page did not scroll').toBe(scrolled);
	}
	expect(await answerWords(page)).toEqual(order);
	await page.getByRole('button', { name: 'Check' }).click();
	await expect(page.getByText('Correct!')).toBeVisible();
});

test('a mouse drags a placed tile to a new place and back to the bank', async ({ page, learner }) => {
	await openSaladCard(page, learner);
	const tokens = await bank(page).getByRole('button').allTextContents();
	for (const word of tokens) await bank(page).getByRole('button', { name: `Place ${word}` }).click();
	expect(await answerWords(page)).toEqual(tokens);

	// The last tile to the front.
	const last = tokens.at(-1)!;
	const from = await centre(answer(page).getByRole('button', { name: `Remove ${last}` }));
	await mouseDrag(page, from, await centre(answer(page)), () => frontOfAnswer(page));
	expect(await answerWords(page)).toEqual([last, ...tokens.slice(0, -1)]);

	// The front tile back to the bank.
	const front = await centre(answer(page).getByRole('button', { name: `Remove ${last}` }));
	await mouseDrag(page, front, await centre(bank(page)), () => centre(bank(page)));
	expect(await answerWords(page)).toEqual(tokens.slice(0, -1));
	await expect(bank(page).getByRole('button', { name: `Place ${last}` })).toBeVisible();
});

test('Alt+Arrow moves a focused placed tile', async ({ page, learner }) => {
	await openSaladCard(page, learner);
	const tokens = await bank(page).getByRole('button').allTextContents();
	for (const word of tokens) await bank(page).getByRole('button', { name: `Place ${word}` }).click();
	const last = tokens.at(-1)!;
	await answer(page).getByRole('button', { name: `Remove ${last}` }).focus();
	await page.keyboard.press('Alt+ArrowLeft');
	expect(await answerWords(page)).toEqual([...tokens.slice(0, -2), last, tokens.at(-2)!]);
	await expect(answer(page).getByRole('button', { name: `Remove ${last}` })).toBeFocused();
	await expect(page).toHaveURL(/\/study\/session$/);
});
