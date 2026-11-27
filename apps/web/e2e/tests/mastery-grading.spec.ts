// The mastery map's grading (#163) at 360 px: a Chinese workspace without an
// HSK pack starts on Common; the learner picks the fixture's level list, which
// shows only its characters (the fixture's one character, 好, is in Level 1);
// the study levels and the outside switch are saved in the workspace settings
// and survive a reload. The map's rules themselves are the DOM tests'
// (routes/stats/characters/page.dom.test.ts).

import { expect, test } from '../support/fixtures';
import { PHONE, expectNoSidewaysScroll } from '../support/layout';

test.use({ viewport: PHONE, hasTouch: true, isMobile: true });

const LIST = 'Chinese end-to-end test levels';

test('the map goes by one grading with study levels and the outside switch, saved for the workspace', async ({ page, learner }) => {
	await page.addInitScript((id) => localStorage.setItem('qinqin.workspace', String(id)), learner.workspaces.zh);
	await page.goto('/stats/characters');
	const grading = page.getByLabel('Grading');
	await expect(grading).toHaveValue('common');
	const sections = page.locator('.block-head .label');
	const cells = page.locator('.cell');
	await expect(cells).toHaveText(['好']);

	await grading.selectOption({ label: LIST });
	await expect(grading).toHaveValue('pack:e2e-zh-levels');
	await expect(sections).toHaveText(['Level 1']);
	const levels = page.getByRole('group', { name: 'Study levels' });
	const one = levels.getByRole('checkbox', { name: 'Level 1' });
	const two = levels.getByRole('checkbox', { name: 'Level 2' });
	await expect(one).toBeChecked();
	await expect(two).toBeChecked();

	// Level 1 off: 好 is a Level 1 character, so the map is empty.
	await one.uncheck();
	await expect(cells).toHaveCount(0);
	await expect(two).toBeDisabled();
	await one.check();
	await two.uncheck();
	await expect(cells).toHaveText(['好']);
	await expect(one).toBeDisabled();
	await page.getByRole('checkbox', { name: `Include characters outside ${LIST}` }).check();
	await expect(page.getByLabel('Level').locator('option')).toHaveText(['All study levels', 'Level 1', `Outside ${LIST}`]);
	await expectNoSidewaysScroll(page, '/stats/characters with a grading');

	await expect
		.poll(async () => {
			const list = await learner.api.get<{ id: number; settings: Record<string, unknown> }[]>('/api/workspaces');
			return list.find((w) => w.id === learner.workspaces.zh)?.settings.masteryMap;
		})
		.toMatchObject({ grading: 'pack:e2e-zh-levels', includeOutside: true, levels: { 'e2e-zh-levels': [expect.any(Number)] } });

	await page.reload();
	await expect(grading).toHaveValue('pack:e2e-zh-levels');
	await expect(cells).toHaveText(['好']);
	await expect(page.getByRole('group', { name: 'Study levels' }).getByRole('checkbox', { name: 'Level 2' })).not.toBeChecked();
	await expect(page.getByRole('checkbox', { name: `Include characters outside ${LIST}` })).toBeChecked();
});
