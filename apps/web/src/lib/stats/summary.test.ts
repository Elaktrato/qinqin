import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_W } from '$lib/studycore/fsrsParams';
import { studyDay, type ZoneChange } from '$lib/time/studyDay';
import { addDays } from '$lib/time/studyDay';
import type { ReviewEvent, StudyCard } from '$lib/studycore/types';
import type { Run } from '$lib/studycore/vacation';
import type { Schedule } from '$lib/studycore/scheduler';
import fixture from '../../../../../docs/contracts/stats/summary-numbers.json';
import { drillPayload, grammarPayload } from '$lib/events/eventPayloads';
import { parseGrammarRun, type GrammarRun } from '$lib/studycore/grammarRuns';
import { parseDrillAnswer, type DrillAnswer } from '$lib/studycore/drills';
import { courseStepOf, type CourseStep } from '$lib/studycore/courseCounting';

// The recall figure must be the decks page's own function, called once for
// the overall scope; the spy proves the reuse (the rest of the module stays
// the real implementation).
vi.mock('$lib/features/flashcards/decks/deckStats', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/features/flashcards/decks/deckStats')>();
	return { ...actual, deckNumbers: vi.fn(actual.deckNumbers) };
});
import {
	deckNumbers,
	STATS_WINDOW_DAYS as DECK_WINDOW_DAYS
} from '$lib/features/flashcards/decks/deckStats';
import { reviewsPerDay, STATS_WINDOW_DAYS, summaryNumbers, type SummaryInput } from './summary';

interface FixtureCard {
	id: string;
	kind: StudyCard['kind'];
	entryId: number;
	deckIds: string[];
	createdAt: string;
}

interface FixtureReview {
	id: string;
	cardId: string;
	ts: string;
	grade: 1 | 2 | 3 | 4;
	mode?: StudyCard['kind'];
	durationMs?: number;
}

interface FixtureCase {
	name: string;
	note: string;
	now: string;
	zone: string;
	/** A zone-change history; `zone` is the first zone when absent. */
	history?: ZoneChange[];
	cards: FixtureCard[];
	reviews: FixtureReview[];
	marks: number[];
	vacation: Run[];
	schedules?: Record<string, Schedule>;
	expect: {
		streak: number;
		wordsKnown: number;
		recall: { share: number | null; base: number };
		studiedSeconds: number;
		reviewsPerDay: [string, number][];
	};
}

const cases = (fixture as { cases: FixtureCase[] }).cases;

function inputOf(c: FixtureCase, workspaceId = 1): SummaryInput {
	const cards: StudyCard[] = c.cards.map((card) => ({ ...card }));
	const reviews: ReviewEvent[] = c.reviews.map((review) => ({
		id: review.id,
		workspaceId,
		device: 'fixture',
		ts: review.ts,
		type: 'review',
		payload: {
			cardId: review.cardId,
			mode: review.mode ?? 'vocab',
			grade: review.grade,
			...(review.durationMs === undefined ? {} : { meta: { durationMs: review.durationMs } })
		}
	}));
	const schedules = c.schedules === undefined ? null : new Map(Object.entries(c.schedules));
	return {
		workspaceId,
		now: Date.parse(c.now),
		day: studyDay(c.history ?? [{ zone: c.zone, from: null }]),
		cards,
		decks: [],
		reviews,
		known: c.marks,
		vacation: c.vacation,
		w: DEFAULT_W,
		kinds: [],
		...(schedules === null ? {} : { schedule: (id: string) => schedules.get(id) ?? null })
	};
}

describe('summaryNumbers, every contract case', () => {
	it.each(cases)('$name', (c) => {
		const input = inputOf(c);
		const today = input.day.today(input.now);
		const got = summaryNumbers(input);

		expect({ streak: got.streak, wordsKnown: got.wordsKnown, base: got.recall.base }).toEqual({
			streak: c.expect.streak,
			wordsKnown: c.expect.wordsKnown,
			base: c.expect.recall.base
		});
		if (c.expect.recall.share === null) expect(got.recall.share).toBeNull();
		else expect(got.recall.share).toBeCloseTo(c.expect.recall.share, 10);
		expect(got.studiedSeconds).toBeCloseTo(c.expect.studiedSeconds, 10);

		const series = reviewsPerDay(input);
		const nonEmpty = series
			.filter((day) => day.count > 0)
			.map((day): [string, number] => [day.day, day.count]);
		expect(nonEmpty).toEqual(c.expect.reviewsPerDay);
		expect(series).toHaveLength(30);
		expect(series[29]).toEqual({ day: today, count: series[29].count, today: true });
		expect(series[0].day).toBe(addDays(today, -29));
		expect(series.filter((day) => day.today)).toHaveLength(1);
	});
});

