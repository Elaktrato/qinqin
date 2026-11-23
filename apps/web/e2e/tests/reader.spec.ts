// Flow 3: open a Japanese book in the reader, point at a word, and the
// lookup popup shows its dictionary entry.

import type { Locator, Page } from '@playwright/test';
import { expect, test } from '../support/fixtures';
import { addBook } from '../support/study';

/** The centre of the first occurrence of `text` inside `container`. */
async function centreOf(container: Locator, text: string): Promise<{ x: number; y: number }> {
	const box = await container.evaluate((el, needle) => {
		const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
		for (let node = walker.nextNode(); node; node = walker.nextNode()) {
			const at = (node as Text).data.indexOf(needle);
			if (at < 0) continue;
			const range = document.createRange();
			range.setStart(node, at);
			range.setEnd(node, at + needle.length);
			const r = range.getBoundingClientRect();
			return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
		}
		return null;
	}, text);
	if (box === null) throw new Error(`${text} is not in the text`);
	return box;
}

/** Moves the mouse onto `text` (the reader looks a word up on hover, from the character under the pointer). */
async function pointAt(page: Page, container: Locator, text: string): Promise<void> {
	const { x, y } = await centreOf(container, text);
	await page.mouse.move(x - 40, y);
	await page.mouse.move(x, y, { steps: 4 });
}

test('pointing at a word in a Japanese book shows its dictionary entry', async ({ page, learner }) => {
	const bookId = await addBook(learner, 'ja', '学校の本', ['私は学校に行きます。', '水を飲みます。']);

	await page.goto('/reader');
	await page.getByRole('link', { name: /学校の本/ }).click();
	await expect(page).toHaveURL(new RegExp(`/reader/book/${bookId}/0$`));
	const paragraph = page.getByText('私は学校に行きます。');
	await expect(paragraph).toBeVisible();

	await pointAt(page, paragraph, '学');
	const popup = page.getByRole('dialog', { name: /学校/ });
	await expect(popup).toBeVisible();
	await expect(popup).toContainText('学校');
	await expect(popup).toContainText('がっこう');
	await expect(popup).toContainText('school');
	await expect(popup).toContainText('Japanese end-to-end test dictionary');

	// Escape closes it; another word opens its own entry.
	await page.keyboard.press('Escape');
	await expect(popup).toBeHidden();
	await pointAt(page, page.getByText('水を飲みます。'), '水');
	const water = page.getByRole('dialog', { name: /水/ });
	await expect(water).toContainText('みず');
	await expect(water).toContainText('water');
});

test.describe('on a phone', () => {
	test.use({ viewport: { width: 360, height: 740 }, hasTouch: true, isMobile: true });

	test('selecting a word (a long press) opens its entry in the bottom sheet', async ({ page, learner }) => {
		const bookId = await addBook(learner, 'ja', '水の本', ['私は水を飲みます。']);
		await page.goto(`/reader/book/${bookId}/0`);
		const paragraph = page.getByText('私は水を飲みます。');
		await expect(paragraph).toBeVisible();
		// A long press selects the word under the finger; select it the same way.
		await paragraph.evaluate((el) => {
			const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
			for (let node = walker.nextNode(); node; node = walker.nextNode()) {
				const at = (node as Text).data.indexOf('水');
				if (at < 0) continue;
				const range = document.createRange();
				range.setStart(node, at);
				range.setEnd(node, at + 1);
				const selection = window.getSelection()!;
				selection.removeAllRanges();
				selection.addRange(range);
				return;
			}
		});
		const sheet = page.getByRole('dialog', { name: /水/ });
		await expect(sheet).toBeVisible();
		await expect(sheet).toContainText('みず');
		await expect(sheet).toContainText('water');
	});
});
