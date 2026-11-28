// The milestone catalogue: families, thresholds and ids. Ids are never
// renamed or removed; a release may only append families or thresholds
// (a seen row is keyed by the id). Pure. Rule and fixtures:
// docs/contracts/milestones/ (catalogue.json).

import { ownedLevelDeckId } from '$lib/features/flashcards/decks/systemDecks';

/** The prefix of a seen row's key: `milestone:<id>`. */
export const MILESTONE_KEY_PREFIX = 'milestone:';

export type MilestoneFamily =
	| 'reviews'
	| 'words-studied'
	| 'words-mature'
	| 'characters-learned'
	| 'streak'
	| 'days-active'
	| 'reading-hours'
	| 'journal-entries'
	| 'level-complete'
	| CourseFamily;

/** The course families (#225): their ids name a course (`<family>:<course>[:<part>]`). */
export type CourseFamily =
	| 'course-started'
	| 'course-unit'
	| 'course-section'
	| 'course-script'
	| 'course-characters'
	| 'course-words'
	| 'course-graduated';

export type ThresholdFamily = Exclude<MilestoneFamily, 'level-complete' | CourseFamily>;

/** The feature switch a family follows; null = always on. */
export type Feature = 'flashcards' | 'reader' | 'journal' | 'courses' | null;

export interface FamilyDef {
	family: MilestoneFamily;
	thresholds: readonly number[];
	unit: 'count' | 'days' | 'hours';
	requires: Feature;
	/** Chinese and Japanese only. */
	hanOnly: boolean;
	/** log: the event log alone; replay: needs the schedule replay; course: needs the workspace's filled course. */
	source: 'log' | 'replay' | 'course';
}

/** Catalogue order: it breaks ties in every list. */
export const FAMILIES: readonly FamilyDef[] = [
	{ family: 'reviews', thresholds: [100, 500, 1000, 2500, 5000, 10000, 25000, 50000, 100000], unit: 'count', requires: 'flashcards', hanOnly: false, source: 'log' },
	{ family: 'words-studied', thresholds: [10, 50, 100, 250, 500, 1000, 2500, 5000, 10000], unit: 'count', requires: 'flashcards', hanOnly: false, source: 'log' },
	{ family: 'words-mature', thresholds: [10, 50, 100, 250, 500, 1000, 2500, 5000], unit: 'count', requires: 'flashcards', hanOnly: false, source: 'replay' },
	{ family: 'characters-learned', thresholds: [10, 50, 100, 250, 500, 1000, 2000, 3000, 5000], unit: 'count', requires: 'flashcards', hanOnly: true, source: 'replay' },
	{ family: 'streak', thresholds: [3, 7, 14, 30, 60, 100, 180, 365, 500, 730, 1000], unit: 'days', requires: 'flashcards', hanOnly: false, source: 'log' },
	{ family: 'days-active', thresholds: [10, 30, 50, 100, 200, 365, 500, 1000], unit: 'days', requires: null, hanOnly: false, source: 'log' },
	{ family: 'reading-hours', thresholds: [1, 5, 10, 25, 50, 100, 250, 500, 1000], unit: 'hours', requires: 'reader', hanOnly: false, source: 'log' },
	{ family: 'journal-entries', thresholds: [1, 10, 25, 50, 100, 250, 365, 500], unit: 'count', requires: 'journal', hanOnly: false, source: 'log' },
	{ family: 'level-complete', thresholds: [], unit: 'count', requires: 'flashcards', hanOnly: false, source: 'replay' },
	{ family: 'course-started', thresholds: [], unit: 'count', requires: 'courses', hanOnly: false, source: 'course' },
	{ family: 'course-unit', thresholds: [], unit: 'count', requires: 'courses', hanOnly: false, source: 'course' },
	{ family: 'course-section', thresholds: [], unit: 'count', requires: 'courses', hanOnly: false, source: 'course' },
	{ family: 'course-script', thresholds: [], unit: 'count', requires: 'courses', hanOnly: false, source: 'course' },
	{ family: 'course-characters', thresholds: [100, 250, 500, 1000], unit: 'count', requires: 'courses', hanOnly: false, source: 'course' },
	{ family: 'course-words', thresholds: [50, 100, 250, 500, 1000, 1500, 2000, 3000], unit: 'count', requires: 'courses', hanOnly: false, source: 'course' },
	{ family: 'course-graduated', thresholds: [], unit: 'count', requires: 'courses', hanOnly: false, source: 'course' }
];

/** What a course family's id carries after the course: nothing, a course id (unit, section, script) or a threshold. */
const COURSE_PART: Readonly<Record<CourseFamily, 'none' | 'id' | 'threshold'>> = {
	'course-started': 'none',
	'course-unit': 'id',
	'course-section': 'id',
	'course-script': 'id',
	'course-characters': 'threshold',
	'course-words': 'threshold',
	'course-graduated': 'none'
};

/** isCourseFamily: a family whose ids name a course. */
export function isCourseFamily(family: MilestoneFamily): family is CourseFamily {
	return Object.hasOwn(COURSE_PART, family);
}

const BY_FAMILY = new Map(FAMILIES.map((f, index) => [f.family, { def: f, index }]));
const LEVEL_PREFIX = 'level-complete:';
const LEVEL_DECK_ID = /^d-lvl-[a-z0-9-]*-[0-9a-f]{8}$/;
const DECIMAL = /^[1-9][0-9]*$/;
// courses/README.md: pack ids, and unit, section and script ids.
const PACK_ID = /^[A-Za-z0-9._-]{1,128}$/;
const PART_ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const isPartId = (v: string): boolean => v.length <= 64 && PART_ID.test(v);

