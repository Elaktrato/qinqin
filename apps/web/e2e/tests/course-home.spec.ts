// Courses on Home (#225), on a phone: a fresh Chinese workspace gets the start card (the course or finding your
// place) and the "Continue course" widget; the first lesson is one tap away; once it is done, Home shows the next
// lesson, the first course milestone, and the start card is gone.

import { expect, test } from '../support/fixtures';
import { PHONE, expectNoSidewaysScroll } from '../support/layout';

test.use({ viewport: PHONE, hasTouch: true, isMobile: true });

const GLOSS: Record<string, string> = { 你好: 'hello', 学习: 'to study', 中国: 'China' };

test('a new learner starts the course from Home and comes back to the next lesson', async ({ page }) => {
	await page.goto('/search');
	await page.getByRole('button', { name: 'Workspace: Japanese' }).click();
	await page.getByRole('menuitemradio', { name: 'Chinese' }).click();
	await expect(page.getByRole('button', { name: 'Workspace: Chinese' })).toBeVisible();

	await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Home' }).click();
	const start = page.getByTestId('course-start-offer');
	await expect(start.getByRole('heading', { name: 'How would you like to start?' })).toBeVisible();
	await expect(start.getByRole('link', { name: 'Find your place' })).toHaveAttribute('href', '/courses/play/e2e-zh-course/section/level-1/placement');
	// The older fresh-workspace offers make room for it.
	await expect(page.getByTestId('placement-offer')).toHaveCount(0);
	await expect(page.getByTestId('starter-offer')).toHaveCount(0);
	const widget = page.getByTestId('course-widget');
	await expect(widget.getByRole('link', { name: 'Start: New words 1' })).toHaveAttribute('href', '/courses/play/e2e-zh-course/first/words-1');
	await expectNoSidewaysScroll(page, 'Home with the course start card and widget');

	await start.getByRole('link', { name: 'Start the course' }).click();
	await expect(page).toHaveURL(/\/courses\/play\/e2e-zh-course\/first\/words-1$/);
	for (let i = 0; i < 2; i++) {
		await expect(page.getByLabel('New word')).toBeVisible();
		await page.getByRole('button', { name: 'Continue' }).click();
	}
	for (let i = 0; i < 6 && (await page.locator('.question').count()) > 0; i++) {
		const prompt = (await page.locator('.question .prompt').textContent())?.trim() ?? '';
		const pair = Object.entries(GLOSS).find(([word, gloss]) => word === prompt || gloss === prompt)!;
		await page.getByRole('button', { name: pair[0] === prompt ? pair[1] : pair[0], exact: true }).click();
		await page.getByRole('button', { name: 'Continue' }).click();
	}
	await expect(page.getByRole('heading', { level: 1, name: 'Lesson done' })).toBeVisible();

	// Back home (the player has no bottom bar: through the course).
	await page.getByRole('link', { name: 'Back to the course' }).click();
	await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Home' }).click();
	await expect(page.getByTestId('course-widget').getByRole('link', { name: 'Continue: Practice' })).toHaveAttribute('href', '/courses/play/e2e-zh-course/first/practice');
	await expect(page.getByTestId('course-widget').getByText('0 of 2 units done · 2 of 3 words met')).toBeVisible();
	await expect(page.getByText(/^First course lesson, reached /)).toBeVisible();
	await expect(page.getByTestId('course-start-offer')).toHaveCount(0);
	await expectNoSidewaysScroll(page, 'Home with the course widget and a course milestone');
});
