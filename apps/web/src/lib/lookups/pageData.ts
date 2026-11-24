// The lookup history page's reads and its add-to-deck (#72): one load of
// everything the page shows, and the decks view's idempotent add plan
// (addWords) for the chosen words. The page itself stays thin.

import type { StudyState } from '$lib/study/data';
import { loadEntryBases } from '$lib/api/entryBases';
import { listBooks } from '$lib/api/library';
import type { EntryBase } from '$lib/api/types';
import { scheduleIndex } from '$lib/features/flashcards/decks/deckStats';
import { addWords, type AddWordsResult } from '$lib/features/reader/wordActions';
import { contextForData } from '$lib/study/currentContext';
import { type KnownIndex, familiarity, knownIndex } from '$lib/study/known';
import { loadRawStudyData, loadStudyHistory } from '$lib/study/data';
import { pushStudy } from '$lib/study/commands/write';
import { activeWeights } from '$lib/study/readModel';
import type { Deck } from '$lib/study/types';
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
async function loadStates(study: StudyState, ws: number): Promise<{ decks: Deck[]; index: KnownIndex }> {
	const data = await loadStudyHistory(study, ws, { force: true });
	const schedules = scheduleIndex(data.cards, data.reviews, activeWeights(data), contextForData(data, ws).clock);
	return { decks: data.decks, index: knownIndex(data.cards, (id) => schedules.get(id) ?? null, data.known) };
}

export async function loadPage(study: StudyState, ws: number): Promise<PageData> {
	const [history, cfg, books, states] = await Promise.all([
		loadHistory(ws),
		loadLookupCfg(),
		listBooks(ws).catch(() => []),
		loadStates(study, ws)
	]);
	const bases = history.items.length === 0 ? new Map<number, EntryBase>() : await loadEntryBases(history.items.map((i) => i.entryId));
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
	study: StudyState,
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
		bases: (ids) => loadEntryBases(ids),
		raw: () => loadRawStudyData(study, ws),
		push: (w, writes) => pushStudy(study, w, writes)
	});
	return result;
}
