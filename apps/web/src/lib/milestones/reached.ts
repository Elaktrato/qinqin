// Milestones of the event log alone (no replay): reviews, words studied,
// streak, days active, reading hours, journal entries. One ordered pass over
// the valid reviews and the `read` / `journal` events; a milestone is reached
// at the first event at which its quantity reaches the threshold. Pure and
// memoised. Rule and fixtures: docs/contracts/milestones/ (reached.json).

import type { StudyEvent } from '$lib/events';
import { readSeconds } from '$lib/stats/readingTime';
import { streakRuns } from '$lib/study/exp';
import { isValidReview } from '$lib/study/scheduler';
import type { ReviewEvent, StudyCard } from '$lib/study/types';
import { isVacationDay, type Run } from '$lib/study/vacation';
import type { StudyDay } from '$lib/time/studyDay';
import { reviewsKey } from '$lib/weekly/replay';
import { FAMILIES, compareIds, type MilestoneFamily, type ThresholdFamily } from './catalogue';

/** One reached milestone: `at` the instant (epoch ms), `day` its learner day. */
export interface Reached {
	id: string;
	at: number;
	day: string;
}

export interface LogInputs {
	/** The study history's reviews (canonical merge, outbox included). */
	reviews: readonly ReviewEvent[];
	/** The workspace's full event log (only `read` and `journal` are read). */
	events: readonly StudyEvent[];
	/** Live cards; deckIds: the existing decks, `general` included. */
	cards: readonly StudyCard[];
	deckIds: ReadonlySet<string>;
	day: StudyDay;
	vacation: readonly Run[];
	now: number;
	families: ReadonlySet<MilestoneFamily>;
	/** When set, events of other workspaces in `events` are ignored. */
	workspaceId?: number;
}

/** Counts full log passes; the tests read it (a memo hit adds nothing). */
export const reachedStats = { passes: 0 };

/**
 * journalEntryId: the entry a `journal` payload names, a non-empty string,
 * else null (events/payloads.json; the heatmap counts text ids only).
 */
export function journalEntryId(payload: unknown): string | null {
	if (typeof payload !== 'object' || payload === null) return null;
	const id = (payload as { entryId?: unknown }).entryId;
	return typeof id === 'string' && id !== '' ? id : null;
}

/** Thresholds of a family, crossed in order as the running value grows. */
class Crossings {
	private next = 0;
	constructor(
		private readonly family: ThresholdFamily,
		private readonly thresholds: readonly number[],
		private readonly out: Reached[]
	) {}

	reach(value: number, at: number, day: string): void {
		while (this.next < this.thresholds.length && value >= this.thresholds[this.next]) {
			this.out.push({ id: `${this.family}:${this.thresholds[this.next]}`, at, day });
			this.next += 1;
		}
	}
}

type Item =
	| { at: number; id: string; kind: 'review'; cardId: string }
	| { at: number; id: string; kind: 'read'; seconds: number }
	| { at: number; id: string; kind: 'journal'; entryId: string };

function compute(input: LogInputs): Reached[] {
	reachedStats.passes += 1;
	const { day, vacation, now, families } = input;
	const items: Item[] = [];
	for (const review of input.reviews) {
		if (!isValidReview(review)) continue;
		const at = Date.parse(review.ts);
		if (at <= now) items.push({ at, id: String(review.id), kind: 'review', cardId: review.payload.cardId });
	}
	for (const event of input.events) {
		if (event === null || typeof event !== 'object' || typeof event.ts !== 'string') continue;
		if (input.workspaceId !== undefined && event.workspaceId !== input.workspaceId) continue;
		const at = Date.parse(event.ts);
		if (Number.isNaN(at) || at > now) continue;
		if (event.type === 'read') {
			const seconds = readSeconds(event.payload);
			if (seconds > 0) items.push({ at, id: String(event.id), kind: 'read', seconds });
		} else if (event.type === 'journal') {
			const entryId = journalEntryId(event.payload);
			if (entryId !== null) items.push({ at, id: String(event.id), kind: 'journal', entryId });
		}
	}
	items.sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

	const out: Reached[] = [];
	const crossing = (family: ThresholdFamily): Crossings | null =>
		families.has(family)
			? new Crossings(family, FAMILIES.find((f) => f.family === family)?.thresholds ?? [], out)
			: null;
	const reviews = crossing('reviews');
	const words = crossing('words-studied');
	const active = crossing('days-active');
	const reading = crossing('reading-hours');
	const journal = crossing('journal-entries');

	// Live vocab cards in an existing deck: the words a review studies.
	const entryOf = new Map<string, number>();
	if (words !== null) {
		for (const card of input.cards) {
			if (card.kind === 'vocab' && card.deckIds.some((id) => input.deckIds.has(id))) entryOf.set(card.id, card.entryId);
		}
	}
	const studied = new Set<number>();
	const entries = new Set<string>();
	const activeDays = new Set<string>();
	/** The first counting review of each non-vacation review date, in date order. */
	const firstReview = new Map<string, number>();
	let reviewCount = 0;
	let seconds = 0;

	for (const item of items) {
		const date = day.dayOf(item.at);
		const vacationDay = isVacationDay(vacation, date);
		if (item.kind === 'review') {
			reviewCount += 1;
			reviews?.reach(reviewCount, item.at, date);
			const entry = entryOf.get(item.cardId);
			if (entry !== undefined && !studied.has(entry)) {
				studied.add(entry);
				words?.reach(studied.size, item.at, date);
			}
			if (!vacationDay && !firstReview.has(date)) firstReview.set(date, item.at);
		} else if (item.kind === 'read') {
			seconds += item.seconds;
			reading?.reach(seconds / 3600, item.at, date);
		} else if (!entries.has(item.entryId)) {
			entries.add(item.entryId);
			journal?.reach(entries.size, item.at, date);
		}
		if (!vacationDay && !activeDays.has(date)) {
			activeDays.add(date);
			active?.reach(activeDays.size, item.at, date);
		}
	}

	const streak = crossing('streak');
	if (streak !== null) {
		// Dates arrive in order (dayOf is monotone), so the map is sorted.
		const dates = [...firstReview.keys()];
		const runs = streakRuns(dates, vacation);
		dates.forEach((date, i) => streak.reach(runs[i], firstReview.get(date) as number, date));
	}
	return out.sort((a, b) => a.at - b.at || compareIds(a.id, b.id));
}

