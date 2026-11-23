import { describe, expect, it } from 'vitest';

import fixture from '../../../../../../../docs/contracts/decks/add-to-deck.json';
import type { Deck, StudyCard } from '$lib/study/types';
import { addPlanRows, planAddToDeck, type AddPlan } from './addToDeck';
import { cardRow, identityOf, parseRow, studyKey } from '$lib/study/rows';
import type { StudyWrite } from '$lib/study/store';

const keyOf = (w: StudyWrite) => studyKey(w.collection, identityOf(w.collection, w.row));

interface Case {
	name: string;
	now: string;
	items: { entryId: number; written: string; entryKind?: 'character' }[];
	target: { id: string; name: string; source?: Deck['source'] };
	existingDeck: Deck | null;
	rawCards: StudyCard[];
	unreadable?: string[];
	settings?: { newOrder: { by: 'frequency' }; exists: boolean };
	expected: { deck: Deck | null; writes: StudyCard[]; created: number; joined: number; skipped: number; unreadable?: number };
}

const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;

/** A fresh ULID id (docs: the placeholder <ulid>) compares as the placeholder. */
function masked(plan: AddPlan): AddPlan {
	return { ...plan, writes: plan.writes.map((w) => (ULID.test(w.id) ? { ...w, id: '<ulid>' } : w)) };
}

const cases = fixture.cases as unknown as Case[];

describe('add to deck contract', () => {
	for (const c of cases) {
		it(c.name, () => {
			const input = structuredClone(c);
			const plan = planAddToDeck({
				items: input.items,
				target: input.target,
				existingDeck: input.existingDeck,
				rawCards: input.rawCards,
				now: new Date(input.now),
				...(input.unreadable === undefined ? {} : { unreadable: new Set(input.unreadable) }),
				...(input.settings === undefined ? {} : { settings: input.settings })
			});
			expect(masked(plan)).toEqual(c.expected);
			// The planned rows never name a row this version cannot read.
			expect(() => addPlanRows(plan, { unreadable: new Set(c.unreadable ?? []) })).not.toThrow();
			// Planning never changes its input.
			expect(input).toEqual(c);
			// Two devices planning from the same input write identical rows.
			const again = planAddToDeck({
				items: c.items,
				target: c.target,
				existingDeck: c.existingDeck,
				rawCards: c.rawCards,
				now: new Date(c.now),
				...(c.unreadable === undefined ? {} : { unreadable: new Set(c.unreadable) }),
				...(c.settings === undefined ? {} : { settings: c.settings })
			});
			expect(masked(again)).toEqual(masked(plan));
		});
	}
});

describe('add to deck idempotence', () => {
	const target = { id: 'd-lvl-x-00000000', name: 'X · L1', source: { type: 'level' as const, packId: 'x', level: 'L1' } };
	const items = [1, 2, 3].map((entryId) => ({ entryId, written: `w${entryId}` }));
	const now = new Date('2026-03-10T12:00:00.000Z');

	function apply(plan: AddPlan, decks: Deck | null, raw: StudyCard[]): { deck: Deck | null; cards: StudyCard[] } {
		const cards = [...raw];
		for (const w of plan.writes) {
			const i = cards.findIndex((c) => c.id === w.id);
			if (i >= 0) cards[i] = w;
			else cards.push(w);
		}
		return { deck: plan.deck ?? decks, cards };
	}

	it('adding the same level twice writes nothing the second time', () => {
		const first = planAddToDeck({ items, target, existingDeck: null, rawCards: [], now });
		expect(first.created).toBe(3);
		const state = apply(first, null, []);
		const second = planAddToDeck({
			items,
			target,
			existingDeck: state.deck,
			rawCards: state.cards,
			now: new Date('2026-03-12T09:00:00.000Z')
		});
		expect(second).toEqual({ deck: null, writes: [], created: 0, joined: 0, skipped: 3 });
	});

	it('a joined word is skipped on the next add', () => {
		const raw: StudyCard[] = [{ id: 'c-vocab-1', kind: 'vocab', entryId: 1, deckIds: ['general'], createdAt: '2026-01-01T00:00:00.000Z' }];
		const first = planAddToDeck({ items: [items[0]], target, existingDeck: null, rawCards: raw, now });
		const state = apply(first, null, raw);
		const second = planAddToDeck({ items: [items[0]], target, existingDeck: state.deck, rawCards: state.cards, now });
		expect(second.writes).toEqual([]);
		expect(second.skipped).toBe(1);
	});

	it('a deleted word is recreated under its old id, so its history comes back', () => {
		const plan = planAddToDeck({ items: [items[0]], target, existingDeck: null, rawCards: [], now });
		expect(plan.writes[0].id).toBe('c-vocab-1');
	});
});

