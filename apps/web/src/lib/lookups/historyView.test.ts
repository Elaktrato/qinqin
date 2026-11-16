import { describe, expect, it } from 'vitest';
import type { EntryBase } from '$lib/api/types';
import { parseLookups, type LookupItem } from './lookups';
import { PAGE_SIZE, addResultText, dayLabel, deckOptions, historyRows, stateLabel, whereText } from './historyView';

const item = (entryId: number, over: Partial<LookupItem> = {}): LookupItem => ({
	entryId,
	count: 1,
	firstAt: '2026-11-01T09:00:00Z',
	lastAt: '2026-11-03T09:00:00Z',
	sources: { reader: 1 },
	books: [],
	...over
});
const base = (id: number, written: string, reading = ''): EntryBase =>
	({ id, language: 'zh', kind: 'word', written, readings: reading ? [{ type: 'pinyin', value: reading, plain: reading }] : [], attrs: {}, radicalId: null }) as unknown as EntryBase;
const books = new Map([
	[17, '三体'],
	[4, '活着']
]);

describe('whereText', () => {
	it('names books, then lessons and search', () => {
		expect(whereText(item(1, { books: [17, 4], sources: { reader: 3, lesson: 1, search: 2 } }), books)).toBe('《三体》, 《活着》, lessons, search');
	});
	it('a book the library no longer has reads "a removed book", once', () => {
		expect(whereText(item(1, { books: [99, 17, 98] }), books)).toBe('a removed book, 《三体》');
	});
	it('reader lookups without a book say reader; unknown sources say nothing', () => {
		expect(whereText(item(1, { books: [], sources: { reader: 2 } }), books)).toBe('reader');
		expect(whereText(item(1, { books: [], sources: { android: 2 } }), books)).toBe('');
		expect(whereText(item(1, { books: [], sources: { search: 1, lesson: 0 } }), books)).toBe('search');
	});
});

describe('dayLabel', () => {
	it('day and month, the year only when it is not this year', () => {
		expect(dayLabel('2026-11-03', '2026-11-16')).toBe('3 Nov');
		expect(dayLabel('2025-12-31', '2026-11-16')).toBe('31 Dec 2025');
	});
});

describe('historyRows', () => {
	const h = parseLookups({
		version: 1,
		clearedAt: null,
		items: [item(1, { lastAt: '2026-11-05T09:00:00Z', count: 4, books: [17] }), item(2, { lastAt: '2026-11-04T23:30:00Z' }), item(3), item(4)]
	});
	const bases = new Map([
		[1, base(1, '马', 'mǎ')],
		[2, base(2, '书')],
		[4, base(4, '活')]
	]);
	const stateOf = (id: number): 'new' | 'learning' | 'known' => (id === 2 ? 'learning' : id === 4 ? 'known' : 'new');
	// The learner's day of an instant: a fixed +02:00 zone.
	const dayOf = (iso: string) => new Date(Date.parse(iso) + 2 * 3600_000).toISOString().slice(0, 10);

	it('keeps the newest-first order and fills each row', () => {
		const rows = historyRows(h, bases, books, stateOf, dayOf, 'all');
		expect(rows.map((r) => r.entryId)).toEqual([1, 2, 3, 4]);
		expect(rows[0]).toEqual({ entryId: 1, written: '马', reading: 'mǎ', count: 4, lastDay: '2026-11-05', where: '《三体》', state: 'new', missing: false });
		expect(rows[1].lastDay).toBe('2026-11-05');
		expect(rows[2]).toMatchObject({ entryId: 3, written: null, missing: true });
	});

	it('leaves the reading empty when the word is shown as that reading (こと)', () => {
		const koto = { ...base(9, 'こと', 'こと'), language: 'ja' } as EntryBase;
		const one = { ...h, items: [{ ...h.items[0], entryId: 9 }] };
		const [row] = historyRows(one, new Map([[9, koto]]), books, stateOf, dayOf, 'all');
		expect(row.reading).toBe('');
	});

	it('filter "No card yet" keeps new words that are still in the dictionary', () => {
		expect(historyRows(h, bases, books, stateOf, dayOf, 'nocard').map((r) => r.entryId)).toEqual([1]);
	});
});

describe('labels', () => {
	it('state chips have text', () => {
		expect(stateLabel('new')).toBe('No card');
		expect(stateLabel('learning')).toBe('In study');
		expect(stateLabel('known')).toBe('Known');
	});
	it('the add result names created and joined counts', () => {
		expect(addResultText({ created: 2, joined: 1, skipped: 0, missing: 0 }, 'General')).toBe('Added 2 new cards to General; 1 word joined the deck.');
		expect(addResultText({ created: 1, joined: 0, skipped: 0, missing: 0 }, 'HSK')).toBe('Added 1 new card to HSK.');
		expect(addResultText({ created: 0, joined: 0, skipped: 2, missing: 0 }, 'HSK')).toBe('Nothing to add: these words are already in HSK.');
		expect(addResultText({ created: 0, joined: 0, skipped: 0, missing: 1 }, 'HSK')).toBe('Nothing to add. 1 word is not in the dictionary any more.');
	});
	it('decks: General first, then by createdAt', () => {
		expect(
			deckOptions([
				{ id: 'b', name: 'B', createdAt: '2026-11-02T00:00:00Z' },
				{ id: 'a', name: 'A', createdAt: '2026-11-01T00:00:00Z' }
			]).map((d) => d.id)
		).toEqual(['general', 'a', 'b']);
	});
	it('pages hold 50 rows', () => {
		expect(PAGE_SIZE).toBe(50);
	});
});
