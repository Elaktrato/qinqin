// Every string the milestones show, in one pure module (interface-string
// keys come with v0.4.0 item 8). Dates are civil dates formatted in UTC so
// the browser's zone never shifts them (the weekly ruling).

import { parseMilestoneId, type CourseFamily, type ThresholdFamily } from './catalogue';
import type { CardPlan } from './plan';
import { labelRecord, t, type MessageKey } from '$lib/i18n';
import { formatDay, formatNumber } from '$lib/i18n/format';

/** Titles per family: `{n}` the threshold, `{level}` the level's name (catalogue.json `titles`). */
const TITLES: Record<ThresholdFamily, MessageKey> = {
	reviews: 'milestones.title.reviews',
	'words-studied': 'milestones.title.wordsStudied',
	'words-mature': 'milestones.title.wordsMature',
	'characters-learned': 'milestones.title.charactersLearned',
	streak: 'milestones.title.streak',
	'days-active': 'milestones.title.daysActive',
	'reading-hours': 'milestones.title.readingHours',
	'journal-entries': 'milestones.title.journalEntries'
};

/** Course titles (#225): `{course}`, `{unit}`, `{section}`, `{script}` the names, `{n}` a threshold. */
const COURSE_TITLES: Record<CourseFamily, MessageKey> = {
	'course-started': 'milestones.title.courseStarted',
	'course-unit': 'milestones.title.courseUnit',
	'course-section': 'milestones.title.courseSection',
	'course-script': 'milestones.title.courseScript',
	'course-characters': 'milestones.title.courseCharacters',
	'course-words': 'milestones.title.courseWords',
	'course-graduated': 'milestones.title.courseGraduated'
};

/** The names key of a course part (courseReached.ts courseNames builds them). */
const COURSE_NAME: Partial<Record<CourseFamily, (course: string, part: string) => string>> = {
	'course-unit': (course, part) => `course:${course}:unit:${part}`,
	'course-section': (course, part) => `course:${course}:section:${part}`,
	'course-script': (_course, part) => `script:${part}`
};

/**
 * milestoneTitle: "1,000 reviews", "HSK Words · HSK 1 complete", "Unit done:
 * Hello". `names` maps a level deck id to the level's name, and a course's
 * keys (`course:<course>`, `course:<course>:unit:<unit>`,
 * `course:<course>:section:<section>`, `script:<script>`) to theirs. Null for
 * an id this client does not know, or one whose level or course it cannot name
 * (no longer installed, not held on this device).
 */
export function milestoneTitle(id: string, names: ReadonlyMap<string, string>, locale?: string): string | null {
	const parsed = parseMilestoneId(id);
	if (parsed === null) return null;
	if ('course' in parsed) {
		const course = names.get(`course:${parsed.course}`);
		if (course === undefined) return null;
		const key = COURSE_TITLES[parsed.family];
		if ('threshold' in parsed) {
			return t(key, { count: parsed.threshold, n: formatNumber(parsed.threshold, {}, locale) });
		}
		if (!('part' in parsed)) return t(key, { course });
		const name = names.get(COURSE_NAME[parsed.family]?.(parsed.course, parsed.part) ?? '');
		if (name === undefined) return null;
		if (parsed.family === 'course-unit') return t(key, { unit: name });
		if (parsed.family === 'course-section') return t(key, { section: name });
		return t(key, { script: name });
	}
	if (!('threshold' in parsed)) {
		const name = names.get(parsed.deckId);
		return name === undefined ? null : t('milestones.title.levelComplete', { level: name });
	}
	const count = parsed.threshold;
	return t(TITLES[parsed.family], { count, n: formatNumber(count, {}, locale) });
}

/** cardHeading: "Milestone reached", "3 milestones reached", "You have reached 14 milestones". */
export function cardHeading(plan: CardPlan, locale?: string): string {
	if (plan.kind === 'none') return '';
	if (plan.kind === 'recent') {
		const count = plan.items.length;
		return count === 1 ? t('milestones.card.reachedOne') : t('milestones.card.reachedRecent', { count });
	}
	return t('milestones.card.reachedTotal', { count: plan.count, n: formatNumber(plan.count, {}, locale) });
}

/**
 * statusText: what the status region announces when a card appears —
 * "Milestone reached: 100 reviews", "2 milestones reached: …", "You have
 * reached 14 milestones"; '' for no card.
 */
export function statusText(plan: CardPlan, titles: ReadonlyMap<string, string>, locale?: string): string {
	const heading = cardHeading(plan, locale);
	if (plan.kind !== 'recent') return heading;
	return t('milestones.card.status', { heading, titles: plan.items.map((r) => titles.get(r.id) ?? r.id).join(', ') });
}

/** "and 11 more" under a summary card's three names. */
export function moreText(more: number, locale?: string): string {
	return t('milestones.card.more', { n: formatNumber(more, {}, locale) });
}

/** reachedOn: "reached 3 November 2026" (the civil date, never shifted by the zone). */
export function reachedOn(day: string, locale?: string): string {
	return t('milestones.reachedOn', { date: formatDay(day, { day: 'numeric', month: 'long', year: 'numeric' }, locale) });
}

/** titleWithDay: "1,000 reviews, reached 3 November 2026". */
export function titleWithDay(title: string, day: string, locale?: string): string {
	return t('milestones.titleWithDay', { title, reached: reachedOn(day, locale) });
}

export const MILESTONE_TEXT = labelRecord({
	section: 'milestones.section',
	dismiss: 'milestones.dismiss',
	seeAll: 'milestones.seeAll',
	isNew: 'milestones.isNew',
	empty: 'milestones.empty',
	weekLine: 'milestones.weekLine',
	none: 'milestones.none'
});
