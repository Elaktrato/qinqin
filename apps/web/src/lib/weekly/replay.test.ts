import { describe, expect, it } from 'vitest';
import fixture from '../../../../../docs/contracts/weekly/week-summary.json';
import type { CharRow } from '../api/types';
import { usesHan } from '../languages';
import { DEFAULT_W } from '../study/fsrs/params';
import { cellStates, masteryGlyphs, sectionStats } from '../study/charGroups';
import { masteryFromSchedules } from '../study/mastery';
import { scheduleAt, type TimelinePoint } from '../study/scheduler';
import { IDENTITY_CLOCK, clockFromRuns } from '../study/studyClock';
import { GENERAL_DECK_ID } from '../study/store';
import type { ReviewEvent, StudyCard } from '../study/types';
import { addDays, studyDay, type ZoneChange } from '../time/studyDay';
import {
	charactersLearned,
	givenTimelines,
	replayStats,
	timelinesFor,
	wordsReachingMature,
	type Timelines
} from './replay';
import * as build from '$lib/testing/study';

interface ReplayCase {
	name: string;
	history: ZoneChange[];
	week: string;
	language: string;
	decks: string[];
	cards: { id: string; kind: StudyCard['kind']; written?: string; deckIds: string[] }[];
	timelines: Record<string, { ts: string; state: number; stability: number }[]>;
	chars: CharRow[];
	expect: { mature: { value: number; previous: number }; characters: { value: number; previous: number } | null };
}

const toCard = (c: ReplayCase['cards'][number]): StudyCard => ({
	...c,
	entryId: 1,
	createdAt: '2026-01-01T00:00:00Z'
});

const cases = (fixture.cases as unknown as ReplayCase[]).filter((c) => 'timelines' in c);

describe('week-summary.json: mature and character crossings', () => {
	it('has replay cases', () => expect(cases.length).toBeGreaterThan(0));

	it.each(cases.map((c) => [c.name, c] as const))('%s', (_n, c) => {
		// These cases are completed weeks: the week ends at the next Monday.
		const day = studyDay(c.history);
		const cut = (d: string) => day.dayStart(d);
		const t = givenTimelines(c.timelines);
		const cards = c.cards.map(toCard);
		const decks = new Set([GENERAL_DECK_ID, ...c.decks]);
		const prev = addDays(c.week, -7);
		expect({
			value: wordsReachingMature(cards, decks, t, cut(c.week), cut(addDays(c.week, 7))),
			previous: wordsReachingMature(cards, decks, t, cut(prev), cut(c.week))
		}).toEqual(c.expect.mature);
		const characters = usesHan(c.language)
			? {
					value: charactersLearned(c.chars, cards, t, cut(c.week), cut(addDays(c.week, 7))),
					previous: charactersLearned(c.chars, cards, t, cut(prev), cut(c.week))
				}
			: null;
		expect(characters).toEqual(c.expect.characters);
	});
});

function ev(id: number, cardId: string, grade: number, ts: string): ReviewEvent {
	return build.review({ id: build.eventId(id, '01JRP'), cardId, grade, ts });
}

describe('timelinesFor', () => {
	const reviews = [
		ev(1, 'a', 3, '2026-11-01T10:00:00Z'),
		ev(2, 'a', 3, '2026-11-05T10:00:00Z'),
		ev(3, 'b', 1, '2026-11-02T10:00:00Z')
	];

	it('replays each card once per reviews array, weights and clock', () => {
		const before = replayStats.timelines;
		const t1 = timelinesFor(reviews, DEFAULT_W, IDENTITY_CLOCK);
		t1.of('a');
		t1.of('a');
		t1.of('b');
		const t2 = timelinesFor(reviews, DEFAULT_W, clockFromRuns([]));
		t2.of('a');
		t2.of('b');
		expect(replayStats.timelines - before).toBe(2);
		expect(t1.of('a')).toHaveLength(2);
		expect(t1.of('none')).toEqual([]);
	});

	it('keeps the timelines for a new array with the same reviews (a reloaded history after its TTL)', () => {
		timelinesFor(reviews, DEFAULT_W, IDENTITY_CLOCK).of('a');
		const before = replayStats.timelines;
		timelinesFor(reviews.map((r) => ({ ...r, payload: { ...r.payload } })), DEFAULT_W, IDENTITY_CLOCK).of('a');
		expect(replayStats.timelines - before).toBe(0);
	});

	it('replays again when the reviews, the weights or the clock change', () => {
		timelinesFor(reviews, DEFAULT_W, IDENTITY_CLOCK).of('a');
		const before = replayStats.timelines;
		timelinesFor([...reviews, ev(4, 'a', 1, '2026-11-06T10:00:00Z')], DEFAULT_W, IDENTITY_CLOCK).of('a');
		// A review moved to another card by a duplicate merge: same ids, other content.
		timelinesFor(reviews.map((r) => (r.payload.cardId === 'b' ? { ...r, payload: { ...r.payload, cardId: 'a' } } : r)), DEFAULT_W, IDENTITY_CLOCK).of('a');
		timelinesFor(reviews, DEFAULT_W.map((x, i) => (i === 0 ? x + 0.1 : x)), IDENTITY_CLOCK).of('a');
		timelinesFor(reviews, DEFAULT_W, clockFromRuns([{ a: Date.parse('2026-11-03T00:00:00Z'), n: 1 }])).of('a');
		expect(replayStats.timelines - before).toBe(4);
	});
});

