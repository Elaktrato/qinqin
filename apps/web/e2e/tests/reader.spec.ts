// Flow 3: open a Japanese book in the reader, point at a word, and the
// lookup popup shows its dictionary entry.

import type { Locator, Page } from '@playwright/test';
import { expect, test } from '../support/fixtures';
import { boxOf, centreOf, pointAt } from '../support/pointer';
import { addBook } from '../support/study';

test('pointing at a word in a Japanese book shows its dictionary entry', async ({ page, learner }) => {
	const bookId = await addBook(learner, 'ja', '学校の本', ['私は学校に行きます。', '水を飲みます。', '学生は本を読みます。']);

	await page.goto('/reader');
	await page.getByRole('link', { name: /学校の本/ }).click();
	await expect(page).toHaveURL(new RegExp(`/reader/book/${bookId}/0$`));
	const paragraph = page.getByText('私は学校に行きます。');
	await expect(paragraph).toBeVisible();

	// 学 of 学校: the longest match comes first (学校, then the character 学).
	await pointAt(page, paragraph, '学');
	const popup = page.getByRole('dialog', { name: /学校/ });
	await expect(popup).toBeVisible();
	await expect(popup).toContainText('がっこう');
	await expect(popup).toContainText('school');
	await expect(popup).toContainText('Japanese end-to-end test dictionary');
	await expectRanked(popup, ['school', 'learning; study']);
	await expect(popup).not.toContainText('student');

	// Escape closes it; another word opens its own entry.
	await page.keyboard.press('Escape');
	await expect(popup).toBeHidden();
	await pointAt(page, page.getByText('水を飲みます。'), '水');
	const water = page.getByRole('dialog', { name: /水/ });
	await expect(water).toContainText('みず');
	await expect(water).toContainText('water');
	await page.keyboard.press('Escape');
	await expect(water).toBeHidden();

	// 学 again, now of 学生: same first character, a different word (no stale lookup).
	await pointAt(page, page.getByText('学生は本を読みます。'), '学');
	const student = page.getByRole('dialog', { name: /学生/ });
	await expect(student).toContainText('がくせい');
	await expectRanked(student, ['student', 'learning; study']);
	await expect(student).not.toContainText('school');
});

