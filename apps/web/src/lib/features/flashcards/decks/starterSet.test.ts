import { describe, expect, it } from 'vitest';

import type { StarterSetEntry } from '$lib/api/starter';
import { starterSetDeckId } from '$lib/starter/starter';
import { planAddToDeck } from './addToDeck';
import { starterSetItems, starterSetTarget } from './starterSet';

const entry = (id: number, written: string, kind = 'word'): StarterSetEntry => ({
	id,
	language: 'ja',
	kind,
	written,
	readings: [],
	attrs: {},
	radicalId: null,
	gloss: '',
	pictureConcept: ''
});

describe('the Starter set deck', () => {
	it('has a fixed id per language and the set name', () => {
		expect(starterSetTarget({ language: 'ja', name: 'Starter words (Japanese)' })).toEqual({
			id: 'd-starter-ja',
			name: 'Starter words (Japanese)'
		});
		expect(starterSetDeckId('zh')).toBe('d-starter-zh');
		expect(starterSetDeckId('zh-Hant')).toBe('d-starter-zh');
	});

	it('lists the words in set order; a character entry has no companions', () => {
		expect(starterSetItems([entry(1, '犬'), entry(2, '水', 'character')])).toEqual([
			{ entryId: 1, written: '犬' },
			{ entryId: 2, written: '水', entryKind: 'character' }
		]);
	});

	it("passes the set's pinned reading on, and a new card keeps it (#346)", () => {
		const items = starterSetItems([{ ...entry(1, '猫'), reading: 'māo' }, { ...entry(2, '鸡'), reading: '' }]);
		expect(items).toEqual([
			{ entryId: 1, written: '猫', reading: 'māo' },
			{ entryId: 2, written: '鸡' }
		]);
		const target = starterSetTarget({ language: 'zh', name: 'Starter' });
		const plan = planAddToDeck({ items, target, existingDeck: null, rawCards: [], now: new Date('2026-03-01T09:00:00Z') });
		expect(plan.writes.map((c) => c.reading)).toEqual(['māo', undefined]);
	});

	it('adds in set order and a second run adds nothing', () => {
		const items = starterSetItems([entry(1, '犬'), entry(2, '猫')]);
		const target = starterSetTarget({ language: 'ja', name: 'Starter' });
		const now = new Date('2026-03-01T09:00:00Z');
		const first = planAddToDeck({ items, target, existingDeck: null, rawCards: [], now, settings: { newOrder: { by: 'added' }, exists: false } });
		expect(first.created).toBe(2);
		expect(first.deck?.id).toBe('d-starter-ja');
		expect(first.writes.map((c) => c.entryId)).toEqual([1, 2]);
		expect(first.writes[0].createdAt < first.writes[1].createdAt).toBe(true);
		expect(first.writes.every((c) => c.deckIds.includes('d-starter-ja'))).toBe(true);

		const second = planAddToDeck({
			items,
			target,
			existingDeck: first.deck,
			rawCards: first.writes,
			now,
			settings: { newOrder: { by: 'added' }, exists: true }
		});
		expect(second.writes).toEqual([]);
		expect(second.created + second.joined).toBe(0);
	});

	it('a word the learner already studies joins the deck with its history', () => {
		const items = starterSetItems([entry(1, '犬')]);
		const target = starterSetTarget({ language: 'ja', name: 'Starter' });
		const own = { id: 'c-vocab-1', kind: 'vocab' as const, entryId: 1, deckIds: ['general'], createdAt: '2026-01-01T00:00:00Z' };
		const plan = planAddToDeck({ items, target, existingDeck: null, rawCards: [own], now: new Date('2026-03-01T00:00:00Z') });
		expect(plan.created).toBe(0);
		expect(plan.joined).toBe(1);
		expect(plan.writes[0].id).toBe('c-vocab-1');
		expect(plan.writes[0].deckIds).toContain('d-starter-ja');
		expect(plan.writes[0].deckIds).toContain('general');
	});
});
