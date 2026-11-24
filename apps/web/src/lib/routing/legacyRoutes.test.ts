import { describe, expect, it } from 'vitest';
import { legacyRedirect } from './legacyRoutes';

describe('legacyRedirect', () => {
	it('sends the old map URL to Stats → Characters', () => {
		expect(legacyRedirect({ pathname: '/study/map', search: '', hash: '' })).toBe(
			'/stats/characters'
		);
		expect(legacyRedirect({ pathname: '/study/map/', search: '', hash: '' })).toBe(
			'/stats/characters'
		);
	});

	it('keeps the query and the fragment', () => {
		expect(legacyRedirect({ pathname: '/study/map', search: '?q=1', hash: '#top' })).toBe(
			'/stats/characters?q=1#top'
		);
	});

	it('sends the old plugin URLs of the core features to their core routes (v0.4.0)', () => {
		const at = (pathname: string, search = '', hash = '') => legacyRedirect({ pathname, search, hash });
		expect(at('/p/flashcards')).toBe('/flashcards');
		expect(at('/p/flashcards/')).toBe('/flashcards');
		expect(at('/p/flashcards/deck/d-1/settings', '?from=home', '#cards')).toBe('/flashcards/deck/d-1/settings?from=home#cards');
		expect(at('/p/reader')).toBe('/reader');
		expect(at('/p/reader/book/12/3', '', '#p-4')).toBe('/reader/book/12/3#p-4');
		// The sub-path is kept as it is (still encoded).
		expect(at('/p/flashcards/system/level/hsk-words/HSK%201')).toBe('/flashcards/system/level/hsk-words/HSK%201');
	});

	it('sends the old plugin URLs of the journal and grammar to their core routes (#199)', () => {
		const at = (pathname: string, search = '', hash = '') => legacyRedirect({ pathname, search, hash });
		expect(at('/p/journal')).toBe('/journal');
		expect(at('/p/journal/entry/e1', '?x=1', '#a')).toBe('/journal/entry/e1?x=1#a');
		expect(at('/p/grammar/lesson/p/l')).toBe('/grammar/lesson/p/l');
	});

	it('leaves lookalikes alone', () => {
		for (const path of ['/p/notes', '/p/journalx', '/p/flashcardsx', '/p/readers/x', '/flashcards', '/reader', '/journal']) {
			expect(legacyRedirect({ pathname: path, search: '', hash: '' }), path).toBeNull();
		}
	});

	it('leaves every other path alone', () => {
		expect(legacyRedirect({ pathname: '/study', search: '', hash: '' })).toBeNull();
		expect(legacyRedirect({ pathname: '/study/mapx', search: '', hash: '' })).toBeNull();
		expect(legacyRedirect({ pathname: '/stats/characters', search: '', hash: '' })).toBeNull();
	});
});
