// Courses (#222, #224) on a phone: the roadmap of the workspace's course, a word lesson in the full-screen player (no
// bottom bar), its check and summary, then the path moves on and the words have cards in the course's deck; placement
// through the section exams, and a failed unit test that shows what to review.

import type { Page } from '@playwright/test';
import { expect, test } from '../support/fixtures';
import { PHONE, expectNoSidewaysScroll } from '../support/layout';

test.use({ viewport: PHONE, hasTouch: true, isMobile: true });

const GLOSS: Record<string, string> = { 你好: 'hello', 学习: 'to study', 中国: 'China' };
const READING: Record<string, string> = { 你好: 'nǐ hǎo', 学习: 'xué xí', 中国: 'zhōng guó' };

/** The right answer to the question shown: a reading question asks the pinyin, the others a gloss or a word. */
async function rightAnswer(page: Page): Promise<string> {
	const ask = (await page.locator('.question .ask').textContent()) ?? '';
	const prompt = (await page.locator('.question .prompt').textContent())?.trim() ?? '';
	if (ask.startsWith('How is it read')) return READING[prompt];
	const pair = Object.entries(GLOSS).find(([word, gloss]) => word === prompt || gloss === prompt)!;
	return pair[0] === prompt ? pair[1] : pair[0];
}

/** Answers the questions of a test until it ends; `right` false picks a wrong choice each time. */
async function answerTest(page: Page, right: boolean): Promise<void> {
	for (let i = 0; i < 10 && (await page.locator('.question').count()) > 0; i++) {
		const want = await rightAnswer(page);
		const choices = page.locator('.question .choice');
		const texts = (await choices.allTextContents()).map((t) => t.trim());
		const at = right ? texts.indexOf(want) : texts.findIndex((t) => t !== want);
		await choices.nth(at).click();
		await page.getByRole('button', { name: 'Continue' }).click();
	}
}

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

test('a learner who knows some finds their place through the section exams (#224)', async ({ page }) => {
	await switchToChinese(page);
	await page.goto('/courses');
	await page.getByRole('link', { name: 'Already know some? Find your place' }).click();
	await expect(page).toHaveURL(/\/courses\/play\/e2e-zh-course\/section\/level-1\/placement$/);
	await expect(page.getByText(/Placement asks the section exams/)).toBeVisible();
	await expect(page.getByRole('navigation', { name: 'Main' })).toHaveCount(0);
	await expectNoSidewaysScroll(page, 'a placement exam');

	await answerTest(page, true);
	await expect(page.getByRole('heading', { level: 1, name: 'Passed' })).toBeVisible();
	await expectNoSidewaysScroll(page, 'the placement summary');
	await expect(page.getByRole('link', { name: 'Next: the Level 2 exam' })).toBeVisible();
	await page.getByRole('button', { name: 'Start here' }).click();

	// Back on the roadmap: level 1 is skipped (its words marked known), the learner starts in level 2.
	await expect(page).toHaveURL(/\/courses$/);
	await expect(page.getByRole('link', { name: 'Continue: New words 1' })).toHaveAttribute('href', '/courses/play/e2e-zh-course/second/words-1');
	const first = page.getByRole('heading', { level: 3, name: 'First words' }).locator('xpath=ancestor::li[1]');
	await expect(first.getByText('Skipped')).toBeVisible();
	await expect(page.getByRole('link', { name: 'Already know some? Find your place' })).toHaveCount(0);
});

test('a failed unit test shows what to review, keeps progress and can be taken again (#224)', async ({ page }) => {
	await switchToChinese(page);
	await page.goto('/courses/play/e2e-zh-course/first/test');
	await expect(page.locator('.question')).toBeVisible();
	await answerTest(page, false);
	await expect(page.getByRole('heading', { level: 1, name: 'Not passed yet' })).toBeVisible();
	await expect(page.getByText('You need 80 % to pass. Try again whenever you are ready.')).toBeVisible();
	await expect(page.getByText(/Your progress is kept/)).toBeVisible();
	const review = page.getByRole('region', { name: 'What to review' });
	await expect(review.getByText('hello')).toBeVisible();
	await expectNoSidewaysScroll(page, 'a failed test');

	await page.getByRole('button', { name: 'Try again' }).click();
	await expect(page.locator('.question')).toBeVisible();
	await answerTest(page, true);
	await expect(page.getByRole('heading', { level: 1, name: 'Passed' })).toBeVisible();
	await page.getByRole('link', { name: 'Back to the course' }).click();
	const first = page.getByRole('heading', { level: 3, name: 'First words' }).locator('xpath=ancestor::li[1]');
	await expect(first.getByText('Skipped')).toBeVisible();
});
