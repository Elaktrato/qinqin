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

import { api } from '../api/client';
import { fetchFullLog, invalidateWorkspaceEvents, loadWorkspaceEvents, type StudyEvent } from '../events';
import { onSessionEnd, sessionEpoch } from '../session/sessionEnd';
import { createStudyCache } from './cache';
import { pendingReviews } from './events';
import { outboxUser } from './outboxUser';
import { recentSentReviews } from './recentSent';
import { historyOf, keyedSlot, withQueued as mergeQueued, type StudyView } from './readModel';
import type { StudyRow } from './rows';
import { pullStudyRound } from './sync/pull';
import { UnreadableRowError, clearUnreadableReport, reportUnreadable } from './unreadable';
import type { Deck, StudyCard, StudyData, StudyHistory } from './types';
import type { DeckSettings } from './deckSettings';

/** The write touched rows every workspace reads (user-global vacations). */
export const ALL_WORKSPACES = 0;

/** The session's study cache; #196 moves it into the per-session app context. */
export const studyCache = createStudyCache({
	pull: (workspaceId, since) => pullStudyRound((path) => api<unknown>(path), workspaceId, since),
	now: () => Date.now(),
	epoch: sessionEpoch,
	setTimer: (fn, ms) => setTimeout(fn, ms),
	clearTimer: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
	onRound: (workspaceId, view) => reportUnreadable(workspaceId, view.counts, view.unreadableKeys)
});
onSessionEnd(() => {
	studyCache.clear();
	clearUnreadableReport();
});

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
export function assertReadableKeyed(workspaceId: number, key: string): void {
	const hit =
		workspaceId === ALL_WORKSPACES
			? studyCache.loadedViews().some((view) => view.keyedUnreadable.has(keyedSlot(key, true)))
			: studyCache.peek(workspaceId)?.keyedUnreadable.has(keyedSlot(key, false)) === true;
	if (hit) throw new UnreadableRowError(`pluginData:${key}`);
}

/** How many pages the last full study round of a workspace took (the offline receipt counts them). */
export function studyPullPages(workspaceId: number): number {
	return studyCache.pages(workspaceId);
}

/** planningView: the view a write plans against (the cache, refreshed when older than 8 s). */
export function planningView(workspaceId: number): Promise<StudyView> {
	return studyCache.view(workspaceId);
}

/**
 * onStudyChange registers a listener called with the workspace whose study rows
 * changed (ALL_WORKSPACES: user-global rows): a write of this tab, or a round
 * that brought new rows (the same-second follow-up). Returns the unsubscribe.
 */
export function onStudyChange(listener: (workspaceId: number) => void): () => void {
	return studyCache.onChange(listener);
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
function queued(workspaceId: number): StudyEvent[] {
	const user = outboxUser();
	if (user === null) return [];
	return [...pendingReviews(user, workspaceId), ...recentSentReviews(user, workspaceId)];
}

/**
 * loadStudyData is THE read of a workspace's study state for pages that show,
 * count or schedule cards: decks, cards and the review history, with duplicate
 * cards merged (readModel historyOf), the log read fresh. Writes read the raw
 * rows instead, so they see and rewrite every stored duplicate.
 */
export async function loadStudyData(workspaceId: number): Promise<StudyHistory> {
	requireWorkspaceArg(workspaceId, 'loadStudyData');
	const [view, events] = await Promise.all([studyCache.view(workspaceId), fetchFullLog(workspaceId)]);
	// A copy: pages keep it in their state.
	return historyOf(workspaceId, copyData(view.data), mergeQueued(events, queued(workspaceId)));
}

/** copyData: a copy of the data whose arrays and records a page may change. */
function copyData(data: StudyData): StudyData {
	return {
		...data,
		decks: data.decks.map((deck) => ({ ...deck })),
		cards: data.cards.map((card) => ({ ...card, deckIds: [...card.deckIds] })),
		...(data.deckSettings === undefined ? {} : { deckSettings: { ...data.deckSettings } }),
		...(data.vacations === undefined ? {} : { vacations: [...data.vacations] }),
		...(data.known === undefined ? {} : { known: [...data.known] })
	};
}

const historyMemo = new WeakMap<StudyView, { events: readonly StudyEvent[]; queued: string; value: StudyHistory }>();

/**
 * loadStudyHistory is loadStudyData for widgets: the log through its 8 s cache
 * (events.ts), one shared answer per cache and log version. `force` (a widget's
 * "Try again") reads a delta round and the log again; `full` reads a full round
 * (offline preparation: the worker keeps full rounds).
 */
export async function loadStudyHistory(workspaceId: number, opts: { force?: boolean; full?: boolean } = {}): Promise<StudyHistory> {
	requireWorkspaceArg(workspaceId, 'loadStudyHistory');
	if (opts.force === true) invalidateWorkspaceEvents(workspaceId);
	const [view, events] = await Promise.all([
		studyCache.view(workspaceId, { force: opts.force, full: opts.full }),
		loadWorkspaceEvents(workspaceId)
	]);
	const waiting = queued(workspaceId);
	const signature = waiting.map((event) => event.id).join(',');
	const memo = historyMemo.get(view);
	if (memo !== undefined && memo.events === events && memo.queued === signature) return memo.value;
	const value = historyOf(workspaceId, view.data, mergeQueued(events, waiting));
	historyMemo.set(view, { events, queued: signature, value });
	return value;
}

/** getStudyData reads one workspace's raw rows (duplicates included), shared: do not mutate. */
export async function getStudyData(workspaceId: number, opts: { force?: boolean } = {}): Promise<StudyData> {
	requireWorkspaceArg(workspaceId, 'getStudyData');
	return (await studyCache.view(workspaceId, { force: opts.force })).data;
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
export async function loadRawStudyData(workspaceId: number): Promise<{
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
	const { data, snapshot } = await studyCache.view(workspaceId);
	return {
		decks: [...data.decks],
		cards: [...data.cards],
		knownAt: new Map(snapshot.knownAt),
		stored: new Map(snapshot.stored),
		unreadable: new Set(snapshot.unreadable),
		deckSettings: { ...(data.deckSettings ?? {}) }
	};
}
