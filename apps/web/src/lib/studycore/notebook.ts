// The mistake notebook (#227, docs/contracts/notebook/): what each study event says about an item (wrong, right or
// nothing), and the notebook replayed from those outcomes and the learner's marks. Pure; derived from the study
// history like every schedule, nothing stored but the `notebook` mark events.

import type { StudyEvent } from '$lib/events';
import { parseCourseEvent, type CourseEvent } from './courseProgress';
import { isLearned } from './grammarReview';
import { compareById, isValidReview } from './reviewOrder';
import type { ReviewGrade, StudyCard, StudyCardKind, StudyHistory } from './types';

/** The event type of a mark (a removal by hand, a clear). */
export const NOTEBOOK_EVENT = 'notebook';
/** Right answers in a row that take an item out (owner decision, v0.9.0 plan). */
export const LEAVE_AFTER = 3;
/** A score run (a grammar run, a course lesson) is right at this percentage: the grammar learned mark. */
export const PASS_PERCENT = 80;
/** The longest item key a removal names, in code points. */
export const MAX_MARK_ITEM_LENGTH = 400;

export type NotebookGroup = 'words' | 'characters' | 'tones' | 'grammar' | 'course';
/** The groups in the order the notebook shows them. */
export const NOTEBOOK_GROUPS: readonly NotebookGroup[] = Object.freeze<NotebookGroup[]>(['words', 'characters', 'tones', 'grammar', 'course']);

/** The group of a drill's items; a drill not listed is in DEFAULT_DRILL_GROUP. */
export const DRILL_GROUPS: Readonly<Record<string, NotebookGroup>> = Object.freeze({
	'tone-pairs': 'tones',
	conjugation: 'grammar',
	'measure-words': 'words',
	counters: 'words',
	'counter-readings': 'words',
	'look-alikes': 'characters'
});
export const DEFAULT_DRILL_GROUP: NotebookGroup = 'words';

/** What an item names: where it comes from and what to open to practise it. */
export type NotebookRef =
	| { source: 'card'; cardId: string; entryId: number; kind: StudyCardKind }
	| { source: 'drill'; drill: string; item: string }
	| { source: 'grammar'; point: string }
	| { source: 'course'; course: string; check: 'lesson'; unit: string; lesson: string }
	| { source: 'course'; course: string; check: 'unit'; unit: string }
	| { source: 'course'; course: string; check: 'section'; section: string };

/** What the last wrong answer was: a review's or a drill answer's mode and grade, a run's score. */
export interface NotebookWrong {
	mode?: string;
	grade?: ReviewGrade;
	score?: number;
	total?: number;
}

/** One answer's verdict on one item. */
export interface NotebookOutcome {
	id: string;
	ts: string;
	/** The instant of `ts`, epoch milliseconds. */
	at: number;
	item: string;
	wrong: boolean;
	/** The item as this event names it (a card's ref is completed from its card). */
	ref: Exclude<NotebookRef, { source: 'card' }> | { source: 'card'; cardId: string };
	detail: NotebookWrong;
}

/** One item in the notebook. */
export interface NotebookItem {
	key: string;
	group: NotebookGroup;
	/** When it entered (the first wrong answer since it last came in). */
	since: string;
	/** The last wrong answer. */
	last: string;
	/** Wrong answers since it entered. */
	mistakes: number;
	/** Right answers in a row since the last wrong one (it leaves at LEAVE_AFTER). */
	right: number;
	ref: NotebookRef;
	wrong: NotebookWrong;
}

/** A readable mark: a removal by hand of one item, or a clear of every item. */
export type NotebookMark = { id: string; ts: string; at: number } & ({ action: 'remove'; item: string } | { action: 'clear' });

const NOT_IN_ITEM = /[\p{White_Space}\p{Cc}]/u;

function validMarkItem(item: unknown): item is string {
	if (typeof item !== 'string' || item === '' || NOT_IN_ITEM.test(item)) return false;
	let n = 0;
	for (const _ of item) if (++n > MAX_MARK_ITEM_LENGTH) return false;
	return true;
}