/** milestoneId: `<family>:<threshold>`; throws for a value that is not one of the family's thresholds. */
export function milestoneId(family: ThresholdFamily, threshold: number): string {
	if (!(BY_FAMILY.get(family)?.def.thresholds ?? []).includes(threshold)) {
		throw new RangeError(`${family}: ${threshold} is not a threshold`);
	}
	return `${family}:${threshold}`;
}

/** levelMilestoneId: `level-complete:<ownedLevelDeckId(packId, level)>`. */
export function levelMilestoneId(packId: string, level: string): string {
	return `${LEVEL_PREFIX}${ownedLevelDeckId(packId, level)}`;
}

/**
 * courseMilestoneId: `<family>:<course>`, `<family>:<course>:<id>` (unit, section, script) or
 * `<family>:<course>:<threshold>`; throws for a part the family does not take.
 */
export function courseMilestoneId(family: CourseFamily, course: string, part?: string | number): string {
	const kind = COURSE_PART[family];
	const def = BY_FAMILY.get(family)?.def;
	const ok =
		PACK_ID.test(course) &&
		(kind === 'none'
			? part === undefined
			: kind === 'id'
				? typeof part === 'string' && isPartId(part)
				: typeof part === 'number' && (def?.thresholds ?? []).includes(part));
	if (!ok) throw new RangeError(`${family}: ${course} ${String(part)} is not an id`);
	return part === undefined ? `${family}:${course}` : `${family}:${course}:${part}`;
}

export type ParsedCourseId =
	| { family: CourseFamily; course: string }
	| { family: CourseFamily; course: string; part: string }
	| { family: CourseFamily; course: string; threshold: number };

export type ParsedId =
	| { family: ThresholdFamily; threshold: number }
	| { family: 'level-complete'; deckId: string }
	| ParsedCourseId;

function parseCourseId(family: CourseFamily, rest: string): ParsedCourseId | null {
	const kind = COURSE_PART[family];
	const colon = rest.indexOf(':');
	const course = colon < 0 ? rest : rest.slice(0, colon);
	if (!PACK_ID.test(course)) return null;
	if (kind === 'none') return colon < 0 ? { family, course } : null;
	if (colon < 0) return null;
	const part = rest.slice(colon + 1);
	if (kind === 'id') return isPartId(part) ? { family, course, part } : null;
	if (!DECIMAL.test(part)) return null;
	const threshold = Number(part);
	return (BY_FAMILY.get(family)?.def.thresholds ?? []).includes(threshold) ? { family, course, threshold } : null;
}

/** parseMilestoneId: null for an id this client does not know (a newer catalogue, or garbage). */
export function parseMilestoneId(id: string): ParsedId | null {
	if (id.startsWith(LEVEL_PREFIX)) {
		const deckId = id.slice(LEVEL_PREFIX.length);
		return LEVEL_DECK_ID.test(deckId) ? { family: 'level-complete', deckId } : null;
	}
	const colon = id.indexOf(':');
	if (colon < 0) return null;
	const entry = BY_FAMILY.get(id.slice(0, colon) as MilestoneFamily);
	const value = id.slice(colon + 1);
	if (entry !== undefined && isCourseFamily(entry.def.family)) return parseCourseId(entry.def.family, value);
	if (entry === undefined || entry.def.family === 'level-complete' || !DECIMAL.test(value)) return null;
	const threshold = Number(value);
	if (!entry.def.thresholds.includes(threshold)) return null;
	return { family: entry.def.family as ThresholdFamily, threshold };
}

/** enabledFamilies: the families the feature switches and the language allow; days-active always. Courses: off when not given. */
export function enabledFamilies(opts: {
	flashcards: boolean;
	reader: boolean;
	journal: boolean;
	courses?: boolean;
	han: boolean;
}): Set<MilestoneFamily> {
	const out = new Set<MilestoneFamily>();
	for (const f of FAMILIES) {
		if (f.requires !== null && !(opts[f.requires] ?? false)) continue;
		if (f.hanOnly && !opts.han) continue;
		out.add(f.family);
	}
	return out;
}

/** The course families of a set (Home and the Week tab compute them from the workspace's course, #225). */
export function courseFamilies(families: ReadonlySet<MilestoneFamily>): Set<MilestoneFamily> {
	return new Set(FAMILIES.filter((f) => f.source === 'course' && families.has(f.family)).map((f) => f.family));
}

/** The log families of a set (what home computes). */
export function logFamilies(families: ReadonlySet<MilestoneFamily>): Set<MilestoneFamily> {
	return new Set(FAMILIES.filter((f) => f.source === 'log' && families.has(f.family)).map((f) => f.family));
}

function rank(id: string): [number, number, string] {
	const parsed = parseMilestoneId(id);
	if (parsed === null) return [FAMILIES.length, 0, id];
	const index = BY_FAMILY.get(parsed.family)?.index ?? FAMILIES.length;
	if ('deckId' in parsed) return [index, 0, parsed.deckId];
	return 'threshold' in parsed ? [index, -parsed.threshold, 'course' in parsed ? id : ''] : [index, 0, id];
}

/** compareIds: catalogue family order, then the higher threshold first; level, course and unknown ids by id. */
export function compareIds(a: string, b: string): number {
	const [fa, ta, sa] = rank(a);
	const [fb, tb, sb] = rank(b);
	return fa - fb || ta - tb || (sa < sb ? -1 : sa > sb ? 1 : 0);
}
