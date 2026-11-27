import { describe, expect, it, beforeEach } from 'vitest';
import fixture from '../../../../../docs/contracts/weekly/week-summary.json';
import type { ActivityCell, ActivitySource } from '../api/stats';
import type { CharRow } from '../api/types';
import { parseGoalsRow, type GoalsRow } from '../goals/goals';
import { usesHan } from '$lib/languages';
import { GENERAL_DECK_ID } from '$lib/studycore/types';
import type { Run } from '$lib/studycore/vacation';
import type { ReviewEvent, StudyCard } from '$lib/studycore/types';
import { addDays, studyDay, type ZoneChange } from '../time/studyDay';
import { charactersLearned, givenTimelines, wordsReachingMature } from './replay';
import { weekSummary, type WeekInputs, type WeekPasses } from './summary';
import { oldestWeek } from './week';
import { grammarPayload } from '$lib/events/eventPayloads';
import { parseGrammarRun, type GrammarRun } from '$lib/studycore/grammarRuns';

// A fresh memo per test (record 0009: the session owns one).
let weekPasses = new Map() as WeekPasses;
beforeEach(() => {
	weekPasses = new Map() as WeekPasses;
});

interface FixtureReview {
	id: string;
	ts: string;
	cardId: string;
	grade: number;
	durationMs?: number;
}
interface SummaryCase {
	name: string;
	history: ZoneChange[];
	now: string;
	week: string;
	workspace: number;
	language: string;
	vacation: Run[];
	goals: unknown;
	activity: { sources: ActivitySource[]; cells: ActivityCell[] } | null;
	reviews: FixtureReview[];
	cards?: { id: string; kind: StudyCard['kind']; written?: string; deckIds: string[] }[];
	decks?: string[];
	timelines?: Record<string, { ts: string; state: number; stability: number }[]>;
	chars?: CharRow[];
	expect: Record<string, unknown>;
}

function toReview(r: FixtureReview, workspaceId = 1): ReviewEvent {
	return {
		id: r.id,
		workspaceId,
		device: 'web',
		ts: r.ts,
		type: 'review',
		payload: {
			cardId: r.cardId,
			mode: 'vocab',
			grade: r.grade,
			...(r.durationMs === undefined ? {} : { meta: { durationMs: r.durationMs } })
		}
	} as unknown as ReviewEvent;
}

function inputsOf(c: SummaryCase): WeekInputs {
	const parsed = parseGoalsRow(c.goals);
	const input: WeekInputs = {
		monday: c.week,
		now: Date.parse(c.now),
		day: studyDay(c.history),
		workspaceId: c.workspace,
		reviews: c.reviews.map((r) => toReview(r, c.workspace)),
		vacation: c.vacation,
		activity: c.activity,
		goals: parsed === 'newer' ? null : (parsed as GoalsRow | null)
	};
	if (c.timelines !== undefined) {
		const t = givenTimelines(c.timelines);
		const cards = (c.cards ?? []).map((card) => ({ ...card, entryId: 1, createdAt: '2026-01-01T00:00:00Z' }));
		const decks = new Set([GENERAL_DECK_ID, ...(c.decks ?? [])]);
		input.mature = (before, after) => wordsReachingMature(cards, decks, t, before, after);
		if (usesHan(c.language)) {
			input.characters = (before, after) => charactersLearned(c.chars ?? [], cards, t, before, after);
		}
	}
	return input;
}

const cases = fixture.cases as unknown as SummaryCase[];

describe('week-summary.json', () => {
	it.each(cases.map((c) => [c.name, c] as const))('%s', (_n, c) => {
		const summary = weekSummary(weekPasses, inputsOf(c));
		// The fixture's days carry date, state and reviews (points are the route's own numbers).
		const out = {
			...summary,
			days: summary.days.map(({ date, state, reviews }) => ({ date, state, reviews }))
		} as unknown as Record<string, unknown>;
		for (const [key, value] of Object.entries(c.expect)) {
			expect(out[key], key).toEqual(value);
		}
		expect(out.monday).toBe(c.week);
	});
});

const base = cases.find((c) => c.name.startsWith('a completed week'))!;

