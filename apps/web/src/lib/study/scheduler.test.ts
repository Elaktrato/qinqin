import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { studyDay } from '../time/studyDay';
import { describe, expect, it, vi } from 'vitest';

import type { ReviewEvent, ReviewGrade } from './types';
import { createEmptyCard, fsrs, generatorParameters, Rating, type Grade } from 'ts-fsrs';

// A passthrough spy: the options scheduler.ts hands to ts-fsrs are part of the FSRS pin.
vi.mock('ts-fsrs', async (importOriginal) => {
	const actual = await importOriginal<typeof import('ts-fsrs')>();
	return { ...actual, fsrs: vi.fn(actual.fsrs) };
});

import envelopeFixture from '../../../../../docs/contracts/events/envelope.json';
import vacationSchedule from '../../../../../docs/contracts/scheduler/vacation-schedule.json';
import { DEFAULT_W } from './fsrs/params';
import { clockFromRuns, IDENTITY_CLOCK } from './studyClock';
import {
	isDue,
	isValidReview,
	levelFromXp,
	scheduleFor,
	scheduleTimeline,
	schedulerCacheSize,
	sortedReviews,
	xpFromReviews
} from './scheduler';
import * as build from '$lib/testing/study';

// Read with JSON.parse, not imported: a JSON import turns 1e999 into null, the
// fixture means Infinity (what JSON.parse makes of a stored 1e999).
const fsrsFixture: unknown = JSON.parse(
	readFileSync(resolve(__dirname, '../../../../../docs/contracts/scheduler/fsrs.json'), 'utf8')
);
const reviewParseFixture: unknown = JSON.parse(
	readFileSync(resolve(__dirname, '../../../../../docs/contracts/events/review-parse.json'), 'utf8')
);

// ULIDs are lexicographically sortable: same-instant reviews break ties
// on the id, exactly like the server's own ordering.
const eventId = (n: number): string => build.eventId(n);

function review(
	cardId: string,
	grade: ReviewGrade,
	ts: string,
	id = eventId(1)
): ReviewEvent {
	return build.review({ id, cardId, grade, ts, workspaceId: 7 });
}

// Event rows are only validated for id/ts server-side, so a payload can
// still be out of contract when it reaches the scheduler.
function malformed(cardId: string, grade: number, ts: string): ReviewEvent {
	return {
		id: eventId(9),
		workspaceId: 7,
		device: 'web',
		ts,
		type: 'review',
		payload: { cardId, mode: 'vocab', grade }
	} as unknown as ReviewEvent;
}

const NOW = new Date('2026-06-01T00:00:00.000Z');

