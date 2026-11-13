import { describe, expect, it } from 'vitest';
import { iconFor, NAV_ICONS } from './navIcons';

describe('iconFor', () => {
	it('maps the shell links to their glyphs', () => {
		expect(iconFor('home')).toBe('home');
		expect(iconFor('search')).toBe('search');
		expect(iconFor('map')).toBe('map');
		expect(iconFor('sources')).toBe('books');
		expect(iconFor('settings')).toBe('gear');
		expect(iconFor('signout')).toBe('signout');
		expect(iconFor('Sign out')).toBe('signout');
	});

	it('maps known plugin slugs', () => {
		expect(iconFor('reader')).toBe('book');
		expect(iconFor('flashcards')).toBe('cards');
		expect(iconFor('study')).toBe('cards');
	});

	it('ignores case, surrounding space and the qinqin- pack prefix', () => {
		expect(iconFor('  READER ')).toBe('book');
		expect(iconFor('Study')).toBe('cards');
		expect(iconFor('qinqin-flashcards')).toBe('cards');
		expect(iconFor('Qinqin-Reader')).toBe('book');
	});

	it('falls back to the title when the slug is unknown', () => {
		expect(iconFor('x-42', 'Reader')).toBe('book');
		expect(iconFor('deck', 'Flashcards')).toBe('cards');
	});

	it('prefers the slug over the title', () => {
		expect(iconFor('reader', 'Study')).toBe('book');
	});

	it('gives unknown plugins the neutral glyph', () => {
		expect(iconFor('weather', 'Weather')).toBe('plugin');
		expect(iconFor('')).toBe('plugin');
		expect(iconFor('', '')).toBe('plugin');
		expect(iconFor('toString')).toBe('plugin');
		expect(iconFor('__proto__', 'constructor')).toBe('plugin');
	});

	it('only returns names that have a glyph', () => {
		for (const key of ['home', 'search', 'map', 'reader', 'study', 'sources', 'settings', 'signout', 'zzz']) {
			expect(NAV_ICONS).toContain(iconFor(key));
		}
	});
});