// A few answers kept by content, so a reloaded history (a new array with the
// same reviews) and the same event log do not walk the log again.
const MAX_MEMO = 4;
const identities = new WeakMap<object, number>();
let nextIdentity = 1;

function identity(value: object): number {
	let id = identities.get(value);
	if (id === undefined) {
		id = nextIdentity++;
		identities.set(value, id);
	}
	return id;
}

/** A content key of the cards (id, kind, entry, written, decks) and the existing decks. */
export function cardsKey(cards: readonly StudyCard[], deckIds: ReadonlySet<string>): string {
	let h = 0x811c9dc5;
	const mix = (text: string): void => {
		for (let i = 0; i < text.length; i++) {
			h ^= text.charCodeAt(i);
			h = Math.imul(h, 0x01000193) >>> 0;
		}
	};
	for (const card of cards) mix(`${card.id}|${card.kind}|${card.entryId}|${card.written ?? ''}|${card.deckIds.join(',')};`);
	return `${cards.length}:${h.toString(36)}:${[...deckIds].sort().join(',')}`;
}

/**
 * reachedFromLog: the reached milestones of the enabled log families,
 * ordered by instant then catalogue order. Memoised in `memo` (the session's,
 * context/caches.ts) by the reviews' content
 * (reviewsKey), the event log array, now's learner day and the scope.
 */
export function reachedFromLog(memo: Map<string, Reached[]>, input: LogInputs): Reached[] {
	const key = [
		reviewsKey(input.reviews),
		eventsKey(input.events),
		input.workspaceId ?? '',
		identity(input.day),
		input.day.today(input.now),
		input.now >= latestInstant(input) ? 'all' : String(input.now),
		[...input.families].sort().join(','),
		JSON.stringify(input.vacation),
		cardsKey(input.cards, input.deckIds)
	].join('|');
	const cached = memo.get(key);
	if (cached !== undefined) {
		memo.delete(key);
		memo.set(key, cached);
		return cached;
	}
	const result = compute(input);
	if (memo.size >= MAX_MEMO) memo.delete(memo.keys().next().value as string);
	memo.set(key, result);
	return result;
}

const eventKeys = new WeakMap<object, string>();

/**
 * eventsKey identifies the counted events of a log by content (FNV-1a over
 * id, workspace, ts, type and payload of every `read` and `journal` event),
 * once per array, so a reloaded log (a new array, the same events) hits.
 */
function eventsKey(events: readonly StudyEvent[]): string {
	const cached = eventKeys.get(events);
	if (cached !== undefined) return cached;
	let h = 0x811c9dc5;
	let n = 0;
	for (const event of events) {
		if (event?.type !== 'read' && event?.type !== 'journal') continue;
		n += 1;
		const text = `${event.id}|${event.workspaceId}|${event.ts}|${event.type}|${JSON.stringify(event.payload ?? null)};`;
		for (let i = 0; i < text.length; i++) {
			h ^= text.charCodeAt(i);
			h = Math.imul(h, 0x01000193) >>> 0;
		}
	}
	const key = `${n}:${h.toString(36)}`;
	eventKeys.set(events, key);
	return key;
}

const latestOf = new WeakMap<object, number>();

function latest(list: readonly { ts: string }[]): number {
	let value = latestOf.get(list);
	if (value === undefined) {
		value = Number.NEGATIVE_INFINITY;
		for (const item of list) {
			const at = Date.parse(item?.ts);
			if (at > value) value = at;
		}
		latestOf.set(list, value);
	}
	return value;
}

/** The latest instant of the inputs (once per array): a `now` past it gives the same answer. */
function latestInstant(input: LogInputs): number {
	return Math.max(latest(input.reviews), latest(input.events));
}
