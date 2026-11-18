import { describe, expect, it } from 'vitest';
import type { PluginInfo } from '$lib/api/types';
import { FLASHCARDS_ID, READER_ID } from '$lib/features';
import { webPlugins, type WebPlugin } from '$lib/plugins';
import { currentSection, frameSections, homeSection, iconOf } from './sections';

function state(id: string, order: number, enabled = true): PluginInfo {
	return { id, manifest: {}, enabled, order };
}
const ready = (list: PluginInfo[]) => ({ list, status: 'ready' as const });
const all = ready([
	state(FLASHCARDS_ID, 0),
	state(READER_ID, 0),
	state('qinqin-journal', 0),
	state('qinqin-grammar', 1)
]);

describe('frameSections', () => {
	it('shows only Search and Stats before the plugin states are ready (nothing switched off flashes in)', () => {
		for (const status of ['idle', 'loading', 'error'] as const) {
			expect(frameSections({ list: [], status }).map((s) => s.id)).toEqual(['search', 'stats']);
		}
	});

	it('Search first, then core features and plugin pages in the user order, Stats last', () => {
		const sections = frameSections(all);
		expect(sections.map((s) => s.id)).toEqual(['search', 'flashcards', 'reader', 'journal', 'grammar', 'stats']);
		expect(sections.map((s) => s.icon)).toEqual(['search', 'study', 'reader', 'journal', 'grammar', 'stats']);
		expect(sections.map((s) => s.label)).toEqual(['Search', 'Decks', 'Reader', 'Journal', 'Grammar', 'Stats']);
		expect(sections.map((s) => s.href)).toEqual(['/search', '/flashcards', '/reader', '/p/journal', '/p/grammar', '/stats']);
		const swapped = frameSections(ready([state('qinqin-journal', 3), state('qinqin-grammar', 1)]));
		expect(swapped.map((s) => s.id)).toEqual(['search', 'flashcards', 'reader', 'grammar', 'journal', 'stats']);
	});

	it('leaves out a switched-off feature and a disabled plugin', () => {
		const sections = frameSections(ready([state(READER_ID, 0, false), state('qinqin-journal', 0, false)]));
		expect(sections.map((s) => s.id)).toEqual(['search', 'flashcards', 'grammar', 'stats']);
	});

	it('a plugin page without an icon, or with one the app does not know, gets the generic icon', () => {
		const bare = (id: string, icon?: string): WebPlugin => ({
			manifest: { ...webPlugins[0].manifest, id, icon },
			pages: [{ title: id, nav: true, component: webPlugins[0].pages![0].component }]
		});
		const sections = frameSections(ready([]), [bare('x-none'), bare('x-odd', 'no-such-icon'), bare('x-ok', 'map')]);
		expect(sections.filter((s) => s.id.startsWith('x-')).map((s) => s.icon)).toEqual(['plugin', 'plugin', 'map']);
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
		expect(at('/p/journal')).toBe('journal');
		expect(at('/p/journal/2026-11-17')).toBe('journal');
		expect(at('/stats/week')).toBe('stats');
		expect(at('/entry/5')).toBe('search');
		expect(at('/lookups')).toBe('search');
		expect(at('/search/parts')).toBe('search');
	});

	it('pages of the account menu belong to no section; a prefix must end at a segment', () => {
		expect(at('/settings')).toBeNull();
		expect(at('/sources')).toBeNull();
		expect(at('/statsx')).toBeNull();
		expect(at('/p/journalx')).toBeNull();
	});

	it('a switched-off section is never current', () => {
		const without = frameSections(ready([state(FLASHCARDS_ID, 0, false)]));
		expect(currentSection('/study/session', without)).toBeNull();
	});
});
