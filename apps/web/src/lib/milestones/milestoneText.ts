// Every string the milestones show, in one pure module (interface-string
// keys come with v0.4.0 item 8). Dates are civil dates formatted in UTC so
// the browser's zone never shifts them (the weekly ruling).

import { parseMilestoneId, type MilestoneFamily } from './catalogue';
import type { CardPlan } from './plan';

/** Titles per family: `{n}` the threshold, `{level}` the level's name (catalogue.json `titles`). */
const TITLES: Record<MilestoneFamily, { one: string; other: string }> = {
	reviews: { one: '{n} review', other: '{n} reviews' },
	'words-studied': { one: '{n} word studied', other: '{n} words studied' },
	'words-mature': { one: '{n} mature word', other: '{n} mature words' },
	'characters-learned': { one: '{n} character learned', other: '{n} characters learned' },
	streak: { one: '{n}-day streak', other: '{n}-day streak' },
	'days-active': { one: '{n} day active', other: '{n} days active' },
	'reading-hours': { one: '{n} hour of reading', other: '{n} hours of reading' },
	'journal-entries': { one: '{n} journal entry', other: '{n} journal entries' },
	'level-complete': { one: '{level} complete', other: '{level} complete' }
};

/**
 * milestoneTitle: "1,000 reviews", "HSK Words · HSK 1 complete". `levels`
 * maps a level deck id to the level's name. Null for an id this client
 * does not know, or a level whose name is unknown (no longer installed).
 */
export function milestoneTitle(id: string, levels: ReadonlyMap<string, string>, locale?: string): string | null {
	const parsed = parseMilestoneId(id);
	if (parsed === null) return null;
	const forms = TITLES[parsed.family];
	if (!('threshold' in parsed)) {
		const name = levels.get(parsed.deckId);
		return name === undefined ? null : forms.other.replace('{level}', name);
	}
	const n = parsed.threshold;
	const form = new Intl.PluralRules(locale).select(n) === 'one' ? forms.one : forms.other;
	return form.replace('{n}', new Intl.NumberFormat(locale).format(n));
}

/** cardHeading: "Milestone reached", "3 milestones reached", "You have reached 14 milestones". */
export function cardHeading(plan: CardPlan, locale?: string): string {
	if (plan.kind === 'none') return '';
	if (plan.kind === 'recent') {
		return plan.items.length === 1 ? 'Milestone reached' : `${plan.items.length} milestones reached`;
	}
	const count = new Intl.NumberFormat(locale).format(plan.count);
	return `You have reached ${count} ${plan.count === 1 ? 'milestone' : 'milestones'}`;
}

/** "and 11 more" under a summary card's three names. */
export function moreText(more: number, locale?: string): string {
	return `and ${new Intl.NumberFormat(locale).format(more)} more`;
}

function civilDate(day: string): Date {
	return new Date(`${day}T00:00:00Z`);
}

/** reachedOn: "reached 3 November 2026" (the civil date, never shifted by the zone). */
export function reachedOn(day: string, locale?: string): string {
	const fmt = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
	return `reached ${fmt.format(civilDate(day))}`;
}

/** titleWithDay: "1,000 reviews, reached 3 November 2026". */
export function titleWithDay(title: string, day: string, locale?: string): string {
	return `${title}, ${reachedOn(day, locale)}`;
}

export const MILESTONE_TEXT = {
	section: 'Milestones',
	dismiss: 'Dismiss',
	seeAll: 'See all milestones',
	isNew: 'New',
	empty: 'No milestones yet.',
	weekLine: 'Milestones',
	none: 'None'
} as const;
