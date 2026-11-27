// Stats as a feature a learner can switch off (#295), at 360 px with the
// bottom bar: Settings → Features switches it off; the More sheet has no Stats,
// Home drops the heatmap but keeps This week (without its link into Stats), and
// a Stats page says it is switched off with the way back. Switched on, Stats is
// back.

import { expect, test } from '../support/fixtures';
import { PHONE, expectNoSidewaysScroll } from '../support/layout';

test.use({ viewport: PHONE, hasTouch: true, isMobile: true });

test('switching Stats off hides its pages, section and widgets; switching it on brings them back', async ({ page }) => {
	const statsSwitch = page.getByRole('checkbox', { name: 'Stats' });
	await page.goto('/settings?tab=features');
	await expect(statsSwitch).toBeChecked();
	await statsSwitch.uncheck();
	await expect(page.getByText('Saved', { exact: true })).toBeVisible();

	await page.goto('/');
	const bar = page.getByRole('navigation', { name: 'Main' });
	await expect(page.getByRole('heading', { name: 'This week' })).toBeVisible();
	await expect(page.locator('[data-widget="activity-heatmap"]')).toHaveCount(0);
	await expect(page.getByRole('link', { name: 'See the week' })).toHaveCount(0);
	await bar.getByRole('button', { name: 'More' }).click();
	const more = page.getByRole('dialog');
	await expect(more.getByRole('link', { name: 'Grammar' })).toBeVisible();
	await expect(more.getByRole('link', { name: 'Stats' })).toHaveCount(0);
	await page.keyboard.press('Escape');

	for (const path of ['/stats', '/stats/week', '/stats/characters']) {
		await page.goto(path);
		await expect(page.getByRole('heading', { level: 1, name: 'Stats are switched off' })).toBeVisible();
		await expect(page.getByRole('navigation', { name: 'Stats views' })).toHaveCount(0);
		await expectNoSidewaysScroll(page, path);
	}
	await page.getByRole('link', { name: 'Settings → Features' }).click();
	await expect(page).toHaveURL(/\/settings\?tab=features$/);
	await statsSwitch.check();
	await expect(page.getByText('Saved', { exact: true })).toBeVisible();

	await page.goto('/stats');
	await expect(page.getByRole('heading', { level: 1, name: 'Stats' })).toBeVisible();
	await expect(page.getByRole('navigation', { name: 'Stats views' })).toBeVisible();
	await page.goto('/');
	await expect(page.locator('[data-widget="activity-heatmap"]')).toHaveCount(1);
	await expect(page.getByRole('link', { name: 'See the week' })).toBeVisible();
});
