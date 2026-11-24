import { describe, expect, it } from 'vitest';
import { flashcardsHref, flashcardsTitle, parseDecodedFlashcardsRoute, parseFlashcardsRoute, type FlashcardsRoute } from './route';

const ROUTES: FlashcardsRoute[] = [
	{ view: 'list' },
	{ view: 'deck', deckId: 'general' },
	{ view: 'deck', deckId: '01JABC' },
	{ view: 'settings', deckId: 'd-lvl-hsk-words-b06fd2ac' },
	{ view: 'system-level', packId: 'hsk-words', level: 'HSK 7–9' },
	{ view: 'system-level', packId: 'tgh-chars', level: '一级' },
	{ view: 'system-level', packId: 'x', level: 'a/b %' },
	{ view: 'system-frequency', packId: 'jiten-frequency', size: 500 },
	{ view: 'system-frequency', packId: 'My Pack/ü', size: 2000 }
];

describe('flashcards route', () => {
	for (const route of ROUTES) {
		it(`round-trips ${JSON.stringify(route)}`, () => {
			const href = flashcardsHref(route);
			expect(href.startsWith('/flashcards')).toBe(true);
			expect(parseFlashcardsRoute(href.slice('/flashcards'.length).replace(/^\//, ''))).toEqual(route);
		});
	}

	it('routes the empty and unknown paths to the list', () => {
		expect(parseFlashcardsRoute('')).toEqual({ view: 'list' });
		expect(parseFlashcardsRoute('/')).toEqual({ view: 'list' });
		expect(parseFlashcardsRoute('nope')).toEqual({ view: 'list' });
		expect(parseFlashcardsRoute('deck')).toEqual({ view: 'list' });
		// The plugin decks went with the code plugins (#199).
		expect(parseFlashcardsRoute('system/plugin/starter/k')).toEqual({ view: 'list' });
		expect(parseFlashcardsRoute('deck/a/b/c')).toEqual({ view: 'list' });
		expect(parseFlashcardsRoute('system/level/only-pack')).toEqual({ view: 'list' });
	});

	it('reads starter decks of the three sizes only', () => {
		expect(parseFlashcardsRoute('system/frequency/jiten-frequency/1000')).toEqual({
			view: 'system-frequency',
			packId: 'jiten-frequency',
			size: 1000
		});
		expect(parseFlashcardsRoute('system/frequency/jiten-frequency/3')).toEqual({ view: 'list' });
		expect(parseFlashcardsRoute('system/frequency/jiten-frequency/500x')).toEqual({ view: 'list' });
		expect(parseFlashcardsRoute('system/frequency/jiten-frequency')).toEqual({ view: 'list' });
	});

	it('treats a malformed escape as the list', () => {
		expect(parseFlashcardsRoute('deck/%E0')).toEqual({ view: 'list' });
		expect(parseFlashcardsRoute('system/level/p/%E0%A4')).toEqual({ view: 'list' });
	});

	it('encodes each segment', () => {
		expect(flashcardsHref({ view: 'system-level', packId: 'hsk-words', level: 'HSK 7–9' })).toBe(
			'/flashcards/system/level/hsk-words/HSK%207%E2%80%939'
		);
		expect(flashcardsHref({ view: 'list' })).toBe('/flashcards');
	});
});

describe('parseDecodedFlashcardsRoute', () => {
	// SvelteKit hands the page a rest parameter that is already decoded.
	it('reads a decoded rest without decoding it twice', () => {
		expect(parseDecodedFlashcardsRoute('system/level/hsk-words/N5 100%')).toEqual({
			view: 'system-level',
			packId: 'hsk-words',
			level: 'N5 100%'
		});
		expect(parseDecodedFlashcardsRoute('system/level/hsk-words/HSK 7–9')).toEqual({
			view: 'system-level',
			packId: 'hsk-words',
			level: 'HSK 7–9'
		});
		expect(parseDecodedFlashcardsRoute('deck/01JABC/settings')).toEqual({ view: 'settings', deckId: '01JABC' });
		expect(parseDecodedFlashcardsRoute('')).toEqual({ view: 'list' });
	});
});

describe('flashcardsTitle', () => {
	it('names every view, most specific first', () => {
		expect(flashcardsTitle({ view: 'list' })).toEqual(['Decks', 'Flashcards']);
		expect(flashcardsTitle({ view: 'deck', deckId: 'general' })).toEqual(['Deck', 'Flashcards']);
		expect(flashcardsTitle({ view: 'settings', deckId: 'general' })).toEqual(['Deck settings', 'Flashcards']);
		expect(flashcardsTitle({ view: 'system-level', packId: 'hsk', level: '1' })).toEqual(['Level deck', 'Flashcards']);
		expect(flashcardsTitle({ view: 'system-frequency', packId: 'f', size: 500 })).toEqual(['Starter deck', 'Flashcards']);
	});
});
