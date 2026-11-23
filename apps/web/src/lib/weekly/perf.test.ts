import { describe, expect, it } from 'vitest';
import { DEFAULT_W } from '../study/fsrs/params';
import { IDENTITY_CLOCK } from '../study/studyClock';
import type { ReviewEvent, StudyCard } from '../study/types';
import { addDays, studyDay } from '../time/studyDay';
import { replayStats, timelinesFor, wordsReachingMature } from './replay';
import { summaryStats, weekSummary } from './summary';
import { MAX_WEEKS_BACK, weekOf } from './week';

// A guard against an accidental per-week replay: 53 weeks (current + 52
// back) of a large history replay each reviewed card exactly once. The
// replay count is the check; no wall-clock limit (0005-test-conventions).
const CARDS = 5000;
const REVIEWS = 50_000;
const NOW = Date.parse('2026-11-18T12:00:00Z');
const DAY = 86_400_000;

function seeded(seed: number): () => number {
	let s = seed;
	return () => {
		s = (s * 1103515245 + 12345) % 2147483648;
		return s / 2147483648;
	};
}

describe('weekly summary performance', () => {
	it('replays each reviewed card once for 53 weeks', () => {
		const rand = seeded(81);
		const cards: StudyCard[] = Array.from({ length: CARDS }, (_, i) => ({
			id: `c${i}`,
			kind: 'vocab',
			entryId: i,
			deckIds: ['general'],
			createdAt: '2025-01-01T00:00:00Z'
		}));
		const start = NOW - 400 * DAY;
		const reviews: ReviewEvent[] = Array.from({ length: REVIEWS }, (_, i) => ({
			id: `01JPERF${String(i).padStart(19, '0')}`,
			workspaceId: 1,
			device: 'web',
			ts: new Date(start + Math.floor(rand() * 400 * DAY)).toISOString(),
			type: 'review',
			payload: { cardId: `c${i % CARDS}`, mode: 'vocab', grade: (1 + Math.floor(rand() * 4)) as 1 | 2 | 3 | 4 }
		}));
		const day = studyDay([]);
		const decks = new Set(['general']);
		const before = replayStats.timelines;
		const current = weekOf(day.today(NOW));
		for (let k = 0; k <= MAX_WEEKS_BACK; k++) {
			const t = timelinesFor(reviews, DEFAULT_W, IDENTITY_CLOCK);
			weekSummary({
				monday: addDays(current, -7 * k),
				now: NOW,
				day,
				workspaceId: 1,
				reviews,
				vacation: [],
				activity: { sources: [], cells: [] },
				goals: null,
				mature: (b, a) => wordsReachingMature(cards, decks, t, b, a)
			});
		}
		expect(replayStats.timelines - before).toBe(CARDS);

		// After the study history's TTL the page gets a new, equal history
		// object: browsing on replays nothing and repeats no log pass.
		const reloaded = reviews.map((r) => ({ ...r, payload: { ...r.payload } }));
		const passes = summaryStats.logPasses;
		const t = timelinesFor(reloaded, DEFAULT_W, IDENTITY_CLOCK);
		for (let k = 0; k < 3; k++) {
			weekSummary({
				monday: addDays(current, -7 * k),
				now: NOW,
				day,
				workspaceId: 1,
				reviews: reloaded,
				vacation: [],
				activity: { sources: [], cells: [] },
				goals: null,
				mature: (b, a) => wordsReachingMature(cards, decks, t, b, a)
			});
		}
		expect(replayStats.timelines - before).toBe(CARDS);
		expect(summaryStats.logPasses).toBe(passes);
	}, 60_000);
});
