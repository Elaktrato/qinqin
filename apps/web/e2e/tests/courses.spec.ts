// Courses (#222) on a phone: the roadmap of the workspace's course, a word lesson in the full-screen player (no
// bottom bar), its check and summary, then the path moves on and the words have cards in the course's deck.

import type { Page } from '@playwright/test';
import { expect, test } from '../support/fixtures';
import { PHONE, expectNoSidewaysScroll } from '../support/layout';

test.use({ viewport: PHONE, hasTouch: true, isMobile: true });

const GLOSS: Record<string, string> = { 你好: 'hello', 学习: 'to study' };

async function switchToChinese(page: Page): Promise<void> {
	await page.goto('/search');
	await page.getByRole('button', { name: 'Workspace: Japanese' }).click();
	await page.getByRole('menuitemradio', { name: 'Chinese' }).click();
	await expect(page.getByRole('button', { name: 'Workspace: Chinese' })).toBeVisible();
}

test('a learner finishes the first word lesson of the course and the path moves on', async ({ page }) => {
	await switchToChinese(page);
	await page.goto('/courses');
	await expect(page.getByRole('heading', { level: 1, name: 'End-to-end course' })).toBeVisible();
	await expect(page.getByText('0 of 3 words met')).toBeVisible();
	await expectNoSidewaysScroll(page, '/courses');

	await page.getByRole('link', { name: 'Continue: New words 1' }).click();
	await expect(page).toHaveURL(/\/courses\/play\/e2e-zh-course\/first\/words-1$/);
	// Full screen: no bottom bar.
	await expect(page.getByRole('navigation', { name: 'Main' })).toHaveCount(0);
	await expect(page.getByRole('progressbar', { name: 'Lesson progress' })).toBeVisible();
	await expectNoSidewaysScroll(page, 'the lesson player');

	// Two words are introduced, then checked.
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
	await expect(page.getByText('4 of 4 right the first time')).toBeVisible();
	await expect(page.getByText('2 cards were added to the deck')).toBeVisible();
	await expectNoSidewaysScroll(page, 'the lesson summary');

	// The next step is the unit's next lesson.
	await page.getByRole('link', { name: 'Back to the course' }).click();
	await expect(page.getByText('2 of 3 words met')).toBeVisible();
	await expect(page.getByRole('link', { name: /^Continue: Practice$/ })).toBeVisible();

	// The words are cards in the course's deck.
	// In the app (the session holds the rows it wrote; a reload within the same second could miss them, the pull's
	// round cut).
	await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Decks' }).click();
	await expect(page.getByRole('link', { name: /End-to-end course/ }).first()).toBeVisible();
});
