// The reminder facts (#137, docs/contracts/reminders/README.md "Facts"): a small derived snapshot of one
// workspace's study state (due now, due later by UTC hour, goal, streak, vacation days) that the client
// publishes so the server (email, push) and the shell can plan reminders. The server has no scheduler: due dates
// exist only in the clients' FSRS replay. Facts are a cache, never study data: no card text, no ids.
//
// Documented approximation: `dueBuckets` come from the schedule index (reviewed cards in a deck whose kind is
// studied); buried cards and "skip" flags are not applied, and new cards are never counted. `dueNow` is the
// decks page's overall due count (deckNumbers), daily limits not applied.

import { api as defaultApi } from '../api/client';
import type { Session } from '$lib/context/session.svelte';
import { loadGoalStatus, type GoalView } from '$lib/goals/loadGoal';
import { deckNumbers, scheduleIndex } from '$lib/features/flashcards/decks/deckStats';
import { sessionKinds } from '$lib/features/flashcards/decks/studyStart';
import { loadStudyHistory } from '$lib/studycore/data';
import { contextForData } from '$lib/studycore/currentContext';
import { activeWeights } from '$lib/studycore/readModel';
import { DEFAULT_W } from '$lib/studycore/fsrsParams';
import { GENERAL_DECK_ID } from '$lib/studycore/types';
import { vacationRuns, type Run } from '$lib/studycore/vacation';
import { addDays } from '$lib/time/studyDay';

export const MAX_BUCKETS = 400;
export const BUCKET_DAYS = 14;
export const VACATION_DAYS = 60;
export const MAX_VACATION_DATES = 120;
const MAX_COUNT = 1_000_000;
const HOUR_MS = 3_600_000;

export interface Bucket {
	at: string;
	count: number;
}

export type GoalFactStatus = 'open' | 'met' | 'vacation' | 'none';

export interface ReminderFacts {
	workspace: number;
	asOf: string;
	dueNow: number;
	dueBuckets: Bucket[];
	goal: { set: boolean; status: GoalFactStatus };
	streak: { current: number; todayMet: boolean };
	vacation: string[];
}

const count = (n: number): number => (Number.isFinite(n) ? Math.min(MAX_COUNT, Math.max(0, Math.trunc(n))) : 0);

/** dueBucketsOf: due instants later than `now` and within 14 days, grouped by the start of the UTC hour (at most 400). */
export function dueBucketsOf(dues: Iterable<string>, now: Date): Bucket[] {
	const from = now.getTime();
	const to = from + BUCKET_DAYS * 24 * HOUR_MS;
	const byHour = new Map<number, number>();
	for (const due of dues) {
		const ms = Date.parse(due);
		if (Number.isNaN(ms) || ms <= from || ms > to) continue;
		const start = Math.floor(ms / HOUR_MS) * HOUR_MS;
		byHour.set(start, (byHour.get(start) ?? 0) + 1);
	}
	return [...byHour]
		.sort(([a], [b]) => a - b)
		.slice(0, MAX_BUCKETS)
		.map(([start, n]) => ({ at: new Date(start).toISOString(), count: count(n) }));
}

/** vacationDatesOf: the learner days of the next 60 (today first) covered by a vacation run. */
export function vacationDatesOf(runs: readonly Run[], today: string): string[] {
	const out: string[] = [];
	for (let i = 0; i < VACATION_DAYS; i++) {
		const day = addDays(today, i);
		if (runs.some((r) => r.start <= day && day <= r.end)) out.push(day);
	}
	return out.slice(0, MAX_VACATION_DATES);
}

export interface FactsInput {
	workspace: number;
	now: Date;
	dueNow: number;
	/** The due instants of every reviewed card in scope (a schedule's `due`). */
	dues: Iterable<string>;
	goal: ReminderFacts['goal'];
	streak: ReminderFacts['streak'];
	vacation: string[];
}

/** buildFacts is the request body, every number clamped to the contract's range. */
export function buildFacts(input: FactsInput): ReminderFacts {
	return {
		workspace: input.workspace,
		asOf: input.now.toISOString(),
		dueNow: count(input.dueNow),
		dueBuckets: dueBucketsOf(input.dues, input.now),
		goal: input.goal,
		streak: { current: count(input.streak.current), todayMet: input.streak.todayMet },
		vacation: input.vacation.slice(0, MAX_VACATION_DATES)
	};
}

/** factsOf maps a goal view to the goal and streak facts (no goal in effect, or a status the contract lacks: none). */
export function factsOf(view: GoalView): Pick<ReminderFacts, 'goal' | 'streak'> {
	const status = view.today.status;
	const known = status === 'open' || status === 'met' || status === 'vacation';
	return {
		goal: known ? { set: true, status } : { set: false, status: 'none' },
		streak: view.streak === null ? { current: 0, todayMet: false } : { current: view.streak.current, todayMet: view.streak.todayMet }
	};
}

export interface FactsDeps {
	api: typeof defaultApi;
	now: () => number;
}

/** computeFacts builds the facts of one workspace from the session's study state and goal. */
export async function computeFacts(session: Session, workspaceId: number, now: Date): Promise<ReminderFacts> {
	const data = await loadStudyHistory(session.study, workspaceId, {});
	const weights = activeWeights(data) ?? DEFAULT_W;
	const ctx = contextForData(session.zone, data, workspaceId);
	const index = scheduleIndex(data.cards, data.reviews, weights, ctx.clock);
	const deckSettings = data.deckSettings ?? {};
	const deckIds = [GENERAL_DECK_ID, ...data.decks.map((d) => d.id)];
	const language = session.workspaces.list.find((w) => w.id === workspaceId)?.language ?? '';
	const kinds = sessionKinds(session.setups.of(workspaceId).setup, deckIds, deckSettings, language);
	const { due } = deckNumbers({ deckId: null, cards: data.cards, decks: data.decks, reviews: data.reviews, index, kinds, deckSettings, now, w: weights, ctx, addDays });
	const existing = new Set(deckIds);
	const dues: string[] = [];
	for (const card of data.cards) {
		const schedule = index.get(card.id);
		if (schedule && kinds.includes(card.kind) && card.deckIds.some((id) => existing.has(id))) dues.push(schedule.due);
	}
	const today = ctx.day.today(now.getTime());
	const goal = await loadGoalStatus(session, workspaceId, { now: now.getTime() });
	return buildFacts({
		workspace: workspaceId,
		now,
		dueNow: due,
		dues,
		...factsOf(goal),
		vacation: vacationDatesOf(vacationRuns(data.vacations ?? [], workspaceId, today), today)
	});
}

/** publishFacts computes the workspace's facts and PUTs them. Errors reject (the publisher catches them). */
export async function publishFacts(session: Session, workspaceId: number, deps: Partial<FactsDeps> = {}): Promise<void> {
	const now = new Date((deps.now ?? Date.now)());
	const facts = await computeFacts(session, workspaceId, now);
	await (deps.api ?? defaultApi)('/api/reminders/facts', { method: 'PUT', body: facts });
}
