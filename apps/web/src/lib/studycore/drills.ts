// Drills (v0.9.0 drills framework, docs/contracts/drills/): a drill (the conjugation trainer, measure words and
// counters, tone pairs, look-alike characters) asks about items, and each answer is a `drill.<id>` study event
// {item, mode, grade}. Every item has its own spaced schedule, replayed from its answers through FSRS exactly as a
// card's reviews are (scheduler.ts), outside the flashcard queue. The core reads the answers for EXP and the
// streak, the Practice feature for its rounds. Nothing here is stored.

import { forgetting_curve } from 'ts-fsrs';

import type { StudyEvent } from '$lib/events';
import { DEFAULT_W } from './fsrsParams';
import { compareById } from './reviewOrder';
import { scheduleTimeline, type Schedule } from './scheduler';
import { feedInstants, type StudyClock } from './studyClock';
import type { ReviewEvent, ReviewGrade } from './types';

/** The event type of a drill is this prefix and the drill's id. */
export const DRILL_EVENT_PREFIX = 'drill.';

/** The core feature the drills belong to (the Practice area). */
export const DRILL_FEATURE = 'practice';

/**
 * The drills a server and a client count as activity (contract `registry`; Go `drills.IDs`). Each drill's builder
 * adds its id here, in Go and in the contract (docs/contracts/drills/README.md, "Adding a drill").
 */
export const DRILL_IDS: readonly string[] = [];

export const MAX_DRILL_ID_LENGTH = 32;
export const MAX_ITEM_LENGTH = 200;
/** `weakest` names the round across drills (`/practice/weakest`), so it is never a drill. */
export const RESERVED_DRILL_IDS: readonly string[] = ['weakest'];

/** The most items of a round, and of new items in a drill's round. */
export const ROUND_SIZE = 20;
export const NEW_PER_ROUND = 10;

/** EXP of one drill answer: this plus the review grade bonus (exp.ts, where it lives). */
export { DRILL_ANSWER_XP } from './exp';

const ID = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const NOT_IN_ITEM = /[\p{White_Space}\p{Cc}]/u;

/** validDrillId: a drill id (`tone-pairs`), never `weakest`. */
export function validDrillId(id: unknown): id is string {
	return typeof id === 'string' && id.length <= MAX_DRILL_ID_LENGTH && ID.test(id) && !RESERVED_DRILL_IDS.includes(id);
}

/** validDrillMode: a drill's direction (`produce`, `recognise`): the id pattern. */
export function validDrillMode(mode: unknown): mode is string {
	return typeof mode === 'string' && mode.length <= MAX_DRILL_ID_LENGTH && ID.test(mode);
}

/** validItemKey: 1 to 200 code points, no white space and no control characters. */
export function validItemKey(item: unknown): item is string {
	if (typeof item !== 'string' || item === '' || NOT_IN_ITEM.test(item)) return false;
	let n = 0;
	for (const _ of item) if (++n > MAX_ITEM_LENGTH) return false;
	return true;
}

/** drillEventType: `drill.<id>`. */
export function drillEventType(drill: string): string {
	return `${DRILL_EVENT_PREFIX}${drill}`;
}

/** drillOfType: the drill id of an event type, or null when it is no drill's. */
export function drillOfType(type: unknown): string | null {
	if (typeof type !== 'string' || !type.startsWith(DRILL_EVENT_PREFIX)) return null;
	const id = type.slice(DRILL_EVENT_PREFIX.length);
	return validDrillId(id) ? id : null;
}

/** One readable drill answer. */
export interface DrillAnswer {
	id: string;
	workspaceId: number;
	ts: string;
	/** The instant of `ts`, epoch milliseconds. */
	at: number;
	drill: string;
	item: string;
	mode: string;
	grade: ReviewGrade;
}

/** parseDrillAnswer reads a stored event as a drill answer; null when it is not one (it then counts nowhere). */
export function parseDrillAnswer(event: Pick<StudyEvent, 'id' | 'workspaceId' | 'ts' | 'type' | 'payload'>): DrillAnswer | null {
	const drill = drillOfType(event.type);
	if (drill === null) return null;
	const p: unknown = event.payload;
	if (typeof p !== 'object' || p === null || Array.isArray(p)) return null;
	const { item, mode, grade } = p as Record<string, unknown>;
	if (!validItemKey(item) || !validDrillMode(mode)) return null;
	if (grade !== 1 && grade !== 2 && grade !== 3 && grade !== 4) return null;
	if (typeof event.ts !== 'string') return null;
	const at = Date.parse(event.ts);
	if (Number.isNaN(at)) return null;
	return { id: String(event.id), workspaceId: event.workspaceId, ts: event.ts, at, drill, item, mode, grade };
}

/** drillAnswersOf: the workspace's readable drill answers in replay order (instant, then id). */
export function drillAnswersOf(workspaceId: number, events: readonly StudyEvent[]): DrillAnswer[] {
	const out: DrillAnswer[] = [];
	for (const event of events) {
		if (event.workspaceId !== workspaceId) continue;
		const answer = parseDrillAnswer(event);
		if (answer !== null) out.push(answer);
	}
	return out.sort((a, b) => a.at - b.at || compareById(a, b));
}

