// The writing-system trainer (#204, kana #63): it appears in a Japanese workspace only, a practice round records
// `script` events on the server, and the progress shows in the chart after a reload.

import { expect, test } from '../support/fixtures';

interface ScriptEvent {
	type: string;
	payload: { system: string; item: string; mode: string; ok: boolean };
}

test('kana practice is recorded as script events and shows in the chart', async ({ page, learner }) => {
	await page.addInitScript((id) => localStorage.setItem('qinqin.workspace', String(id)), learner.workspaces.ja);
	await page.goto('/scripts');

	await expect(page.getByRole('heading', { name: 'Scripts' })).toBeVisible();
	await expect(page.getByRole('link', { name: 'Katakana' })).toBeVisible();
	await expect(page.getByRole('button', { name: 'あ, a, Not seen yet' })).toBeVisible();

	await page.getByRole('link', { name: 'Recognise' }).click();
	await expect(page).toHaveURL(/\/scripts\/hiragana\/practice\/recognise$/);
	const glyph = (await page.locator('.shown').textContent()) ?? '';
	const answers: Record<string, string> = { あ: 'a', い: 'i', う: 'u', え: 'e', お: 'o', か: 'ka', き: 'ki', く: 'ku', け: 'ke', こ: 'ko' };
	// The first round of new letters asks the first five of the chart (あ い う え お) among ten.
	const roman = answers[glyph];
	test.skip(roman === undefined, 'the round started with a letter outside the table');
	await page.getByRole('button', { name: roman, exact: true }).click();
	await expect(page.getByText('Correct.')).toBeVisible();

	await expect
		.poll(async () => {
			const events = await learner.api.events(learner.workspaces.ja);
			return events.filter((e) => e.type === 'script').map((e) => [(e.payload as ScriptEvent['payload']).item, (e.payload as ScriptEvent['payload']).ok]);
		})
		.toEqual([[`hiragana:${glyph}`, true]]);

	// A fresh load counts it: the letter is no longer "not seen".
	await page.goto('/scripts');
	await expect(page.getByRole('button', { name: new RegExp(`^${glyph}, ${roman}, Learning`) })).toBeVisible();
});

test('a Chinese workspace has no Scripts page', async ({ page, learner }) => {
	await page.addInitScript((id) => localStorage.setItem('qinqin.workspace', String(id)), learner.workspaces.zh);
	await page.goto('/scripts');
	await expect(page.getByText('This language has no writing system to practise here.')).toBeVisible();
	await expect(page.getByRole('link', { name: 'Scripts' })).toHaveCount(0);
});