/** The glosses appear in the popup in this order (the ranking of the entries). */
async function expectRanked(popup: Locator, glosses: string[]): Promise<void> {
	await expect(popup).toContainText(glosses[glosses.length - 1]);
	const text = await popup.innerText();
	const at = glosses.map((g) => text.indexOf(g));
	expect(at.every((i) => i >= 0), `${glosses.join(', ')} in ${text}`).toBe(true);
	expect([...at].sort((a, b) => a - b), `order of ${glosses.join(', ')} in ${text}`).toEqual(at);
}

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

	test('tapping a word opens its entry in the bottom sheet, with the word above the sheet and nothing selected', async ({ page, learner }) => {
		const filler = Array.from({ length: 12 }, () => '私は学校に行きます。');
		const bookId = await addBook(learner, 'ja', '水の本', [...filler, '私は水を飲みます。', ...filler]);
		await page.goto(`/reader/book/${bookId}/0`);
		const paragraph = page.getByText('私は水を飲みます。');
		await expect(paragraph).toBeVisible();
		// Low on the screen, where the sheet comes up.
		await paragraph.evaluate((el) => window.scrollBy(0, el.getBoundingClientRect().top - window.innerHeight * 0.8));
		const word = await centreOf(paragraph, '水');
		const box = await paragraph.boundingBox();
		expect(box, 'the paragraph is rendered').not.toBeNull();
		await paragraph.tap({ position: { x: word.x - box!.x, y: word.y - box!.y } });

		const sheet = page.getByRole('dialog', { name: /水/ });
		await expect(sheet).toBeVisible();
		await expect(sheet).toContainText('みず');
		await expect(sheet).toContainText('water');
		await expectAboveSheet(page, sheet, paragraph, '水');
		expect(await page.evaluate(() => window.getSelection()?.toString() ?? '')).toBe('');

		// Another word, behind the open sheet's backdrop: one tap looks it up.
		const above = page.getByText('私は学校に行きます。').nth(11);
		const school = await centreOf(above, '学');
		await page.touchscreen.tap(school.x, school.y);
		const next = page.getByRole('dialog', { name: /学校/ });
		await expect(next).toBeVisible();
		await expect(next).toContainText('school');
		await expect(page.getByRole('dialog')).toHaveCount(1);
		await expectAboveSheet(page, next, above, '学校');
	});

	test('a word on the last line of the chapter can still be read above the sheet', async ({ page, learner }) => {
		const filler = Array.from({ length: 12 }, () => '私は学校に行きます。');
		const bookId = await addBook(learner, 'ja', '最後の本', [...filler, '私は水を飲みます。']);
		await page.goto(`/reader/book/${bookId}/0`);
		const paragraph = page.getByText('私は水を飲みます。');
		await expect(paragraph).toBeVisible();
		// The very end of the page: nothing more to scroll.
		await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
		const word = await centreOf(paragraph, '水');
		await page.touchscreen.tap(word.x, word.y);
		const sheet = page.getByRole('dialog', { name: /水/ });
		await expect(sheet).toContainText('water');
		await expectAboveSheet(page, sheet, paragraph, '水');
	});

	test('a long entry: the sheet takes at most 60 % of the screen and scrolls inside, the word above it (#282)', async ({ page, learner }) => {
		const filler = Array.from({ length: 12 }, () => '私は学校に行きます。');
		const bookId = await addBook(learner, 'ja', '辞書の本', [...filler, '辞書を読みます。', ...filler]);
		await page.goto(`/reader/book/${bookId}/0`);
		const paragraph = page.getByText('辞書を読みます。');
		await expect(paragraph).toBeVisible();
		// Low on the screen, where the sheet comes up.
		await paragraph.evaluate((el) => window.scrollBy(0, el.getBoundingClientRect().top - window.innerHeight * 0.8));
		const word = await centreOf(paragraph, '辞');
		await page.touchscreen.tap(word.x, word.y);
		const sheet = page.getByRole('dialog', { name: /辞書/ });
		await expect(sheet).toContainText('dictionary sense 30');
		await expectAboveSheet(page, sheet, paragraph, '辞書');

		const viewport = page.viewportSize()!;
		const measure = () =>
			sheet.evaluate((el) => {
				const body = el.querySelector('.body') as HTMLElement;
				return { height: el.getBoundingClientRect().height, scrolls: body.scrollHeight > body.clientHeight + 1 };
			});
		const opened = await measure();
		expect(opened.height, `sheet height ${opened.height} of ${viewport.height}`).toBeLessThanOrEqual(viewport.height * 0.6);
		expect(opened.scrolls, 'the long entry scrolls inside the sheet').toBe(true);

		// The content scrolls to its end inside the sheet; the sheet stays put.
		const last = sheet.getByText('dictionary sense 30', { exact: false });
		await last.scrollIntoViewIfNeeded();
		await expect(last).toBeInViewport();
		expect((await measure()).height).toBeCloseTo(opened.height, 0);
		await expectAboveSheet(page, sheet, paragraph, '辞書');

		// Dragging the handle up does not grow it past the cap.
		const handle = sheet.locator('.grab');
		const grab = await handle.boundingBox();
		await handle.dispatchEvent('pointerdown', { clientX: grab!.x + 10, clientY: grab!.y + 10, pointerId: 3, isPrimary: true });
		await handle.dispatchEvent('pointermove', { clientX: grab!.x + 10, clientY: 20, pointerId: 3 });
		expect((await measure()).height).toBeLessThanOrEqual(viewport.height * 0.6);
		expect((await sheet.boundingBox())!.y).toBeCloseTo(viewport.height - opened.height, 0);
		await handle.dispatchEvent('pointerup', { clientX: grab!.x + 10, clientY: 20, pointerId: 3 });
		await expect(sheet).toBeVisible();
	});
});

/**
 * Once the sheet has slid in, the word's box ends above its top edge, is
 * still on the screen, and is still marked as the looked-up word.
 */
async function expectAboveSheet(page: Page, sheet: Locator, paragraph: Locator, word: string): Promise<void> {
	await sheet.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
	await expect
		.poll(
			async () => {
				const top = (await sheet.boundingBox())?.y ?? 0;
				const w = await boxOf(paragraph, word);
				return { onScreen: w.y >= 0, above: top - (w.y + w.height) > 0 };
			},
			{ message: `${word} above the sheet and on the screen` }
		)
		.toEqual({ onScreen: true, above: true });
	expect(await page.evaluate(() => CSS.highlights.has('reader-lookup')), 'the looked-up word stays marked').toBe(true);
}
