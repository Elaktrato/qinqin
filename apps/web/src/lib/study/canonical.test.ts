import { describe, expect, it } from 'vitest';

import { canonicalCards, newCardId } from './canonical';
import { cardKey } from './reviewParse';
import type { ReviewEvent, ReviewGrade, StudyCard, StudyCardKind } from './types';

function card(
	id: string,
	entryId: number,
	createdAt: string,
	extra: Partial<StudyCard> = {}
): StudyCard {
	return { id, kind: 'vocab', entryId, deckIds: ['general'], createdAt, ...extra };
}

function review(id: string, cardId: string, grade: ReviewGrade = 3, mode: StudyCardKind = 'vocab'): ReviewEvent {
	return {
		id,
		workspaceId: 7,
		device: 'web',
		ts: '2026-02-01T00:00:00.000Z',
		type: 'review',
		payload: { cardId, mode, grade }
	};
}

describe('newCardId', () => {
	it('derives the id from kind and entry', () => {
		expect(newCardId('vocab', 42)).toBe('c-vocab-42');
		expect(newCardId('writing', 42)).toBe('c-writing-42');
		expect(newCardId('tone', 42)).toBe('c-tone-42');
		expect(newCardId('sentence', 42)).toBe('c-sentence-42');
	});

	it('only uses characters that are safe in a plugin-data key and a URL path segment', () => {
		for (const kind of ['vocab', 'sentence', 'writing', 'tone'] as const) {
			expect(`card:${newCardId(kind, 123456)}`).toMatch(/^card:[a-z0-9-]+$/);
		}
	});
});

