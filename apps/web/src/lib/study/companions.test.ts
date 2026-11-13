import { describe, expect, it } from 'vitest';

import { COMPANION_PREFIX, isCompanionId, planCompanions } from './companions';
import type { StudyCard, StudyCardKind } from './types';

function card(
	id: string,
	kind: StudyCardKind,
	entryId: number,
	opts: { deckIds?: string[]; createdAt?: string; written?: string | null } = {}
): StudyCard {
	const result: StudyCard = {
		id,
		kind,
		entryId,
		deckIds: opts.deckIds ?? ['general'],
		createdAt: opts.createdAt ?? '2026-01-01T00:00:00.000Z'
	};
	if (opts.written !== null) result.written = opts.written ?? `w${entryId}`;
	return result;
}

describe('planCompanions', () => {
	const cards = [
		card('a', 'vocab', 1, { createdAt: '2026-01-01T00:00:00.000Z' }),
		card('b', 'vocab', 2, { createdAt: '2026-01-02T00:00:00.000Z' }),
		card('c', 'vocab', 3, { createdAt: '2026-01-03T00:00:00.000Z' })
	];
	const base = {
		cards,
		kinds: ['sentence'] as StudyCardKind[],
		deckIds: ['general'],
		newBudget: 10
	};

	it('plans one virtual item per vocab card, ordered by createdAt', () => {
		const items = planCompanions({ ...base, cards: [...cards].reverse() });
		expect(items.map((i) => i.cardId)).toEqual([
			'companion:sentence:1',
			'companion:sentence:2',
			'companion:sentence:3'
		]);
		expect(items[0]).toEqual({
			cardId: 'companion:sentence:1',
			kind: 'sentence',
			entryId: 1,
			written: 'w1',
			deckIds: ['general'],
			virtual: true
		});
	});

	it('skips vocab cards that already have the kind', () => {
		const items = planCompanions({ ...base, cards: [...cards, card('s2', 'sentence', 2)] });
		expect(items.map((i) => i.entryId)).toEqual([1, 3]);
	});

	it('no longer plans a companion once its card exists', () => {
		expect(planCompanions(base).map((i) => i.entryId)).toEqual([1, 2, 3]);
		const after = [...cards, card('s1', 'sentence', 1)];
		expect(planCompanions({ ...base, cards: after }).map((i) => i.entryId)).toEqual([2, 3]);
	});

	it('respects the deck filter', () => {
		const scoped = [...cards, card('d', 'vocab', 4, { deckIds: ['other'] })];
		expect(planCompanions({ ...base, cards: scoped }).map((i) => i.entryId)).toEqual([1, 2, 3]);
		expect(
			planCompanions({ ...base, cards: scoped, deckIds: ['other'] }).map((i) => i.entryId)
		).toEqual([4]);
	});

	it('respects the new budget', () => {
		expect(planCompanions({ ...base, newBudget: 2 })).toHaveLength(2);
		expect(planCompanions({ ...base, newBudget: 0 })).toEqual([]);
		expect(planCompanions({ ...base, newBudget: -3 })).toEqual([]);
	});

	it('round-robins kinds within the budget', () => {
		const items = planCompanions({
			...base,
			kinds: ['sentence', 'writing', 'tone'],
			newBudget: 4
		});
		expect(items.map((i) => i.cardId)).toEqual([
			'companion:sentence:1',
			'companion:writing:1',
			'companion:tone:1',
			'companion:sentence:2'
		]);
	});

	it('ignores vocab as a companion kind and kinds not requested', () => {
		expect(planCompanions({ ...base, kinds: ['vocab'] })).toEqual([]);
		const items = planCompanions({ ...base, kinds: ['tone'] });
		expect(items.every((i) => i.kind === 'tone')).toBe(true);
	});

	it('is empty for an empty kind list', () => {
		expect(planCompanions({ ...base, kinds: [] })).toEqual([]);
	});

	it('skips vocab cards without a written snapshot', () => {
		const items = planCompanions({
			...base,
			cards: [card('x', 'vocab', 9, { written: null }), ...cards]
		});
		expect(items.map((i) => i.entryId)).toEqual([1, 2, 3]);
	});

	it('does not plan from non-vocab cards', () => {
		expect(planCompanions({ ...base, cards: [card('s', 'sentence', 7)] })).toEqual([]);
	});
});

describe('isCompanionId', () => {
	it('recognises the prefix', () => {
		expect(COMPANION_PREFIX).toBe('companion:');
		expect(isCompanionId('companion:tone:5')).toBe(true);
		expect(isCompanionId('01JABC')).toBe(false);
	});
});