describe('addPlanRows', () => {
	it('puts the deck row first, then the cards', () => {
		const plan = planAddToDeck({
			items: [{ entryId: 1, written: 'a' }],
			target: { id: 'd1', name: 'D' },
			existingDeck: null,
			rawCards: [],
			now: new Date('2026-03-10T12:00:00.000Z')
		});
		expect(addPlanRows(plan).map(keyOf)).toEqual(['decks:d1', 'cards:c-vocab-1']);
		expect(addPlanRows({ ...plan, deck: null }).map(keyOf)).toEqual(['cards:c-vocab-1']);
		// Typed rows only, never a plugin-data row.
		expect(addPlanRows(plan)[1]).toMatchObject({ collection: 'cards', row: { id: 'c-vocab-1', entryId: 1, written: 'a', extra: {} } });
	});

	it('stamps after the stored row and echoes its extra (a joined card keeps a newer client member)', () => {
		const card = { id: 'c-vocab-1', kind: 'vocab' as const, entryId: 1, deckIds: ['general'], createdAt: '2026-01-01T00:00:00Z' };
		const plan = planAddToDeck({
			items: [{ entryId: 1, written: 'a' }],
			target: { id: 'd1', name: 'D' },
			existingDeck: { id: 'd1', name: 'D', createdAt: 'x' },
			rawCards: [card],
			now: new Date('2026-03-10T12:00:00.000Z')
		});
		const stored = parseRow('cards', {
			...cardRow(card, { color: 'red' }),
			workspaceId: 7,
			version: 2,
			updatedAt: '2026-03-10T12:00:05Z',
			deletedAt: null
		})!;
		const writes = addPlanRows(plan, {
			knownAt: new Map([['cards:c-vocab-1', '2026-03-10T12:00:05Z']]),
			stored: new Map([['cards:c-vocab-1', stored]])
		});
		expect(writes).toEqual([
			{
				collection: 'cards',
				row: { ...cardRow({ ...card, deckIds: ['general', 'd1'] }), extra: { color: 'red' } },
				knownAt: '2026-03-10T12:00:05Z'
			}
		]);
	});
});

describe('add with known words skipped and a deck setting (#75)', () => {
	const target = {
		id: 'd-frq-jiten-frequency-d4514a31',
		name: 'Jiten · Top 500',
		source: { type: 'frequency' as const, packId: 'jiten-frequency', size: 500 }
	};
	const items = [1, 2, 3, 4].map((entryId) => ({ entryId, written: `w${entryId}` }));
	const now = new Date('2026-11-16T12:00:00.000Z');
	const settings = { newOrder: { by: 'frequency' as const }, exists: false };

	it('leaves known entries out, counts them, and writes the deck setting', () => {
		const plan = planAddToDeck({ items, target, existingDeck: null, rawCards: [], now, exclude: new Set([2]), settings });
		expect(plan.writes.map((c) => c.entryId)).toEqual([1, 3, 4]);
		expect(plan.writes.map((c) => c.createdAt)).toEqual([
			'2026-11-16T12:00:00.000Z',
			'2026-11-16T12:00:00.001Z',
			'2026-11-16T12:00:00.002Z'
		]);
		expect(plan.known).toBe(1);
		expect(plan.created).toBe(3);
		expect(plan.settings).toEqual({
			deckId: target.id,
			cardTypes: [],
			newOrder: { by: 'frequency' },
			extra: {}
		});
		const rows = addPlanRows(plan);
		expect(rows.map(keyOf)).toEqual([
			`decks:${target.id}`,
			`deckSettings:${target.id}`,
			'cards:c-vocab-1',
			'cards:c-vocab-3',
			'cards:c-vocab-4'
		]);
		expect(rows[1]!.row).toEqual({ deckId: target.id, cardTypes: [], newOrder: { by: 'frequency' }, extra: {} });
	});

	it('writes no deck setting when a live one exists, and a re-add writes nothing', () => {
		const first = planAddToDeck({ items, target, existingDeck: null, rawCards: [], now, exclude: new Set([2]), settings });
		const again = planAddToDeck({
			items,
			target,
			existingDeck: first.deck,
			rawCards: first.writes,
			now,
			exclude: new Set([2]),
			settings: { ...settings, exists: true }
		});
		expect(again.writes).toEqual([]);
		expect(again.deck).toBeNull();
		expect(again.settings).toBeUndefined();
		expect(again.known).toBe(1);
		expect(again.skipped).toBe(3);
		expect(addPlanRows(again)).toEqual([]);
	});
});