/** parseNotebookMark reads a stored event as a mark; null when it is not one (it then counts nowhere). */
export function parseNotebookMark(event: Pick<StudyEvent, 'id' | 'ts' | 'type' | 'payload'>): NotebookMark | null {
	if (event.type !== NOTEBOOK_EVENT) return null;
	const p: unknown = event.payload;
	if (typeof p !== 'object' || p === null || Array.isArray(p)) return null;
	if (typeof event.ts !== 'string') return null;
	const at = Date.parse(event.ts);
	if (Number.isNaN(at)) return null;
	const { action, item } = p as Record<string, unknown>;
	const base = { id: String(event.id), ts: event.ts, at };
	if (action === 'clear') return { ...base, action };
	if (action === 'remove' && validMarkItem(item)) return { ...base, action, item };
	return null;
}

/** notebookMarksOf: the workspace's readable marks in replay order (instant, then id). */
export function notebookMarksOf(workspaceId: number, events: readonly StudyEvent[]): NotebookMark[] {
	const out: NotebookMark[] = [];
	for (const event of events) {
		if (event?.workspaceId !== workspaceId) continue;
		const mark = parseNotebookMark(event);
		if (mark !== null) out.push(mark);
	}
	return out.sort((a, b) => a.at - b.at || compareById(a, b));
}

/** The key of a card item. */
export function cardItemKey(cardId: string): string {
	return `card:${cardId}`;
}

/** The key of a drill item. */
export function drillItemKey(drill: string, item: string): string {
	return `drill.${drill}:${item}`;
}

/** The key of a grammar point. */
export function grammarItemKey(point: string): string {
	return `grammar:${point}`;
}

function passes(score: number, total: number): boolean {
	return 100 * score >= PASS_PERCENT * total;
}

function courseOutcomes(events: readonly StudyEvent[]): NotebookOutcome[] {
	const parsed = events
		.map((event) => {
			const c = parseCourseEvent(event);
			return c === null ? null : { c, ts: event.ts };
		})
		.filter((x): x is { c: CourseEvent; ts: string } => x !== null)
		.sort((a, b) => a.c.at - b.c.at || compareById(a.c, b.c));
	const out: NotebookOutcome[] = [];
	parsed.forEach(({ c, ts }, i) => {
		const base = { id: c.id, ts, at: c.at, detail: { score: c.score, total: c.total } };
		const prefix = `course:${c.course}`;
		if (c.kind === 'lesson-finished') {
			if (c.total <= 0) return;
			out.push({ ...base, item: `${prefix}:lesson:${c.unit}:${c.lesson}`, wrong: !passes(c.score, c.total), ref: { source: 'course', course: c.course, check: 'lesson', unit: c.unit, lesson: c.lesson } });
		} else if (c.kind === 'unit-test') {
			// A failed early test (taken to skip ahead) is no mistake: the unit was not studied yet.
			if (!c.passed && c.early) return;
			out.push({ ...base, item: `${prefix}:unit:${c.unit}`, wrong: !c.passed, ref: { source: 'course', course: c.course, check: 'unit', unit: c.unit } });
		} else if (c.kind === 'section-exam') {
			if (!c.passed) {
				// A placement step: the course's next event is a placement.
				const next = parsed.slice(i + 1).find((x) => x.c.course === c.course);
				if (next?.c.kind === 'placement') return;
			}
			out.push({ ...base, item: `${prefix}:section:${c.section}`, wrong: !c.passed, ref: { source: 'course', course: c.course, check: 'section', section: c.section } });
		}
	});
	return out;
}

/**
 * notebookOutcomes: every answer of the history that says something about an item, in replay order (instant, then
 * id): reviews (live, on the surviving card), drill answers, grammar runs and course events.
 */