/** The derived state of one drill item. */
export interface DrillItemState extends Schedule {
	drill: string;
	item: string;
	/** How many answers it has. */
	answers: number;
	/** The study-clock instant of its last answer as fed to FSRS (retrievability counts from it). */
	fed: number;
}

/** The map key of a drill item. */
export function drillItemKey(drill: string, item: string): string {
	return `${drill}\u0000${item}`;
}

export type DrillStates = ReadonlyMap<string, DrillItemState>;

export function stateOf(states: DrillStates, drill: string, item: string): DrillItemState | undefined {
	return states.get(drillItemKey(drill, item));
}

/**
 * drillStates replays every item's answers as a card's reviews (scheduleTimeline: an empty card at the first
 * answer, then FSRS per answer on the study clock) with the default weights.
 */
export function drillStates(answers: readonly DrillAnswer[], clock: StudyClock): Map<string, DrillItemState> {
	const groups = new Map<string, DrillAnswer[]>();
	for (const a of answers) {
		const key = drillItemKey(a.drill, a.item);
		const list = groups.get(key);
		if (list === undefined) groups.set(key, [a]);
		else list.push(a);
	}
	const out = new Map<string, DrillItemState>();
	for (const [key, list] of groups) {
		const { drill, item } = list[0];
		const reviews: ReviewEvent[] = list.map((a) => ({
			id: a.id,
			workspaceId: a.workspaceId,
			device: '',
			ts: a.ts,
			type: 'review',
			payload: { cardId: item, mode: 'vocab', grade: a.grade }
		}));
		const timeline = scheduleTimeline(item, reviews, DEFAULT_W, clock);
		if (timeline.length === 0) continue;
		const fed = feedInstants(
			timeline.map((p) => p.ts),
			clock
		);
		out.set(key, { ...timeline[timeline.length - 1].schedule, drill, item, answers: timeline.length, fed: fed[fed.length - 1] });
	}
	return out;
}

const DAY = 86_400_000;

/** retrievability: FSRS's chance of a right answer at `now` (the forgetting curve over the study-clock days since the last answer). */
export function retrievability(state: Pick<DrillItemState, 'stability' | 'fed'>, now: number, clock: StudyClock): number {
	const elapsed = Math.max(0, clock.v(now) - state.fed) / DAY;
	return forgetting_curve(DEFAULT_W as number[], elapsed, state.stability);
}

export function isDrillDue(state: Pick<DrillItemState, 'due'>, now: number): boolean {
	return Date.parse(state.due) <= now;
}

/** Why an item is in a drill's round. */
export type RoundReason = 'due' | 'new' | 'ahead';

const byString = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * pickRound: a drill's round from its candidate items (in the order the drill introduces them): the due items,
 * earliest due first; then new items in the drill's order, at most NEW_PER_ROUND; then the items not due yet,
 * lowest retrievability first; at most ROUND_SIZE.
 */
export function pickRound(drill: string, items: readonly string[], states: DrillStates, now: number, clock: StudyClock): { item: string; why: RoundReason }[] {
	const seen: { item: string; due: number; r: number }[] = [];
	const fresh: string[] = [];
	for (const item of new Set(items)) {
		const s = stateOf(states, drill, item);
		if (s === undefined) fresh.push(item);
		else seen.push({ item, due: Date.parse(s.due), r: retrievability(s, now, clock) });
	}
	const due = seen.filter((s) => s.due <= now).sort((a, b) => a.due - b.due || byString(a.item, b.item));
	const ahead = seen.filter((s) => s.due > now).sort((a, b) => a.r - b.r || a.due - b.due || byString(a.item, b.item));
	const out: { item: string; why: RoundReason }[] = due.slice(0, ROUND_SIZE).map((s) => ({ item: s.item, why: 'due' }));
	for (const item of fresh.slice(0, Math.min(NEW_PER_ROUND, ROUND_SIZE - out.length))) out.push({ item, why: 'new' });
	for (const s of ahead.slice(0, ROUND_SIZE - out.length)) out.push({ item: s.item, why: 'ahead' });
	return out;
}

/**
 * pickWeakest: the "practise weakest" round across drills: every candidate item with at least one answer, lowest
 * retrievability at `now` first, then drill id, then item key; at most ROUND_SIZE.
 */
export function pickWeakest(
	candidates: readonly { drill: string; items: readonly string[] }[],
	states: DrillStates,
	now: number,
	clock: StudyClock
): { drill: string; item: string }[] {
	const list: { drill: string; item: string; r: number }[] = [];
	for (const c of candidates) {
		for (const item of new Set(c.items)) {
			const s = stateOf(states, c.drill, item);
			if (s !== undefined) list.push({ drill: c.drill, item, r: retrievability(s, now, clock) });
		}
	}
	list.sort((a, b) => a.r - b.r || byString(a.drill, b.drill) || byString(a.item, b.item));
	return list.slice(0, ROUND_SIZE).map(({ drill, item }) => ({ drill, item }));
}
