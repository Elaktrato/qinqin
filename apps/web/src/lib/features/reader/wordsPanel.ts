// The Words rail tab's view model (#68): texts, paging and the deck list.
// Pure; WordsPanel.svelte only renders it.
import { profileOf } from '$lib/languages/profiles';
import { GENERAL_DECK_ID } from '$lib/studycore/types';
import { familiarity, type KnownIndex } from '$lib/studycore/known';
import type { Deck } from '$lib/studycore/types';
import type { Coverage } from './coverage';
import type { AddWordsResult } from './wordActions';
import { t } from '$lib/i18n';
import { formatNumber, formatPercent } from '$lib/i18n/format';

export const PAGE_SIZE = 50;

const n = (x: number): string => formatNumber(x);

/** Word counts need dictionary segmentation (the language profile, #199). */
export function wordCountsSupported(lang: string): boolean {
	return profileOf(lang).segmentation === 'dictionary';
}

export function coverageText(c: Coverage, scope: 'chapter' | 'book'): string {
	if (c.percent === null) return scope === 'chapter' ? t('reader.words.noneChapter') : t('reader.words.noneBook');
	const percent = formatPercent(c.percent / 100);
	return scope === 'chapter' ? t('reader.words.coverageChapter', { percent }) : t('reader.words.coverageBook', { percent });
}

export function figuresText(c: Coverage): string {
	return t('reader.words.figures', {
		known: n(c.known),
		tokens: t('reader.words.tokens', { count: c.tokens }),
		fresh: t('reader.words.typesNew', { count: c.types.new }),
		learning: n(c.types.learning)
	});
}

export function unmatchedText(count: number): string | null {
	if (count === 0) return null;
	return t('reader.words.unmatched', { count });
}

export function countingText(done: number, total: number): string {
	return t('reader.words.counting', { done: n(done), total: n(total) });
}

export function bookProgressText(done: number, total: number): string {
	return t('reader.words.bookProgress', { done: n(done), total: n(total) });
}

export function buttonLabels(selected: number, allNew: number): { addSelected: string; addAll: string; know: string } {
	return {
		addSelected: t('reader.words.addSelected', { count: n(selected) }),
		addAll: t('reader.words.addAll', { count: n(allNew) }),
		know: t('reader.words.know', { count: n(selected) })
	};
}

export function addResultText(r: AddWordsResult, deck: string): string {
	const parts: string[] = [];
	if (r.created > 0) {
		parts.push(t('reader.words.added', { count: r.created, deck }));
		if (r.joined > 0) parts.push(t('reader.words.addedJoined', { count: r.joined }));
	} else if (r.joined > 0) {
		parts.push(t('reader.words.joined', { count: r.joined, deck }));
	} else {
		parts.push(t('reader.words.nothingNew', { deck }));
	}
	if (r.missing > 0) parts.push(t('reader.words.missing', { count: n(r.missing) }));
	return parts.join('; ');
}

export function markResultText(written: number): string {
	return written === 0 ? t('reader.words.alreadyKnown') : t('reader.words.marked', { count: written });
}

export function pageOf<T>(list: readonly T[], pages: number): { shown: T[]; more: boolean } {
	const end = Math.max(1, pages) * PAGE_SIZE;
	return { shown: list.slice(0, end), more: list.length > end };
}

export function deckOptions(decks: readonly Deck[]): { id: string; name: string }[] {
	const own = [...decks].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.id.localeCompare(b.id));
	return [{ id: GENERAL_DECK_ID, name: t('reader.words.general') }, ...own.map((d) => ({ id: d.id, name: d.name }))];
}

/** stateLineText: the popup's state line for an entry (shown with highlighting on). */
export function stateLineText(entryId: number, index: KnownIndex, threshold: number): string {
	const state = familiarity(entryId, index, threshold);
	if (state === 'new') return t('reader.state.new');
	if (state === 'learning') return t('reader.state.learning');
	if (index.marks.has(entryId)) return t('reader.state.marked');
	return t('reader.state.score', { score: index.scores.get(entryId) ?? 0 });
}
