import { describe, expect, it } from 'vitest';
import { rangeIds, toggleId, wordsOfCards } from './cardSelection';
import type { StudyCard } from './types';

describe('cardSelection', () => {
	it('toggles an id in and out without mutating', () => {
		const start = ['a'];
		expect(toggleId(start, 'b')).toEqual(['a', 'b']);
		expect(toggleId(['a', 'b'], 'a')).toEqual(['b']);
		expect(start).toEqual(['a']);
	});

	it('selects the inclusive range between two ids in either direction', () => {
		const order = ['a', 'b', 'c', 'd'];
		expect(rangeIds(order, 'b', 'd')).toEqual(['b', 'c', 'd']);
		expect(rangeIds(order, 'd', 'b')).toEqual(['b', 'c', 'd']);
		expect(rangeIds(order, 'zz', 'b')).toEqual(['b']);
	});

	it('lists one row per word: vocab cards only, oldest first', () => {
		const make = (id: string, kind: StudyCard['kind'], at: string): StudyCard => ({
			id,
			kind,
			entryId: 1,
			deckIds: ['general'],
			createdAt: at
		});
		const rows = wordsOfCards([
			make('w', 'writing', '2026-01-01T00:00:00Z'),
			make('v2', 'vocab', '2026-01-03T00:00:00Z'),
			make('v1', 'vocab', '2026-01-02T00:00:00Z')
		]);
		expect(rows.map((card) => card.id)).toEqual(['v1', 'v2']);
	});
});
