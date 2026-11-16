import { describe, expect, it } from 'vitest';
import fixture from '../../../../../docs/contracts/goals/goal-amounts.json';
import { studyDay } from '../time/studyDay';
import type { ActivityCell } from '../api/stats';
import type { ReviewEvent } from '../study/types';
import { MAX_REVIEW_MS, NO_AMOUNTS, activityAmounts, amountsOf, flashcardAmounts } from './amounts';

interface FixtureReview {
	id: string;
	ts: string;
	cardId: string;
	grade: number;
	durationMs?: number;
}

function event(r: FixtureReview): ReviewEvent {
	return {
		id: r.id,
		workspaceId: 1,
		device: 'web',
		ts: r.ts,
		type: 'review',
		payload: {
			cardId: r.cardId,
			mode: 'vocab',
			grade: r.grade as 1,
			...(r.durationMs === undefined ? {} : { meta: { durationMs: r.durationMs } })
		}
	};
}

const toObject = <T>(m: ReadonlyMap<string, T>): Record<string, T> => Object.fromEntries(m);

type Case =
	| { name: string; op: 'flashcards'; zone: string; reviews: FixtureReview[]; expect: Record<string, unknown> }
	| { name: string; op: 'activity'; workspace: number; cells: ActivityCell[]; expect: Record<string, unknown> };
const cases = fixture.cases as Case[];

describe('goal-amounts.json', () => {
	it.each(cases.map((c) => [c.name, c] as const))('%s', (_name, c) => {
		if (c.op === 'flashcards') {
			const day = studyDay([{ zone: c.zone, from: null }]);
			expect(toObject(flashcardAmounts(c.reviews.map(event), day.dayOf))).toEqual(c.expect);
		} else {
			expect(toObject(activityAmounts(c.cells, c.workspace))).toEqual(c.expect);
		}
	});
});

const UTC = studyDay([]);
let n = 0;
function rv(ts: string, cardId: string, meta?: Record<string, unknown>): ReviewEvent {
	n++;
	return {
		id: `01JTESTAMOUNT${String(n).padStart(13, '0')}`,
		workspaceId: 1,
		device: 'web',
		ts,
		type: 'review',
		payload: { cardId, mode: 'vocab', grade: 3, ...(meta === undefined ? {} : { meta: meta as never }) }
	};
}

describe('flashcardAmounts', () => {
	it('does not depend on the input order', () => {
		const reviews = [
			rv('2026-11-14T10:00:00Z', 'a', { durationMs: 1000 }),
			rv('2026-11-15T10:00:00Z', 'a', { durationMs: 2000 }),
			rv('2026-11-15T11:00:00Z', 'b', { durationMs: 3000 }),
			rv('2026-11-16T10:00:00Z', 'b', { durationMs: 4000 }),
			rv('2026-11-16T10:00:00Z', 'c', { durationMs: 5000 })
		];
		const expected = toObject(flashcardAmounts(reviews, UTC.dayOf));
		for (let i = 0; i < 10; i++) {
			const shuffled = [...reviews].sort(() => Math.random() - 0.5);
			expect(toObject(flashcardAmounts(shuffled, UTC.dayOf))).toEqual(expected);
		}
		expect(expected).toEqual({
			'2026-11-14': { newCards: 1, studySeconds: 1 },
			'2026-11-15': { newCards: 1, studySeconds: 5 },
			'2026-11-16': { newCards: 1, studySeconds: 9 }
		});
	});

	it('a card first reviewed yesterday adds no new card today', () => {
		const out = flashcardAmounts(
			[rv('2026-11-15T10:00:00Z', 'a'), rv('2026-11-16T10:00:00Z', 'a')],
			UTC.dayOf
		);
		expect(out.get('2026-11-16')).toEqual({ newCards: 0, studySeconds: 0 });
	});

	it('counts an invalid durationMs as 0', () => {
		const out = flashcardAmounts(
			[
				rv('2026-11-16T10:00:00Z', 'a', { durationMs: -1 }),
				rv('2026-11-16T10:01:00Z', 'b', { durationMs: Number.NaN }),
				rv('2026-11-16T10:02:00Z', 'c', { durationMs: '5000' }),
				rv('2026-11-16T10:03:00Z', 'd', { durationMs: Infinity }),
				rv('2026-11-16T10:04:00Z', 'e', { durationMs: 1500 })
			],
			UTC.dayOf
		);
		expect(out.get('2026-11-16')).toEqual({ newCards: 5, studySeconds: 1.5 });
	});

	it('keeps fractional seconds and caps each review', () => {
		const out = flashcardAmounts(
			[rv('2026-11-16T10:00:00Z', 'a', { durationMs: 1234 }), rv('2026-11-16T10:01:00Z', 'a', { durationMs: 61_000 })],
			UTC.dayOf
		);
		expect(MAX_REVIEW_MS).toBe(60_000);
		expect(out.get('2026-11-16')?.studySeconds).toBe(61.234);
	});
});

describe('activityAmounts', () => {
	it('sums repeated cells of one day and type', () => {
		const cell = (raw: number): ActivityCell => ({ day: '2026-11-16', workspace: 1, type: 'read', points: 1, raw });
		expect(toObject(activityAmounts([cell(30), cell(45)], 1))).toEqual({ '2026-11-16': { read: 75 } });
	});
});

describe('amountsOf', () => {
	it('joins both sources per day, empty days are NO_AMOUNTS', () => {
		const of = amountsOf(
			new Map([['2026-11-16', { newCards: 2, studySeconds: 30 }]]),
			new Map<string, Record<string, number>>([['2026-11-16', { review: 7 }], ['2026-11-15', { read: 60 }]])
		);
		expect(of('2026-11-16')).toEqual({ activity: { review: 7 }, newCards: 2, studySeconds: 30 });
		expect(of('2026-11-15')).toEqual({ activity: { read: 60 }, newCards: 0, studySeconds: 0 });
		expect(of('2026-11-14')).toEqual(NO_AMOUNTS);
		expect(NO_AMOUNTS).toEqual({ activity: {}, newCards: 0, studySeconds: 0 });
	});
});
