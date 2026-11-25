// The level check (#82, experimental): it says what it does not measure, asks
// a short self-assessed sample, shows coverage and an estimate, writes nothing
// and leads into a level study session.

import type { Page } from '@playwright/test';
import { expect, test, type Learner } from '../support/fixtures';

async function switchToChinese(page: Page): Promise<void> {
	await page.goto('/search');
	await page.getByRole('button', { name: 'Workspace: Japanese' }).click();
	await page.getByRole('menuitemradio', { name: 'Chinese' }).click();
	await expect(page.getByRole('button', { name: 'Workspace: Chinese' })).toBeVisible();
}

const marks = (learner: Learner) =>
	learner.api.get<unknown[]>(`/api/rows?workspace=${learner.workspaces.zh}&prefix=known:`);

async function answerAll(page: Page, testid: 'placement-know' | 'placement-unsure'): Promise<void> {
	for (let i = 0; i < 25 && (await page.getByTestId('level-check-question').count()) > 0; i++) {
		await page.getByTestId(testid).click();
	}
}

test('the level check states its limits, estimates, writes nothing and starts a level session', async ({ page, learner }) => {
	await switchToChinese(page);
	await page.goto('/settings?tab=study');
	await expect(page.getByRole('heading', { name: 'Level check' })).toBeVisible();
	await expect(page.getByText('Experimental', { exact: true })).toBeVisible();
	await expect(page.getByTestId('level-check-limits')).toContainText('not the official exam');
	await expect(page.getByTestId('level-check-limits')).toContainText('listening, grammar or reading');

	await page.getByTestId('level-check-start').click();
	await answerAll(page, 'placement-know');
	await expect(page.getByTestId('level-check-result')).toBeVisible();
	await expect(page.getByTestId('level-check-estimate')).toContainText('100%');
	await expect(page.getByTestId('level-check-coverage')).toBeVisible();
	expect(await marks(learner)).toHaveLength(0);

	await page.getByRole('button', { name: 'Close' }).click();
	await page.getByTestId('level-check-start').click();
	await answerAll(page, 'placement-unsure');
	await page.getByTestId('level-check-study').click();
	await expect(page).toHaveURL(/\/study\/session/);
});