describe('summaryNumbers', () => {
	it('counts a grammar lesson day in the streak, of this workspace only (#277)', () => {
		const input = inputOf(cases[0]);
		const day = input.day;
		const today = day.today(input.now);
		const run = (id: string, ws: number, date: string): GrammarRun => {
			const r = parseGrammarRun({ id, workspaceId: ws, ts: `${date}T12:00:00Z`, type: 'grammar', payload: grammarPayload('p', 'a', 1, 1) });
			if (r === null) throw new Error('no run');
			return r;
		};
		const base = summaryNumbers({ ...input, reviews: [], vacation: [] }).streak;
		expect(base).toBe(0);
		const own = [run('g1', input.workspaceId, addDays(today, -1)), run('g2', input.workspaceId, today)];
		expect(summaryNumbers({ ...input, reviews: [], vacation: [], grammarRuns: own }).streak).toBe(2);
		expect(summaryNumbers({ ...input, reviews: [], vacation: [], grammarRuns: [run('g3', input.workspaceId + 1, today)] }).streak).toBe(0);
	});

	it('counts a drill answer day in the streak, of this workspace only', () => {
		const input = inputOf(cases[0]);
		const today = input.day.today(input.now);
		const answer = (id: string, ws: number, date: string): DrillAnswer => {
			const a = parseDrillAnswer({ id, workspaceId: ws, ts: `${date}T12:00:00Z`, type: 'drill.tone-pairs', payload: drillPayload('3-4', 'produce', 1) });
			if (a === null) throw new Error('no answer');
			return a;
		};
		const own = [answer('d1', input.workspaceId, addDays(today, -1)), answer('d2', input.workspaceId, today)];
		expect(summaryNumbers({ ...input, reviews: [], vacation: [], drillAnswers: own }).streak).toBe(2);
		expect(summaryNumbers({ ...input, reviews: [], vacation: [], drillAnswers: [answer('d3', input.workspaceId + 1, today)] }).streak).toBe(0);
	});

	it('counts a course step day in the streak, of this workspace only (#225)', () => {
		const input = inputOf(cases[0]);
		const today = input.day.today(input.now);
		const step = (id: string, ws: number, date: string): CourseStep => {
			const payload = { kind: 'lesson-finished', course: 'c', unit: 'u', lesson: 'words-1', score: 1, total: 1, words: [] };
			const s = courseStepOf({ id, workspaceId: ws, ts: `${date}T12:00:00Z`, type: 'course', payload });
			if (s === null) throw new Error('no step');
			return s;
		};
		const own = [step('k1', input.workspaceId, addDays(today, -1)), step('k2', input.workspaceId, today)];
		expect(summaryNumbers({ ...input, reviews: [], vacation: [], courseSteps: own }).streak).toBe(2);
		expect(summaryNumbers({ ...input, reviews: [], vacation: [], courseSteps: [step('k3', input.workspaceId + 1, today)] }).streak).toBe(0);
	});

	it('uses the decks page’s 30-day window, one constant for both', () => {
		expect(STATS_WINDOW_DAYS).toBe(DECK_WINDOW_DAYS);
	});

	it('reuses deckNumbers for recall (one call with deckId null)', () => {
		vi.mocked(deckNumbers).mockClear();
		summaryNumbers(inputOf(cases[0]));

		expect(deckNumbers).toHaveBeenCalledTimes(1);
		expect(vi.mocked(deckNumbers).mock.calls[0][0].deckId).toBeNull();
	});

	it('ignores reviews of another workspace', () => {
		const base = cases.find((c) => c.name === 'a review at 03:30 local belongs to the local learner day')!;
		const input = inputOf(base, 1);
		// The caller passes one workspace's history; a foreign event in the
		// same array must still not count anywhere.
		const foreign: ReviewEvent[] = [
			{
				id: 'foreign',
				workspaceId: 2,
				device: 'fixture',
				ts: '2026-11-17T10:00:00Z',
				type: 'review',
				payload: { cardId: 'c1', mode: 'vocab', grade: 3, meta: { durationMs: 5000 } }
			}
		];
		const got = summaryNumbers({ ...input, reviews: [...input.reviews, ...foreign] });
		const series = reviewsPerDay({ ...input, reviews: [...input.reviews, ...foreign] });

		expect(series.find((day) => day.day === '2026-11-17')?.count).toBe(0);
		expect(got.studiedSeconds).toBeCloseTo(10, 10);
	});

	it('reviewsPerDay returns exactly 30 days ending today, zero-filled, today flagged', () => {
		const got = reviewsPerDay(inputOf(cases[0]));
		expect(got).toHaveLength(30);
		expect(got[0].day).toBe('2026-10-20');
		expect(got[29]).toEqual({ day: '2026-11-18', count: 0, today: true });
		expect(got.every((day, i) => day.day === addDays('2026-10-20', i))).toBe(true);
	});
});
