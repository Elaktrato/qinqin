// AI example sentences on demand (#186) against the server's fake AI
// provider: on the entry page of a word without examples the learner
// generates examples with their own (fake) key, keeps one and reports one;
// the kept one is an own sentence marked as AI-written, also after a reload.

import { expect, test } from '../support/fixtures';

test('a learner generates AI examples for a word, keeps one and reports one', async ({ page, learner }) => {
	// Nothing is sent without the learner's own key: store one (the fake accepts any key without "bad").
	await learner.api.call('PUT', '/api/ai/keys/anthropic', { key: 'sk-fake-good-key-e2e02' });
	const id = await learner.entryId('ja', '学校');

	await page.goto(`/entry/${id}`);
	const panel = page.getByRole('region', { name: 'AI examples', exact: true });
	await expect(panel).toBeVisible();
	await panel.getByRole('combobox', { name: 'Your level' }).selectOption('elementary');
	await panel.getByRole('button', { name: 'Generate examples' }).click();

	// The fake writes five sentences; the server leaves out the one without the word.
	await expect(panel.getByRole('status')).toHaveText(/4 new examples\. Keep the ones you like\. 1 was left out/);
	await expect(panel.getByText('学校が好きです。', { exact: true })).toBeVisible();
	await expect(panel.getByText('あいうえお。', { exact: true })).toHaveCount(0);
	await expect(panel.getByText(/^AI-written · .+ · Anthropic$/)).toHaveCount(4);

	// Keep the first: it joins the word's examples, marked as AI-written.
	await panel.getByRole('button', { name: 'Keep' }).first().click();
	await expect(panel.getByRole('status')).toHaveText(/^Kept\./);
	const examples = page.getByRole('region', { name: 'Examples', exact: true });
	await expect(examples.getByText('学校が好きです。', { exact: true })).toBeVisible();
	await expect(examples.getByText(/^AI-written · .+ · Anthropic$/)).toBeVisible();

	// Report another draft with a reason: it goes.
	await panel.getByRole('button', { name: 'Report' }).first().click();
	await panel.getByRole('combobox', { name: 'What is wrong with it?' }).selectOption('unnatural');
	await panel.getByRole('button', { name: 'Report and delete' }).click();
	await expect(panel.getByRole('status')).toHaveText(/^Reported and deleted\./);
	await expect(panel.getByText('これは学校です。', { exact: true })).toHaveCount(0);

	// The server stored the kept one as the learner's own sentence, marked.
	const entry = await learner.api.get<{ sentences: { hanzi: string; ai: { provider: string; model: string } | null }[] }>(`/api/entries/${id}`);
	expect(entry.sentences).toEqual([expect.objectContaining({ hanzi: '学校が好きです。', ai: expect.objectContaining({ provider: 'anthropic' }) })]);
	const left = await learner.api.get<{ drafts: { hanzi: string }[] }>(`/api/entries/${id}/examples`);
	expect(left.drafts.map((d) => d.hanzi)).toEqual(['学校はとても大切です。', '今日は学校の話をしました。']);

	// After a reload the mark is still there.
	await page.reload();
	await expect(page.getByRole('region', { name: 'Examples', exact: true }).getByText(/^AI-written · .+ · Anthropic$/)).toBeVisible();
});
