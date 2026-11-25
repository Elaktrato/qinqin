// Flow: visual aids (#212). A Chinese word's pinyin is drawn with tone colours and a contour under each
// syllable; the switch in Settings > Study > Visual aids turns it off for the workspace, saved on the server
// (docs/contracts/aids/). The fixture packs carry no images pack, so no picture is expected here.

import { expect, test } from '../support/fixtures';

test('tone colours show on a word page and switch off in Settings', async ({ page, learner }) => {
	const id = await learner.entryId('zh', '你好');

	await page.goto(`/entry/${id}`);
	const syllables = page.locator('.syl');
	await expect(syllables).toHaveCount(2);
	await expect(syllables.first()).toHaveAttribute('data-tone', '3');
	// The contour is a drawing under the syllable, not a colour.
	await expect(syllables.first().locator('svg path')).toHaveCount(1);
	// The pinyin still reads as the same text.
	await expect(page.getByLabel('Readings')).toContainText('nǐ hǎo');

	await page.goto('/settings?tab=study');
	const saved = page.waitForResponse((r) => r.request().method() === 'PUT' && /\/api\/workspaces\/\d+$/.test(r.url()));
	await page.getByRole('checkbox', { name: 'Tone colours' }).uncheck();
	const response = await saved;
	const workspace = (await response.json()) as { settings: { visualAids?: Record<string, boolean> } };
	expect(workspace.settings.visualAids).toEqual({ toneColors: false });

	// The preview still shows what the aid looks like.
	await expect(page.getByTestId('tone-preview').locator('.syl')).toHaveCount(5);

	await page.goto(`/entry/${id}`);
	await expect(page.getByLabel('Readings')).toContainText('nǐ hǎo');
	await expect(page.locator('.syl')).toHaveCount(0);

	// The choice survives a reload: the switch is read back from the server.
	await page.goto('/settings?tab=study');
	await expect(page.getByRole('checkbox', { name: 'Tone colours' })).not.toBeChecked();
	await expect(page.getByRole('checkbox', { name: 'Pictures' })).toBeChecked();
});

test('colours are forced away: the contour stays', async ({ page, learner }) => {
	const id = await learner.entryId('zh', '你好');
	await page.emulateMedia({ forcedColors: 'active' });
	await page.goto(`/entry/${id}`);
	await expect(page.locator('.syl').first().locator('svg path')).toHaveCount(1);
});
