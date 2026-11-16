// Wording of the daily limits (pure; components only place the strings).

import type { Admission } from './limits';

function plural(n: number, one: string, many = `${one}s`): string {
	return `${n} ${n === 1 ? one : many}`;
}

/** The home widget's line: "18 reviews · 5 new left today". */
export function leftTodayText(left: Admission['left']): string {
	if (left.unlimited) return `${plural(left.reviews, 'review')} · ${left.new} new (no daily limit)`;
	if (left.reviews === 0 && left.new === 0) {
		return left.limitedOut > 0 ? 'Done for today — daily limit reached' : 'Nothing due today';
	}
	return `${plural(left.reviews, 'review')} · ${left.new} new left today`;
}

/** The study start's line. */
export function startTodayText(reviews: number, fresh: number, unlimited: boolean): string {
	const base = `Today: ${plural(reviews, 'review')} and ${fresh} new`;
	return unlimited ? base : `${base} (daily limits applied)`;
}

/** The decks view's "5 new · 12 reviews left today"; null when both are unlimited. */
export function deckLeftText(left: { new: number | null; reviews: number | null }): string | null {
	const parts: string[] = [];
	if (left.new !== null) parts.push(`${left.new} new`);
	if (left.reviews !== null) parts.push(plural(left.reviews, 'review'));
	return parts.length === 0 ? null : `${parts.join(' · ')} left today`;
}