export function notebookOutcomes(history: Pick<StudyHistory, 'reviews' | 'grammarRuns' | 'drillAnswers' | 'courseEvents'>): NotebookOutcome[] {
	const out: NotebookOutcome[] = [];
	for (const r of history.reviews) {
		if (!isValidReview(r)) continue;
		const { cardId, grade, mode } = r.payload;
		out.push({ id: r.id, ts: r.ts, at: Date.parse(r.ts), item: cardItemKey(cardId), wrong: grade === 1, ref: { source: 'card', cardId }, detail: { mode, grade } });
	}
	for (const a of history.drillAnswers ?? []) {
		out.push({ id: a.id, ts: a.ts, at: a.at, item: drillItemKey(a.drill, a.item), wrong: a.grade === 1, ref: { source: 'drill', drill: a.drill, item: a.item }, detail: { mode: a.mode, grade: a.grade } });
	}
	for (const g of history.grammarRuns ?? []) {
		if (g.total <= 0) continue;
		out.push({ id: g.id, ts: g.ts, at: g.at, item: grammarItemKey(g.point), wrong: !isLearned(g.score, g.total), ref: { source: 'grammar', point: g.point }, detail: { mode: g.mode, score: g.score, total: g.total } });
	}
	out.push(...courseOutcomes(history.courseEvents ?? []));
	return out.sort((a, b) => a.at - b.at || compareById(a, b));
}

function cardGroup(card: StudyCard): NotebookGroup {
	if (card.kind === 'tone') return 'tones';
	if (card.kind === 'writing' || card.entryKind === 'character') return 'characters';
	return 'words';
}

function refGroup(ref: NotebookOutcome['ref']): NotebookGroup {
	if (ref.source === 'drill') return DRILL_GROUPS[ref.drill] ?? DEFAULT_DRILL_GROUP;
	if (ref.source === 'grammar') return 'grammar';
	return 'course';
}

interface Entry {
	outcome: NotebookOutcome;
	since: string;
	mistakes: number;
	right: number;
}

/**
 * notebookItems: the notebook of a workspace's history. The outcomes and marks replay in (instant, id) order: a wrong
 * answer puts the item in and starts its run of right answers again; LEAVE_AFTER right answers in a row take it out;
 * a removal takes one item out, a clear every item; a later wrong answer brings an item back with a fresh count.
 * Items of a card that is gone are left out. Ordered by group, then the last wrong answer (newest first), then key.
 */
export function notebookItems(
	history: Pick<StudyHistory, 'cards' | 'reviews' | 'grammarRuns' | 'drillAnswers' | 'courseEvents' | 'notebookMarks'>
): NotebookItem[] {
	type Step = { at: number; id: string; outcome?: NotebookOutcome; mark?: NotebookMark };
	const steps: Step[] = [
		...notebookOutcomes(history).map((outcome) => ({ at: outcome.at, id: outcome.id, outcome })),
		...(history.notebookMarks ?? []).map((mark) => ({ at: mark.at, id: mark.id, mark }))
	].sort((a, b) => a.at - b.at || compareById(a, b));

	const open = new Map<string, Entry>();
	for (const step of steps) {
		const { outcome, mark } = step;
		if (mark !== undefined) {
			if (mark.action === 'clear') open.clear();
			else open.delete(mark.item);
			continue;
		}
		if (outcome === undefined) continue;
		const entry = open.get(outcome.item);
		if (outcome.wrong) {
			if (entry === undefined) open.set(outcome.item, { outcome, since: outcome.ts, mistakes: 1, right: 0 });
			else open.set(outcome.item, { outcome, since: entry.since, mistakes: entry.mistakes + 1, right: 0 });
		} else if (entry !== undefined) {
			if (entry.right + 1 >= LEAVE_AFTER) open.delete(outcome.item);
			else entry.right += 1;
		}
	}

	const cards = new Map(history.cards.map((card) => [card.id, card]));
	const items: (NotebookItem & { lastAt: number })[] = [];
	for (const [key, entry] of open) {
		const { ref, detail, ts, at } = entry.outcome;
		let full: NotebookRef;
		let group: NotebookGroup;
		if (ref.source === 'card') {
			const card = cards.get(ref.cardId);
			if (card === undefined) continue;
			full = { source: 'card', cardId: card.id, entryId: card.entryId, kind: card.kind };
			group = cardGroup(card);
		} else {
			full = ref;
			group = refGroup(ref);
		}
		items.push({ key, group, since: entry.since, last: ts, mistakes: entry.mistakes, right: entry.right, ref: full, wrong: { ...detail }, lastAt: at });
	}
	const groupIndex = (g: NotebookGroup) => NOTEBOOK_GROUPS.indexOf(g);
	items.sort((a, b) => groupIndex(a.group) - groupIndex(b.group) || b.lastAt - a.lastAt || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
	return items.map(({ lastAt: _, ...item }) => item);
}
