import { describe, expect, it } from 'vitest';

import type { StudyEvent } from '$lib/events';
import fixture from '../../../../../docs/contracts/events/review-replace.json';
import { DEFAULT_W } from './fsrsParams';
import { liveReviews } from './replaced';
import { parseReview } from './reviewParse';
import { isValidReview, scheduleFor, sortedReviews } from './scheduler';
import { IDENTITY_CLOCK } from './studyClock';
import type { ReviewEvent } from './types';

interface Case {
	name: string;
	events: StudyEvent[];
	live: string[];
	replaced: string[];
}

const cases = (fixture as unknown as { rule: string; cases: Case[] }).cases;
const generated = (fixture as unknown as { generated: { generator: string; seed: number; cases: Case[] } }).generated;

function parsed(events: readonly StudyEvent[]): ReviewEvent[] {
	return events.map(parseReview).filter((e): e is ReviewEvent => e !== null);
}

describe('docs/contracts/events/review-replace.json: liveReviews', () => {
	it('has cases', () => {
		expect((fixture as { rule: string }).rule).toBe('events/review-replace');
		expect(cases.length).toBeGreaterThanOrEqual(15);
	});
	for (const c of cases) {
		it(c.name, () => {
			const reviews = parsed(c.events);
			const live = liveReviews(reviews);
			const counted = sortedReviews(live.filter(isValidReview)).map((r) => r.id);
			expect(counted).toEqual(c.live);
			const kept = new Set(live.map((r) => r.id));
			const gone = reviews
				.filter((r) => isValidReview(r) && !kept.has(r.id))
				.map((r) => r.id)
				.sort();
			expect(gone).toEqual(c.replaced);
		});
	}
});

describe('docs/contracts/events/review-replace.json: generated families (review fix 5)', () => {
	it('holds the seeded block', () => {
		expect(generated.generator).toBe('scripts/contracts/gen-review-replace.mjs');
		expect(generated.seed).toBe(131);
		expect(generated.cases).toHaveLength(300);
	});
	it('every generated case', () => {
		for (const [n, c] of generated.cases.entries()) {
			const reviews = parsed(c.events);
			const live = liveReviews(reviews);
			const kept = new Set(live.map((r) => r.id));
			expect(sortedReviews(live.filter(isValidReview)).map((r) => r.id), `case ${n}`).toEqual(c.live);
			expect(
				reviews.filter((r) => isValidReview(r) && !kept.has(r.id)).map((r) => r.id).sort(),
				`case ${n}`
			).toEqual(c.replaced);
		}
	});
});

describe('liveReviews', () => {
	const misclick = cases.find((c) => c.name === 'a misclick replaced by the intended grade')!;

	it('keeps the input order and the objects themselves', () => {
		const reviews = parsed([...misclick.events].reverse());
		const live = liveReviews(reviews);
		expect(live.map((r) => r.id)).toEqual(reviews.filter((r) => r.id !== misclick.replaced[0]).map((r) => r.id));
		expect(live.every((r) => reviews.includes(r))).toBe(true);
	});

	it('the same array back when nothing is replaced', () => {
		const reviews = parsed(misclick.events.filter((e) => e.id !== misclick.events[1].id));
		expect(liveReviews(reviews)).toBe(reviews);
	});

	it('a misclick replays as the intended grade alone', () => {
		const reviews = parsed(misclick.events);
		const now = new Date('2026-11-22T12:00:00Z');
		const intended = reviews.filter((r) => r.id === misclick.live[0]);
		const withMisclick = scheduleFor('c1', reviews, now, DEFAULT_W, IDENTITY_CLOCK);
		const corrected = scheduleFor('c1', liveReviews(reviews), now, DEFAULT_W, IDENTITY_CLOCK);
		expect(corrected).toEqual(scheduleFor('c1', intended, now, DEFAULT_W, IDENTITY_CLOCK));
		expect(corrected).not.toEqual(withMisclick);
	});
});