describe('weekSummary', () => {
	it('throws for a week after the current one', () => {
		expect(() => weekSummary(weekPasses, { ...inputsOf(base), monday: '2026-11-23' })).toThrow(RangeError);
	});

	it('counts grammar lesson days of the workspace in the streak (#277)', () => {
		const input = inputsOf(base);
		const plain = weekSummary(weekPasses, input).streak;
		const runAt = (id: string, ws: number, ts: string): GrammarRun => {
			const r = parseGrammarRun({ id, workspaceId: ws, ts, type: 'grammar', payload: grammarPayload('p', 'a', 1, 1) });
			if (r === null) throw new Error('no run');
			return r;
		};
		// A run on each day of the (completed) week: a seven-day run at least.
		const runs = (ws: number) =>
			Array.from({ length: 7 }, (_, i) => runAt(`g${ws}-${i}`, ws, new Date(input.day.dayStart(addDays(input.monday, i)) + 60_000).toISOString()));
		const withRun = weekSummary(new Map() as WeekPasses, { ...input, vacation: [], grammarRuns: runs(input.workspaceId) }).streak;
		const foreign = weekSummary(new Map() as WeekPasses, { ...input, grammarRuns: runs(input.workspaceId + 1) }).streak;
		expect(plain).toBeLessThan(7);
		expect(withRun).toBeGreaterThanOrEqual(7);
		expect(foreign).toBe(plain);
	});

	it('throws for a date that is not a Monday', () => {
		expect(() => weekSummary(weekPasses, { ...inputsOf(base), monday: '2026-11-10' })).toThrow(RangeError);
	});

	it('offline: no comparison for activity rows, localOnly days active', () => {
		const out = weekSummary(weekPasses, { ...inputsOf(base), activity: null });
		const byKey = new Map(out.rows.map((r) => [r.key, r]));
		expect(byKey.get('reviews')).toMatchObject({ value: null, previous: null });
		expect(byKey.get('reading')).toMatchObject({ value: null, previous: null });
		expect(byKey.get('newCards')).toMatchObject({ value: 2, previous: 1 });
		expect(out.rows.map((r) => r.key)).toEqual(['reviews', 'newCards', 'studyTime', 'reading', 'journal']);
		expect(out.daysActive).toEqual({ active: 2, of: 7, localOnly: true });
		expect(out.days.every((d) => d.reviews === null && d.points === null)).toBe(true);
	});

	it('previousDays of the oldest browsable week are inactive with zero points when nothing was logged', () => {
		const monday = oldestWeek('2026-11-18');
		const out = weekSummary(weekPasses, { ...inputsOf(base), monday });
		expect(out.previousDays.map((d) => d.date)).toEqual([
			'2025-11-10',
			'2025-11-11',
			'2025-11-12',
			'2025-11-13',
			'2025-11-14',
			'2025-11-15',
			'2025-11-16'
		]);
		expect(out.previousDays.every((d) => d.state === 'inactive' && d.points === 0 && d.reviews === 0)).toBe(true);
		expect(out.previousDays.every((d) => d.state !== 'upcoming')).toBe(true);
	});

	it('a review on a vacation date counts in new cards and not in days active', () => {
		const out = weekSummary(weekPasses, { ...inputsOf(base), vacation: [{ start: '2026-11-09', end: '2026-11-09' }] });
		expect(out.rows.find((r) => r.key === 'newCards')?.value).toBe(2);
		expect(out.days[0].state).toBe('vacation');
		expect(out.daysActive).toEqual({ active: 4, of: 6, localOnly: false });
	});

	it('has mature and characters null without their callbacks', () => {
		const out = weekSummary(weekPasses, inputsOf(base));
		expect(out.mature).toBeNull();
		expect(out.characters).toBeNull();
	});

	it('passes the week and comparison cutoffs to the callbacks', () => {
		const calls: [string, string][] = [];
		const iso = (ms: number) => new Date(ms).toISOString();
		weekSummary(weekPasses, {
			...inputsOf(cases.find((c) => c.name.startsWith('the week in progress'))!),
			mature: (b, a) => {
				calls.push([iso(b), iso(a)]);
				return 0;
			}
		});
		// In progress on Wednesday 11-18: the week to the end of today, the
		// comparison window 11-09 to the end of 11-11.
		expect(calls).toEqual([
			['2026-11-16T00:00:00.000Z', '2026-11-19T00:00:00.000Z'],
			['2026-11-09T00:00:00.000Z', '2026-11-12T00:00:00.000Z']
		]);
	});
});
