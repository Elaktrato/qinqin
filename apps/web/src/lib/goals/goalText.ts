// The words of a daily goal: metric choices for Settings, the progress text
// (also the ring's aria-valuetext), the status line and the streak line.
// Pure. Templates come from the activity sources' `describe` plurals.

import type { ActivitySource } from '../api/stats';
import { activityType, type GoalMetric } from './goals';
import type { GoalDay } from './progress';

export interface MetricOption {
	metric: GoalMetric;
	label: string;
	unit: 'count' | 'minutes';
}

const REVIEW_TYPE = 'review';

const BUILT_IN: Record<'flashcards:new' | 'flashcards:studyTime', { one: string; other: string }> = {
	'flashcards:new': { one: '{n} new card', other: '{n} new cards' },
	'flashcards:studyTime': { one: '{n} minute of flashcard study', other: '{n} minutes of flashcard study' }
};

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
		{ metric: 'flashcards:new', label: 'New cards', unit: 'count' },
		{ metric: 'flashcards:studyTime', label: 'Flashcard study time', unit: 'minutes' },
		...others.map(option)
	];
}

function templateOf(metric: GoalMetric, sources: readonly ActivitySource[]): { one: string; other: string } {
	if (metric === 'flashcards:new' || metric === 'flashcards:studyTime') return BUILT_IN[metric];
	const type = activityType(metric) ?? metric;
	const source = sources.find((s) => s.type === type);
	return source?.describe ?? { one: `{n} ${type}`, other: `{n} ${type}` };
}

/** progressText: "32 of 50 flashcard reviews today"; the plural follows the target. */
export function progressText(day: GoalDay, sources: readonly ActivitySource[]): string {
	if (day.metric === null || day.target === null) return 'No daily goal';
	const template = templateOf(day.metric, sources);
	const words = day.target === 1 ? template.one : template.other;
	return `${words.replaceAll('{n}', `${day.amount} of ${day.target}`)} today`;
}

/** shortText: "32/50" for the small ring; empty without a goal. */
export function shortText(day: GoalDay): string {
	if (day.target === null) return '';
	return `${day.amount}/${day.target}`;
}

/** ariaText: the progress text, prefixed "Goal reached: " when met. */
export function ariaText(day: GoalDay, sources: readonly ActivitySource[]): string {
	const text = progressText(day, sources);
	return day.status === 'met' ? `Goal reached: ${text}` : text;
}

export function statusLine(day: GoalDay): string | null {
	if (day.unavailable) return "This goal's activity is no longer counted";
	if (day.status === 'met') return 'Goal reached';
	if (day.status === 'vacation') return 'On vacation — goal paused';
	return null;
}

export function streakText(s: { current: number; capped: boolean }): string {
	// Capped: at least `current` (vacation days are skipped, so not always 365).
	if (s.capped) return `Goal streak: ${s.current}+ days`;
	return `Goal streak: ${s.current} ${s.current === 1 ? 'day' : 'days'}`;
}
