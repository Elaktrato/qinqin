// The journal and grammar as core features (#199): a learner writes a journal
// entry at /journal and finds it again after a reload and on the server; the
// grammar page answers at /grammar; an old plugin link lands on the core route.

import { expect, test } from '../support/fixtures';

test('a journal entry is saved at /journal and grammar answers at /grammar', async ({ page, learner }) => {
	await page.goto('/journal');
	await page.getByRole('link', { name: 'New entry' }).first().click();
	await expect(page).toHaveURL(/\/journal\/new/);
	const text = '今天我去了学校。';
	await page.getByRole('textbox', { name: 'Entry' }).fill(text);
	// The editor saves as you type.
	await expect(page.getByText(/· Saved$/)).toBeVisible();

	// On the server: typed storage behind /api/journal/entries, in one of the learner's workspaces.
	await expect
		.poll(async () => {
			const lists = await Promise.all(
				Object.values(learner.workspaces).map((ws) =>
					learner.api.get<{ text: string }[]>(`/api/journal/entries?workspace=${ws}`)
				)
			);
			return lists.flat().map((e) => e.text);
		})
		.toEqual([text]);

	// A fresh load of the journal lists it and opens it.
	await page.goto('/journal');
	await page.getByRole('link', { name: new RegExp(text) }).click();
	await expect(page).toHaveURL(/\/journal\/e\/[^/]+$/);
	await expect(page.getByRole('textbox', { name: 'Entry' })).toHaveValue(text);

	// No grammar pack is installed in the suite: the page says so.
	await page.goto('/grammar');
	await expect(page.getByText('No grammar lessons for this language yet.')).toBeVisible();

	// An old plugin URL lands on the core route.
	await page.goto('/p/journal');
	await expect(page).toHaveURL(/\/journal$/);
});
