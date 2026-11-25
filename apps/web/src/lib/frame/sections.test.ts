import { describe, expect, it } from 'vitest';
import { FLASHCARDS_ID, GRAMMAR_ID, JOURNAL_ID, READER_ID } from '$lib/features';
import type { FeatureSwitch } from '$lib/features/switches.svelte';
import { currentSection, frameSections, homeSection, iconOf } from './sections';

function state(id: string, enabled = true): FeatureSwitch {
	return { id, enabled };
}
const ready = (list: FeatureSwitch[]) => ({ list, status: 'ready' as const });
const all = ready([state(FLASHCARDS_ID), state(READER_ID), state(JOURNAL_ID), state(GRAMMAR_ID)]);

describe('frameSections', () => {
	it('shows only Search and Stats before the switches are ready (nothing switched off flashes in)', () => {
		for (const status of ['idle', 'loading', 'error'] as const) {
			expect(frameSections({ list: [], status }).map((s) => s.id)).toEqual(['search', 'stats']);
		}
	});

	it('Search first, then the core features in their fixed order, Stats last', () => {
		const sections = frameSections(all);
		expect(sections.map((s) => s.id)).toEqual(['search', 'flashcards', 'reader', 'journal', 'grammar', 'stats']);
		expect(sections.map((s) => s.icon)).toEqual(['search', 'study', 'reader', 'journal', 'grammar', 'stats']);
		expect(sections.map((s) => s.label)).toEqual(['Search', 'Decks', 'Reader', 'Journal', 'Grammar', 'Stats']);
		expect(sections.map((s) => s.href)).toEqual(['/search', '/flashcards', '/reader', '/journal', '/grammar', '/stats']);
		// A feature without a switch row is on.
		expect(frameSections(ready([])).map((s) => s.id)).toEqual(sections.map((s) => s.id));
	});

	it('leaves out a switched-off feature', () => {
		const sections = frameSections(ready([state(READER_ID, false), state(JOURNAL_ID, false)]));
		expect(sections.map((s) => s.id)).toEqual(['search', 'flashcards', 'grammar', 'stats']);
	});

	it('every id is unique', () => {
		const ids = [homeSection(), ...frameSections(all)].map((s) => s.id);
		expect(new Set(ids).size).toBe(ids.length);
	});
});

describe('iconOf', () => {
	it('maps a known name to itself and anything else to plugin', () => {
		expect(iconOf('journal')).toBe('journal');
		expect(iconOf('Journal')).toBe('plugin');
		expect(iconOf(undefined)).toBe('plugin');
		expect(iconOf('constructor')).toBe('plugin');
	});
});

describe('homeSection', () => {
	it('is Home at / with the home icon', () => {
		expect(homeSection()).toEqual(expect.objectContaining({ id: 'home', label: 'Home', href: '/', icon: 'home' }));
	});
});

describe('currentSection', () => {
	const sections = frameSections(all);
	const at = (path: string) => currentSection(path, sections);

	it('/ is Home only', () => {
		expect(at('/')).toBe('home');
	});

	it('nested routes belong to their section', () => {
		expect(at('/flashcards')).toBe('flashcards');
		expect(at('/flashcards/decks/3')).toBe('flashcards');
		expect(at('/study/session')).toBe('flashcards');
		expect(at('/study')).toBe('flashcards');
		expect(at('/reader/12')).toBe('reader');
		expect(at('/journal')).toBe('journal');
		expect(at('/journal/2026-11-17')).toBe('journal');
		expect(at('/stats/week')).toBe('stats');
		expect(at('/entry/5')).toBe('search');
		expect(at('/lookups')).toBe('search');
		expect(at('/search/parts')).toBe('search');
	});

	it('pages of the account menu belong to no section; a prefix must end at a segment', () => {
		expect(at('/settings')).toBeNull();
		expect(at('/sources')).toBeNull();
		expect(at('/statsx')).toBeNull();
		expect(at('/journalx')).toBeNull();
	});

	it('a switched-off section is never current', () => {
		const without = frameSections(ready([state(FLASHCARDS_ID, false)]));
		expect(currentSection('/study/session', without)).toBeNull();
	});
});