describe('scheduleFor', () => {
	it('returns null when the card has no reviews', () => {
		expect(scheduleFor('missing', [], NOW, DEFAULT_W, IDENTITY_CLOCK)).toBeNull();
		expect(scheduleFor('missing', [review('other', 3, '2026-01-01T00:00:00.000Z')], NOW, DEFAULT_W, IDENTITY_CLOCK)).toBeNull();
	});

	it('replays the same events to the same schedule', () => {
		const reviews = [
			review('c1', 3, '2026-01-01T00:00:00.000Z', eventId(1)),
			review('c1', 4, '2026-01-02T00:00:00.000Z', eventId(2)),
			review('c1', 3, '2026-02-01T00:00:00.000Z', eventId(3))
		];

		const first = scheduleFor('c1', reviews, NOW, DEFAULT_W, IDENTITY_CLOCK);
		const second = scheduleFor('c1', [...reviews].reverse(), NOW, DEFAULT_W, IDENTITY_CLOCK);

		expect(first).not.toBeNull();
		expect(second).toEqual(first);
	});

	it('sorts by ts then id, independent of array order', () => {
		const a = review('c1', 3, '2026-01-02T00:00:00.000Z', eventId(1));
		const b = review('c1', 1, '2026-01-02T00:00:00.000Z', eventId(2));

		// Same instant: the id decides which grade is applied last.
		expect(scheduleFor('c1', [a, b], NOW, DEFAULT_W, IDENTITY_CLOCK)).toEqual(scheduleFor('c1', [b, a], NOW, DEFAULT_W, IDENTITY_CLOCK));
	});

	it('ignores reviews of other cards', () => {
		const own = [review('c1', 3, '2026-01-01T00:00:00.000Z', eventId(1))];
		const other = [
			...own,
			review('c2', 1, '2026-01-01T00:00:00.000Z', eventId(2)),
			review('c2', 1, '2026-01-02T00:00:00.000Z', eventId(3))
		];

		expect(scheduleFor('c1', other, NOW, DEFAULT_W, IDENTITY_CLOCK)).toEqual(scheduleFor('c1', own, NOW, DEFAULT_W, IDENTITY_CLOCK));
	});

	it('makes Again due earlier than Good for the same history', () => {
		const history = [review('c1', 3, '2026-01-01T00:00:00.000Z', eventId(1))];
		const again = scheduleFor(
			'c1',
			[...history, review('c1', 1, '2026-01-02T00:00:00.000Z', eventId(2))],
			NOW
		, DEFAULT_W, IDENTITY_CLOCK);
		const good = scheduleFor(
			'c1',
			[...history, review('c1', 3, '2026-01-02T00:00:00.000Z', eventId(2))],
			NOW
		, DEFAULT_W, IDENTITY_CLOCK);

		expect(again).not.toBeNull();
		expect(good).not.toBeNull();
		expect(new Date(again!.due).getTime()).toBeLessThan(new Date(good!.due).getTime());
	});

	it('exposes the fsrs memory state and a due instant', () => {
		const schedule = scheduleFor(
			'c1',
			[review('c1', 3, '2026-01-01T00:00:00.000Z', eventId(1))],
			NOW
		, DEFAULT_W, IDENTITY_CLOCK);

		expect(schedule).not.toBeNull();
		expect(new Date(schedule!.due).toISOString()).toBe(schedule!.due);
		expect(typeof schedule!.stability).toBe('number');
		expect(typeof schedule!.difficulty).toBe('number');
		expect(typeof schedule!.state).toBe('number');
	});
});

describe('isDue', () => {
	it('compares the due instant with now', () => {
		const schedule = { due: '2026-06-01T00:00:00.000Z', stability: 1, difficulty: 1, state: 2 };

		expect(isDue(schedule, new Date('2026-06-01T00:00:00.000Z'))).toBe(true);
		expect(isDue(schedule, new Date('2026-06-01T00:00:01.000Z'))).toBe(true);
		expect(isDue(schedule, new Date('2026-05-31T23:59:59.000Z'))).toBe(false);
	});
});

const UTC_DAY = studyDay([]);

describe('xpFromReviews', () => {
	it('awards 10 plus the grade bonus per review', () => {
		const reviews = [
			review('c1', 1, '2026-01-01T00:00:00.000Z', eventId(1)),
			review('c1', 2, '2026-01-02T00:00:00.000Z', eventId(2)),
			review('c2', 3, '2026-01-03T00:00:00.000Z', eventId(3)),
			review('c2', 4, '2026-01-04T00:00:00.000Z', eventId(4))
		];

		// again 10, hard 10, good 15, easy 20, plus +10 first review of
		// each of the four distinct UTC days
		expect(xpFromReviews(reviews, UTC_DAY.dayOf)).toBe(95);
	});

	it('is zero for no reviews', () => {
		expect(xpFromReviews([], UTC_DAY.dayOf)).toBe(0);
	});
});

describe('levelFromXp', () => {
	it('needs 100 * level xp per level starting at 1', () => {
		expect(levelFromXp(0)).toBe(1);
		expect(levelFromXp(99)).toBe(1);
		expect(levelFromXp(100)).toBe(2);
		expect(levelFromXp(250)).toBe(2);
		expect(levelFromXp(300)).toBe(3);
	});
});

