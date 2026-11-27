// Flow: hidden romanisation (#284) at phone size. With Show pinyin and Show bopomofo on Never (Chinese) or Show
// romaji on Never (Japanese), no romanisation is visible on a word page, on a flashcard (front and back) or in the
// reader's lookup sheet; asking for it is the last hint (docs/contracts/settings/romanisation.json).

import type { Page } from '@playwright/test';
import { expect, test } from '../support/fixtures';
import type { Learner } from '../support/fixtures';
import { addBook, addCards } from '../support/study';

test.use({ viewport: { width: 360, height: 740 }, hasTouch: true, isMobile: true });

/** Latin letters with pinyin tone marks, or any Bopomofo letter: a visible pinyin or zhuyin. */
const PINYIN = /[āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ]|nǐ|hǎo|\bni hao\b/i;
const BOPOMOFO = /[㄀-ㄯ]/;

async function useWorkspace(page: Page, learner: Learner, language: string): Promise<void> {
	await page.addInitScript((id) => localStorage.setItem('qinqin.workspace', String(id)), learner.workspaces[language]);
}

async function visibleText(page: Page): Promise<string> {
	return page.locator('body').innerText();
}

async function noHorizontalScroll(page: Page): Promise<void> {
	const overflow = await page.evaluate(() => {
		const root = document.scrollingElement ?? document.documentElement;
		return root.scrollWidth - root.clientWidth;
	});
	expect(overflow, 'no horizontal scroll at 360 px').toBeLessThanOrEqual(0);
}

async function startStudying(page: Page): Promise<void> {
	await page.goto('/study');
	await page.getByRole('dialog', { name: 'Study' }).getByRole('button', { name: 'Start studying' }).click();
	await expect(page).toHaveURL(/\/study\/session$/);
}

test('Chinese with pinyin and bopomofo hidden: none on the word page, the card or the reader sheet', async ({ page, learner }) => {
	await useWorkspace(page, learner, 'zh');
	const id = await learner.entryId('zh', '你好');
	await addCards(learner, 'zh', [{ kind: 'vocab', written: '你好' }]);
	const bookId = await addBook(learner, 'zh', '你好的书', ['你好，中国。']);

	// Before: the word page shows the pinyin.
	await page.goto(`/entry/${id}`);
	await expect(page.getByLabel('Readings')).toContainText('nǐ hǎo');

	// Settings → Study → Romanisation: both Never, saved on the server.
	await page.goto('/settings?tab=study');
	for (const name of ['Show pinyin', 'Show bopomofo (zhuyin)']) {
		const saved = page.waitForResponse((r) => r.request().method() === 'PUT' && /\/api\/workspaces\/\d+$/.test(r.url()));
		await page.getByRole('group', { name }).getByRole('radio', { name: 'Never' }).check();
		await saved;
	}
	await noHorizontalScroll(page);

	// The word page.
	await page.goto(`/entry/${id}`);
	await expect(page.getByRole('heading', { name: '你好' })).toBeVisible();
	await expect(page.getByText('hello').first()).toBeVisible();
	expect(await visibleText(page)).not.toMatch(PINYIN);
	expect(await visibleText(page)).not.toMatch(BOPOMOFO);
	await noHorizontalScroll(page);

	// A card: no reading on the front or the back; the only hint is the romanisation, asked for.
	await startStudying(page);
	await expect(page.getByRole('button', { name: 'Hint' })).toBeVisible();
	expect(await visibleText(page)).not.toMatch(PINYIN);
	await page.getByRole('button', { name: 'Show answer' }).click();
	await expect(page.getByRole('button', { name: /^Good\b/ })).toBeVisible();
	expect(await visibleText(page)).not.toMatch(PINYIN);
	expect(await visibleText(page)).not.toMatch(BOPOMOFO);
	await noHorizontalScroll(page);

	// The reader: tapping a word opens the sheet without its pinyin.
	await page.goto(`/reader/book/${bookId}/0`);
	const paragraph = page.getByText('你好，中国。');
	await expect(paragraph).toBeVisible();
	await paragraph.evaluate((el) => {
		const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
		for (let node = walker.nextNode(); node; node = walker.nextNode()) {
			const at = (node as Text).data.indexOf('你');
			if (at < 0) continue;
			const range = document.createRange();
			range.setStart(node, at);
			range.setEnd(node, at + 2);
			window.getSelection()!.removeAllRanges();
			window.getSelection()!.addRange(range);
			return;
		}
	});
	const sheet = page.getByRole('dialog', { name: /你好/ });
	await expect(sheet).toContainText('hello');
	expect(await sheet.innerText()).not.toMatch(PINYIN);
	expect(await visibleText(page)).not.toMatch(PINYIN);
});

test('Japanese with romaji hidden: kana everywhere, the romaji only as the last hint', async ({ page, learner }) => {
	await useWorkspace(page, learner, 'ja');
	await learner.api.call('PUT', `/api/workspaces/${learner.workspaces.ja}`, { settings: { romanisation: { romaji: 'never' } } });
	const id = await learner.entryId('ja', '学校');
	await addCards(learner, 'ja', [{ kind: 'vocab', written: '学校' }]);

	await page.goto(`/entry/${id}`);
	await expect(page.getByLabel('Readings')).toContainText('がっこう');
	expect(await visibleText(page)).not.toMatch(/gakk?ou|gakkō/i);
	await noHorizontalScroll(page);

	await startStudying(page);
	const card = page.getByRole('article', { name: /^Recognise card$/ });
	await expect(page.getByRole('button', { name: 'Hint' })).toBeVisible();
	expect(await visibleText(page)).not.toMatch(/gakk?ou/i);
	// First hint: the kana. Second (the last step): the romaji, which the learner asked for.
	await page.getByRole('button', { name: 'Hint' }).click();
	await expect(card.locator('[data-hint="reading"]')).toContainText('がっこう');
	expect(await visibleText(page)).not.toMatch(/gakk?ou/i);
	await page.getByRole('button', { name: 'Hint' }).click();
	await expect(card.locator('[data-hint="romanisation"]')).toContainText(/gakk?ou/i);
	await page.getByRole('button', { name: 'Show answer' }).click();
	// Two hints asked: the suggestion is lowered (Hard holds the focus).
	await expect(page.getByRole('button', { name: /^Hard\b/ })).toBeFocused();
	await noHorizontalScroll(page);
});
