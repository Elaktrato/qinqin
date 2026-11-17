// The words of a daily goal: metric choices for Settings, the progress text
// (also the ring's aria-valuetext), the status line and the streak line.
// Pure. Templates come from the activity sources' `describe` plurals.

import type { ActivitySource } from '../api/stats';
import { t } from '../i18n';
import { activityType, type GoalMetric } from './goals';
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
		label: s.label,
		unit: s.unit === 'seconds' ? 'minutes' : 'count'
	});
	const review = sources.find((s) => s.type === REVIEW_TYPE);
	const others = sources
		.filter((s) => s.type !== REVIEW_TYPE)
		.sort((a, b) => a.label.localeCompare(b.label) || (a.type < b.type ? -1 : 1));
	return [
		...(review === undefined ? [] : [option(review)]),
		{ metric: 'flashcards:new', label: t('goals.metric.newCards'), unit: 'count' },
		{ metric: 'flashcards:studyTime', label: t('goals.metric.studyTime'), unit: 'minutes' },
		...others.map(option)
	];
}

function templateOf(metric: GoalMetric, sources: readonly ActivitySource[]): { one: string; other: string } {
	const type = activityType(metric) ?? metric;
	const source = sources.find((s) => s.type === type);
	return source?.describe ?? { one: `{n} ${type}`, other: `{n} ${type}` };
}

/** progressText: "32 of 50 flashcard reviews today"; the plural follows the target. */
export function progressText(day: GoalDay, sources: readonly ActivitySource[]): string {
	if (day.metric === null || day.target === null) return t('goals.progress.none');
	if (day.metric === 'flashcards:new') return t('goals.progress.newCards', { count: day.target, amount: day.amount });
	if (day.metric === 'flashcards:studyTime') {
		return t('goals.progress.studyTime', { count: day.target, amount: day.amount });
	}
	// A plugin's own `describe` template (manifest text, Task 22 brings its catalogue wording).
	const template = templateOf(day.metric, sources);
	const words = day.target === 1 ? template.one : template.other;
	const amount = t('goals.progress.amountOfTarget', { amount: day.amount, target: day.target });
	return t('goals.progress.today', { progress: words.replaceAll('{n}', amount) });
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
