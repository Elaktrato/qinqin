// Extra flows (cheap and stable): search an entry and add it to study; switch
// the workspace to another language.

import { expect, test } from '../support/fixtures';

test('searching a word and adding it to study creates its card', async ({ page, learner }) => {
	await page.goto('/search');
	await page.getByRole('searchbox', { name: 'Search entries' }).fill('学校');
	await page.getByRole('button', { name: 'Search', exact: true }).click();
	const results = page.getByRole('list', { name: 'Search results' });
	await expect(results.getByRole('link', { name: /学校/ })).toContainText('school');
	await expect(page.getByRole('heading', { level: 2, name: '学校' })).toBeVisible();

	await page.getByRole('button', { name: 'Add to deck' }).click();
	await expect(page.getByRole('status').filter({ hasText: 'Added to study.' })).toBeVisible();
	await expect(page.getByText('In study deck')).toBeVisible();

	const id = await learner.entryId('ja', '学校');
	await expect
		.poll(async () => {
			const pull = await learner.api.get<{ collections: { cards: { id: string; deckIds: string[] }[] } }>(
				`/api/sync/pull?v=2&collections=cards&workspace=${learner.workspaces.ja}`
			);
			return pull.collections.cards.map((c) => `${c.id} ${c.deckIds.join(',')}`);
		})
		.toEqual([`c-vocab-${id} general`]);
});

test('switching the workspace changes the language of search', async ({ page }) => {
	await page.goto('/search');
	await page.getByRole('button', { name: 'Workspace: Japanese' }).click();
	await page.getByRole('menuitemradio', { name: 'Chinese' }).click();
	await expect(page.getByRole('button', { name: 'Workspace: Chinese' })).toBeVisible();

	await page.getByRole('searchbox', { name: 'Search entries' }).fill('学习');
	await page.getByRole('button', { name: 'Search', exact: true }).click();
	await expect(page.getByRole('list', { name: 'Search results' }).getByRole('link', { name: /学习/ })).toContainText('to study');

	// The choice is kept across a reload.
	await page.reload();
	await expect(page.getByRole('button', { name: 'Workspace: Chinese' })).toBeVisible();
});
