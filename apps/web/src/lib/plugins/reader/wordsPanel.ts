// The Words rail tab's view model (#68): texts, paging and the deck list.
// Pure; WordsPanel.svelte only renders it.
import { GENERAL_DECK_ID } from '$lib/study/store';
import type { Deck } from '$lib/study/types';
import type { Coverage } from './coverage';
import type { AddWordsResult } from './wordActions';

export const PAGE_SIZE = 50;

const n = (x: number): string => x.toLocaleString('en-US');
const plural = (x: number, one: string, many: string): string => `${n(x)} ${x === 1 ? one : many}`;

export function wordCountsSupported(lang: string): boolean {
	return lang === 'zh' || lang === 'ja';
}

export function coverageText(c: Coverage, scope: 'chapter' | 'book'): string {
	const where = scope === 'chapter' ? 'this chapter' : 'this book';
	return c.percent === null ? `No words to count in ${where}` : `You know ${c.percent}% of the words in ${where}`;
}

export function figuresText(c: Coverage): string {
	return `${n(c.known)} of ${plural(c.tokens, 'word', 'words')} · ${plural(c.types.new, 'different new word', 'different new words')} · ${n(c.types.learning)} learning`;
}

export function unmatchedText(count: number): string | null {
	if (count === 0) return null;
	return count === 1 ? '1 passage is not in the dictionary' : `${n(count)} passages are not in the dictionary`;
}

export function countingText(done: number, total: number): string {
	return `Counting… ${n(done)} of ${n(total)} parts`;
}

export function bookProgressText(done: number, total: number): string {
	return `Chapter ${n(done)} of ${n(total)}`;
}

export function buttonLabels(selected: number, allNew: number): { addSelected: string; addAll: string; know: string } {
	return { addSelected: `Add selected (${n(selected)})`, addAll: `Add all new words (${n(allNew)})`, know: `I know these (${n(selected)})` };
}

export function addResultText(r: AddWordsResult, deck: string): string {
	const parts: string[] = [];
	if (r.created > 0) {
		parts.push(`Added ${plural(r.created, 'word', 'words')} to ${deck}`);
		if (r.joined > 0) parts.push(`${n(r.joined)} already had ${r.joined === 1 ? 'a card' : 'cards'} and joined it`);
	} else if (r.joined > 0) {
		parts.push(`${plural(r.joined, 'word', 'words')} already had ${r.joined === 1 ? 'a card' : 'cards'} and joined ${deck}`);
	} else {
		parts.push(`Nothing new to add to ${deck}`);
	}
	if (r.missing > 0) parts.push(`${n(r.missing)} could not be found`);
	return parts.join('; ');
}

export function markResultText(written: number): string {
	return written === 0 ? 'These words were already marked as known' : `Marked ${plural(written, 'word', 'words')} as known`;
}

export function pageOf<T>(list: readonly T[], pages: number): { shown: T[]; more: boolean } {
	const end = Math.max(1, pages) * PAGE_SIZE;
	return { shown: list.slice(0, end), more: list.length > end };
}

export function deckOptions(decks: readonly Deck[]): { id: string; name: string }[] {
	const own = [...decks].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.id.localeCompare(b.id));
	return [{ id: GENERAL_DECK_ID, name: 'General' }, ...own.map((d) => ({ id: d.id, name: d.name }))];
}
