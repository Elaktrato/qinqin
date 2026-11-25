// The reads of a workspace's study state (#193), all over the session's one
// study cache (cache.ts). Cards, decks, deck settings, limits and FSRS sets are
// typed core rows (docs/contracts/study/); goals, known marks, vacations and
// milestones are keyed rows of the study namespace. Every read and write names
// its workspace (#174: captured by the caller when the user acted); a missing
// one is an error. The one exception: `vacation:*` rows are user-global
// (docs/contracts/scheduler/). The daily goal is goals:workspace
// (docs/contracts/goals/).
//
// - loadStudyData: pages that show, count or schedule cards (merged history,
//   the event log read fresh). A fresh object per call.
// - loadStudyHistory: widgets (merged history over the 8 s log cache), one
//   shared object per cache and log version: do not mutate it.
// - getStudyData: "is this word studied" checks and settings (raw rows), shared.
// - loadRawStudyData: planners (raw rows and the snapshot to plan against).
//
// The study cache belongs to the session (StudyState, record 0009): every
// function here takes the session's study state first.

import type { Api, Timers } from '../context/deps';
import { fetchFullLog, type EventLog, type StudyEvent } from '$lib/events';
import { createStudyCache, type StudyCache } from './cache';
import type { ReviewOutbox } from './events';
import { recentSentReviews } from './recentSent';
import { historyOf, keyedSlot, withQueued as mergeQueued, type StudyView } from './readModel';
import type { StudyRow } from './rows';
import { pullStudyRound } from './sync/pull';
import { UnreadableRowError } from './unreadable';
import { UnreadableRows } from './unreadableReport.svelte';
import type { Deck, StudyCard, StudyData, StudyHistory } from './types';
import type { DeckSettings } from './deckSettings';

/** The write touched rows every workspace reads (user-global vacations). */
export const ALL_WORKSPACES = 0;

export interface StudyDeps {
	api: Api;
	now(): number;
	timers: Timers;
	local(): Storage | null;
	/** The session's user, null until `me` answered. */
	user(): number | null;
	/** False once the session ended: an answer then changes nothing. */
	alive(): boolean;
	/** The session's outbox: queued reviews count as reviewed. */
	outbox: Pick<ReviewOutbox, 'pendingReviews' | 'ready'>;
	/** The session's event log cache (the widgets' history reads the log through it). */
	events: Pick<EventLog, 'load' | 'invalidate'>;
}

/**
 * StudyState: the session's study data (record 0009) — the one study cache of
 * #193, the unreadable-row report, and the history memo. Every read and write
 * of this module and of commands/ takes it as its first argument.
 */
export class StudyState {
	readonly deps: StudyDeps;
	readonly cache: StudyCache;
	readonly unreadable = new UnreadableRows();
	/** loadStudyHistory's memo, one per cache view. */
	readonly historyMemo = new WeakMap<StudyView, { events: readonly StudyEvent[]; queued: string; value: StudyHistory }>();

	constructor(deps: StudyDeps) {
		this.deps = deps;
		this.cache = createStudyCache({
			pull: (workspaceId, since) => pullStudyRound((path) => deps.api<unknown>(path), workspaceId, since),
			now: deps.now,
			epoch: () => (deps.alive() ? 0 : 1),
			setTimer: (fn, ms) => deps.timers.set(fn, ms),
			clearTimer: (timer) => deps.timers.clear(timer),
			onRound: (workspaceId, view) => this.unreadable.record(workspaceId, view.counts, view.unreadableKeys)
		});
	}

	/** dispose: the session ended; the cache forgets every slot and timer. */
	dispose(): void {
		this.cache.clear();
		this.unreadable.clear();
	}
}

/** withStudy binds a study function to the session's study state (a dependency handed to a pure module). */
export function withStudy<A extends unknown[], R>(study: StudyState, fn: (study: StudyState, ...args: A) => R): (...args: A) => R {
	return (...args) => fn(study, ...args);
}

/** createStudyState builds the session's study state. */
export function createStudyState(deps: StudyDeps): StudyState {
	return new StudyState(deps);
}

/**
 * requireWorkspaceArg checks the workspace a caller named (#174): study data
 * is workspace-scoped and every read and write names its workspace, captured
 * when the user acted (never "whatever is selected now", which a switch
 * mid-save would change), so a missing one is a plain Error before any
 * request instead of a write to user-global or another workspace's rows.
 */
export function requireWorkspaceArg(workspaceId: number, fn: string): void {
	if (!Number.isInteger(workspaceId) || workspaceId <= 0) {
		throw new Error(`${fn}: not a workspace id: study data is workspace-scoped`);
	}
}

/**
 * Throws UnreadableRowError when a loaded workspace could not read the keyed
 * row `key` (ALL_WORKSPACES: a user-global row, in any loaded workspace).
 */
export function assertReadableKeyed(study: StudyState, workspaceId: number, key: string): void {
	const studyCache = study.cache;
	const hit =
		workspaceId === ALL_WORKSPACES
			? studyCache.loadedViews().some((view) => view.keyedUnreadable.has(keyedSlot(key, true)))
			: studyCache.peek(workspaceId)?.keyedUnreadable.has(keyedSlot(key, false)) === true;
	if (hit) throw new UnreadableRowError(`rows:${key}`);
}

/** How many pages the last full study round of a workspace took (the offline receipt counts them). */
export function studyPullPages(study: StudyState, workspaceId: number): number {
	return study.cache.pages(workspaceId);
}

/** planningView: the view a write plans against (the cache, refreshed when older than 8 s). */
export function planningView(study: StudyState, workspaceId: number): Promise<StudyView> {
	return study.cache.view(workspaceId);
}

