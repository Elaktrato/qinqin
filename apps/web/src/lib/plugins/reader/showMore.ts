// "Show more" thresholds of the lookup popup: the first few entries of a
// result list and the first few senses of an entry, the rest behind a button.

export const ENTRIES_VISIBLE = 3;
export const SENSES_VISIBLE = 3;

/**
 * visibleCount is how many of `total` items show once `step` more are
 * revealed after the `shown` already visible; without a step, all of them.
 * visibleCount(total, 0, ENTRIES_VISIBLE) is the initial count.
 */
export function visibleCount(total: number, shown: number, step = Infinity): number {
	return Math.min(total, Math.max(0, shown) + step);
}
