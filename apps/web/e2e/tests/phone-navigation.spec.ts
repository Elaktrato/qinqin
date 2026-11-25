// Flow 5: the phone bottom bar (#188) at 360 px, and Settings → Layout →
// Phone navigation switching to the side menu and back.

import type { Locator, Page } from '@playwright/test';
import { expect, signedInState, test } from '../support/fixtures';

const PHONE = { width: 360, height: 740 };
test.use({ viewport: PHONE, hasTouch: true, isMobile: true });

/** The bar's bottom edge is the screen's bottom edge (within a pixel). */
async function expectAtBottom(bar: Locator): Promise<void> {
	await expect(bar).toBeInViewport();
	const box = await bar.boundingBox();
	expect(box, 'the bar is rendered').not.toBeNull();
	expect(Math.abs(box!.y + box!.height - PHONE.height), `bar bottom at ${box!.y + box!.height}`).toBeLessThanOrEqual(1);
}

/**
 * Scrolls whatever scrolls the page (the document or the page panel) to a
 * fraction of its range and checks that it moved: the page is longer than the
 * screen.
 */
async function scrollPageTo(page: Page, fraction: number): Promise<void> {
	const moved = await page.evaluate((f) => {
		const candidates = [document.scrollingElement, ...document.querySelectorAll('*')].filter(
			(el): el is Element =>
				el !== null &&
				el.scrollHeight > el.clientHeight + 40 &&
				(el === document.scrollingElement || /(auto|scroll)/.test(getComputedStyle(el).overflowY))
		);
		const el = candidates.sort((a, b) => b.scrollHeight - b.clientHeight - (a.scrollHeight - a.clientHeight))[0];
		if (!el) return -1;
		el.scrollTop = Math.round((el.scrollHeight - el.clientHeight) * f);
		return el.scrollTop;
	}, fraction);
	expect(moved, 'the page is longer than the screen and scrolled').toBeGreaterThan(0);
}

test('the bottom bar navigates; the side menu option replaces it and the choice is kept', async ({ page, learner, browser, baseURL }) => {
	await page.goto('/');
	const bar = page.getByRole('navigation', { name: 'Main' });
	await expect(bar).toBeVisible();
	// Five or more sections: four pins and More (lib/frame/barItems.ts).
	await expect(bar.getByRole('link')).toHaveText(['Home', 'Decks', 'Reader', 'Search']);
	await expect(bar.getByRole('button', { name: 'More' })).toBeVisible();
	// The bar sits on the bottom edge; no menu button in bar mode.
	await expectAtBottom(bar);
	await expect(page.getByRole('button', { name: 'Open menu' })).toHaveCount(0);

	await bar.getByRole('link', { name: 'Reader' }).click();
	await expect(page).toHaveURL(/\/reader$/);
	await expect(page.getByRole('heading', { level: 1, name: 'Library' })).toBeVisible();
	await expect(bar.getByRole('link', { name: 'Reader' })).toHaveAttribute('aria-current', 'page');
	await bar.getByRole('link', { name: 'Decks' }).click();
	await expect(page).toHaveURL(/\/flashcards$/);
	await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
	await expect(bar.getByRole('link', { name: 'Decks' })).toHaveAttribute('aria-current', 'page');
	await expect(bar.getByRole('link', { name: 'Reader' })).not.toHaveAttribute('aria-current', 'page');

	// More opens the sheet with the other sections and "Edit the bar".
	await bar.getByRole('button', { name: 'More' }).click();
	const more = page.getByRole('dialog');
	await expect(more.getByRole('link', { name: 'Stats' })).toBeVisible();
	await more.getByRole('link', { name: /Edit the bar/ }).click();
	await expect(page).toHaveURL(/\/settings\?tab=layout#bottom-bar$/);

	// A page longer than the screen: the bar stays on the bottom edge mid-page and at the end.
	await scrollPageTo(page, 0.5);
	await expectAtBottom(bar);
	await scrollPageTo(page, 1);
	await expectAtBottom(bar);

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

	// The choice belongs to the account: another device (a fresh browser with
	// nothing stored but the session) opens in side-menu mode.
	const other = await browser.newContext({
		baseURL,
		viewport: PHONE,
		hasTouch: true,
		isMobile: true,
		storageState: signedInState(baseURL!, learner)
	});
	try {
		const phone = await other.newPage();
		await phone.goto('/');
		await expect(phone.getByRole('button', { name: 'Open menu' })).toBeVisible();
		await expect(phone.getByRole('navigation', { name: 'Main' })).toBeHidden();
	} finally {
		await other.close();
	}

	// And back to the bottom bar.
	await page.goto('/settings?tab=layout');
	await page.getByRole('radio', { name: /Bottom bar/ }).check();
	await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Open menu' })).toHaveCount(0);
	await expectAtBottom(page.getByRole('navigation', { name: 'Main' }));
});
