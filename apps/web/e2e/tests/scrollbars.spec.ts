// Scrollbars follow the theme (owner request, 2026-11-25): a thin bar in the
// theme's muted colour on a clear track, never the system's grey bar with
// arrow buttons. Checked on the home page, whose activity heatmap scrolls
// sideways when the window is narrower than a year of weeks.

import { expect, test } from '../support/fixtures';

test('scrollbars are thin and themed, the heatmap strip included', async ({ page }) => {
	await page.setViewportSize({ width: 760, height: 900 });
	await page.goto('/');
	await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

	const style = await page.evaluate(() => {
		// The first element that really scrolls sideways (the heatmap grid), else the page.
		const strip =
			[...document.querySelectorAll<HTMLElement>('body *')].find(
				(el) => el.scrollWidth > el.clientWidth + 1 && ['auto', 'scroll'].includes(getComputedStyle(el).overflowX)
			) ?? document.documentElement;
		const cs = getComputedStyle(strip);
		const muted = getComputedStyle(document.documentElement).getPropertyValue('--muted').trim();
		return { width: cs.scrollbarWidth, colour: cs.scrollbarColor, muted, isPage: strip === document.documentElement };
	});
	expect(style.width).toBe('thin');
	expect(style.colour).not.toBe('auto');
	// The track is clear; the thumb is a colour, not the system default.
	expect(style.colour).toMatch(/(transparent|rgba\(0, 0, 0, 0\))$/);
	expect(style.muted).not.toBe('');
});
