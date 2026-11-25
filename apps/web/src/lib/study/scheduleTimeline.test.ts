import { describe, expect, it, vi } from 'vitest';

import { DEFAULT_W } from './fsrs/params';
import { scheduleAt, scheduleFor, scheduleTimeline } from './scheduler';
import { clockFromRuns, IDENTITY_CLOCK, type StudyClock } from './studyClock';
import type { ReviewEvent } from './types';
import * as build from '$lib/testing/study';

const DAY = 86_400_000;
const T0 = Date.parse('2026-01-05T08:00:00Z');
const NOW = new Date('2027-01-01T00:00:00Z');

function rng(seed: number): () => number {
	let s = seed;
	return () => {
		s = (s * 1103515245 + 12345) % 2147483648;
		return s / 2147483648;
	};
}

function ev(id: number, cardId: string, grade: number, ms: number): ReviewEvent {
	return build.review({ id: build.eventId(id, '01JTL'), cardId, grade, ts: new Date(ms).toISOString() });
}

/** A seeded history of two cards: ties on ts, invalid grades and other cards mixed in. */
function history(seed: number): ReviewEvent[] {
	const r = rng(seed);
	const out: ReviewEvent[] = [];
	let t = T0;
	for (let i = 0; i < 40; i++) {
		// A tie on the instant every few reviews (broken by id).
		if (r() > 0.2) t += Math.floor(r() * 9 * DAY);
		const grade = r() < 0.1 ? 7 : 1 + Math.floor(r() * 4);
		out.push(ev(1000 - i, r() < 0.8 ? 'a' : 'b', grade, t));
	}
	return out;
}

const CLOCKS: [string, StudyClock][] = [
	['identity', IDENTITY_CLOCK],
	['vacation', clockFromRuns([{ a: T0 + 20 * DAY, n: 5 }, { a: T0 + 60 * DAY, n: 3 }])]
];

describe('scheduleTimeline', () => {
	it.each(CLOCKS)('ends at scheduleFor and samples equal the prefix replay (%s clock)', (_n, clock) => {
		for (const seed of [1, 2, 3, 4, 5]) {
			const reviews = history(seed);
			const timeline = scheduleTimeline('a', reviews, DEFAULT_W, clock);
			expect(timeline.at(-1)?.schedule ?? null).toEqual(scheduleFor('a', reviews, NOW, DEFAULT_W, clock));
			const instants = [...new Set(reviews.map((rv) => Date.parse(rv.ts)))].sort((x, y) => x - y);
			for (const at of instants) {
				for (const cutoff of [at, at + 1]) {
					const prefix = reviews.filter((rv) => Date.parse(rv.ts) < cutoff);
					expect(scheduleAt(timeline, cutoff)).toEqual(scheduleFor('a', prefix, NOW, DEFAULT_W, clock));
				}
			}
		}
	});

	it('is in replay order, one point per valid review of the card', () => {
		const reviews = history(9);
		const valid = reviews.filter((rv) => rv.payload.cardId === 'a' && [1, 2, 3, 4].includes(rv.payload.grade));
		const timeline = scheduleTimeline('a', reviews, DEFAULT_W, IDENTITY_CLOCK);
		expect(timeline).toHaveLength(valid.length);
		for (let i = 1; i < timeline.length; i++) expect(timeline[i].ts).toBeGreaterThanOrEqual(timeline[i - 1].ts);
	});

	it('is empty without a valid review', () => {
		expect(scheduleTimeline('a', [ev(1, 'a', 9, T0)], DEFAULT_W, IDENTITY_CLOCK)).toEqual([]);
		expect(scheduleTimeline('z', history(1), DEFAULT_W, IDENTITY_CLOCK)).toEqual([]);
	});
});

describe('scheduleAt', () => {
	const reviews = [ev(1, 'a', 3, T0), ev(2, 'a', 3, T0 + 3 * DAY)];
	const timeline = scheduleTimeline('a', reviews, DEFAULT_W, IDENTITY_CLOCK);

	it('is null before the first review and at its instant (ts < cutoff)', () => {
		expect(scheduleAt(timeline, T0 - 1)).toBeNull();
		expect(scheduleAt(timeline, T0)).toBeNull();
		expect(scheduleAt([], T0)).toBeNull();
	});

	it('excludes a review at exactly the cutoff', () => {
		expect(scheduleAt(timeline, T0 + 3 * DAY)).toEqual(timeline[0].schedule);
		expect(scheduleAt(timeline, T0 + 3 * DAY + 1)).toEqual(timeline[1].schedule);
	});
});

describe('scheduleFor stays lean', () => {
	it('builds one schedule, not one per review', () => {
		const reviews = history(3).filter((rv) => rv.payload.cardId === 'a');
		const spy = vi.spyOn(Date.prototype, 'toISOString');
		try {
			scheduleFor('a', reviews, NOW, DEFAULT_W, IDENTITY_CLOCK);
			expect(spy).toHaveBeenCalledTimes(1);
		} finally {
			spy.mockRestore();
		}
	});
});
