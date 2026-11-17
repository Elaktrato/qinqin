// The rows of a deck's detail view: one per entry (grouped from all the
// deck's cards, so a stray sibling without a vocab card is still listed
// and manageable), with the state of the word, a folded search string
// built once, filters and sorts. Pure; the component only renders.

import { shownWritten } from '$lib/entry/displayForm';
import { t } from '$lib/i18n';
import type { EntryBase } from '$lib/api/types';
import { cleanSkipKinds } from '$lib/study/canonical';
import { foldSearch } from '$lib/study/charGroups';
import { cardScore } from '$lib/study/mastery';
import type { StudyCard, StudyCardKind } from '$lib/study/types';
import { WORD_STATES, classifySchedule, type WordState } from '$lib/stats/wordStates';
import type { ScheduleIndex } from './deckStats';

export interface DeckRow {
	entryId: number;
	written: string;
	vocab: StudyCard | null;
	/** The deck's non-vocab cards of this entry. */
	siblings: StudyCard[];
	/** Kinds the learner switched off for this word. */
	skipped: StudyCardKind[];
	state: WordState;
	/** The vocab card's 0-100 memory score. */
	score: number;
	/** The earliest due instant among the entry's reviewed cards. */
	nextDue: string | null;
	addedAt: string;
	/** Folded written form, readings and entry id. */
	search: string;
}

const SEP = '\u0000';

function instant(ts: string): number {
	const ms = Date.parse(ts);
	return Number.isNaN(ms) ? 0 : ms;
}

/** deckRows: one row per entry that has a card in `deckId`, in entry-id order. */
export function deckRows(
	cards: readonly StudyCard[],
	deckId: string,
	index: ScheduleIndex,
	bases?: ReadonlyMap<number, EntryBase>
): DeckRow[] {
	const byEntry = new Map<number, StudyCard[]>();
	for (const card of cards) {
		if (!card.deckIds.includes(deckId)) continue;
		const list = byEntry.get(card.entryId);
		if (list === undefined) byEntry.set(card.entryId, [card]);
		else list.push(card);
	}
	const rows: DeckRow[] = [];
	for (const [entryId, group] of byEntry) {
		const vocab = group.find((card) => card.kind === 'vocab') ?? null;
		const siblings = group.filter((card) => card.kind !== 'vocab');
		const base = bases?.get(entryId);
		const snapshot = vocab?.written ?? group.find((card) => card.written)?.written;
		// The live display form, unless the snapshot is a kana reading of the
		// entry (a starter deck's kana row): shownWritten, as on the card front.
		const written =
			base === undefined ? (snapshot ?? t('flashcards.deck.entryN', { id: entryId })) : shownWritten(base, snapshot);
		const schedule = vocab === null ? null : (index.get(vocab.id) ?? null);
		let nextDue: string | null = null;
		for (const card of group) {
			const due = index.get(card.id)?.due;
			if (due !== undefined && (nextDue === null || instant(due) < instant(nextDue))) nextDue = due;
		}
		const readings = (base?.readings ?? []).flatMap((r) => [r.value, r.plain]);
		rows.push({
			entryId,
			written,
			vocab,
			siblings,
			skipped: cleanSkipKinds(vocab?.skipKinds ?? []),
			state: classifySchedule(schedule),
			score: schedule === null ? 0 : cardScore(schedule.stability),
			nextDue,
			addedAt: (vocab ?? group[0]).createdAt,
			search: foldSearch([written, ...readings, String(entryId)].join(SEP))
		});
	}
	return rows.sort((a, b) => a.entryId - b.entryId);
}

export interface RowQuery {
	text: string;
	state: WordState | 'all';
	kind: StudyCardKind | 'all';
	dueNow: boolean;
	sort: 'added' | 'due' | 'state';
}

const STATE_ORDER = new Map(WORD_STATES.map(({ state }, i) => [state, i]));

function hasKind(row: DeckRow, kind: StudyCardKind): boolean {
	return kind === 'vocab' ? row.vocab !== null : row.siblings.some((card) => card.kind === kind);
}

/** filterRows applies a query and sorts; ties always break by entry id. */
export function filterRows(rows: readonly DeckRow[], q: RowQuery, now: Date): DeckRow[] {
	const needle = foldSearch(q.text.trim()).replaceAll(SEP, '');
	const nowMs = now.getTime();
	const kept = rows.filter(
		(row) =>
			(needle === '' || row.search.includes(needle)) &&
			(q.state === 'all' || row.state === q.state) &&
			(q.kind === 'all' || hasKind(row, q.kind)) &&
			(!q.dueNow || (row.nextDue !== null && instant(row.nextDue) <= nowMs))
	);
	const byId = (a: DeckRow, b: DeckRow) => a.entryId - b.entryId;
	switch (q.sort) {
		case 'due':
			return kept.sort((a, b) => {
				if (a.nextDue === null || b.nextDue === null) {
					return a.nextDue === b.nextDue ? byId(a, b) : a.nextDue === null ? 1 : -1;
				}
				return instant(a.nextDue) - instant(b.nextDue) || byId(a, b);
			});
		case 'state':
			return kept.sort(
				(a, b) => (STATE_ORDER.get(a.state) ?? 0) - (STATE_ORDER.get(b.state) ?? 0) || byId(a, b)
			);
		default:
			return kept.sort((a, b) => instant(a.addedAt) - instant(b.addedAt) || byId(a, b));
	}
}

/** Rows rendered per "page"; the rest waits behind "Show 100 more". */
export const PAGE_SIZE = 100;

export function visibleCount(total: number, pages: number): number {
	return Math.min(total, PAGE_SIZE * Math.max(1, pages));
}
