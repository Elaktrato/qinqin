// The conversation partner (#185) against the server's fake AI provider: the
// learner stores a (fake) key, starts a conversation, looks up a word of the
// partner's reply, gets corrections on a message and saves the conversation
// as a journal entry.

import { expect, test } from '../support/fixtures';
import { pointAt } from '../support/pointer';

test('a conversation with the partner is corrected, looked up and saved as an entry', async ({ page, learner }) => {
	// Nothing is sent without the learner's own key: store one (the fake accepts any key without "bad").
	await learner.api.call('PUT', '/api/ai/keys/anthropic', { key: 'sk-fake-good-key-e2e01' });

	await page.goto('/journal');
	await page.getByRole('link', { name: 'Talk with the AI' }).click();
	await expect(page).toHaveURL(/\/journal\/talk$/);
	await page.getByRole('textbox', { name: 'Topic (optional)' }).fill('学校');
	await page.getByRole('combobox', { name: 'Your level' }).selectOption('elementary');
	await page.getByRole('button', { name: 'Start' }).click();
	await expect(page).toHaveURL(/\/journal\/talk\/[0-9a-z]+$/);

	// The partner opens, in the workspace language; the provider is named.
	await page.getByRole('button', { name: 'Let the partner begin' }).click();
	const reply = page.getByText('こんにちは！今日は学校に行きましたか？', { exact: true });
	// The live region reads it out too.
	await expect(page.getByText('Partner: こんにちは！今日は学校に行きましたか？')).toBeAttached();
	await expect(reply).toBeVisible();
	await expect(page.getByText(/Answered by .*Anthropic/)).toBeVisible();

	// The reader's lookup popup works on the reply.
	await pointAt(page, reply, '学');
	const popup = page.getByRole('dialog', { name: /学校/ });
	await expect(popup).toContainText('school');
	await page.keyboard.press('Escape');
	await expect(popup).toBeHidden();

	// The learner's message gets the journal's corrections in the margin.
	await page.getByRole('textbox', { name: 'Your message' }).fill('私は学校に行きました。');
	await page.getByRole('button', { name: 'Send' }).click();
	const margin = page.getByRole('complementary');
	await expect(margin).toContainText('私は');
	await page.getByRole('button', { name: /^私は/ }).click();
	await expect(margin).toContainText('Fake explanation in en');

	// Saved as a journal entry: the transcript, the partner's lines quoted.
	await page.getByRole('button', { name: 'Save as journal entry' }).click();
	await expect(page).toHaveURL(/\/journal\/e\/[^/]+$/);
	await expect(page.getByRole('textbox', { name: 'Entry' })).toHaveValue(/^> こんにちは！今日は学校に行きましたか？\n\n私は学校に行きました。\n\n> /);
	const left = await learner.api.get<unknown[]>(`/api/journal/conversations?workspace=${learner.workspaces.ja}`);
	expect(left).toEqual([]);
});
