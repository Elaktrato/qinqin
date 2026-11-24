// The reads of a workspace's study state (#193). Cards, decks, deck settings,
// limits and FSRS sets are typed core rows (docs/contracts/study/); goals,
// known marks, vacations and milestones are keyed rows of the study namespace.
// Every read and write names its workspace (#174: captured by the caller when
// the user acted); a missing one is an error. The one exception: `vacation:*`
// rows are user-global (docs/contracts/scheduler/). The daily goal is
// goals:workspace (docs/contracts/goals/).

import { api } from '../api/client';
import { fetchFullLog, type StudyEvent } from '../events';
import { onSessionEnd, sessionEpoch } from '../session/sessionEnd';
import { pendingReviews } from './events';
import { outboxUser } from './outboxUser';
import { recentSentReviews } from './recentSent';
import { emptyRows, historyOf, keyedSlot, mergeRows, viewOf, withQueued as mergeQueued, type StudyView } from './readModel';
import type { StudySnapshot } from './plan';
import type { StudyRow } from './rows';
import { pullStudyRound } from './sync/pull';
import { UnreadableRowError, clearUnreadableReport, reportUnreadable } from './unreadable';
import type { Deck, StudyCard, StudyData, StudyHistory } from './types';
import type { DeckSettings } from './deckSettings';

/** The write touched rows every workspace reads (user-global vacations). */
export const ALL_WORKSPACES = 0;

/** How many pages the last study round of a workspace took (the offline receipt counts them). */
const pulledPages = new Map<number, number>();
/**
 * The keyed rows (keyedSlot keys) the last study load of a workspace could not
 * read: keyed writes refuse them.
 */
const unreadableKeyed = new Map<number, Set<string>>();
onSessionEnd(() => {
	pulledPages.clear();
	unreadableKeyed.clear();
	clearUnreadableReport();
});

/** How many pages the last study pull of a workspace took (the offline receipt counts them). */
export function studyPullPages(workspaceId: number): number {
	return pulledPages.get(workspaceId) ?? 0;
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

/** Throws UnreadableRowError when the last load could not read the keyed row `key` (ALL_WORKSPACES: a user-global row). */
export function assertReadableKeyed(workspaceId: number, key: string): void {
	const hit =
		workspaceId === ALL_WORKSPACES
			? [...unreadableKeyed.values()].some((set) => set.has(keyedSlot(key, true)))
			: unreadableKeyed.get(workspaceId)?.has(keyedSlot(key, false)) === true;
	if (hit) throw new UnreadableRowError(`pluginData:${key}`);
}

/**
 * studyView reads one round of the workspace and derives its view. A row that
 * does not decode (docs/contracts/sync/, "Reading rows") is skipped, counted
 * and reported (unreadable.ts); its identity is protected from writes.
 */
export async function studyView(workspaceId: number): Promise<StudyView> {
	const epoch = sessionEpoch();
	const round = await pullStudyRound((path) => api<unknown>(path), workspaceId);
	const rows = emptyRows();
	mergeRows(rows, round.collections, workspaceId);
	const view = viewOf(rows);
	// An answer for a session that has ended reports nothing (#173).
	if (epoch === sessionEpoch()) {
		pulledPages.set(workspaceId, round.pages);
		reportUnreadable(workspaceId, view.counts, view.unreadableKeys);
		unreadableKeyed.set(workspaceId, view.keyedUnreadable);
	}
	return view;
}

/** planningView: the view a write plans against. */
export function planningView(workspaceId: number): Promise<StudyView> {
	return studyView(workspaceId);
}

// Called after every write with the workspace it touched, so caches of
// study data can drop what is now stale.
const writeListeners = new Set<(workspaceId: number) => void>();

/** onStudyWrite registers a listener for study-data writes; returns the unsubscribe. */
export function onStudyWrite(listener: (workspaceId: number) => void): () => void {
	writeListeners.add(listener);
	return () => writeListeners.delete(listener);
}

/** notifyWrite tells the listeners that a write touched `workspaceId` (ALL_WORKSPACES: user-global rows). */
export function notifyWrite(workspaceId: number): void {
	for (const listener of writeListeners) listener(workspaceId);
}

/**
 * queued: the signed-in user's reviews that wait in the outbox, or were sent
 * since the log was read, so a card reviewed offline - or just before a reload -
 * is not shown as due again before the review has been sent. Another user's
 * queue, or any queue while no user is known, is never read.
 */
function withQueued(workspaceId: number, events: readonly StudyEvent[]): readonly StudyEvent[] {
	const user = outboxUser();
	if (user === null) return events;
	return mergeQueued(events, [...pendingReviews(user, workspaceId), ...recentSentReviews(user, workspaceId)]);
}

/**
 * loadStudyData is THE read of a workspace's study state for anything
 * that shows, counts or schedules cards: decks, cards and the review
 * history, with duplicate cards merged (readModel historyOf). Every page and
 * widget goes through it (widgets through loadStudyHistory), so no call site
 * can forget the merge. Writes read the raw rows instead, so they see and
 * rewrite every stored duplicate.
 */
export async function loadStudyData(workspaceId: number): Promise<StudyHistory> {
	requireWorkspaceArg(workspaceId, 'loadStudyData');
	return loadStudyDataWith(workspaceId, (id) => fetchFullLog(id));
}

/** loadStudyDataWith is loadStudyData with the event log read by `readEvents` (the widgets pass the cached log). */
export async function loadStudyDataWith(
	workspaceId: number,
	readEvents: (workspaceId: number) => Promise<readonly StudyEvent[]>
): Promise<StudyHistory> {
	const [view, events] = await Promise.all([studyView(workspaceId), readEvents(workspaceId)]);
	return historyOf(workspaceId, view.data, withQueued(workspaceId, events));
}

/** loadStudyDataFor reads the raw rows of one workspace (duplicates included) for "is this word studied" checks. */
export async function loadStudyDataFor(workspaceId: number): Promise<StudyData> {
	return (await studyView(workspaceId)).data;
}

/**
 * loadRawStudyData reads the live decks and cards of a workspace as stored:
 * duplicate cards are NOT merged, so a writer sees every row it must keep
 * consistent (the decks view's add-to-deck plan). `knownAt` and `stored`
 * are what the server holds (StudySnapshot), for planning a write with
 * studyWrite. Pages that show or schedule cards use loadStudyData instead.
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
	const { data, snapshot } = await studyView(workspaceId);
	return { ...rawOf(data, snapshot), deckSettings: data.deckSettings ?? {} };
}

function rawOf(data: StudyData, snapshot: StudySnapshot) {
	return {
		decks: data.decks,
		cards: data.cards,
		knownAt: snapshot.knownAt,
		stored: snapshot.stored,
		unreadable: snapshot.unreadable
	};
}
