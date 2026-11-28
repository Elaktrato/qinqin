// The phone-width guard (#296): no page may scroll sideways at 360 px, and
// nothing may stick out of the viewport at the left or right. Every screen
// is checked with it (docs/wiki/Development.md, record 0007).
//
// A box that scrolls sideways on purpose (a wide table in its own
// `overflow-x: auto` wrapper, the activity heatmap) is allowed: what is
// inside a box that clips or scrolls sideways is bounded by that box, and the
// box itself is checked. The page root does not count as such a box, so a
// root with `overflow-x: hidden` cannot hide a page that is too wide.

import { expect, type Page } from '@playwright/test';

/** The phone viewport the guard is run at. */
export const PHONE = { width: 360, height: 740 } as const;

export interface SidewaysReport {
	/** The width the screen was opened at (the test's viewport). */
	screenWidth: number;
	/**
	 * window.innerWidth. On a phone (isMobile) a page that is too wide widens
	 * the layout viewport (the browser zooms out), so this is checked against
	 * the screen width, and the rest against the screen width, not this.
	 */
	innerWidth: number;
	/** document.documentElement.scrollWidth. */
	scrollWidth: number;
	/** body.scrollWidth (a body that scrolls instead of the root). */
	bodyScrollWidth: number;
	/** What sticks out, as `tag.class "text…" [left, right]`, at most 20. */
	offenders: string[];
}

/**
 * sidewaysOverflow measures the page: its scroll width against the
 * viewport, and every rendered element and text that reaches past the left
 * or right edge (by more than half a pixel) and is not inside a box that
 * clips or scrolls sideways.
 */
export function sidewaysOverflow(page: Page): Promise<SidewaysReport> {
	const screen = page.viewportSize();
	if (!screen) throw new Error('the guard needs a fixed viewport');
	return page.evaluate((vw) => {
		const root = document.documentElement;
		const body = document.body;
		const SLACK = 0.5;
		// Whether a box that clips or scrolls sideways, below the root, bounds an
		// element's box. An absolutely positioned element escapes every such box
		// up to its containing block (a visually hidden label in a scrolling table
		// widens the page unless the scroller is positioned); a fixed one escapes all.
		const insideSidewaysBox = (el: Element): boolean => {
			let position = getComputedStyle(el).position;
			for (let cur = el.parentElement; cur && cur !== body && cur !== root; cur = cur.parentElement) {
				const style = getComputedStyle(cur);
				const contains =
					position === 'absolute'
						? style.position !== 'static' || style.transform !== 'none' || style.contain.includes('layout')
						: position === 'fixed'
							? style.transform !== 'none' || style.contain.includes('layout')
							: true;
				if (!contains) continue;
				if (style.overflowX !== 'visible') return true;
				position = style.position;
			}
			return false;
		};
		/** A text node is bounded by its parent's own clipping, or by the parent's boxes. */
		const textInsideSidewaysBox = (parent: Element): boolean =>
			getComputedStyle(parent).overflowX !== 'visible' || insideSidewaysBox(parent);
		const describe = (el: Element, left: number, right: number, text?: string): string => {
			const cls = typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\s+/).join('.') : '';
			const sample = (text ?? el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 40);
			const id = el.id ? '#' + el.id : '';
			return `${el.tagName.toLowerCase()}${id}${cls} "${sample}" [${Math.round(left)}, ${Math.round(right)}]`;
		};
		const sticksOut = (r: DOMRect) => r.width > 0 && r.height > 0 && (r.left < -SLACK || r.right > vw + SLACK);

		const offenders: string[] = [];
		const reported = new Set<Element>();
		const within = (el: Element) => [...reported].some((r) => r.contains(el));
		for (const el of body.querySelectorAll('*')) {
			if (offenders.length >= 20) break;
			const style = getComputedStyle(el);
			if (style.visibility !== 'visible' || style.display === 'contents') continue;
			const r = el.getBoundingClientRect();
			// The outermost box that sticks out is reported, not each of its children.
			if (sticksOut(r) && !within(el) && !insideSidewaysBox(el)) {
				reported.add(el);
				offenders.push(describe(el, r.left, r.right));
			}
		}
		// Text that overflows its own box (a long unbroken string) is not in any element's rectangle.
		const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
		const range = document.createRange();
		for (let node = walker.nextNode(); node && offenders.length < 20; node = walker.nextNode()) {
			const parent = node.parentElement;
			if (!parent || !node.textContent?.trim()) continue;
			if (getComputedStyle(parent).visibility !== 'visible') continue;
			range.selectNodeContents(node);
			const r = range.getBoundingClientRect();
			if (sticksOut(r) && !within(parent) && !textInsideSidewaysBox(parent)) {
				reported.add(parent);
				offenders.push(describe(parent, r.left, r.right, node.textContent));
			}
		}
		return { screenWidth: vw, innerWidth: window.innerWidth, scrollWidth: root.scrollWidth, bodyScrollWidth: body.scrollWidth, offenders };
	}, screen.width);
}

/**
 * expectNoSidewaysScroll fails when the page scrolls sideways or anything
 * sticks out of the viewport at the side. `where` names the screen in the
 * failure message.
 */
export async function expectNoSidewaysScroll(page: Page, where: string): Promise<void> {
	const report = await sidewaysOverflow(page);
	expect(report.offenders, `${where}: elements sticking out of the ${report.screenWidth} px screen`).toEqual([]);
	expect(report.innerWidth, `${where}: the page widened the phone's viewport (zoomed out)`).toBe(report.screenWidth);
	expect(report.scrollWidth, `${where}: the page scrolls sideways`).toBeLessThanOrEqual(report.innerWidth);
	expect(report.bodyScrollWidth, `${where}: the body scrolls sideways`).toBeLessThanOrEqual(report.innerWidth);
}
