// The item keys of the measure-word and counter drills (#179; docs/contracts/counters/items.json): a noun drill's
// item is the noun's entry id, the readings drill's item `<counterId>:<number>` (`hon:3`, `hon:nan` for 何).

import type { StudyHistory } from '$lib/studycore/types';

export const MEASURE_WORDS_DRILL = 'measure-words';
export const COUNTERS_DRILL = 'counters';
export const READINGS_DRILL = 'counter-readings';

/** The number 何 in a reading item. */
export const WHAT = 'nan';

const ENTRY = /^[1-9][0-9]*$/;
const READING = /^([a-z][a-z0-9]*(?:-[a-z0-9]+)*):([1-9][0-9]?|nan)$/;

/** parseEntryItem: a noun drill's entry id, or null. */
export function parseEntryItem(item: string): number | null {
	if (!ENTRY.test(item)) return null;
	const id = Number(item);
	return Number.isSafeInteger(id) ? id : null;
}

/** parseReadingItem: a readings item's counter id and number, or null. */
export function parseReadingItem(item: string): { counter: string; number: string } | null {
	const m = READING.exec(item);
	if (m === null || m[1].length > 32) return null;
	return { counter: m[1], number: m[2] };
}

export function readingItem(counter: string, number: string): string {
	return `${counter}:${number}`;
}

/** validItem: whether `item` is an item of one of the three drills. */
export function validItem(drill: string, item: string): boolean {
	if (drill === MEASURE_WORDS_DRILL || drill === COUNTERS_DRILL) return parseEntryItem(item) !== null;
	if (drill === READINGS_DRILL) return parseReadingItem(item) !== null;
	return false;
}

/**
 * studiedNounIds: the entries of the workspace's cards that have a review, in the order of their first review. A
 * character card counts only where `characters` (Chinese: CC-CEDICT keeps a one-hanzi word, 书, as a character
 * entry); a Japanese kanji card is not a word.
 */
export function studiedNounIds(history: Pick<StudyHistory, 'cards' | 'reviews'>, characters: boolean): number[] {
	const entryOf = new Map(history.cards.filter((c) => characters || c.entryKind !== 'character').map((c) => [c.id, c.entryId]));
	const first = new Map<number, string>();
	for (const r of history.reviews) {
		const entry = entryOf.get(r.payload.cardId);
		if (entry === undefined) continue;
		const at = first.get(entry);
		if (at === undefined || r.ts < at) first.set(entry, r.ts);
	}
	return [...first.entries()].sort((a, b) => (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : a[0] - b[0])).map(([id]) => id);
}