describe('malformed review events', () => {
	it('ignores an out-of-range grade for scheduling and xp', () => {
		const valid = review('c1', 3, '2026-01-01T00:00:00.000Z', eventId(1));
		const poisoned = malformed('c1', 9, '2026-01-02T00:00:00.000Z');

		expect(scheduleFor('c1', [valid, poisoned], NOW, DEFAULT_W, IDENTITY_CLOCK)).toEqual(scheduleFor('c1', [valid], NOW, DEFAULT_W, IDENTITY_CLOCK));
		expect(xpFromReviews([valid, poisoned], UTC_DAY.dayOf)).toBe(25);
	});

	it('ignores an invalid timestamp and an empty card id', () => {
		expect(scheduleFor('c1', [malformed('c1', 3, 'not-a-timestamp')], NOW, DEFAULT_W, IDENTITY_CLOCK)).toBeNull();
		expect(scheduleFor('c1', [malformed('', 3, '2026-01-01T00:00:00.000Z')], NOW, DEFAULT_W, IDENTITY_CLOCK)).toBeNull();
	});

});

describe('scheduleFor weights', () => {
	const reviews = [
		review('w1', 3, '2026-01-01T00:00:00.000Z', eventId(1)),
		review('w1', 3, '2026-01-04T00:00:00.000Z', eventId(2)),
		review('w1', 4, '2026-01-12T00:00:00.000Z', eventId(3))
	];

	it('with the default weights equals a plain ts-fsrs replay', () => {
		const plain = fsrs();
		let c = createEmptyCard(new Date(reviews[0].ts));
		const grades: Grade[] = [Rating.Good, Rating.Good, Rating.Easy];
		reviews.forEach((r, i) => {
			c = plain.next(c, new Date(r.ts), grades[i]).card;
		});
		const got = scheduleFor('w1', reviews, NOW, DEFAULT_W, IDENTITY_CLOCK);
		expect(got?.due).toBe(c.due.toISOString());
		expect(got?.stability).toBe(c.stability);
		expect(got?.difficulty).toBe(c.difficulty);
	});

	it('a doubled w8 makes the due date later', () => {
		const w = [...DEFAULT_W];
		w[8] *= 2;
		const base = scheduleFor('w1', reviews, NOW, DEFAULT_W, IDENTITY_CLOCK);
		const changed = scheduleFor('w1', reviews, NOW, w, IDENTITY_CLOCK);
		expect(Date.parse(changed?.due ?? '')).toBeGreaterThan(Date.parse(base?.due ?? ''));
	});

	it('equal weight arrays share one scheduler instance', () => {
		const w = [...DEFAULT_W];
		w[3] = 7.77;
		scheduleFor('w1', reviews, NOW, w, IDENTITY_CLOCK);
		const size = schedulerCacheSize();
		scheduleFor('w1', reviews, NOW, [...w], IDENTITY_CLOCK);
		expect(schedulerCacheSize()).toBe(size);
	});

	it('keeps at most 16 instances and drops the oldest first', () => {
		for (let i = 0; i < 20; i++) {
			const w = [...DEFAULT_W];
			w[3] = 5 + i * 0.01;
			scheduleFor('w1', reviews, NOW, w, IDENTITY_CLOCK);
		}
		expect(schedulerCacheSize()).toBeLessThanOrEqual(16);
		expect(schedulerCacheSize()).toBe(16);
		const size = schedulerCacheSize();
		const newest = [...DEFAULT_W];
		newest[3] = 5 + 19 * 0.01;
		scheduleFor('w1', reviews, NOW, newest, IDENTITY_CLOCK);
		expect(schedulerCacheSize()).toBe(size);
		const oldest = [...DEFAULT_W];
		oldest[3] = 5;
		scheduleFor('w1', reviews, NOW, oldest, IDENTITY_CLOCK);
		expect(schedulerCacheSize()).toBe(16);
	});
});

describe('fixtures: replay on the study clock', () => {
	for (const c of vacationSchedule.cases) {
		it(c.name, () => {
			const clock = clockFromRuns(c.runs.map((r) => ({ a: Date.parse(r.a), n: r.n })));
			const events = c.reviews.map((r, i) => review('c1', r.grade as ReviewGrade, r.ts, eventId(i + 1)));
			const got = scheduleFor('c1', events, NOW, DEFAULT_W, clock);
			expect(Date.parse(got?.due ?? '')).toBe(Date.parse(c.expected.due));
			expect(got?.stability).toBeCloseTo(c.expected.stability, 8);
			expect(got?.difficulty).toBeCloseTo(c.expected.difficulty, 8);
			expect(got?.state).toBe(c.expected.state);
		});
	}
});

