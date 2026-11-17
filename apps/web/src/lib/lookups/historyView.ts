// The lookup history page model (#72): pure, so the Svelte page stays thin.
// Words and titles are returned as plain strings for text interpolation.

import { readingBeside } from '$lib/entry/displayForm';
import { t } from '$lib/i18n';
import { formatDay } from '$lib/i18n/format';
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
			if (!removed) parts.push(t('lookups.where.removedBook'));
			removed = true;
		} else {
			parts.push(`《${title}》`);
		}
	}
	if (item.books.length === 0 && (item.sources.reader ?? 0) > 0) parts.push(t('lookups.where.reader'));
	if ((item.sources.lesson ?? 0) > 0) parts.push(t('lookups.where.lessons'));
	if ((item.sources.search ?? 0) > 0) parts.push(t('lookups.where.search'));
	return parts.join(', ');
}

/** dayLabel: "3 Nov", with the year when it is not today's year (the format locale's short day). */
export function dayLabel(day: string, today: string): string {
	const sameYear = day.slice(0, 4) === today.slice(0, 4);
	return formatDay(day, sameYear ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' });
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
			reading: base === undefined ? '' : readingBeside(base.written, base.readings),
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
	return state === 'new'
		? t('lookups.state.new')
		: state === 'learning'
			? t('lookups.state.learning')
			: t('lookups.state.known');
}

export function addResultText(r: { created: number; joined: number; skipped: number; missing: number }, deck: string): string {
	const parts: string[] = [];
	if (r.created > 0) parts.push(t('lookups.add.created', { count: r.created, deck }));
	if (r.joined > 0) parts.push(t('lookups.add.joined', { count: r.joined }));
	const result =
		parts.length > 0
			? t('lookups.add.done', { parts: parts.join('; ') })
			: r.skipped > 0
				? t('lookups.add.alreadyIn', { deck })
				: t('lookups.add.nothing');
	if (r.missing === 0) return result;
	return t('lookups.add.withMissing', { result, missing: t('lookups.add.missing', { count: r.missing }) });
}

/** deckOptions: General first, then the decks by createdAt (ties: id). */
export function deckOptions(decks: readonly Pick<Deck, 'id' | 'name' | 'createdAt'>[]): { id: string; name: string }[] {
	const sorted = [...decks].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
	return [{ id: GENERAL_DECK_ID, name: t('entry.study.general') }, ...sorted.map((d) => ({ id: d.id, name: d.name }))];
}

/**
 * historyCountText is the live count above the list (#12): how many words
 * the filter shows, against the whole history; '' with no history.
 */
export function historyCountText(shown: number, total: number, filter: HistoryFilter): string {
	if (total === 0) return '';
	if (filter === 'all') return t('lookups.count.all', { count: shown });
	return t('lookups.count.noCard', { count: total, shown });
}
