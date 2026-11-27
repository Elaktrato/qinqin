// #290: coming back to Home shows what the session already knows at once and
// refreshes it behind: no widget passes through its loading line on the
// revisit, also after the study data's freshness window (8 s), and the
// refresh still goes out.

import type { Page } from '@playwright/test';
import { expect, test } from '../support/fixtures';
import { addCards } from '../support/study';

const PHONE = { width: 360, height: 740 };
test.use({ viewport: PHONE, hasTouch: true, isMobile: true });

const WORDS = ['私', '学校', '行く', '水'];

/** Every Home widget is there and none shows a loading line. */
async function widgetsShown(page: Page): Promise<void> {
	const widgets = page.locator('[data-widget]');
	await expect(widgets).toHaveCount(4);
	await expect(widgets.filter({ hasText: /Loading/ })).toHaveCount(0);
	await expect(page.getByRole('region', { name: 'Flashcards' }).getByRole('link', { name: 'Study' })).toBeVisible();
}

test('Home revisited shows its widgets at once and refreshes them behind', async ({ page, learner }) => {
	await addCards(learner, 'ja', WORDS.map((written) => ({ kind: 'vocab' as const, written, reviewedDaysAgo: 3 })));
	await page.clock.install();
	await page.goto('/');
	await widgetsShown(page);

	const bar = page.getByRole('navigation', { name: 'Main' });
	await bar.getByRole('link', { name: 'Decks' }).click();
	await expect(page).toHaveURL(/\/flashcards$/);
	await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

	// From here on, any loading line inside a Home widget is recorded.
	await page.evaluate(() => {
		const w = window as unknown as { sawLoading: number };
		w.sawLoading = 0;
		const look = (): void => {
			for (const el of document.querySelectorAll('[data-widget] *')) {
				if (el.children.length === 0 && /^\s*Loading\b/.test(el.textContent ?? '')) w.sawLoading++;
			}
		};
		new MutationObserver(look).observe(document.body, { childList: true, subtree: true, characterData: true });
	});
	// Past the study cache's freshness window: the held data is refreshed behind it. The
	// refresh may go out while the clock moves (a same-second follow-up round fires then)
	// or on the revisit; either way it goes out, and no widget waits for it.
	const pulls: string[] = [];
	page.on('request', (request) => {
		if (request.url().includes('/api/sync/pull')) pulls.push(request.url());
	});
	await page.clock.fastForward(20_000);

	await bar.getByRole('link', { name: 'Home' }).click();
	await expect(page).toHaveURL(/\/$/);
	await widgetsShown(page);
	await expect.poll(() => pulls.length, { message: 'the refresh behind the held rows went out' }).toBeGreaterThan(0);
	await widgetsShown(page);
	expect(await page.evaluate(() => (window as unknown as { sawLoading: number }).sawLoading), 'loading lines on the revisit').toBe(0);
});
