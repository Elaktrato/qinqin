// The mistake notebook (#227) on a 360 px phone in the Chinese workspace: a card answered Again and a tone pair
// answered wrong are in it, grouped; "Practise my mistakes" asks the tone pair and its right answer counts towards
// leaving; Remove takes the card out with a notebook event the server keeps. The fixture's level list has 学习 (2-2).

import { expect, test } from '../support/fixtures';
import { PHONE, expectNoSidewaysScroll } from '../support/layout';
import { ulid } from '../support/api';
import { addCards } from '../support/study';

test.use({ viewport: PHONE, hasTouch: true, isMobile: true });

const DAY = 86_400_000;

test('the notebook gathers mistakes, practises them and takes one out by hand', async ({ page, learner }) => {
	const ws = learner.workspaces.zh;
	await addCards(learner, 'zh', [{ kind: 'vocab', written: '你好', reviewedDaysAgo: 3 }]);
	const entry = await learner.entryId('zh', '你好');
	const now = Date.now();
	await learner.api.post('/api/events/batch', {
		events: [
			{ id: ulid(now - 2 * DAY), workspaceId: ws, device: 'e2e', ts: new Date(now - 2 * DAY).toISOString(), type: 'review', payload: { cardId: `c-vocab-${entry}`, mode: 'vocab', grade: 1 } },
			{ id: ulid(now - DAY), workspaceId: ws, device: 'e2e', ts: new Date(now - DAY).toISOString(), type: 'drill.tone-pairs', payload: { item: '2-2', mode: 'mark', grade: 1 } }
		]
	});
	await page.addInitScript((id) => localStorage.setItem('qinqin.workspace', String(id)), ws);

	// From the Decks page.
	await page.goto('/flashcards');
	await page.getByRole('link', { name: 'Mistake notebook' }).click();
	await expect(page).toHaveURL(/\/notebook$/);
	const words = page.getByRole('region', { name: 'Words' });
	await expect(words.getByText('你好')).toBeVisible();
	await expect(words.getByText('Answered Again')).toBeVisible();
	const tones = page.getByRole('region', { name: 'Tones' });
	await expect(tones.getByText('Tone pairs')).toBeVisible();
	await expect(page.getByText('1 drill item to practise.')).toBeVisible();
	await expectNoSidewaysScroll(page, '/notebook');

	await page.getByRole('link', { name: 'Practise my mistakes' }).click();
	await expect(page).toHaveURL(/\/notebook\/practise$/);
	await expect(page.getByText('Question 1 of 1')).toBeVisible();
	await expect(page.locator('.written')).toHaveText('学习');
	await expectNoSidewaysScroll(page, '/notebook/practise');
	const field = page.getByLabel('Tones', { exact: true });
	await field.fill('2 2');
	await field.press('Enter');
	await expect(page.getByText('Right: 2-2.')).toBeVisible();

	await page.goto('/notebook');
	await expect(page.getByRole('region', { name: 'Tones' }).getByText('1 of 3 right in a row')).toBeVisible();
	await page.getByRole('button', { name: 'Remove 你好 from the notebook' }).click();
	await expect(page.getByText('Removed 你好 from the notebook.')).toBeVisible();
	await expect(page.getByRole('region', { name: 'Words' })).toHaveCount(0);

	// The mark is an event the server keeps: a reload still has the card out.
	await expect
		.poll(async () => (await learner.api.events(ws)).filter((e) => e.type === 'notebook').map((e) => e.payload))
		.toEqual([{ action: 'remove', item: `card:c-vocab-${entry}` }]);
	await page.reload();
	await expect(page.getByRole('region', { name: 'Tones' })).toBeVisible();
	await expect(page.getByRole('region', { name: 'Words' })).toHaveCount(0);
});
