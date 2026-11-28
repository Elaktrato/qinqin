// The lookup history page's reads and its add-to-deck (#72): one load of
// everything the page shows, and the decks view's idempotent add plan
// (addWords) for the chosen words. The page itself stays thin.

import type { Session } from '$lib/context/session.svelte';
import { loadEntryBases } from '$lib/api/entryBases';
import { listBooks } from '$lib/api/library';
import type { EntryBase } from '$lib/api/types';
import { scheduleIndex } from '$lib/features/flashcards/decks/deckStats';
import { addWords, type AddWordsResult } from '$lib/features/reader/wordActions';
import { contextForData } from '$lib/studycore/currentContext';
import { type KnownIndex, familiarity, knownIndex } from '$lib/studycore/known';
import { loadRawStudyData, loadStudyHistory } from '$lib/studycore/data';
import { pushStudy } from '$lib/studycore/commands/write';
import { activeWeights } from '$lib/studycore/readModel';
import type { Deck } from '$lib/studycore/types';
import type { LookupHistory, LookupState } from './lookups';
import { loadHistory, loadLookupCfg } from './store';

export interface PageData {
	history: LookupHistory;
	record: boolean;
	bases: Map<number, EntryBase>;
	/** Book id -> title, of the workspace's library. */
	books: Map<number, string>;
	decks: Deck[];
	stateOf: (entryId: number) => LookupState;
}

/** loadStates: the familiarity of every entry in the workspace (#68's predicate). */
async function loadStates(session: Session, ws: number): Promise<{ decks: Deck[]; index: KnownIndex }> {
	const data = await loadStudyHistory(session.study, ws, { force: true });
	const schedules = scheduleIndex(data.cards, data.reviews, activeWeights(data), contextForData(session.zone, data, ws).clock);
	return { decks: data.decks, index: knownIndex(data.cards, (id) => schedules.get(id) ?? null, data.known) };
}

export async function loadPage(session: Session, ws: number): Promise<PageData> {
	const [history, cfg, books, states] = await Promise.all([
		loadHistory(ws),
		loadLookupCfg(),
		listBooks(ws).catch(() => []),
		loadStates(session, ws)
	]);
	const bases = history.items.length === 0 ? new Map<number, EntryBase>() : await loadEntryBases(session.caches.entryBases, history.items.map((i) => i.entryId));
	return {
		history,
		record: cfg.record,
		bases,
		books: new Map(books.map((b) => [b.id, b.title])),
		decks: states.decks,
		stateOf: (id) => familiarity(id, states.index)
	};
}

/** addEntries adds the words (in the given order) to a deck; adding twice creates nothing. */
export async function addEntries(
	session: Session,
	ws: number,
	entryIds: readonly number[],
	target: { id: string; name: string },
	now: Date = new Date()
): Promise<AddWordsResult> {
	const result = await addWords({
		workspaceId: ws,
		entryIds,
		target,
		now,
		bases: (ids) => loadEntryBases(session.caches.entryBases, ids),
		raw: () => loadRawStudyData(session.study, ws),
		push: (w, writes) => pushStudy(session.study, w, writes)
	});
	return result;
}