describe('identity clock golden', () => {
	it('equals a plain ts-fsrs replay over 2,000 reviews', () => {
		let seed = 7;
		const rnd = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
		const events: ReviewEvent[] = [];
		let at = Date.parse('2025-01-01T08:00:00Z');
		for (let i = 0; i < 2000; i++) {
			at += Math.floor(rnd() * 3 * 86_400_000) + 60_000;
			events.push(review(`c${i % 200}`, (1 + Math.floor(rnd() * 4)) as ReviewGrade, new Date(at).toISOString(), eventId(i)));
		}
		const f = fsrs();
		const rating = { 1: Rating.Again, 2: Rating.Hard, 3: Rating.Good, 4: Rating.Easy } as const;
		for (let c = 0; c < 200; c++) {
			const mine = events.filter((e) => e.payload.cardId === `c${c}`);
			let plain = createEmptyCard(new Date(mine[0].ts));
			for (const e of mine) plain = f.next(plain, new Date(e.ts), rating[e.payload.grade] as Grade).card;
			const got = scheduleFor(`c${c}`, events, NOW, DEFAULT_W, IDENTITY_CLOCK);
			expect(got?.due).toBe(plain.due.toISOString());
			expect(got?.stability).toBe(plain.stability);
			expect(got?.difficulty).toBe(plain.difficulty);
		}
	});
});

describe('docs/contracts/events/envelope.json: replay order', () => {
	interface EnvelopeEvent {
		id: string;
		ts: string;
		type: string;
		payload: unknown;
	}
	interface EnvelopeCase {
		name: string;
		steps: { post?: { events?: EnvelopeEvent[] }; list?: string; expect: { ids?: string[] } }[];
		stored: EnvelopeEvent[];
	}
	const order = (envelopeFixture as unknown as { cases: EnvelopeCase[] }).cases.find((c) => c.name.startsWith('list order'));
	it('sortedReviews over the stored copies equals the server list order (ts, then id)', () => {
		expect(order).toBeDefined();
		const serverOrder = order!.steps.find((s) => s.list === '')!.expect.ids!;
		const stored = order!.stored.map((e) => ({ ...e, workspaceId: 7, device: 'web' }) as ReviewEvent);
		expect(sortedReviews(stored).map((e) => e.id)).toEqual(serverOrder);
		expect(sortedReviews([...stored].reverse()).map((e) => e.id)).toEqual(serverOrder);
	});
});

describe('docs/contracts/events/review-parse.json: validity and replay order', () => {
	const fixture = reviewParseFixture as unknown as {
		cases: { name: string; event: ReviewEvent; valid: boolean }[];
		order: { name: string; events: { id: string; ts: string }[]; expect: string[] }[];
	};
	for (const c of fixture.cases) {
		it(`isValidReview: ${c.name}`, () => {
			expect(isValidReview(c.event)).toBe(c.valid);
		});
	}
	for (const c of fixture.order) {
		it(`sortedReviews: ${c.name}`, () => {
			const events = c.events.map((e) => review('c1', 3, e.ts, e.id));
			expect(sortedReviews(events).map((e) => e.id)).toEqual(c.expect);
			expect(sortedReviews([...events].reverse()).map((e) => e.id)).toEqual(c.expect);
		});
	}
});

