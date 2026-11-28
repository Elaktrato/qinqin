// The activity sources (#199): the event types that count as activity on the
// heatmap, in goals and in the weekly summary, as the server's core table
// (server/internal/stats/rules.go, docs/contracts/events/activity.json). The
// activity route lists them; this table is the fallback offline and the
// source of their words (catalogue text).

import { t, type MessageKey } from '$lib/i18n';
import type { ActivitySource } from '$lib/api/stats';
import { DRILL_FEATURE, DRILL_IDS, drillEventType, drillOfType } from '$lib/studycore/drills';

/** The activity sources, in the order the activity route lists them. */
export const ACTIVITY_SOURCES: readonly ActivitySource[] = [
	{ type: 'review', feature: 'flashcards', unit: 'count' },
	{ type: 'read', feature: 'reader', unit: 'seconds' },
	{ type: 'journal', feature: 'journal', unit: 'count' },
	{ type: 'script', feature: 'scripts', unit: 'count' },
	{ type: 'grammar', feature: 'grammar', unit: 'count' },
	// One count rule per registered drill (docs/contracts/drills/, counting.json).
	...DRILL_IDS.map((id): ActivitySource => ({ type: drillEventType(id), feature: DRILL_FEATURE, unit: 'count' }))
];

/**
 * The words of each registered drill, as literal catalogue keys (the catalogue check finds every key used; a key
 * built at run time would be invisible to it): `activity.source.drill.<id in camel case>.label` and `.count`. A
 * drill's builder adds its pair here; a test checks one pair per id of DRILL_IDS.
 */
export const DRILL_WORDS: Readonly<Record<string, { label: MessageKey; count: MessageKey }>> = {
	'tone-pairs': { label: 'activity.source.drill.tonePairs.label', count: 'activity.source.drill.tonePairs.count' },
	conjugation: { label: 'activity.source.drill.conjugation.label', count: 'activity.source.drill.conjugation.count' }
};

const WORDS: Readonly<Record<string, { label: MessageKey; count: MessageKey }>> = {
	review: { label: 'activity.source.review.label', count: 'activity.source.review.count' },
	read: { label: 'activity.source.read.label', count: 'activity.source.read.count' },
	journal: { label: 'activity.source.journal.label', count: 'activity.source.journal.count' },
	script: { label: 'activity.source.script.label', count: 'activity.source.script.count' },
	grammar: { label: 'activity.source.grammar.label', count: 'activity.source.grammar.count' },
	...Object.fromEntries(
		DRILL_IDS.filter((id) => Object.hasOwn(DRILL_WORDS, id)).map((id) => [drillEventType(id), DRILL_WORDS[id]])
	)
};

/** activityChangesLog: the event types that change what the readers of the full event log show. */
export const LOG_CHANGING_TYPES: ReadonlySet<string> = new Set(ACTIVITY_SOURCES.map((s) => s.type));

/** changesLog: an event of this type changes what the log readers show: an activity type, or any drill's answer (EXP, the streak, the Practice area). */
export function changesLog(type: string): boolean {
	return LOG_CHANGING_TYPES.has(type) || drillOfType(type) !== null;
}

/** An activity source's label ("Flashcard reviews"); an unknown type shows its id. */
export function activityLabel(source: Pick<ActivitySource, 'type'>): string {
	const words = Object.hasOwn(WORDS, source.type) ? WORDS[source.type] : null;
	return words === null ? source.type : t(words.label);
}

/**
 * An amount of an activity ("32 of 50 flashcard reviews"): `n` is the text put in for `{n}`, `count` the number the
 * plural follows. An unknown type shows the number and its id.
 */
export function activityText(source: Pick<ActivitySource, 'type'>, count: number, n: string): string {
	const words = Object.hasOwn(WORDS, source.type) ? WORDS[source.type] : null;
	return words === null ? `${n} ${source.type}` : t(words.count, { count, n });
}
