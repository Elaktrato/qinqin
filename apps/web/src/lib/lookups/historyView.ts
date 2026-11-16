// The lookup history page model (#72): pure, so the Svelte page stays thin.
// Words and titles are returned as plain strings for text interpolation.

import type { EntryBase } from '$lib/api/types';
import { GENERAL_DECK_ID } from '$lib/study/store';
import type { Deck } from '$lib/study/types';
import type { LookupHistory, LookupItem, LookupState } from './lookups';

export const PAGE_SIZE = 50;

export type HistoryFilter = 'all' | 'nocard';

export interface HistoryRow {
	entryId: number;
	/** null: the dictionary no longer has the entry. */
	written: string | null;
	reading: string;
	count: number;
	/** The learner's day of the last lookup, YYYY-MM-DD. */
	lastDay: string;
	where: string;
	state: LookupState;
	missing: boolean;
}

/** whereText: 《A》, 《B》, lessons, search; a book the library lacks is "a removed book". */
export function whereText(item: LookupItem, books: ReadonlyMap<number, string>): string {
	const parts: string[] = [];
	let removed = false;
	for (const id of item.books) {
		const title = books.get(id);
		if (title === undefined) {
			if (!removed) parts.push('a removed book');
			removed = true;
		} else {
			parts.push(`《${title}》`);
		}
	}
	if (item.books.length === 0 && (item.sources.reader ?? 0) > 0) parts.push('reader');
	if ((item.sources.lesson ?? 0) > 0) parts.push('lessons');
	if ((item.sources.search ?? 0) > 0) parts.push('search');
	return parts.join(', ');
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** dayLabel: "3 Nov", with the year when it is not today's year. */
export function dayLabel(day: string, today: string): string {
	const [y, m, d] = day.split('-').map(Number);
	const label = `${d} ${MONTHS[m - 1] ?? '?'}`;
	return day.slice(0, 4) === today.slice(0, 4) ? label : `${label} ${y}`;
}

export function historyRows(
	h: LookupHistory,
	bases: ReadonlyMap<number, EntryBase>,
	books: ReadonlyMap<number, string>,
	stateOf: (id: number) => LookupState,
	dayOf: (iso: string) => string,
	filter: HistoryFilter
): HistoryRow[] {
	const rows: HistoryRow[] = [];
	for (const item of h.items) {
		const base = bases.get(item.entryId);
		const state = stateOf(item.entryId);
		if (filter === 'nocard' && (base === undefined || state !== 'new')) continue;
		rows.push({
			entryId: item.entryId,
			written: base?.written ?? null,
			reading: base?.readings[0]?.value ?? '',
			count: item.count,
			lastDay: dayOf(item.lastAt),
			where: whereText(item, books),
			state,
			missing: base === undefined
		});
	}
	return rows;
}

export function stateLabel(state: LookupState): string {
	return state === 'new' ? 'No card' : state === 'learning' ? 'In study' : 'Known';
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function addResultText(r: { created: number; joined: number; skipped: number; missing: number }, deck: string): string {
	const parts: string[] = [];
	if (r.created > 0) parts.push(`Added ${plural(r.created, 'new card', 'new cards')} to ${deck}`);
	if (r.joined > 0) parts.push(`${plural(r.joined, 'word', 'words')} joined the deck`);
	const missing = r.missing > 0 ? ` ${plural(r.missing, 'word is', 'words are')} not in the dictionary any more.` : '';
	if (parts.length === 0) {
		return r.skipped > 0 ? `Nothing to add: these words are already in ${deck}.${missing}` : `Nothing to add.${missing}`;
	}
	return `${parts.join('; ')}.${missing}`;
}

/** deckOptions: General first, then the decks by createdAt (ties: id). */
export function deckOptions(decks: readonly Pick<Deck, 'id' | 'name' | 'createdAt'>[]): { id: string; name: string }[] {
	const sorted = [...decks].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
	return [{ id: GENERAL_DECK_ID, name: 'General' }, ...sorted.map((d) => ({ id: d.id, name: d.name }))];
}
