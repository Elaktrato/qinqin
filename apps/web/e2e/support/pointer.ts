// Pointing at text the way a reader does: the lookup popup opens on hover,
// from the character under the pointer.

import type { Locator, Page } from '@playwright/test';

/** The viewport box of the first occurrence of `text` inside `container`. */
export async function boxOf(container: Locator, text: string): Promise<{ x: number; y: number; width: number; height: number }> {
	const box = await container.evaluate((el, needle) => {
		const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
		for (let node = walker.nextNode(); node; node = walker.nextNode()) {
			const at = (node as Text).data.indexOf(needle);
			if (at < 0) continue;
			const range = document.createRange();
			range.setStart(node, at);
			range.setEnd(node, at + needle.length);
			const r = range.getBoundingClientRect();
			return { x: r.x, y: r.y, width: r.width, height: r.height };
		}
		return null;
	}, text);
	if (box === null) throw new Error(`${text} is not in the text`);
	return box;
}

/** The centre of the first occurrence of `text` inside `container`. */
export async function centreOf(container: Locator, text: string): Promise<{ x: number; y: number }> {
	const box = await boxOf(container, text);
	return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Moves the mouse onto `text`. */
export async function pointAt(page: Page, container: Locator, text: string): Promise<void> {
	const { x, y } = await centreOf(container, text);
	await page.mouse.move(x - 40, y);
	await page.mouse.move(x, y, { steps: 4 });
}
