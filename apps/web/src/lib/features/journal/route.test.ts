import { describe, expect, it } from 'vitest';
import { journalHref, newEntryHref, parseJournalRoute, type JournalRoute } from './route';

describe('parseJournalRoute', () => {
	it('maps each path', () => {
		expect(parseJournalRoute('')).toEqual({ view: 'list' });
		expect(parseJournalRoute('/')).toEqual({ view: 'list' });
		expect(parseJournalRoute('new')).toEqual({ view: 'new' });
		expect(parseJournalRoute('photo')).toEqual({ view: 'photo' });
		expect(parseJournalRoute('settings')).toEqual({ view: 'settings' });
		expect(parseJournalRoute('e/01ABC')).toEqual({ view: 'entry', id: '01ABC' });
		expect(parseJournalRoute('/e/01ABC/')).toEqual({ view: 'entry', id: '01ABC' });
		expect(parseJournalRoute('talk')).toEqual({ view: 'talk' });
		expect(parseJournalRoute('talk/c0123')).toEqual({ view: 'conversation', id: 'c0123' });
	});

	it('sends unknown paths to the list', () => {
		expect(parseJournalRoute('nope')).toEqual({ view: 'list' });
		expect(parseJournalRoute('e')).toEqual({ view: 'list' });
		expect(parseJournalRoute('e/')).toEqual({ view: 'list' });
		expect(parseJournalRoute('e/a/b')).toEqual({ view: 'list' });
		expect(parseJournalRoute('new/extra')).toEqual({ view: 'list' });
		expect(parseJournalRoute('talk/a/b')).toEqual({ view: 'list' });
	});
});

describe('journalHref', () => {
	it('round trips every route', () => {
		const routes: JournalRoute[] = [
			{ view: 'list' },
			{ view: 'new' },
			{ view: 'photo' },
			{ view: 'settings' },
			{ view: 'entry', id: '01ABC' },
			{ view: 'talk' },
			{ view: 'conversation', id: 'c1' }
		];
		for (const route of routes) {
			expect(parseJournalRoute(journalHref(route).replace(/^\/journal\/?/, ''))).toEqual(route);
		}
	});

	it('builds the URLs', () => {
		expect(journalHref({ view: 'list' })).toBe('/journal');
		expect(journalHref({ view: 'entry', id: 'x' })).toBe('/journal/e/x');
		expect(journalHref({ view: 'settings' })).toBe('/journal/settings');
		expect(journalHref({ view: 'talk' })).toBe('/journal/talk');
		expect(journalHref({ view: 'conversation', id: 'c1' })).toBe('/journal/talk/c1');
	});

	it('encodes an id', () => {
		expect(journalHref({ view: 'entry', id: 'a/b' })).toBe('/journal/e/a%2Fb');
		expect(parseJournalRoute('e/a%2Fb')).toEqual({ view: 'entry', id: 'a/b' });
	});
});

describe('newEntryHref', () => {
	it('adds an encoded title only when there is one', () => {
		expect(newEntryHref()).toBe('/journal/new');
		expect(newEntryHref('  ')).toBe('/journal/new');
		expect(newEntryHref('我的 一天&x')).toBe('/journal/new?title=%E6%88%91%E7%9A%84%20%E4%B8%80%E5%A4%A9%26x');
		expect(parseJournalRoute('new')).toEqual({ view: 'new' });
	});
});
