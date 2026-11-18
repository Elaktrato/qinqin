// The words of a daily goal: metric choices for Settings, the progress text
// (also the ring's aria-valuetext), the status line and the streak line.
// Pure. Templates come from the activity sources' `describe` plurals.

import type { ActivitySource } from '../api/stats';
import { t } from '../i18n';
import { formatNumber } from '../i18n/format';
import { activityType, type GoalMetric } from './goals';
import { activityLabel, activityText } from '../plugins/manifestText';
import type { GoalDay } from './progress';

export interface MetricOption {
	metric: GoalMetric;
	label: string;
	unit: 'count' | 'minutes';
}

const REVIEW_TYPE = 'review';

/** metricOptions: reviews (when a source counts them), new cards, study time, then the other sources by label. */
export function metricOptions(sources: readonly ActivitySource[]): MetricOption[] {
	const option = (s: ActivitySource): MetricOption => ({
		metric: `activity:${s.type}`,
		label: activityLabel(s),
		unit: s.unit === 'seconds' ? 'minutes' : 'count'
	});
	const review = sources.find((s) => s.type === REVIEW_TYPE);
	const others = sources
		.filter((s) => s.type !== REVIEW_TYPE)
		.sort((a, b) => activityLabel(a).localeCompare(activityLabel(b)) || (a.type < b.type ? -1 : 1));
	return [
		...(review === undefined ? [] : [option(review)]),
		{ metric: 'flashcards:new', label: t('goals.metric.newCards'), unit: 'count' },
		{ metric: 'flashcards:studyTime', label: t('goals.metric.studyTime'), unit: 'minutes' },
		...others.map(option)
	];
}

/** The activity source a metric counts; an unknown type words itself with its id ("{n} pomodoro"). */
function sourceOf(metric: GoalMetric, sources: readonly ActivitySource[]): Pick<ActivitySource, 'plugin' | 'type' | 'describe'> {
	const type = activityType(metric) ?? metric;
	return sources.find((s) => s.type === type) ?? { plugin: '', type, describe: { one: `{n} ${type}`, other: `{n} ${type}` } };
}

/** progressText: "32 of 50 flashcard reviews today"; the plural follows the target. */
export function progressText(day: GoalDay, sources: readonly ActivitySource[]): string {
	if (day.metric === null || day.target === null) return t('goals.progress.none');
	if (day.metric === 'flashcards:new') return t('goals.progress.newCards', { count: day.target, amount: day.amount });
	if (day.metric === 'flashcards:studyTime') {
		return t('goals.progress.studyTime', { count: day.target, amount: day.amount });
	}
	// A source's count text: the catalogue's for a built-in plugin, else the manifest's `describe` templates.
	const amount = t('goals.progress.amountOfTarget', { amount: day.amount, target: day.target });
	return t('goals.progress.today', { progress: activityText(sourceOf(day.metric, sources), day.target, amount) });
}

/** shortText: "32/50" for the small ring; empty without a goal. */
export function shortText(day: GoalDay): string {
	if (day.target === null) return '';
	return `${day.amount}/${day.target}`;
}

/** ariaText: the progress text, prefixed "Goal reached: " when met. */
export function ariaText(day: GoalDay, sources: readonly ActivitySource[]): string {
	const text = progressText(day, sources);
	return day.status === 'met' ? t('goals.progress.reached', { progress: text }) : text;
}

export function statusLine(day: GoalDay): string | null {
	if (day.unavailable) return t('goals.status.unavailable');
	if (day.status === 'met') return t('goals.status.reached');
	if (day.status === 'vacation') return t('goals.status.vacation');
	return null;
}

export function streakText(s: { current: number; capped: boolean }): string {
	// Capped: at least `current` (vacation days are skipped, so not always 365).
	if (s.capped) return t('goals.streak.capped', { count: s.current });
	return t('goals.streak.days', { count: s.current });
}

/**
 * toGoText: what is left of today's goal ("29 flashcard reviews to go today",
 * "3 new cards to go today"), in the goal's display units; null when none is left.
 */
export function toGoText(
	day: { metric: GoalMetric; amount: number; target: number },
	sources: readonly ActivitySource[]
): string | null {
	const left = day.target - day.amount;
	if (left <= 0) return null;
	if (day.metric === 'flashcards:new') return t('widgets.activity.week.newCardsToGo', { count: left });
	if (day.metric === 'flashcards:studyTime') return t('widgets.activity.week.minutesToGo', { count: left });
	return t('widgets.activity.week.toGo', { amount: activityText(sourceOf(day.metric, sources), left, formatNumber(left)) });
}
