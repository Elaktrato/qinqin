// What the mistake notebook's page shows (#227): each item as a line (what it is, what went wrong, how far it is on its
// way out, where to practise it), the groups, and what "Practise my mistakes" asks. The rules are the core's
// (`lib/studycore/notebook.ts`); this module only words and links them.

import { t, type MessageKey } from '$lib/i18n';
import { formatDate } from '$lib/i18n/format';
import type { Course } from '$lib/api/courses';
import { courseHref } from '$lib/features/courses/route';
import { lessonLabel, titleText } from '$lib/features/courses/roadmap';
import { grammarHref } from '$lib/features/grammar/route';
import { practiceHref } from '$lib/features/practice/route';
import type { DrillDef, DrillItem, RoundEntry } from '$lib/features/practice/types';
import { ROUND_SIZE } from '$lib/studycore/drills';
import { splitPoint } from '$lib/studycore/grammarRuns';
import { LEAVE_AFTER, NOTEBOOK_GROUPS, type NotebookGroup, type NotebookItem } from '$lib/studycore/notebook';
import type { StudyCard, StudyCardKind } from '$lib/studycore/types';

export { NOTEBOOK_HREF, PRACTISE_HREF } from './href';

export type NotebookRoute = { view: 'list' } | { view: 'practise' };

/** parseNotebookRoute reads the path after `/notebook/`; anything but `practise` is the list. */
export function parseNotebookRoute(rest: string): NotebookRoute {
	const parts = rest.split('/').filter((p) => p !== '');
	return parts.length === 1 && parts[0] === 'practise' ? { view: 'practise' } : { view: 'list' };
}

/** What the page knows besides the items: the cards, the drills that apply, the names of points and courses. */
export interface NotebookContext {
	cards: ReadonlyMap<string, StudyCard>;
	/** The drills that apply to the workspace language. */
	drills: ReadonlyMap<string, DrillDef>;
	/** Each drill's candidate items, by drill id and item key (absent: not loaded). */
	drillItems: ReadonlyMap<string, ReadonlyMap<string, DrillItem>>;
	/** Grammar lesson titles by point. */
	grammarTitles: ReadonlyMap<string, string>;
	/** The filled courses the session holds, by id. */
	courses: ReadonlyMap<string, Course>;
	/** The interface language (course titles). */
	language: string;
}

export interface NotebookRow {
	key: string;
	/** What the item is: the word, the drill item, the grammar point, the lesson or test. */
	title: string;
	/** The title is a word of the study language (a card's word, a drill item), not interface text. */
	inStudyLanguage: boolean;
	/** Where it comes from: the card type, the drill, grammar, the course. */
	source: string;
	/** What went wrong the last time. */
	wrong: string;
	/** How many mistakes since it came in. */
	mistakes: string;
	/** "1 of 3 right in a row", or null before the first right answer. */
	progress: string | null;
	/** The day of the last mistake. */
	last: string;
	/** Where to open or practise it; null when nothing applies here (a drill of another language). */
	href: string | null;
	hrefLabel: string;
}

export interface NotebookSection {
	group: NotebookGroup;
	title: string;
	rows: NotebookRow[];
}

const GROUP_TITLES: Record<NotebookGroup, MessageKey> = {
	words: 'study.notebook.group.words',
	characters: 'study.notebook.group.characters',
	tones: 'study.notebook.group.tones',
	grammar: 'study.notebook.group.grammar',
	course: 'study.notebook.group.course'
};

const KIND_LABELS: Record<StudyCardKind, MessageKey> = {
	vocab: 'study.session.kind.vocab',
	reverse: 'study.session.kind.reverse',
	cloze: 'study.session.kind.cloze',
	sentence: 'study.session.kind.sentence',
	writing: 'study.session.kind.writing',
	tone: 'study.session.kind.tone'
};

/** The kind of a course lesson from its id (`words-2`, `catch-up-1`, `grammar-ba`, `reading`, …). */
function lessonKind(id: string): Parameters<typeof lessonLabel>[0]['kind'] {
	if (/^(words|catch-up)-\d+$/.test(id)) return 'words';
	if (id.startsWith('grammar-')) return 'grammar';
	if (id === 'script' || id === 'practice' || id === 'listening' || id === 'speaking' || id === 'reading') return id;
	return 'words';
}

function unitTitle(course: Course | undefined, unit: string, language: string): string {
	for (const s of course?.sections ?? []) for (const u of s.units) if (u.id === unit) return titleText(u.title, language);
	return unit;
}

function sectionTitle(course: Course | undefined, section: string, language: string): string {
	const s = course?.sections.find((x) => x.id === section);
	return s === undefined ? section : titleText(s.title, language);
}

function scoreText(score: number | undefined, total: number | undefined): string {
	return t('study.notebook.wrong.score', { score: score ?? 0, total: total ?? 0 });
}

