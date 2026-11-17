// The reading position is the first paragraph in view. IntersectionObserver
// records for the `<p data-p>` elements of the chapter are folded into the
// set of paragraphs in view; the smallest one is the position.

export interface VisibilityRecord {
	isIntersecting: boolean;
	/** A `<p data-p>` element (or anything with a `dataset`). */
	target: Element | { dataset?: { p?: string } };
}

function paragraphIndex(target: VisibilityRecord['target']): number | null {
	const raw = (target as { dataset?: { p?: string } }).dataset?.p;
	if (raw === undefined || raw === '') return null;
	const p = Number(raw);
	return Number.isInteger(p) ? p : null;
}

/**
 * topParagraph folds a batch of records into `visible` and returns the
 * first paragraph in view, or null while none is. The whole viewport
 * counts: nothing sticky covers the text.
 */
export function topParagraph(visible: Set<number>, records: Iterable<VisibilityRecord>): number | null {
	for (const record of records) {
		const p = paragraphIndex(record.target);
		if (p === null) continue;
		if (record.isIntersecting) visible.add(p);
		else visible.delete(p);
	}
	return visible.size > 0 ? Math.min(...visible) : null;
}
