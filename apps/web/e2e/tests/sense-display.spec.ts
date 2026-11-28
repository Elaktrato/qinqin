// Flow: slang and vulgar senses at phone size (#345, docs/contracts/senses). 鸡's "(slang) prostitute" never shows
// first: the card back folds it behind "Show 1 more meaning", the reader's lookup sheet lists it last behind "Show 1
// more sense", and the full word page shows it last, marked "vulgar". No sideways scroll at 360 px.

import type { Page } from '@playwright/test';
import { expect, test } from '../support/fixtures';
import type { Learner } from '../support/fixtures';
import { PHONE, expectNoSidewaysScroll } from '../support/layout';
import { addBook, addCards } from '../support/study';

test.use({ viewport: PHONE, hasTouch: true, isMobile: true });

const SLANG = '(slang) prostitute';

async function useWorkspace(page: Page, learner: Learner, language: string): Promise<void> {
	await page.addInitScript((id) => localStorage.setItem('qinqin.workspace', String(id)), learner.workspaces[language]);
}

test('the card back folds the slang meaning behind a button', async ({ page, learner }) => {
	await useWorkspace(page, learner, 'zh');
	await addCards(learner, 'zh', [{ kind: 'vocab', written: '鸡' }]);
	await page.goto('/study');
	await page.getByRole('dialog', { name: 'Study' }).getByRole('button', { name: 'Start studying' }).click();
	await expect(page).toHaveURL(/\/study\/session$/);
	await page.getByRole('button', { name: 'Show answer' }).click();

	const answer = page.getByRole('region', { name: 'Answer' });
	await expect(answer).toContainText('chicken');
	await expect(answer).not.toContainText('prostitute');
	await expectNoSidewaysScroll(page, 'card back');
	await answer.getByRole('button', { name: 'Show 1 more meaning' }).click();
	await expect(answer.getByText(SLANG)).toBeVisible();
	await expect(answer.getByText('vulgar', { exact: true })).toBeVisible();
	await expectNoSidewaysScroll(page, 'card back, all meanings');
});

test('the lookup sheet lists the slang sense last, behind "Show 1 more sense"', async ({ page, learner }) => {
	await useWorkspace(page, learner, 'zh');
	const bookId = await addBook(learner, 'zh', '鸡的书', ['我有一只鸡。']);
	await page.goto(`/reader/book/${bookId}/0`);
	const paragraph = page.getByText('我有一只鸡。');
	await expect(paragraph).toBeVisible();
	await paragraph.evaluate((el) => {
		const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
		for (let node = walker.nextNode(); node; node = walker.nextNode()) {
			const at = (node as Text).data.indexOf('鸡');
			if (at < 0) continue;
			const range = document.createRange();
			range.setStart(node, at);
			range.setEnd(node, at + 1);
			window.getSelection()!.removeAllRanges();
			window.getSelection()!.addRange(range);
			return;
		}
	});
	const sheet = page.getByRole('dialog', { name: /鸡/ });
	await expect(sheet).toContainText('chicken');
	await expect(sheet).not.toContainText('prostitute');
	await sheet.getByRole('button', { name: 'Show 1 more sense' }).click();
	await expect(sheet).toContainText(SLANG);
	await expectNoSidewaysScroll(page, 'lookup sheet');
});

test('the word page shows every meaning, the slang one last and marked', async ({ page, learner }) => {
	await useWorkspace(page, learner, 'zh');
	const id = await learner.entryId('zh', '鸡');
	await page.goto(`/entry/${id}`);
	const senses = page.getByRole('region', { name: 'Senses' });
	const items = senses.getByRole('listitem');
	await expect(items).toHaveText(['chicken', 'fowl', `vulgar${SLANG}`]);
	await expectNoSidewaysScroll(page, 'word page');
});
