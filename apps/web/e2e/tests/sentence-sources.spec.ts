// Sentence sources (#280), on a 360 px phone: a sentence saved from the
// reader keeps its book and place; the word's page links back to the reader
// at the word (marked), the back button returns to the word's page, and a
// deleted book leaves the title as text.

import { expect, test } from '../support/fixtures';
import { PHONE, expectNoSidewaysScroll } from '../support/layout';
import { centreOf } from '../support/pointer';
import { addBook, addCards } from '../support/study';

test.use({ viewport: PHONE, hasTouch: true, isMobile: true });

const SENTENCE = '私は水を飲みます。';
const FILLER = Array.from({ length: 30 }, (_, i) => `これは${i + 1}番目の段落です。本を読みます。`);

test('a saved sentence links back to its place in the book', async ({ page, learner }) => {
	await addCards(learner, 'ja', [{ kind: 'vocab', written: '水' }]);
	const entryId = await learner.entryId('ja', '水');
	const bookId = await addBook(learner, 'ja', '水の本', [...FILLER, SENTENCE]);

	await page.goto(`/reader/book/${bookId}/0`);
	const paragraph = page.getByText(SENTENCE);
	await paragraph.scrollIntoViewIfNeeded();
	const word = await centreOf(paragraph, '水');
	await page.touchscreen.tap(word.x, word.y);
	const sheet = page.getByRole('dialog', { name: /水/ });
	await sheet.getByRole('button', { name: 'Save this sentence for 水' }).click();
	await expect(sheet.getByText('Sentence saved as a new card.')).toBeVisible();

	const entry = await learner.api.get<{ sentences: { userId: number | null; source?: Record<string, unknown> }[] }>(`/api/entries/${entryId}`);
	const own = entry.sentences.filter((s) => s.userId !== null);
	expect(own.map((s) => s.source)).toEqual([
		{ kind: 'book', bookId, title: '水の本', chapter: 0, paragraph: expect.any(Number), start: 2, end: 3 }
	]);
	const at = `${own[0].source!.paragraph}:2-3`;

	await page.goto(`/entry/${entryId}`);
	const link = page.getByRole('link', { name: 'From 水の本, chapter 1' });
	await expect(link).toBeVisible();
	await expectNoSidewaysScroll(page, 'the entry page with a sentence source');
	await link.click();
	await expect(page).toHaveURL(new RegExp(`/reader/book/${bookId}/0\\?at=${at}$`));
	await expect(page.getByText(SENTENCE)).toBeInViewport();
	await expect.poll(() => page.evaluate(() => CSS.highlights.has('reader-source'))).toBe(true);
	await expectNoSidewaysScroll(page, 'the reader opened at a saved sentence');

	// Back (the Android shell's back button is history back) returns to the word's page.
	await page.goBack();
	await expect(page).toHaveURL(new RegExp(`/entry/${entryId}$`));
	await expect(page.getByRole('link', { name: 'From 水の本, chapter 1' })).toBeVisible();

	// The book goes: the title stays, without a link.
	await learner.api.call('DELETE', `/api/library/books/${bookId}`);
	await page.reload();
	await expect(page.getByText('From 水の本, chapter 1 · the book was removed')).toBeVisible();
	await expect(page.getByRole('link', { name: /From 水の本/ })).toHaveCount(0);
});
