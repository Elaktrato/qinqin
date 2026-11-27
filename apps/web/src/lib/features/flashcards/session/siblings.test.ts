import { describe, expect, it } from 'vitest';

import fixture from '../../../../../../../docs/contracts/cards/burying.json';
import { studyDay } from '$lib/time/studyDay';
import { answeredEntriesToday, buriedNow, buries } from './siblings';
import type { ReviewEvent, ReviewGrade, StudyCard, StudyCardKind } from '$lib/studycore/types';

interface Case {
	name: string;
	now: string;
	today: string;
	cards: { id: string; kind: StudyCardKind; entryId: number }[];
	reviews: { cardId: string; ts: string; day: string; grade: number }[];
	buriedCardIds: string[];
	buriedKeys: string[];
}

function toCards(list: Case['cards']): StudyCard[] {
	return list.map((c) => ({ ...c, deckIds: ['general'], createdAt: '2026-01-01T00:00:00Z' }));
}

function toReviews(list: Case['reviews']): ReviewEvent[] {
	return list.map((r, i) => ({
		id: `e${i}`,
		workspaceId: 1,
		device: 'd',
		ts: r.ts,
		type: 'review',
		payload: { cardId: r.cardId, mode: 'vocab', grade: r.grade as ReviewGrade }
	}));
}

describe('buries', () => {
	it('is true only when an opt-in kind is on either side', () => {
		expect(buries('vocab', 'writing')).toBe(false);
		expect(buries('sentence', 'tone')).toBe(false);
		expect(buries('vocab', 'reverse')).toBe(true);
		expect(buries('cloze', 'writing')).toBe(true);
		expect(buries('reverse', 'cloze')).toBe(true);
	});
});

describe('burying contract', () => {
	for (const c of fixture.cases as Case[]) {
		it(c.name, () => {
			const byTs = new Map(c.reviews.map((r) => [r.ts, r.day]));
			const dayOf = (ms: number) => {
				const iso = new Date(ms).toISOString().replace('.000Z', 'Z');
				return byTs.get(iso) ?? c.today;
			};
			const out = buriedNow({
				cards: toCards(c.cards),
				reviews: toReviews(c.reviews),
				now: new Date(c.now),
				studyDay: { dayOf }
			});
			expect([...out.cardIds].sort()).toEqual([...c.buriedCardIds].sort());
			expect([...out.keys].sort()).toEqual([...c.buriedKeys].sort());
		});
	}
});

describe('answeredEntriesToday', () => {
	it('maps an entry to the kinds answered today, in kind order', () => {
		const cards = toCards([
			{ id: 'c-vocab-1', kind: 'vocab', entryId: 1 },
			{ id: 'c-reverse-1', kind: 'reverse', entryId: 1 }
		]);
		const reviews = toReviews([
			{ cardId: 'c-reverse-1', ts: '2026-03-10T09:00:00Z', day: 'x', grade: 3 },
			{ cardId: 'c-vocab-1', ts: '2026-03-09T09:00:00Z', day: 'y', grade: 3 }
		]);
		const out = answeredEntriesToday({
			cards,
			reviews,
			now: new Date('2026-03-10T12:00:00Z'),
			studyDay: { dayOf: (ms) => new Date(ms).toISOString().slice(0, 10) }
		});
		expect(out.get(1)).toEqual(['reverse']);
	});
});

describe('burying with a real non-UTC learner day', () => {
	it('uses the learner day: 23:30 UTC is already tomorrow in Tokyo', () => {
		const tokyo = studyDay([{ zone: 'Asia/Tokyo', from: null }]);
		const cards = toCards([
			{ id: 'c-vocab-1', kind: 'vocab', entryId: 1 },
			{ id: 'c-reverse-1', kind: 'reverse', entryId: 1 }
		]);
		// 2026-03-09T23:30Z = 2026-03-10 08:30 in Tokyo; now = 2026-03-10T01:00Z = 10:00 in Tokyo.
		const reviews = toReviews([{ cardId: 'c-vocab-1', ts: '2026-03-09T23:30:00Z', day: '', grade: 3 }]);
		const now = new Date('2026-03-10T01:00:00Z');
		expect(buriedNow({ cards, reviews, now, studyDay: tokyo }).cardIds.has('c-reverse-1')).toBe(true);
		// In UTC the review belongs to yesterday: nothing is buried.
		expect(buriedNow({ cards, reviews, now, studyDay: studyDay([]) }).cardIds.size).toBe(0);
	});
});
