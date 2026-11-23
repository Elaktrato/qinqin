// Flow 5: the phone bottom bar (#188) at 360 px, and Settings → Layout →
// Phone navigation switching to the side menu and back.

import { expect, test } from '../support/fixtures';

test.use({ viewport: { width: 360, height: 740 }, hasTouch: true, isMobile: true });

test('the bottom bar navigates; the side menu option replaces it and the choice is kept', async ({ page, learner }) => {
	await page.goto('/');
	const bar = page.getByRole('navigation', { name: 'Main' });
	await expect(bar).toBeVisible();
	// Five or more sections: four pins and More (lib/frame/barItems.ts).
	await expect(bar.getByRole('link')).toHaveText(['Home', 'Decks', 'Reader', 'Search']);
	await expect(bar.getByRole('button', { name: 'More' })).toBeVisible();
	// The bar sits at the bottom of the screen; no menu button in bar mode.
	const box = (await bar.boundingBox())!;
	expect(box.y + box.height).toBeGreaterThan(740 - 4);
	await expect(page.getByRole('button', { name: 'Open menu' })).toHaveCount(0);

	await bar.getByRole('link', { name: 'Reader' }).click();
	await expect(page).toHaveURL(/\/reader$/);
	await expect(bar.getByRole('link', { name: 'Reader' })).toHaveAttribute('aria-current', 'page');

	// More opens the sheet with the other sections and "Edit the bar".
	await bar.getByRole('button', { name: 'More' }).click();
	const more = page.getByRole('dialog');
	await expect(more.getByRole('link', { name: 'Stats' })).toBeVisible();
	await more.getByRole('link', { name: /Edit the bar/ }).click();
	await expect(page).toHaveURL(/\/settings\?tab=layout#bottom-bar$/);

	// Side menu: the bar goes, the top bar gets a menu button that opens the drawer.
	await page.getByRole('radio', { name: /Side menu/ }).check();
	await expect(page.getByRole('navigation', { name: 'Main' })).toBeHidden();
	await page.getByRole('button', { name: 'Open menu' }).click();
	const drawer = page.getByRole('navigation', { name: 'Main' });
	await expect(drawer).toBeVisible();
	await expect(drawer.getByRole('link', { name: 'Stats' })).toBeVisible();
	await drawer.getByRole('link', { name: 'Home' }).click();
	await expect(page).toHaveURL(/\/$/);
	await expect(page.getByRole('navigation', { name: 'Main' })).toBeHidden();

	// The choice belongs to the account: stored on the server (the nav-layout
	// row, docs/contracts/settings/nav-layout.json), so a reload keeps it.
	await expect
		.poll(async () => (await learner.api.get<{ data: { phone: string } }>('/api/plugins/qinqin-core/data/nav-layout')).data.phone)
		.toBe('drawer');
	await page.reload();
	await expect(page.getByRole('button', { name: 'Open menu' })).toBeVisible();
	await expect(page.getByRole('navigation', { name: 'Main' })).toBeHidden();

	// And back to the bottom bar.
	await page.goto('/settings?tab=layout');
	await page.getByRole('radio', { name: /Bottom bar/ }).check();
	await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Open menu' })).toHaveCount(0);
});