const card = (id: string, kind: StudyCard['kind'], deckIds: string[], written?: string): StudyCard =>
	build.card({ id, kind, deckIds, createdAt: '2026-01-01T00:00:00Z', written });

describe('wordsReachingMature', () => {
	const t = givenTimelines({
		v: [{ ts: '2026-11-10T00:00:00Z', state: 2, stability: 30 }],
		r: [{ ts: '2026-11-10T00:00:00Z', state: 2, stability: 30 }],
		z: [{ ts: '2026-11-10T00:00:00Z', state: 2, stability: 30 }]
	});
	const before = Date.parse('2026-11-09T00:00:00Z');
	const after = Date.parse('2026-11-16T00:00:00Z');

	it('counts vocab cards only, in an existing deck', () => {
		const decks = new Set(['general']);
		const cards = [card('v', 'vocab', ['general']), card('r', 'reverse', ['general']), card('z', 'cloze', ['general'])];
		expect(wordsReachingMature(cards, decks, t, before, after)).toBe(1);
		expect(wordsReachingMature([card('v', 'vocab', ['gone'])], decks, t, before, after)).toBe(0);
		expect(wordsReachingMature([], decks, t, before, after)).toBe(0);
	});
});

describe('charactersLearned', () => {
	it('is the difference of sectionStats(...).learned when no cell drops (seeded)', () => {
		let seed = 7;
		const rand = (): number => {
			seed = (seed * 1103515245 + 12345) % 2147483648;
			return seed / 2147483648;
		};
		const glyphs = ['一', '二', '三', '四', '五', '六'];
		const chars: CharRow[] = glyphs.map((c, i) => (i === 0 ? { c, v: ['壹'] } : { c })) as CharRow[];
		for (let round = 0; round < 30; round++) {
			const cards: StudyCard[] = [];
			const map: Record<string, { ts: string; state: number; stability: number }[]> = {};
			for (let i = 0; i < 8; i++) {
				const id = `c${i}`;
				const written = [...glyphs, '壹'][Math.floor(rand() * 7)] + glyphs[Math.floor(rand() * 6)];
				cards.push(card(id, i % 2 === 0 ? 'vocab' : 'writing', ['general'], written));
				// Stability only grows, so no cell drops.
				const s1 = rand() * 200;
				map[id] = [
					{ ts: '2026-11-01T00:00:00Z', state: 2, stability: s1 },
					{ ts: '2026-11-10T00:00:00Z', state: 2, stability: s1 + rand() * 300 }
				];
			}
			const t: Timelines = givenTimelines(map);
			const before = Date.parse('2026-11-09T00:00:00Z');
			const after = Date.parse('2026-11-16T00:00:00Z');
			const learnedAt = (cut: number) =>
				sectionStats(
					cellStates(chars, masteryFromSchedules(masteryGlyphs(chars), cards, (id) => scheduleAt(t.of(id), cut)))
				).learned;
			expect(charactersLearned(chars, cards, t, before, after)).toBe(learnedAt(after) - learnedAt(before));
		}
	});

	it('samples the given timelines', () => {
		const tl: readonly TimelinePoint[] = givenTimelines({ a: [{ ts: '2026-11-01T00:00:00Z', state: 2, stability: 5 }] }).of('a');
		expect(tl).toEqual([
			{ ts: Date.parse('2026-11-01T00:00:00Z'), schedule: { due: '2026-11-01T00:00:00Z', stability: 5, difficulty: 0, state: 2 } }
		]);
	});
});
