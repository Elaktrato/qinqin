// The word stays visible (tap to look up): when the phone's lookup sheet
// opens, the text scrolls so the looked-up word sits above the sheet's top
// edge. scrollDeltaAbove is the arithmetic (viewport coordinates, DOM-free);
// scrollParent finds what scrolls.

/** How far above the sheet's top edge the word's box ends (CSS px). */
export const WORD_MARGIN_PX = 12;

/**
 * scrollDeltaAbove answers how far to scroll (positive: the text moves up,
 * as scrollBy counts) so that `word` ends `margin` above `bounds.bottom` (the
 * sheet's top) without its top going above `bounds.top` + margin (the top of
 * the scroll container). A word cut off at the visible top comes down to
 * the margin under it; a word that fits already does not move; when the
 * room above the sheet is too small, the word's top stops the margin under
 * the visible top (never further).
 */
export function scrollDeltaAbove(
	word: { top: number; bottom: number },
	bounds: { top: number; bottom: number },
	margin = WORD_MARGIN_PX
): number {
	// Cut off at the top: bring it down to the margin under the top.
	if (word.top < bounds.top) return word.top - bounds.top - margin;
	const room = Math.max(0, word.top - bounds.top - margin);
	const need = word.bottom + margin - bounds.bottom;
	if (need <= 0) return 0;
	return Math.min(need, room);
}

/**
 * scrollParent is the nearest ancestor of `el` that scrolls vertically
 * (overflow-y auto, scroll or overlay) and has more content than room; null
 * means the window scrolls (every lookup host today).
 */
export function scrollParent(el: Element): HTMLElement | null {
	for (let node = el.parentElement; node && node !== document.body && node !== document.documentElement; node = node.parentElement) {
		const overflow = getComputedStyle(node).overflowY;
		if (/^(auto|scroll|overlay)$/.test(overflow) && node.scrollHeight > node.clientHeight) return node;
	}
	return null;
}
