// "I already know this" and the placement test (#74): a fresh Chinese
// workspace is offered them on Home (inside the course start card, #225: the
// e2e server has a Chinese course), a declared range writes known marks
// (one batch) after a confirmation and Undo removes exactly them, and a
// placement result writes nothing until it is confirmed.

import type { Page } from '@playwright/test';
import { expect, test, type Learner } from '../support/fixtures';

interface MarkRow {
	key: string;
	data: { batch?: string; source?: string; scope?: string };
}

async function switchToChinese(page: Page): Promise<void> {
	await page.goto('/search');
	await page.getByRole('button', { name: 'Workspace: Japanese' }).click();
	await page.getByRole('menuitemradio', { name: 'Chinese' }).click();
	await expect(page.getByRole('button', { name: 'Workspace: Chinese' })).toBeVisible();
}

const marks = (learner: Learner) =>
	learner.api.get<MarkRow[]>(`/api/rows?workspace=${learner.workspaces.zh}&prefix=known:`);

test('Home offers it on an empty workspace; a range is confirmed, written as one batch and undone', async ({ page, learner }) => {
	await switchToChinese(page);
	await page.goto('/');
	// With a course for the language, the course start card stands in for the placement offer (#225).
	const offer = page.getByTestId('course-start-offer');
	await expect(offer).toBeVisible();
	await expect(page.getByTestId('placement-offer')).toHaveCount(0);
	await offer.getByRole('link', { name: 'Tell us which levels you know' }).click();

	await expect(page.getByRole('heading', { name: 'What you already know' })).toBeVisible();
	await expect(page.getByText('3 new entries would be marked as known.')).toBeVisible();
	await page.getByRole('button', { name: 'Mark as known' }).click();
	// Nothing is written before the confirmation.
	expect(await marks(learner)).toHaveLength(0);
	await expect(page.getByText(/Mark 3 entries as known\?/)).toBeVisible();
	await page.getByRole('button', { name: 'Yes, mark them' }).click();
	await expect(page.getByRole('status').filter({ hasText: '3 entries marked as known.' })).toBeVisible();

	await expect.poll(async () => (await marks(learner)).length).toBe(3);
	const rows = await marks(learner);
	expect(new Set(rows.map((r) => r.data.batch)).size).toBe(1);
	expect(rows.every((r) => r.data.source === 'range' && r.data.scope?.endsWith('Level 2'))).toBe(true);

	await page.getByRole('button', { name: 'Undo' }).click();
	await expect(page.getByText('Declaration undone.')).toBeVisible();
	await expect.poll(async () => (await marks(learner)).length).toBe(0);

	// The workspace has nothing again, but a marked workspace is no longer offered: re-mark, then Home.
	await page.getByRole('button', { name: 'Mark as known' }).click();
	await page.getByRole('button', { name: 'Yes, mark them' }).click();
	await expect.poll(async () => (await marks(learner)).length).toBe(3);
	await page.goto('/');
	await expect(page.getByRole('heading', { name: /Good (morning|afternoon|evening)/ })).toBeVisible();
	await expect(page.getByTestId('placement-offer')).toHaveCount(0);
	await expect(page.getByTestId('course-start-offer')).toHaveCount(0);
});

test('the placement test proposes a level and writes nothing until it is confirmed', async ({ page, learner }) => {
	await switchToChinese(page);
	await page.goto('/settings?tab=study');
	await page.getByRole('button', { name: 'Take the placement test' }).click();

	// Someone who knows everything: at most a handful of questions, then the result.
	for (let i = 0; i < 10 && (await page.getByTestId('placement-know').count()) > 0; i++) {
		await page.getByTestId('placement-know').click();
	}
	await expect(page.getByTestId('placement-result')).toBeVisible();
	await expect(page.getByText('Your level looks like Level 2.')).toBeVisible();
	expect(await marks(learner)).toHaveLength(0);

	await page.getByRole('button', { name: "Don't mark anything" }).click();
	expect(await marks(learner)).toHaveLength(0);

	await page.getByRole('button', { name: 'Take the placement test' }).click();
	for (let i = 0; i < 10 && (await page.getByTestId('placement-know').count()) > 0; i++) {
		await page.getByTestId('placement-know').click();
	}
	await page.getByTestId('placement-confirm').click();
	await expect.poll(async () => (await marks(learner)).length).toBe(3);
	expect((await marks(learner)).every((r) => r.data.source === 'placement')).toBe(true);
});