/** rowOf: one item as the page shows it. */
export function rowOf(item: NotebookItem, ctx: NotebookContext): NotebookRow {
	const common = {
		key: item.key,
		mistakes: t('study.notebook.mistakes', { count: item.mistakes }),
		progress: item.right > 0 ? t('study.notebook.progress', { right: item.right, of: LEAVE_AFTER }) : null,
		last: t('study.notebook.last', { date: formatDate(item.last, { dateStyle: 'medium' }) })
	};
	const ref = item.ref;
	const inCourse = { inStudyLanguage: false };
	switch (ref.source) {
		case 'card': {
			const card = ctx.cards.get(ref.cardId);
			return {
				...common,
				title: card?.written ?? t('study.notebook.card.noWord'),
				inStudyLanguage: card?.written !== undefined,
				source: t('study.notebook.source.card', { kind: t(KIND_LABELS[ref.kind]) }),
				wrong: t('study.notebook.wrong.again'),
				href: `/entry/${ref.entryId}`,
				hrefLabel: t('study.notebook.action.word')
			};
		}
		case 'drill': {
			const def = ctx.drills.get(ref.drill);
			const drillItem = ctx.drillItems.get(ref.drill)?.get(ref.item);
			return {
				...common,
				title: def !== undefined && drillItem !== undefined ? def.label(drillItem) : ref.item,
				inStudyLanguage: true,
				source: def?.title ?? ref.drill,
				wrong: t('study.notebook.wrong.drill'),
				href: def === undefined ? null : practiceHref({ view: 'drill', drill: ref.drill }),
				hrefLabel: t('study.notebook.action.drill')
			};
		}
		case 'grammar': {
			const parts = splitPoint(ref.point);
			return {
				...common,
				title: ctx.grammarTitles.get(ref.point) ?? parts?.lessonId ?? ref.point,
				inStudyLanguage: false,
				source: t('study.notebook.source.grammar'),
				wrong: scoreText(item.wrong.score, item.wrong.total),
				href: parts === null ? null : grammarHref({ view: 'lesson', pack: parts.packId, lesson: parts.lessonId }),
				hrefLabel: t('study.notebook.action.grammar')
			};
		}
		case 'course': {
			const course = ctx.courses.get(ref.course);
			const source = course === undefined ? ref.course : titleText(course.title, ctx.language);
			if (ref.check === 'lesson') {
				return {
					...common,
					title: t('study.notebook.course.lesson', {
						unit: unitTitle(course, ref.unit, ctx.language),
						lesson: lessonLabel({ id: ref.lesson, kind: lessonKind(ref.lesson) })
					}),
					...inCourse,
					source,
					wrong: scoreText(item.wrong.score, item.wrong.total),
					href: courseHref({ view: 'lesson', course: ref.course, unit: ref.unit, lesson: ref.lesson }),
					hrefLabel: t('study.notebook.action.lesson')
				};
			}
			if (ref.check === 'unit') {
				return {
					...common,
					title: t('study.notebook.course.unitTest', { unit: unitTitle(course, ref.unit, ctx.language) }),
					...inCourse,
					source,
					wrong: t('study.notebook.wrong.notPassed', { score: item.wrong.score ?? 0, total: item.wrong.total ?? 0 }),
					href: courseHref({ view: 'test', course: ref.course, unit: ref.unit }),
					hrefLabel: t('study.notebook.action.test')
				};
			}
			return {
				...common,
				title: t('study.notebook.course.sectionExam', { section: sectionTitle(course, ref.section, ctx.language) }),
				...inCourse,
				source,
				wrong: t('study.notebook.wrong.notPassed', { score: item.wrong.score ?? 0, total: item.wrong.total ?? 0 }),
				href: courseHref({ view: 'exam', course: ref.course, section: ref.section }),
				hrefLabel: t('study.notebook.action.exam')
			};
		}
	}
}

/** notebookSections: the groups that have items, in the notebook's order, each with its rows in the core's order. */
export function notebookSections(items: readonly NotebookItem[], ctx: NotebookContext): NotebookSection[] {
	return NOTEBOOK_GROUPS.map((group) => ({
		group,
		title: t(GROUP_TITLES[group]),
		rows: items.filter((item) => item.group === group).map((item) => rowOf(item, ctx))
	})).filter((section) => section.rows.length > 0);
}

/**
 * practiseRound: the drill items of the notebook that their drill can ask now (a candidate of a drill that applies),
 * in the notebook's order, at most a round's size.
 */
export function practiseRound(items: readonly NotebookItem[], ctx: Pick<NotebookContext, 'drills' | 'drillItems'>): RoundEntry[] {
	const out: RoundEntry[] = [];
	for (const item of items) {
		if (item.ref.source !== 'drill' || !ctx.drills.has(item.ref.drill)) continue;
		const drillItem = ctx.drillItems.get(item.ref.drill)?.get(item.ref.item);
		if (drillItem === undefined) continue;
		out.push({ drill: item.ref.drill, item: drillItem });
		if (out.length >= ROUND_SIZE) break;
	}
	return out;
}

/** The drills whose items the notebook names (their candidates are loaded for the labels and the round). */
export function drillsNamed(items: readonly NotebookItem[]): string[] {
	return [...new Set(items.flatMap((item) => (item.ref.source === 'drill' ? [item.ref.drill] : [])))];
}

/** The card ids of the notebook's cards. */
export function notebookCardIds(items: readonly NotebookItem[]): string[] {
	return items.flatMap((item) => (item.ref.source === 'card' ? [item.ref.cardId] : []));
}

/** The notebook's grammar points and course checkpoints: practised in their own lesson or test (links). */
export function linkedItems(items: readonly NotebookItem[]): NotebookItem[] {
	return items.filter((item) => item.ref.source === 'grammar' || item.ref.source === 'course');
}
