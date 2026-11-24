import { describe, expect, it } from 'vitest';
import type { Coverage } from './coverage';
import {
	PAGE_SIZE,
	addResultText,
	buttonLabels,
	countingText,
	coverageText,
	deckOptions,
	figuresText,
	markResultText,
	pageOf,
	stateLineText,
	unmatchedText,
	wordCountsSupported
} from './wordsPanel';

const cov = (o: Partial<Coverage>): Coverage => ({
	tokens: 1420,
	known: 1234,
	learning: 20,
	new: 166,
	types: { new: 46, learning: 12 },
	unmatched: 3,
	percent: 86,
	...o
});

describe('words panel texts', () => {
	it('coverage sentence per scope, and no tokens', () => {
		expect(coverageText(cov({ percent: 87 }), 'chapter')).toBe('You know 87% of the words in this chapter');
		expect(coverageText(cov({ percent: 82 }), 'book')).toBe('You know 82% of the words in this book');
		expect(coverageText(cov({ percent: null, tokens: 0 }), 'chapter')).toBe('No words to count in this chapter');
	});
	it('figures with grouped numbers', () => {
		expect(figuresText(cov({}))).toBe('1,234 of 1,420 words · 46 different new words · 12 learning');
		expect(figuresText(cov({ known: 1, tokens: 1, types: { new: 1, learning: 0 } }))).toBe('1 of 1 word · 1 different new word · 0 learning');
	});
	it('unmatched passages', () => {
		expect(unmatchedText(0)).toBeNull();
		expect(unmatchedText(1)).toBe('1 passage is not in the dictionary');
		expect(unmatchedText(3)).toBe('3 passages are not in the dictionary');
	});
	it('counting progress', () => {
		expect(countingText(5, 12)).toBe('Counting… 5 of 12 parts');
	});
	it('button labels with counts', () => {
		expect(buttonLabels(3, 40)).toEqual({ addSelected: 'Add selected (3)', addAll: 'Add all new words (40)', know: 'I know these (3)' });
	});
	it('add result lines', () => {
		expect(addResultText({ created: 40, joined: 3, skipped: 0, missing: 0 }, 'General')).toBe('Added 40 words to General; 3 already had cards and joined it');
		expect(addResultText({ created: 1, joined: 0, skipped: 2, missing: 0 }, 'Reading')).toBe('Added 1 word to Reading');
		expect(addResultText({ created: 0, joined: 1, skipped: 0, missing: 0 }, 'Reading')).toBe('1 word already had a card and joined Reading');
		expect(addResultText({ created: 0, joined: 0, skipped: 2, missing: 0 }, 'Reading')).toBe('Nothing new to add to Reading');
		expect(addResultText({ created: 1, joined: 0, skipped: 0, missing: 2 }, 'Reading')).toBe('Added 1 word to Reading; 2 could not be found');
	});
	it('mark result line', () => {
		expect(markResultText(1)).toBe('Marked 1 word as known');
		expect(markResultText(5)).toBe('Marked 5 words as known');
		expect(markResultText(0)).toBe('These words were already marked as known');
	});
	it('only zh and ja are counted', () => {
		expect(wordCountsSupported('zh')).toBe(true);
		expect(wordCountsSupported('ja')).toBe(true);
		expect(wordCountsSupported('ko')).toBe(false);
		// From the language profile's segmentation (#199): regional tags count, spaced languages do not.
		expect(wordCountsSupported('zh-TW')).toBe(true);
		expect(wordCountsSupported('es')).toBe(false);
	});
});

describe('list paging and decks', () => {
	it('pages by 50', () => {
		const list = Array.from({ length: 120 }, (_, i) => i);
		expect(PAGE_SIZE).toBe(50);
		expect(pageOf(list, 1)).toEqual({ shown: list.slice(0, 50), more: true });
		expect(pageOf(list, 3)).toEqual({ shown: list, more: false });
	});
	it('General first, then decks by createdAt', () => {
		const decks = [
			{ id: 'b', name: 'B', createdAt: '2026-02-01T00:00:00Z' },
			{ id: 'a', name: 'A', createdAt: '2026-01-01T00:00:00Z' }
		];
		expect(deckOptions(decks).map((d) => d.id)).toEqual(['general', 'a', 'b']);
	});
});

describe('stateLineText (the popup state line)', () => {
	const index = { scores: new Map([[1, 85], [2, 40]]), carded: new Set([1, 2]), marks: new Set([3, 1]) };
	it('names the state and why a word is known', () => {
		expect(stateLineText(9, index, 80)).toBe('New word');
		expect(stateLineText(2, index, 80)).toBe('Learning');
		expect(stateLineText(2, index, 40)).toBe('Known — memory score 40');
		expect(stateLineText(3, index, 80)).toBe('Known — marked by you');
		expect(stateLineText(1, index, 80)).toBe('Known — marked by you');
		expect(stateLineText(1, { ...index, marks: new Set() }, 80)).toBe('Known — memory score 85');
	});
});
