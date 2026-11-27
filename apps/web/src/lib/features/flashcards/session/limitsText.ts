// Wording of the daily limits (pure; components only place the strings).

import { t } from '$lib/i18n';
import type { Admission } from '$lib/studycore/limits';

function reviewsText(n: number): string {
	return t('study.limits.reviews', { count: n });
}

/** The home widget's line: "18 reviews · 5 new left today". */
export function leftTodayText(left: Admission['left']): string {
	if (left.unlimited) return t('study.limits.leftUnlimited', { reviews: reviewsText(left.reviews), fresh: left.new });
	if (left.reviews === 0 && left.new === 0) {
		return left.limitedOut > 0 ? t('study.limits.doneLimit') : t('study.limits.nothingDue');
	}
	return t('study.limits.left', { reviews: reviewsText(left.reviews), fresh: left.new });
}

/** The study start's line. */
export function startTodayText(reviews: number, fresh: number, unlimited: boolean): string {
	const args = { reviews: reviewsText(reviews), fresh };
	return unlimited ? t('study.limits.today', args) : t('study.limits.todayLimited', args);
}

/** The decks view's "5 new · 12 reviews left today"; null when both are unlimited. */
export function deckLeftText(left: { new: number | null; reviews: number | null }): string | null {
	const parts: string[] = [];
	if (left.new !== null) parts.push(t('study.limits.newCount', { count: left.new }));
	if (left.reviews !== null) parts.push(reviewsText(left.reviews));
	return parts.length === 0 ? null : t('study.limits.deckLeft', { parts: parts.join(' · ') });
}
