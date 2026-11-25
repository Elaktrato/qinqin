// Flow: the study modal (docs/superpowers/specs/2026-11-25-study-modal-design.md).
// Every Study button opens one small modal that starts the workspace's saved
// setup; a chip is saved to the account at once, so a reload and another
// browser show it; Advanced settings is the full page and returns to the
// modal; on a phone the modal is the bottom sheet.

import type { Page } from '@playwright/test';
import type { Learner } from '../support/fixtures';
import { expect, signedInState, test } from '../support/fixtures';
import { addCards } from '../support/study';

const WORDS = ['私', '学校', '行く', '飲む'];

/** The saved setup row of the ja workspace, read through the API (null: none yet). */
async function savedSetup(learner: Learner): Promise<Record<string, unknown> | null> {
	const rows = await learner.api.get<{ key: string; data: Record<string, unknown> }[]>(
		`/api/rows?workspace=${learner.workspaces.ja}&prefix=study-setup`
	);
	return rows.find((row) => row.key === 'study-setup')?.data ?? null;
}

/** Home, then the Flashcards widget's Study button. */
async function openFromHome(page: Page) {
	await page.goto('/');
	await page.getByRole('region', { name: 'Flashcards' }).getByRole('link', { name: 'Study' }).click();
	const modal = page.getByRole('dialog', { name: 'Study' });
	await expect(modal).toBeVisible();
	return modal;
}

test('the Study button opens the modal and Start studies', async ({ page, learner }) => {
	await addCards(learner, 'ja', WORDS.map((written) => ({ kind: 'vocab' as const, written })));
	const modal = await openFromHome(page);
	await expect(page).toHaveURL(/\/$/);
	await expect(modal).toContainText('0 due · 4 new · 1 deck');
	await expect(modal).toContainText('This session: 4 cards');
	const start = modal.getByRole('button', { name: 'Start studying' });
	await expect(start).toBeFocused();
	await start.click();
	await expect(page).toHaveURL(/\/study\/session$/);
	await expect(page.getByText(/^1 \/ 4/)).toBeVisible();
	await expect(page.getByRole('dialog', { name: 'Study' })).toHaveCount(0);

	// End session goes back home and opens the modal again.
	await page.getByRole('link', { name: 'End session' }).click();
	await expect(page).toHaveURL(/\/$/);
	await expect(page.getByRole('dialog', { name: 'Study' })).toBeVisible();
	// Escape closes it.
	await page.keyboard.press('Escape');
	await expect(page.getByRole('dialog', { name: 'Study' })).toHaveCount(0);
});

test('a chip is saved for the workspace: kept after a reload and in another browser', async ({ page, learner, browser, baseURL }) => {
	await addCards(learner, 'ja', WORDS.map((written) => ({ kind: 'vocab' as const, written })));
	const modal = await openFromHome(page);
	const writing = modal.getByRole('checkbox', { name: 'Writing' });
	await expect(writing).not.toBeChecked();
	await writing.check();
	await expect(writing).toBeChecked();
	await expect.poll(async () => (await savedSetup(learner))?.cardTypes).toEqual(['vocab', 'writing']);

	await page.reload();
	await page.getByRole('region', { name: 'Flashcards' }).getByRole('link', { name: 'Study' }).click();
	await expect(page.getByRole('dialog', { name: 'Study' }).getByRole('checkbox', { name: 'Writing' })).toBeChecked();

	// Another browser (no shared storage): the setup comes from the account.
	const other = await browser.newContext({ storageState: signedInState(baseURL!, learner) });
	try {
		const second = await other.newPage();
		await second.goto('/study');
		const there = second.getByRole('dialog', { name: 'Study' });
		await expect(there).toBeVisible();
		await expect(second).toHaveURL(/\/$/);
		await expect(there.getByRole('checkbox', { name: 'Writing' })).toBeChecked();
		await expect(there.getByRole('checkbox', { name: 'Vocab' })).toBeChecked();
	} finally {
		await other.close();
	}
});

test('Advanced settings: a change there shows in the modal when the learner comes back', async ({ page, learner }) => {
	await addCards(learner, 'ja', WORDS.map((written) => ({ kind: 'vocab' as const, written })));
	await page.goto('/flashcards');
	await page.getByRole('link', { name: 'Study', exact: true }).click();
	const modal = page.getByRole('dialog', { name: 'Study' });
	await expect(modal).toContainText('This session: 4 cards');
	await modal.getByRole('link', { name: /Advanced settings/ }).click();
	await expect(page).toHaveURL(/\/study\/advanced\?from=%2Fflashcards$/);
	await expect(page.getByRole('dialog', { name: 'Study' })).toHaveCount(0);

	const newCards = page.getByRole('spinbutton', { name: 'New cards' });
	await newCards.fill('3');
	await newCards.press('Tab');
	await expect.poll(async () => (await savedSetup(learner))?.newLimit).toBe(3);

	await page.getByRole('link', { name: 'Back to study' }).click();
	await expect(page).toHaveURL(/\/flashcards$/);
	await expect(page.getByRole('dialog', { name: 'Study' })).toContainText('This session: 3 cards');
});

test.describe('on a phone', () => {
	const PHONE = { width: 360, height: 740 };
	test.use({ viewport: PHONE, hasTouch: true, isMobile: true });

	test('the modal is the bottom sheet, and Start studies', async ({ page, learner }) => {
		await addCards(learner, 'ja', WORDS.map((written) => ({ kind: 'vocab' as const, written })));
		await page.goto('/study');
		const sheet = page.getByRole('dialog', { name: 'Study' });
		await expect(sheet).toBeVisible();
		await expect(sheet.getByRole('heading', { name: 'Study' })).toBeVisible();
		await expect(sheet).toContainText('This session: 4 cards');
		// Anchored to the bottom edge of the screen, as wide as the screen, once it has slid in.
		await expect
			.poll(async () => {
				const box = await sheet.boundingBox();
				return box === null ? null : { bottomGap: Math.round(Math.abs(box.y + box.height - PHONE.height)), width: Math.round(box.width) };
			})
			.toEqual({ bottomGap: 0, width: PHONE.width });
		await sheet.getByRole('button', { name: 'Start studying' }).click();
		await expect(page).toHaveURL(/\/study\/session$/);
	});
});
