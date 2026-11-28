// The tone-pair drill (#180), the first registered drill, on a 360 px phone in the Chinese workspace: Practice joins
// the navigation, the list shows the grid of pairs, a round is answered by typing with the field keeping the focus
// (the phone keyboard stays up), the answers reach the server as drill.tone-pairs events and count as activity (the
// heatmap's points, the goal choice, the heatmap's source, the weekly summary's row), and the drill's own weakest round. The fixture's level
// list has 中国 (1-2), 学习 (2-2) and 你好 (3-3).

import type { Page } from '@playwright/test';
import { expect, test } from '../support/fixtures';
import { PHONE, expectNoSidewaysScroll } from '../support/layout';

test.use({ viewport: PHONE, hasTouch: true, isMobile: true });

async function answer(page: Page, tones: string): Promise<void> {
	const field = page.getByLabel('Tones', { exact: true });
	await expect(field).toBeFocused();
	await field.fill(tones);
	await field.press('Enter');
	await expect(field).toHaveAttribute('readonly', '');
	await expect(field).toBeFocused();
}

test('a tone-pair round in the Chinese workspace counts as activity', async ({ page, learner }) => {
	await page.addInitScript((id) => localStorage.setItem('qinqin.workspace', String(id)), learner.workspaces.zh);
	await page.goto('/practice');
	await expect(page.getByRole('heading', { level: 2, name: 'Tone pairs' })).toBeVisible();
	await expect(page.getByText('3 new')).toBeVisible();
	const grid = page.getByRole('region', { name: 'Your tone pairs' });
	await expect(grid.locator('[data-pair]')).toHaveCount(20);
	await expect(grid.getByLabel('3-3: not practised yet')).toBeVisible();
	await expectNoSidewaysScroll(page, '/practice (tone pairs)');

	// Practice is in the navigation of a Chinese workspace.
	await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'More' }).click();
	await expect(page.getByRole('dialog').getByRole('link', { name: 'Practice' })).toBeVisible();
	await page.keyboard.press('Escape');

	await page.getByRole('link', { name: 'Practise', exact: true }).click();
	await expect(page).toHaveURL(/\/practice\/tone-pairs$/);
	await expect(page.getByText('Question 1 of 3')).toBeVisible();
	await expect(page.locator('.written')).toHaveText('中国');
	await expectNoSidewaysScroll(page, '/practice/tone-pairs');
	await answer(page, '1 2');
	await expect(page.getByText('Right: 1-2.')).toBeVisible();
	await page.getByLabel('Tones', { exact: true }).press('Enter');

	await expect(page.getByText('Question 2 of 3')).toBeVisible();
	await expect(page.getByLabel('Tones', { exact: true })).toHaveValue('');
	await answer(page, '4 4');
	await expect(page.getByText('Not quite: the tones are 2-2.')).toBeVisible();
	// The Next button keeps the focus in the field too.
	await page.getByRole('button', { name: 'Next' }).tap();

	await expect(page.getByText('Question 3 of 3')).toBeVisible();
	await expect(page.locator('.written')).toHaveText('你好');
	await answer(page, '3 3');
	// The citation tones are graded; the spoken tone of 你 shows beside its citation tone.
	await expect(page.locator('.answer').first()).toContainText('→ ní');
	await expectNoSidewaysScroll(page, 'a tone-pair answer');
	await page.getByLabel('Tones', { exact: true }).press('Enter');
	await expect(page.getByText('2 of 3 right')).toBeVisible();

	// The three answers reached the server and count as activity of the drill.
	await expect
		.poll(async () => (await learner.api.events(learner.workspaces.zh)).filter((e) => e.type === 'drill.tone-pairs').map((e) => (e.payload as { item: string }).item).sort())
		.toEqual(['1-2', '2-2', '3-3']);
	const activity = await learner.api.get<{ sources: { type: string }[]; cells: { type: string; points: number }[] }>('/api/stats/activity');
	expect(activity.sources.map((s) => s.type)).toContain('drill.tone-pairs');
	expect(activity.cells.filter((c) => c.type === 'drill.tone-pairs').reduce((n, c) => n + c.points, 0)).toBe(3);

	// The grid shows each pair's accuracy; the weakest pairs come first in their own round.
	await page.getByRole('link', { name: 'Back to the drills' }).click();
	await expect(grid.getByLabel('2-2: 0% right in the last answer, weak')).toBeVisible();
	await expect(grid.getByLabel('1-2: 100% right in the last answer, strong')).toBeVisible();
	await page.getByRole('link', { name: 'Practise my weakest pairs' }).click();
	await expect(page).toHaveURL(/\/practice\/tone-pairs\/weakest$/);
	await expect(page.getByRole('heading', { level: 1, name: 'Tone pairs: weakest' })).toBeVisible();
	await expect(page.locator('.written')).toHaveText('学习');
	await expectNoSidewaysScroll(page, '/practice/tone-pairs/weakest');
	await page.goBack();
	await expect(page).toHaveURL(/\/practice$/);

	// The drill is a goal choice and a source of the heatmap.
	await page.goto('/settings?tab=study');
	await expect(page.locator('#goal-metric option', { hasText: 'Tone pairs' })).toHaveCount(1);
	await page.goto('/stats');
	await expect(page.getByText('Tone pairs').first()).toBeVisible();
	// The weekly summary has an activity row for it.
	await page.goto('/stats/week');
	await expect(page.getByRole('region', { name: 'Week' }).getByRole('term').filter({ hasText: 'Tone pairs' })).toBeVisible();
});
