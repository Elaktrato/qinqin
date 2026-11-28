// Flow: the graded readers (#231) at phone size. The Sources page opens on the Graded readers of the workspace
// language; a level filter narrows the list; a text's new words show with their pinyin unless the workspace hides
// it (#284); Read adds the text to the library and opens it in the reader.

import type { Page } from '@playwright/test';
import { expect, test } from '../support/fixtures';
import type { Learner } from '../support/fixtures';
import { PHONE, expectNoSidewaysScroll } from '../support/layout';

test.use({ viewport: PHONE, hasTouch: true, isMobile: true });

async function useWorkspace(page: Page, learner: Learner, language: string): Promise<void> {
	await page.addInitScript((id) => localStorage.setItem('qinqin.workspace', String(id)), learner.workspaces[language]);
}

test('a Chinese learner picks an HSK 2 text and reads it', async ({ page, learner }) => {
	await useWorkspace(page, learner, 'zh');
	await page.goto('/reader');
	await page.getByRole('link', { name: 'browse graded readers and public-domain texts' }).click();
	await expect(page).toHaveURL(/\/reader\/sources$/);
	await expect(page.getByRole('tab', { name: 'Graded readers' })).toHaveAttribute('aria-selected', 'true');
	const list = page.getByTestId('graded-texts');
	await expect(list.getByText('新朋友')).toBeVisible();
	await expectNoSidewaysScroll(page, '/reader/sources (graded readers)');

	await page.getByLabel('Level').selectOption({ label: 'HSK 2' });
	await expect(list.getByText('新朋友')).toBeHidden();
	const doctor = list.getByRole('listitem').filter({ hasText: '看病' });
	await expect(doctor).toContainText('HSK 2');
	await expect(doctor).toContainText('Dialogue');
	await expect(doctor).toContainText('Reviewed by agents');
	await doctor.getByText('2 new words').click();
	await expect(doctor).toContainText('不用');
	await expect(doctor).toContainText('bùyòng');
	await expectNoSidewaysScroll(page, '/reader/sources (new words open)');

	await doctor.getByRole('button', { name: 'Read' }).click();
	await expect(page).toHaveURL(/\/reader\/book\/\d+\/0$/);
	await expect(page.getByText('“你好，你哪儿不舒服？”')).toBeVisible();

	// The text is a book of the library now; the Sources page offers Open for it.
	await page.goto('/reader/sources');
	await page.getByLabel('Level').selectOption({ label: 'HSK 2' });
	const again = page.getByTestId('graded-texts').getByRole('listitem').filter({ hasText: '看病' });
	await expect(again.getByRole('link', { name: 'Open it' })).toBeVisible();
	await page.goto('/reader');
	await expect(page.getByRole('link', { name: /看病/ })).toBeVisible();
});

test('with pinyin hidden the new words show without it', async ({ page, learner }) => {
	await learner.api.call('PUT', `/api/workspaces/${learner.workspaces.zh}`, {
		settings: { romanisation: { pinyin: 'never', bopomofo: 'never' } }
	});
	await useWorkspace(page, learner, 'zh');
	await page.goto('/reader/sources');
	await page.getByLabel('Level').selectOption({ label: 'HSK 2' });
	const doctor = page.getByTestId('graded-texts').getByRole('listitem').filter({ hasText: '看病' });
	await doctor.getByText('2 new words').click();
	await expect(doctor).toContainText('不用');
	await expect(doctor).toContainText('no need to');
	await expect(doctor).not.toContainText('bùyòng');
});

test('a Japanese learner sees the ≈ N5–N3 texts', async ({ page, learner }) => {
	await useWorkspace(page, learner, 'ja');
	await page.goto('/reader/sources');
	await expect(page.getByRole('tab', { name: 'Graded readers' })).toHaveAttribute('aria-selected', 'true');
	const options = await page.getByLabel('Level').locator('option').allTextContents();
	expect(options).toEqual(['All levels', '≈ N5', '≈ N4', '≈ N3']);
	await expect(page.getByTestId('graded-texts').getByText('はじめまして')).toBeVisible();
});
