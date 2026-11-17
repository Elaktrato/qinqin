import { describe, expect, it } from 'vitest';
import fixture from '../../../../../docs/contracts/milestones/reached.json';
import type { CharRow } from '$lib/api/types';
import { classifySchedule } from '$lib/stats/wordStates';
import { cellStates, masteryGlyphs } from '$lib/study/charGroups';
import { MASTERY_THRESHOLD, masteryFromSchedules } from '$lib/study/mastery';
import { scheduleAt } from '$lib/study/scheduler';
import { GENERAL_DECK_ID } from '$lib/study/store';
import { studyClock } from '$lib/study/studyClock';
import type { ReviewEvent, StudyCard, StudyCardKind } from '$lib/study/types';
import { studyDay } from '$lib/time/studyDay';
import { DEFAULT_W } from '$lib/study/fsrs/params';
import { givenTimelines, replayStats, timelinesFor, type Timelines } from '$lib/weekly/replay';
import { enabledFamilies } from './catalogue';
import { reachedFromReplay, sweep, type LevelInput, type ReplayInputs } from './replayReached';
import { asFixture, decodeCase, expectedOf, type ReachedCase } from './testing/reachedCase';

const cases = fixture.cases as unknown as ReachedCase[];

function replayInputs(c: ReachedCase): ReplayInputs {
	const d = decodeCase(c);
	return {
		cards: d.cards,
		deckIds: d.deckIds,
		timelines: d.timelines,
		day: d.day,
		now: d.now,
		families: d.families,
		chars: d.chars,
		levels: d.levels
	};
}

describe('milestones/reached.json: replay families', () => {
	it.each(cases)('$name', (c) => {
		expect(asFixture(reachedFromReplay(replayInputs(c)))).toEqual(expectedOf(c, 'replay'));
	});
});