/**
 * onStudyChange registers a listener called with the workspace whose study rows
 * changed (ALL_WORKSPACES: user-global rows): a write of this tab, or a round
 * that brought new rows (the same-second follow-up). Returns the unsubscribe.
 */
export function onStudyChange(study: StudyState, listener: (workspaceId: number) => void): () => void {
	return study.cache.onChange(listener);
}

/** touches: whether a change of `changed` concerns a view of `workspaceId`. */
export function touches(changed: number, workspaceId: number | null): boolean {
	return workspaceId !== null && (changed === workspaceId || changed === ALL_WORKSPACES);
}

/**
 * queued: the signed-in user's reviews that wait in the outbox, or were sent
 * since the log was read, so a card reviewed offline - or just before a reload -
 * is not shown as due again before the review has been sent. Another user's
 * queue, or any queue while no user is known, is never read.
 */
function queued(study: StudyState, workspaceId: number): StudyEvent[] {
	const user = study.deps.user();
	if (user === null) return [];
	const { deps } = study;
	return [...deps.outbox.pendingReviews(user, workspaceId), ...recentSentReviews(user, workspaceId, deps.now(), deps.local())];
}

/**
 * loadStudyData is THE read of a workspace's study state for pages that show,
 * count or schedule cards: decks, cards and the review history, with duplicate
 * cards merged (readModel historyOf), the log read fresh. Writes read the raw
 * rows instead, so they see and rewrite every stored duplicate.
 */
export async function loadStudyData(study: StudyState, workspaceId: number): Promise<StudyHistory> {
	requireWorkspaceArg(workspaceId, 'loadStudyData');
	const [view, events] = await Promise.all([study.cache.view(workspaceId), fetchFullLog(workspaceId), study.deps.outbox.ready()]);
	// A copy: pages keep it in their state.
	return historyOf(workspaceId, copyData(view.data), mergeQueued(events, queued(study, workspaceId)));
}

/** copyData: a copy of the data whose arrays and records a page may change. */
function copyData(data: StudyData): StudyData {
	return {
		...data,
		decks: data.decks.map((deck) => ({ ...deck })),
		cards: data.cards.map((card) => ({ ...card, deckIds: [...card.deckIds] })),
		...(data.deckSettings === undefined ? {} : { deckSettings: { ...data.deckSettings } }),
		...(data.vacations === undefined ? {} : { vacations: [...data.vacations] }),
		...(data.known === undefined ? {} : { known: [...data.known] }),
		...(data.knownDeclared === undefined ? {} : { knownDeclared: data.knownDeclared.map((d) => ({ ...d })) })
	};
}

/**
 * loadStudyHistory is loadStudyData for widgets: the log through its 8 s cache
 * (events.ts), one shared answer per cache and log version. `force` (a widget's
 * "Try again") reads a delta round and the log again; `full` reads a full round
 * (offline preparation: the worker keeps full rounds).
 */
export async function loadStudyHistory(
	study: StudyState,
	workspaceId: number,
	opts: { force?: boolean; full?: boolean } = {}
): Promise<StudyHistory> {
	requireWorkspaceArg(workspaceId, 'loadStudyHistory');
	if (opts.force === true) study.deps.events.invalidate(workspaceId);
	const [view, events] = await Promise.all([
		study.cache.view(workspaceId, { force: opts.force, full: opts.full }),
		study.deps.events.load(workspaceId),
		study.deps.outbox.ready()
	]);
	const historyMemo = study.historyMemo;
	const waiting = queued(study, workspaceId);
	const signature = waiting.map((event) => event.id).join(',');
	const memo = historyMemo.get(view);
	if (memo !== undefined && memo.events === events && memo.queued === signature) return memo.value;
	const value = historyOf(workspaceId, view.data, mergeQueued(events, waiting));
	historyMemo.set(view, { events, queued: signature, value });
	return value;
}

/** getStudyData reads one workspace's raw rows (duplicates included), shared: do not mutate. */
export async function getStudyData(study: StudyState, workspaceId: number, opts: { force?: boolean } = {}): Promise<StudyData> {
	requireWorkspaceArg(workspaceId, 'getStudyData');
	return (await study.cache.view(workspaceId, { force: opts.force })).data;
}

/**
 * hasCard reports whether the entry already has a vocab card: the card
 * the add buttons create, and the one addCard dedupes on.
 */
export function hasCard(cards: readonly StudyCard[], entryId: number): boolean {
	return cards.some((card) => card.kind === 'vocab' && card.entryId === entryId);
}

/**
 * loadRawStudyData reads the live decks and cards of a workspace as stored:
 * duplicate cards are NOT merged, so a writer sees every row it must keep
 * consistent (the decks view's add-to-deck plan). `knownAt` and `stored`
 * are what the server holds (StudySnapshot), for planning a write with
 * studyWrite. Fresh copies: the caller may keep them.
 */
export async function loadRawStudyData(study: StudyState, workspaceId: number): Promise<{
	decks: Deck[];
	cards: StudyCard[];
	knownAt: Map<string, string>;
	/** Every typed row of the workspace, tombstones included. */
	stored: Map<string, StudyRow>;
	/** The keys of typed rows this version cannot read: studyWrite refuses them. */
	unreadable: Set<string>;
	/** The live deck settings rows, by deck id (always set). */
	deckSettings?: Record<string, DeckSettings>;
}> {
	requireWorkspaceArg(workspaceId, 'loadRawStudyData');
	const { data, snapshot } = await study.cache.view(workspaceId);
	return {
		decks: [...data.decks],
		cards: [...data.cards],
		knownAt: new Map(snapshot.knownAt),
		stored: new Map(snapshot.stored),
		unreadable: new Set(snapshot.unreadable),
		deckSettings: { ...(data.deckSettings ?? {}) }
	};
}
