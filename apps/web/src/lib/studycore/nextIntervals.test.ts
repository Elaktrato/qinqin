import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

// A passthrough spy: the options handed to ts-fsrs are part of the FSRS pin.
vi.mock('ts-fsrs', async (importOriginal) => {
	const actual = await importOriginal<typeof import('ts-fsrs')>();
	return { ...actual, fsrs: vi.fn(actual.fsrs) };
});

import { fsrs } from 'ts-fsrs';
import { DEFAULT_W } from './fsrsParams';
import { nextIntervals, scheduleFor } from './scheduler';
import { clockFromRuns, IDENTITY_CLOCK } from './studyClock';
import type { ReviewEvent, ReviewGrade } from './types';
import * as build from '$lib/testing/study';

interface Case {
	name: string;
	w: 'default' | number[];
	runs: { start: string; a: string; n: number }[];
	reviews: { ts: string; grade: ReviewGrade }[];
	now: string;
	expected: { grade: ReviewGrade; due: string; ms: number }[];
}

const fixture = JSON.parse(
	readFileSync(resolve(__dirname, '../../../../../docs/contracts/scheduler/next-intervals.json'), 'utf8')
) as { cases: Case[] };

function review(cardId: string, grade: ReviewGrade, ts: string, n: number): ReviewEvent {
	return build.review({ id: build.eventId(n), cardId, grade, ts, workspaceId: 7 });
}

const GRADES: ReviewGrade[] = [1, 2, 3, 4];

describe('nextIntervals (#101)', () => {
	describe('decodes next-intervals.json: every case\'s four ms values', () => {
		for (const c of fixture.cases) {
			it(c.name, () => {
				const w = c.w === 'default' ? DEFAULT_W : c.w;
				const clock = clockFromRuns(c.runs.map((r) => ({ a: Date.parse(r.a), n: r.n })));
				const events = c.reviews.map((r, i) => review('c1', r.grade, r.ts, i + 1));
				const got = nextIntervals(events.length === 0 ? null : 'c1', events, new Date(c.now), w, clock);
				for (const e of c.expected) expect(got[e.grade], `grade ${e.grade}`).toBe(e.ms);
			});
		}
	});

	it('null previews an empty card', () => {
		const now = new Date('2026-01-05T09:00:00Z');
		const got = nextIntervals(null, [review('other', 3, '2026-01-04T09:00:00Z', 1)], now, DEFAULT_W, IDENTITY_CLOCK);
		expect(got).toEqual(nextIntervals('never-reviewed', [], now, DEFAULT_W, IDENTITY_CLOCK));
		expect(got[1]).toBe(60_000);
	});

	it('uses the same weights instance as scheduleFor (only {w} reaches ts-fsrs)', () => {
		const w = [...DEFAULT_W];
		w[0] = 0.3456;
		vi.mocked(fsrs).mockClear();
		nextIntervals('c1', [review('c1', 3, '2026-01-05T09:00:00Z', 1)], new Date('2026-01-05T09:10:00Z'), w, IDENTITY_CLOCK);
		scheduleFor('c1', [review('c1', 3, '2026-01-05T09:00:00Z', 1)], new Date(0), w, IDENTITY_CLOCK);
		expect(vi.mocked(fsrs).mock.calls).toEqual([[{ w }]]);
	});

	it('grading then scheduleFor gives the previewed due for each grade', () => {
		const history = [review('c1', 3, '2026-01-05T09:00:00Z', 1), review('c1', 3, '2026-01-05T09:10:00Z', 2)];
		const now = new Date('2026-01-09T12:34:56Z');
		const preview = nextIntervals('c1', history, now, DEFAULT_W, IDENTITY_CLOCK);
		for (const grade of GRADES) {
			const graded = [...history, review('c1', grade, now.toISOString(), 3)];
			const due = scheduleFor('c1', graded, now, DEFAULT_W, IDENTITY_CLOCK)!.due;
			expect(Date.parse(due) - now.getTime(), `grade ${grade}`).toBe(preview[grade]);
		}
	});

	it('a study clock run shifts the due exactly as the replay does', () => {
		const clock = clockFromRuns([{ a: Date.parse('2026-01-04T15:00:00Z'), n: 7 }]);
		const history = [review('c1', 3, '2025-12-28T03:00:00Z', 1), review('c1', 3, '2025-12-28T03:10:00Z', 2)];
		const now = new Date('2026-01-14T03:00:00Z');
		const preview = nextIntervals('c1', history, now, DEFAULT_W, clock);
		for (const grade of GRADES) {
			const graded = [...history, review('c1', grade, now.toISOString(), 3)];
			const due = scheduleFor('c1', graded, now, DEFAULT_W, clock)!.due;
			expect(Date.parse(due) - now.getTime(), `grade ${grade}`).toBe(preview[grade]);
		}
	});
});