describe('docs/contracts/scheduler/fsrs.json: the FSRS pin', () => {
	interface Point {
		due: string;
		stability: number;
		difficulty: number;
		state: number;
	}
	const fixture = fsrsFixture as {
		tsFsrs: string;
		parameters: Record<string, unknown> & { w: number[] };
		replay: {
			name: string;
			w: 'default' | number[];
			reviews: { id: string; ts: string; grade: ReviewGrade }[];
			order: string[];
			points: Point[];
		}[];
	};

	it('scheduler.ts passes only w to ts-fsrs, so every other option is the pinned default', () => {
		// A weight set no other test uses, so the scheduler cache builds a new instance.
		const w = [...fixture.parameters.w];
		w[0] = 0.2345;
		vi.mocked(fsrs).mockClear();
		scheduleFor('c1', [review('c1', 3, '2026-01-05T09:00:00Z')], new Date(0), w, IDENTITY_CLOCK);
		expect(vi.mocked(fsrs).mock.calls).toEqual([[{ w }]]);
		expect(generatorParameters({ w })).toEqual({ ...fixture.parameters, w });
		expect(generatorParameters()).toEqual(fixture.parameters);
	});
	it('records the installed ts-fsrs version', () => {
		const pkg = JSON.parse(readFileSync(resolve(__dirname, '../../../node_modules/ts-fsrs/package.json'), 'utf8'));
		expect(pkg.version).toBe(fixture.tsFsrs);
	});
	it('has at least 20 replay sequences', () => {
		expect(fixture.replay.length).toBeGreaterThanOrEqual(20);
	});
	it('the generated files equal the generator output (gen-scheduler-fixtures.mjs --check)', () => {
		// Catches a hand edit of any member, including those only a port reads (reps, lapses, scheduled_days, learning_steps).
		const script = resolve(__dirname, '../../../../../scripts/contracts/gen-scheduler-fixtures.mjs');
		const run = spawnSync(process.execPath, [script, '--check'], { encoding: 'utf8' });
		expect(run.stderr).toBe('');
		expect(run.status).toBe(0);
	}, 30_000);
	for (const c of fixture.replay) {
		it(`replay: ${c.name}`, () => {
			const w = c.w === 'default' ? DEFAULT_W : c.w;
			const events = c.reviews.map((r) => review('c1', r.grade, r.ts, r.id));
			const timeline = scheduleTimeline('c1', events, w, IDENTITY_CLOCK);
			expect(timeline).toHaveLength(c.points.length);
			timeline.forEach((p, i) => {
				const want = c.points[i];
				expect(Date.parse(p.schedule.due), `due ${i}`).toBe(Date.parse(want.due));
				expect(p.schedule.stability).toBeCloseTo(want.stability, 8);
				expect(p.schedule.difficulty).toBeCloseTo(want.difficulty, 8);
				expect(p.schedule.state).toBe(want.state);
				expect(p.ts).toBe(Date.parse(c.reviews.find((r) => r.id === c.order[i])!.ts));
			});
		});
	}
});

describe('docs/contracts/scheduler next-intervals.json and interval-text.json (#101)', () => {
	const read = (file: string): unknown =>
		JSON.parse(readFileSync(resolve(__dirname, '../../../../../docs/contracts/scheduler', file), 'utf8'));

	it('next-intervals.json: every case has the four grades with ms = due - now', () => {
		const fixture = read('next-intervals.json') as {
			rule: string;
			cases: { name: string; now: string; expected: { grade: number; due: string; ms: number }[] }[];
		};
		expect(fixture.rule).toBe('scheduler/next-intervals');
		expect(fixture.cases.length).toBeGreaterThanOrEqual(8);
		for (const c of fixture.cases) {
			expect(c.expected.map((e) => e.grade), c.name).toEqual([1, 2, 3, 4]);
			for (const e of c.expected) expect(e.ms, c.name).toBe(Date.parse(e.due) - Date.parse(c.now));
		}
	});
	it('interval-text.json: every case names a bucket and a value', () => {
		const fixture = read('interval-text.json') as {
			rule: string;
			cases: { ms: number; unit: string; value: number }[];
		};
		expect(fixture.rule).toBe('scheduler/interval-text');
		const units = new Set(['lessThanMinute', 'minute', 'hour', 'day', 'month', 'year']);
		for (const c of fixture.cases) {
			expect(units.has(c.unit), String(c.ms)).toBe(true);
			expect(Number.isFinite(c.value)).toBe(true);
		}
	});
});
