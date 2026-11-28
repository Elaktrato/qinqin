// Saved sentences (#279), on a 360 px phone: a word in study offers "Save
// this sentence" in the reader's sheet; the sentence becomes an own sentence
// of the entry and a Word Salad card. The entry page lists it with Remove,
// which takes the card too. With the reader's automatic mode on, looking the
// word up is enough.

import type { Page } from '@playwright/test';
import { expect, test, type Learner } from '../support/fixtures';
import { PHONE, expectNoSidewaysScroll } from '../support/layout';
import { centreOf } from '../support/pointer';
import { addBook, addCards } from '../support/study';

test.use({ viewport: PHONE, hasTouch: true, isMobile: true });

const SENTENCE = '私は水を飲みます。';

async function tapWater(page: Page, bookId: number) {
	await page.goto(`/reader/book/${bookId}/0`);
	const paragraph = page.getByText(SENTENCE);
	await expect(paragraph).toBeVisible();
	const word = await centreOf(paragraph, '水');
	await page.touchscreen.tap(word.x, word.y);
	const sheet = page.getByRole('dialog', { name: /水/ });
	await expect(sheet).toBeVisible();
	return sheet;
}

async function sentenceCards(learner: Learner, entryId: number): Promise<{ sentenceId: number | null; deletedAt: string | null }[]> {
	const page = await learner.api.get<{ collections: { cards: { kind: string; entryId: number; sentenceId: number | null; deletedAt: string | null }[] } }>(
		`/api/sync/pull?v=2&collections=cards&limit=2000&workspace=${learner.workspaces.ja}`
	);
	return page.collections.cards.filter((c) => c.kind === 'sentence' && c.entryId === entryId);
}

async function ownSentences(learner: Learner, entryId: number): Promise<{ id: number; hanzi: string }[]> {
	const entry = await learner.api.get<{ sentences: { id: number; hanzi: string; userId: number | null }[] }>(`/api/entries/${entryId}`);
	return entry.sentences.filter((s) => s.userId !== null);
}

test('a studied word saves its book sentence as a card, and the entry page removes it', async ({ page, learner }) => {
	await addCards(learner, 'ja', [{ kind: 'vocab', written: '水' }]);
	const entryId = await learner.entryId('ja', '水');
	const bookId = await addBook(learner, 'ja', '水の本', [SENTENCE]);

	const sheet = await tapWater(page, bookId);
	await expect(sheet.getByText('In study')).toBeVisible();
	await expectNoSidewaysScroll(page, 'the reader sheet with Save this sentence');
	await sheet.getByRole('button', { name: 'Save this sentence for 水' }).click();
	await expect(sheet.getByText('Sentence saved as a new card.')).toBeVisible();

	const saved = await ownSentences(learner, entryId);
	expect(saved.map((s) => s.hanzi)).toEqual([SENTENCE]);
	await expect.poll(async () => (await sentenceCards(learner, entryId)).filter((c) => c.deletedAt === null).map((c) => c.sentenceId)).toEqual([saved[0].id]);

	await page.goto(`/entry/${entryId}`);
	const remove = page.getByRole('button', { name: 'Remove' });
	await expect(remove).toBeVisible();
	await expectNoSidewaysScroll(page, 'the entry page with a saved sentence');
	await remove.click();
	await expect(remove).toBeHidden();
	expect(await ownSentences(learner, entryId)).toEqual([]);
	await expect.poll(async () => (await sentenceCards(learner, entryId)).filter((c) => c.deletedAt === null)).toEqual([]);
});

test('the automatic mode saves the sentence when a studied word is looked up', async ({ page, learner }) => {
	await addCards(learner, 'ja', [{ kind: 'vocab', written: '水' }]);
	const entryId = await learner.entryId('ja', '水');
	const bookId = await addBook(learner, 'ja', '水の本', [SENTENCE]);
	await learner.api.call('PUT', `/api/workspaces/${learner.workspaces.ja}`, { settings: { reader: { saveSentences: true } } });

	const sheet = await tapWater(page, bookId);
	await expect(sheet.getByText('New sentence saved as a card.')).toBeVisible();
	expect((await ownSentences(learner, entryId)).map((s) => s.hanzi)).toEqual([SENTENCE]);
	await expect.poll(async () => (await sentenceCards(learner, entryId)).length).toBe(1);
});
