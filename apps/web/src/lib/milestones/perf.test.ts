import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/study/data', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/study/data')>()),
	loadStudyHistory: vi.fn()
}));
vi.mock('$lib/events', () => ({ loadWorkspaceEvents: vi.fn() }));
vi.mock('$lib/api/schemes', () => ({ getSchemes: vi.fn(async () => []), getSchemeEntries: vi.fn(), fetchSchemeCharacters: vi.fn() }));
vi.mock('$lib/time/zone', async () => {
	const { studyDay } = await import('$lib/time/studyDay');
	// One rule object, as the app's cached currentStudyDay gives.
	const day = studyDay([]);
	return { currentStudyDay: () => day, currentStudyHistory: () => [], onStudyDayChange: () => () => {} };
});

import type { CharRow } from '$lib/api/types';
import type { StudyEvent } from '$lib/events';
import { loadWorkspaceEvents } from '$lib/events';
import { pluginStates } from '$lib/plugins/states';
import { DEFAULT_W } from '$lib/study/fsrs/params';
import { loadStudyHistory } from '$lib/study/data';
import { GENERAL_DECK_ID } from '$lib/study/types';
import { IDENTITY_CLOCK } from '$lib/study/studyClock';
import type { ReviewEvent, StudyCard } from '$lib/study/types';
import { studyDay } from '$lib/time/studyDay';
import { replayStats, timelinesFor } from '$lib/weekly/replay';
import { enabledFamilies } from './catalogue';
import { loadMilestones } from './loadMilestones';
import { reachedFromLog, reachedStats } from './reached';
import { reachedFromReplay } from './replayReached';

// A guard against an extra replay and a repeated log pass: 5 000 cards,
// 50 000 reviews, 2 000 read and 300 journal events. The bounds are
// generous on purpose (CI hardware); the counts are the real check.
const CARDS = 5000;
const REVIEWS = 50_000;
const NOW = Date.parse('2026-11-18T12:00:00Z');
const DAY = 86_400_000;
const GLYPHS = Array.from('一二三四五六七八九十人大小山水火木金土日月中国学来门东西南北上下左右');

function seeded(seed: number): () => number {
	let s = seed;
	return () => {
		s = (s * 1103515245 + 12345) % 2147483648;
		return s / 2147483648;
	};
}

function world() {
	const rand = seeded(94);
	const cards: StudyCard[] = Array.from({ length: CARDS }, (_, i) => ({
		id: `c${i}`,
		kind: 'vocab',
		entryId: i,
		written: GLYPHS[i % GLYPHS.length] + GLYPHS[(i * 7) % GLYPHS.length],
		deckIds: [GENERAL_DECK_ID],
		createdAt: '2025-01-01T00:00:00Z'
	}));
	const start = NOW - 400 * DAY;
	const reviews: ReviewEvent[] = Array.from({ length: REVIEWS }, (_, i) => ({
		id: `01JMPERF${String(i).padStart(18, '0')}`,
		workspaceId: 1,
		device: 'web',
		ts: new Date(start + Math.floor(rand() * 400 * DAY)).toISOString(),
		type: 'review',
		payload: { cardId: `c${i % CARDS}`, mode: 'vocab', grade: (1 + Math.floor(rand() * 4)) as 1 | 2 | 3 | 4 }
	}));
	const events: StudyEvent[] = [
		...Array.from({ length: 2000 }, (_, i) => ({
			id: `01JMREAD${String(i).padStart(18, '0')}`,
			workspaceId: 1,
			device: 'web',
			ts: new Date(start + Math.floor(rand() * 400 * DAY)).toISOString(),
			type: 'read',
			payload: { bookId: 1, seconds: 30 + Math.floor(rand() * 3000) }
		})),
		...Array.from({ length: 300 }, (_, i) => ({
			id: `01JMJRNL${String(i).padStart(18, '0')}`,
			workspaceId: 1,
			device: 'web',
			ts: new Date(start + Math.floor(rand() * 400 * DAY)).toISOString(),
			type: 'journal',
			payload: { entryId: `J${i}` }
		}))
	];
	const chars = GLYPHS.map((c, i) => ({ i, c }) as CharRow);
	return { cards, reviews, events, chars };
}

const w = world();
const day = studyDay([]);
const families = enabledFamilies({ flashcards: true, reader: true, journal: true, han: true });

afterEach(() => vi.clearAllMocks());

describe('milestones performance', () => {
	it('one log pass, and none for an equal reloaded log', () => {
		const input = { reviews: w.reviews, events: w.events, cards: w.cards, deckIds: new Set([GENERAL_DECK_ID]), day, vacation: [], now: NOW, families };
		const passes = reachedStats.passes;
		const first = reachedFromLog(input);
		expect(reachedStats.passes - passes).toBe(1);
		expect(first.length).toBeGreaterThan(20);
		const reloaded = w.reviews.map((r) => ({ ...r, payload: { ...r.payload } }));
		expect(reachedFromLog({ ...input, reviews: reloaded })).toBe(first);
		expect(reachedStats.passes - passes).toBe(1);
	});

	it('the Week tab adds no replay: the sweep reuses the built timelines', async () => {
		const t = timelinesFor(w.reviews, DEFAULT_W, IDENTITY_CLOCK);
		// What loadWeek and loadWeekCharacters already did.
		for (const card of w.cards) t.of(card.id);
		const built = replayStats.timelines;
		const reached = reachedFromReplay({ cards: w.cards, deckIds: new Set([GENERAL_DECK_ID]), timelines: t, day, now: NOW, families, chars: w.chars, levels: [] });
		expect(reached.some((r) => r.id.startsWith('words-mature:'))).toBe(true);
		expect(replayStats.timelines).toBe(built);

		// The loader on the Week tab: given the timelines, nothing is replayed again.
		vi.mocked(loadStudyHistory).mockResolvedValue({ decks: [], cards: w.cards, reviews: w.reviews, merged: 0 });
		vi.mocked(loadWorkspaceEvents).mockResolvedValue(w.events);
		pluginStates.set({ list: [], status: 'ready' });
		await loadMilestones(1, { scope: 'week', language: 'zh', now: NOW, week: { timelines: t, chars: w.chars, cards: w.cards } });
		expect(replayStats.timelines).toBe(built);
		// Home: no replay at all.
		await loadMilestones(1, { scope: 'home', language: 'zh', now: NOW });
		expect(replayStats.timelines).toBe(built);
		// A reload (new, equal history and event log arrays after the caches' TTL) walks the log no more.
		const passes = reachedStats.passes;
		vi.mocked(loadStudyHistory).mockResolvedValue({ decks: [], cards: w.cards, reviews: w.reviews.map((r) => ({ ...r })), merged: 0 });
		vi.mocked(loadWorkspaceEvents).mockResolvedValue(w.events.map((e) => ({ ...e })));
		await loadMilestones(1, { scope: 'home', language: 'zh', now: NOW });
		expect(reachedStats.passes).toBe(passes);
		pluginStates.set({ list: [], status: 'idle' });
	}, 60_000);
});