describe('canonicalCards', () => {
	it('passes through cards without duplicates unchanged', () => {
		const cards = [card('a', 1, '2026-01-01T00:00:00Z'), card('b', 2, '2026-01-02T00:00:00Z')];
		const reviews = [review('r1', 'a'), review('r2', 'b')];

		const result = canonicalCards(cards, reviews);

		expect(result).toEqual({ cards, reviews, merged: 0 });
	});

	it('keeps the earliest-created duplicate and re-points the reviews of the others', () => {
		const late = card('late', 42, '2026-01-05T00:00:00Z');
		const early = card('early', 42, '2026-01-01T00:00:00Z');
		const other = card('other', 7, '2026-01-03T00:00:00Z');
		const reviews = [review('r1', 'late', 4), review('r2', 'early', 2), review('r3', 'other')];

		const result = canonicalCards([late, other, early], reviews);

		expect(result.merged).toBe(1);
		expect(result.cards.map((c) => c.id)).toEqual(['other', 'early']);
		expect(result.reviews.map((r) => [r.id, r.payload.cardId, r.payload.grade])).toEqual([
			['r1', 'early', 4],
			['r2', 'early', 2],
			['r3', 'other', 3]
		]);
	});

	it('breaks a createdAt tie by the lowest id', () => {
		const at = '2026-01-01T00:00:00Z';
		const result = canonicalCards(
			[card('c-vocab-42', 42, at), card('01JZZZZ', 42, at)],
			[review('r1', 'c-vocab-42')]
		);

		expect(result.cards.map((c) => c.id)).toEqual(['01JZZZZ']);
		expect(result.reviews[0].payload.cardId).toBe('01JZZZZ');
	});

	it('merges a three-way duplicate into one card with every review', () => {
		const a = card('a', 42, '2026-01-03T00:00:00Z');
		const b = card('b', 42, '2026-01-01T00:00:00Z');
		const c = card('c', 42, '2026-01-02T00:00:00Z');
		const reviews = [review('r1', 'a'), review('r2', 'b'), review('r3', 'c'), review('r4', 'a')];

		const result = canonicalCards([a, b, c], reviews);

		expect(result.merged).toBe(2);
		expect(result.cards.map((x) => x.id)).toEqual(['b']);
		expect(result.reviews.map((r) => r.payload.cardId)).toEqual(['b', 'b', 'b', 'b']);
		expect(result.reviews.map((r) => r.id)).toEqual(['r1', 'r2', 'r3', 'r4']);
	});

	it('treats vocab cards with different sentence ids as one card', () => {
		const first = card('first', 42, '2026-01-01T00:00:00Z', { sentenceId: 9 });
		const second = card('second', 42, '2026-01-02T00:00:00Z', { sentenceId: 10 });

		const result = canonicalCards([second, first], [review('r1', 'second')]);

		expect(result.cards).toEqual([first]);
		expect(result.reviews[0].payload.cardId).toBe('first');
	});

	it('keeps sentence cards of different sentences apart', () => {
		const s9 = card('s9', 42, '2026-01-01T00:00:00Z', { kind: 'sentence', sentenceId: 9 });
		const s10 = card('s10', 42, '2026-01-02T00:00:00Z', { kind: 'sentence', sentenceId: 10 });

		expect(canonicalCards([s9, s10], []).cards).toEqual([s9, s10]);
	});

	it('never merges different kinds or entries', () => {
		const cards = [
			card('v', 42, '2026-01-01T00:00:00Z'),
			card('w', 42, '2026-01-01T00:00:00Z', { kind: 'writing' }),
			card('t', 42, '2026-01-01T00:00:00Z', { kind: 'tone' }),
			card('v2', 43, '2026-01-01T00:00:00Z')
		];

		expect(canonicalCards(cards, []).cards).toEqual(cards);
	});

	it('keeps the survivor in every deck of its duplicates and fills a missing snapshot', () => {
		const early = card('early', 42, '2026-01-01T00:00:00Z', { deckIds: ['general'] });
		const late = card('late', 42, '2026-01-02T00:00:00Z', {
			deckIds: ['deck-a', 'general'],
			written: '猫',
			sentenceId: 9
		});

		const result = canonicalCards([early, late], []);

		expect(result.cards).toEqual([
			{ ...early, deckIds: ['general', 'deck-a'], written: '猫', sentenceId: 9 }
		]);
	});

	it("keeps the survivor's own written snapshot over a duplicate's", () => {
		const early = card('early', 42, '2026-01-01T00:00:00Z', { written: '貓' });
		const late = card('late', 42, '2026-01-02T00:00:00Z', { written: '猫' });

		expect(canonicalCards([late, early], []).cards[0].written).toBe('貓');
	});

	it('sorts unparsable creation times after valid ones', () => {
		const broken = card('aaa', 42, 'not a date');
		const valid = card('zzz', 42, '2026-01-01T00:00:00Z');

		expect(canonicalCards([broken, valid], []).cards.map((c) => c.id)).toEqual(['zzz']);
	});

	it('leaves reviews of unknown cards and the inputs untouched', () => {
		const a = card('a', 42, '2026-01-01T00:00:00Z');
		const b = card('b', 42, '2026-01-02T00:00:00Z');
		const reviews = [review('r1', 'b'), review('r2', 'gone')];
		const before = structuredClone({ cards: [a, b], reviews });

		const result = canonicalCards([a, b], reviews);

		expect(result.reviews[1]).toBe(reviews[1]);
		expect({ cards: [a, b], reviews }).toEqual(before);
	});

	it('is idempotent', () => {
		const cards = [
			card('a', 42, '2026-01-03T00:00:00Z', { deckIds: ['deck-b'] }),
			card('b', 42, '2026-01-01T00:00:00Z'),
			card('c', 43, '2026-01-01T00:00:00Z'),
			card('d', 43, '2026-01-02T00:00:00Z', { written: '犬' })
		];
		const reviews = [review('r1', 'a'), review('r2', 'd'), review('r3', 'c')];

		const once = canonicalCards(cards, reviews);
		const twice = canonicalCards(once.cards, once.reviews);

		expect(twice).toEqual({ cards: once.cards, reviews: once.reviews, merged: 0 });
	});

	it('gives one card per cardKey whatever the input order', () => {
		const cards = [
			card('a', 1, '2026-01-02T00:00:00Z'),
			card('b', 1, '2026-01-01T00:00:00Z'),
			card('c', 2, '2026-01-01T00:00:00Z', { kind: 'writing' }),
			card('d', 2, '2026-01-01T00:00:00Z', { kind: 'writing' })
		];
		const forward = canonicalCards(cards, []).cards;
		const backward = canonicalCards([...cards].reverse(), []).cards;

		const ids = (list: StudyCard[]) => list.map((c) => c.id).sort();
		expect(ids(forward)).toEqual(['b', 'c']);
		expect(ids(backward)).toEqual(['b', 'c']);
		const keys = forward.map((c) => cardKey(c.kind, c.entryId, c.sentenceId));
		expect(new Set(keys).size).toBe(keys.length);
	});
});