function rng(seed: number): () => number {
	let a = seed;
	return () => {
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

const UTC = studyDay([]);
const ALL = enabledFamilies({ flashcards: true, reader: true, journal: true, han: true });
const GLYPHS = Array.from('一二三四五六七八九十人大小山水火木金土日月中国學学來来門门東东');

/** 200 cards over 30 glyphs (variants included), 3 000 reviews, random schedules. */
function world(seed: number) {
	const next = rng(seed);
	const kinds: StudyCardKind[] = ['vocab', 'vocab', 'vocab', 'sentence', 'writing', 'tone', 'reverse', 'cloze'];
	const cards: StudyCard[] = [];
	for (let i = 0; i < 200; i++) {
		const kind = kinds[Math.floor(next() * kinds.length)];
		const len = 1 + Math.floor(next() * 3);
		const written = Array.from({ length: len }, () => GLYPHS[Math.floor(next() * GLYPHS.length)]).join('');
		const deck = next() < 0.1 ? 'gone' : next() < 0.5 ? GENERAL_DECK_ID : 'd1';
		cards.push({ id: `c${i}`, kind, entryId: 1000 + Math.floor(i / 2), written, deckIds: [deck], createdAt: 't' });
	}
	const map: Record<string, { ts: string; state: number; stability: number }[]> = {};
	const start = Date.parse('2026-01-01T00:00:00Z');
	for (let r = 0; r < 3000; r++) {
		const card = Math.floor(next() * 210); // c200..c209 are deleted cards
		const at = start + Math.floor(next() * 120) * 86_400_000 + Math.floor(next() * 4) * 3_600_000;
		const state = next() < 0.1 ? 3 : next() < 0.2 ? 1 : 2;
		const stability = Math.round(next() * 400 * 100) / 100;
		(map[`c${card}`] ??= []).push({ ts: new Date(at).toISOString(), state, stability });
	}
	const chars: CharRow[] = [
		...'一二三四五六七八九十人大小山水火木金土日月中'.split('').map((c, i) => ({ i, c }) as CharRow),
		{ i: 100, c: '国' } as CharRow,
		{ i: 101, c: '学', v: ['學'] } as CharRow,
		{ i: 102, c: '来', v: ['來'] } as CharRow,
		{ i: 103, c: '门', v: ['門'] } as CharRow,
		{ i: 104, c: '东', v: ['東'] } as CharRow
	];
	const levels: LevelInput[] = [
		{ packId: 'w', level: 'A', unit: 'word', entryIds: [1000, 1001, 1002] },
		{ packId: 'w', level: 'B', unit: 'word', entryIds: Array.from({ length: 30 }, (_, i) => 1000 + i) },
		{ packId: 'c', level: 'A', unit: 'character', cells: [['一'], ['二'], ['学', '學']], entryIds: [] },
		{ packId: 'c', level: 'B', unit: 'character', cells: chars.slice(0, 12).map((r) => [r.c, ...(r.v ?? [])]), entryIds: [] }
	];
	return { cards, timelines: givenTimelines(map), map, chars, levels, now: start + 130 * 86_400_000 };
}

describe('the sweep equals a snapshot at every point (seeded)', () => {
	for (const seed of [11, 12, 13]) {
		it(`seed ${seed}`, () => {
			const w = world(seed);
			const deckIds = new Set([GENERAL_DECK_ID, 'd1']);
			const scoped = w.cards.filter((c) => c.kind === 'vocab' && c.deckIds.some((d) => deckIds.has(d)));
			const glyphs = masteryGlyphs(w.chars);
			let steps = 0;
			sweep(
				{ cards: w.cards, deckIds, timelines: w.timelines, day: UTC, now: w.now, families: ALL, chars: w.chars, levels: w.levels },
				(t, state) => {
					steps += 1;
					const at = (id: string) => scheduleAt(w.timelines.of(id), t + 1);
					expect(state.mature, `mature at ${t}`).toBe(scoped.filter((c) => classifySchedule(at(c.id)) === 'mature').length);
					const mastery = masteryFromSchedules(glyphs, w.cards, at);
					const learned = cellStates(w.chars, mastery).filter((cell) => cell.score >= MASTERY_THRESHOLD).length;
					expect(state.learned, `learned at ${t}`).toBe(learned);
					w.levels.forEach((level, i) => {
						let members: number;
						if (level.unit === 'character') {
							const m = masteryFromSchedules(level.cells!.flat(), w.cards, at);
							members = level.cells!.filter((forms) => forms.some((g) => (m.get(g)?.score ?? 0) >= MASTERY_THRESHOLD)).length;
						} else {
							members = new Set(level.entryIds).size - [...new Set(level.entryIds)].filter((e) => !scoped.some((c) => c.entryId === e && classifySchedule(at(c.id)) === 'mature')).length;
						}
						expect(state.levels[i], `level ${i} at ${t}`).toBe(members);
					});
				}
			);
			expect(steps).toBeGreaterThan(100);
		});
	}

	it('the reached instants are the first at which a snapshot reaches the threshold (ever reached)', () => {
		const w = world(21);
		const deckIds = new Set([GENERAL_DECK_ID, 'd1']);
		const scoped = w.cards.filter((c) => c.kind === 'vocab' && c.deckIds.some((d) => deckIds.has(d)));
		const got = reachedFromReplay({ cards: w.cards, deckIds, timelines: w.timelines, day: UTC, now: w.now, families: ALL, chars: w.chars, levels: w.levels });
		const instants = [...new Set(Object.values(w.map).flat().map((p) => Date.parse(p.ts)))].sort((a, b) => a - b);
		const matureAt = (t: number) => scoped.filter((c) => classifySchedule(scheduleAt(w.timelines.of(c.id), t + 1)) === 'mature').length;
		for (const n of [10, 50]) {
			const first = instants.find((t) => matureAt(t) >= n);
			expect(got.find((r) => r.id === `words-mature:${n}`)?.at, `words-mature:${n}`).toBe(first);
		}
	});
});

describe('reachedFromReplay', () => {
	const t0 = Date.parse('2026-01-01T09:00:00Z');
	const point = (ts: number, state: number, stability: number) => ({ ts: new Date(ts).toISOString(), state, stability });
	const ten = (kind: StudyCardKind = 'vocab', deck = GENERAL_DECK_ID): StudyCard[] =>
		Array.from({ length: 10 }, (_, i) => ({ id: `c${i}`, kind, entryId: i, deckIds: [deck], createdAt: 't' }));
	const matureTen = (lapse?: number) =>
		givenTimelines(
			Object.fromEntries(
				Array.from({ length: 10 }, (_, i) => [
					`c${i}`,
					[point(t0 + i * 1000, 2, 30), ...(lapse !== undefined && i === 0 ? [point(t0 + lapse, 3, 2)] : [])]
				])
			)
		);
	const input = (over: Partial<ReplayInputs>): ReplayInputs => ({
		cards: ten(),
		deckIds: new Set([GENERAL_DECK_ID]),
		timelines: matureTen(),
		day: UTC,
		now: t0 + 86_400_000,
		families: ALL,
		chars: null,
		levels: [],
		...over
	});

	it('a lapse after the crossing keeps the milestone', () => {
		expect(reachedFromReplay(input({ timelines: matureTen(20_000) })).map((r) => r.id)).toEqual(['words-mature:10']);
	});

	it('a lapse before the 10th crossing delays it to never', () => {
		expect(reachedFromReplay(input({ timelines: matureTen(5_000) }))).toEqual([]);
	});

	it('a card in no existing deck, a reverse card and a deleted card never count', () => {
		const cards = ten();
		expect(reachedFromReplay(input({ cards: cards.slice(1) }))).toEqual([]);
		expect(reachedFromReplay(input({ cards: [...cards.slice(1), { ...cards[0], deckIds: ['gone'] }] }))).toEqual([]);
		expect(reachedFromReplay(input({ cards: [...cards.slice(1), { ...cards[0], kind: 'reverse' }] }))).toEqual([]);
	});

	it('a point after now is ignored', () => {
		expect(reachedFromReplay(input({ now: t0 + 8_000 }))).toEqual([]);
		expect(reachedFromReplay(input({ now: t0 + 9_000 })).map((r) => r.id)).toEqual(['words-mature:10']);
	});

	it('disabled families yield nothing', () => {
		expect(reachedFromReplay(input({ families: new Set(['reviews', 'days-active']) }))).toEqual([]);
	});

	it('builds no new timeline for an already built timelines object', () => {
		const reviews: ReviewEvent[] = Array.from({ length: 40 }, (_, i) => ({
			id: `r${String(i).padStart(4, '0')}`,
			workspaceId: 1,
			device: 'web',
			ts: new Date(t0 + i * 86_400_000).toISOString(),
			type: 'review',
			payload: { cardId: `c${i % 10}`, mode: 'vocab', grade: 3 }
		}));
		const cards = ten().map((c, i) => ({ ...c, written: '一二三四五六七八九十'[i] }));
		const clock = studyClock([], UTC);
		const t = timelinesFor(reviews, DEFAULT_W, clock);
		for (const card of cards) t.of(card.id);
		const built = replayStats.timelines;
		const chars = Array.from('一二三四五六七八九十').map((c, i) => ({ i, c }) as CharRow);
		reachedFromReplay(input({ cards, timelines: t, chars, now: t0 + 60 * 86_400_000 }));
		expect(replayStats.timelines).toBe(built);
	});

	it('memoises per timelines object', () => {
		const timelines: Timelines = matureTen();
		const a = reachedFromReplay(input({ timelines }));
		expect(reachedFromReplay(input({ timelines }))).toBe(a);
		expect(reachedFromReplay(input({ timelines: matureTen() }))).not.toBe(a);
	});
});

