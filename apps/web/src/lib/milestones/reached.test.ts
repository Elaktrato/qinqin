import { describe, expect, it } from 'vitest';
import fixture from '../../../../../docs/contracts/milestones/reached.json';
import type { StudyEvent } from '$lib/events';
import { dailyStreak } from '$lib/study/exp';
import { GENERAL_DECK_ID } from '$lib/study/store';
import type { ReviewEvent, StudyCard } from '$lib/study/types';
import { studyDay } from '$lib/time/studyDay';
import { readSeconds } from '$lib/stats/readingTime';
import { FAMILIES, enabledFamilies, milestoneId, type MilestoneFamily } from './catalogue';
import { journalEntryId, reachedFromLog, type LogInputs } from './reached';
import { asFixture, decodeCase, expectedOf, type ReachedCase } from './testing/reachedCase';

const cases = fixture.cases as unknown as ReachedCase[];

function logInputs(c: ReachedCase): LogInputs {
	const d = decodeCase(c);
	return {
		reviews: d.reviews,
		events: d.events,
		cards: d.cards,
		deckIds: d.deckIds,
		day: d.day,
		vacation: d.vacation,
		now: d.now,
		families: d.families
	};
}

describe('milestones/reached.json: log families', () => {
	it.each(cases)('$name', (c) => {
		expect(asFixture(reachedFromLog(logInputs(c)))).toEqual(expectedOf(c, 'log'));
	});
});

// A seeded generator (mulberry32) so a failure is reproducible.
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
const BERLIN = studyDay([{ zone: 'Europe/Berlin', from: null }]);
const ALL = enabledFamilies({ flashcards: true, reader: true, journal: true, han: true });
const START = Date.parse('2026-01-01T00:00:00Z');

function review(i: number, at: number, cardId: string, grade = 3): ReviewEvent {
	return {
		id: `r${String(i).padStart(6, '0')}`,
		workspaceId: 1,
		device: 'web',
		ts: new Date(at).toISOString(),
		type: 'review',
		payload: { cardId, mode: 'vocab', grade: grade as 1 }
	};
}

function event(i: number, at: number, type: string, payload: unknown): StudyEvent {
	return { id: `e${String(i).padStart(6, '0')}`, workspaceId: 1, device: 'web', ts: new Date(at).toISOString(), type, payload };
}

function generate(seed: number) {
	const next = rng(seed);
	const cards: StudyCard[] = [];
	for (let e = 1; e <= 40; e++) {
		cards.push({ id: `c-vocab-${e}`, kind: 'vocab', entryId: e, deckIds: [e % 7 === 0 ? 'gone' : GENERAL_DECK_ID], createdAt: 't' });
	}
	const reviews: ReviewEvent[] = [];
	const events: StudyEvent[] = [];
	let at = START;
	for (let i = 0; i < 700; i++) {
		// Mostly within the day, sometimes a gap of days (streaks break).
		at += next() < 0.08 ? Math.floor(next() * 4) * 86_400_000 : Math.floor(next() * 3_600_000 * 4);
		const r = next();
		if (r < 0.7) reviews.push(review(i, at, `c-vocab-${1 + Math.floor(next() * 45)}`, next() < 0.03 ? 7 : 3));
		else if (r < 0.85) events.push(event(i, at, 'read', next() < 0.5 ? { seconds: Math.floor(next() * 4000) } : { bookId: 1, seconds: 400 }));
		else events.push(event(i, at, 'journal', { entryId: next() < 0.2 ? Math.floor(next() * 9) : `J${Math.floor(next() * 40)}` }));
	}
	return { cards, reviews, events, now: at - 3_600_000 * 12 };
}

/** The earliest instant at which `count(prefix)` reaches `n`, brute force over prefixes. */
function bruteForce(
	items: readonly { at: number; id: string }[],
	count: (prefix: readonly { at: number; id: string }[]) => number,
	n: number
): number | null {
	for (let i = 0; i < items.length; i++) if (count(items.slice(0, i + 1)) >= n) return items[i].at;
	return null;
}

describe('reachedFromLog properties (seeded)', () => {
	for (const seed of [1, 2, 3, 4]) {
		it(`count families agree with a brute force over prefixes (seed ${seed})`, () => {
			const g = generate(seed);
			const vacation = [{ start: '2026-01-20', end: '2026-01-22' }];
			const got = reachedFromLog({ ...g, deckIds: new Set([GENERAL_DECK_ID]), day: BERLIN, vacation, families: ALL });
			const byId = new Map(got.map((r) => [r.id, r.at]));
			const scoped = new Map(g.cards.filter((c) => c.deckIds.includes(GENERAL_DECK_ID)).map((c) => [c.id, c.entryId]));
			type Item = { at: number; id: string; review?: ReviewEvent; event?: StudyEvent };
			const items: Item[] = [
				...g.reviews.filter((r) => r.payload.grade <= 4).map((r) => ({ at: Date.parse(r.ts), id: r.id, review: r })),
				...g.events.map((e) => ({ at: Date.parse(e.ts), id: e.id, event: e }))
			]
				.filter((i) => i.at <= g.now)
				.sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : 1));
			const counters: Record<string, (p: readonly Item[]) => number> = {
				reviews: (p) => p.filter((i) => i.review).length,
				'words-studied': (p) => new Set(p.flatMap((i) => (i.review && scoped.has(i.review.payload.cardId) ? [scoped.get(i.review.payload.cardId)] : []))).size,
				'reading-hours': (p) => p.reduce((s, i) => s + (i.event?.type === 'read' ? readSeconds(i.event.payload) : 0), 0) / 3600,
				'journal-entries': (p) => new Set(p.flatMap((i) => (i.event?.type === 'journal' ? [journalEntryId(i.event.payload)] : [])).filter((x) => x !== null)).size,
				'days-active': (p) =>
					new Set(
						p
							.filter((i) => i.review || (i.event?.type === 'read' && readSeconds(i.event.payload) > 0) || (i.event?.type === 'journal' && journalEntryId(i.event.payload) !== null))
							.map((i) => BERLIN.dayOf(i.at))
							.filter((d) => !(d >= '2026-01-20' && d <= '2026-01-22'))
					).size
			};
			let checked = 0;
			for (const [family, count] of Object.entries(counters)) {
				const def = FAMILIES.find((f) => f.family === family)!;
				for (const n of def.thresholds) {
					const want = bruteForce(items, count as (p: readonly { at: number; id: string }[]) => number, n);
					const id = milestoneId(family as Exclude<MilestoneFamily, 'level-complete'>, n);
					expect(byId.get(id) ?? null, id).toBe(want);
					if (want !== null) checked += 1;
				}
			}
			expect(checked).toBeGreaterThan(5);
		});

		it(`the streak family agrees with dailyStreak at the reached day and the day before (seed ${seed})`, () => {
			const g = generate(seed);
			const vacation = [{ start: '2026-01-20', end: '2026-01-22' }];
			const got = reachedFromLog({ ...g, deckIds: new Set([GENERAL_DECK_ID]), day: UTC, vacation, families: ALL });
			const before = (t: number) => g.reviews.filter((r) => Date.parse(r.ts) <= t);
			const best = dailyStreak(before(g.now), g.now, UTC, vacation).best;
			for (const n of FAMILIES.find((f) => f.family === 'streak')!.thresholds) {
				const r = got.find((x) => x.id === `streak:${n}`);
				if (r === undefined) {
					expect(best, `streak:${n}`).toBeLessThan(n);
					continue;
				}
				expect(dailyStreak(before(r.at), r.at, UTC, vacation).best).toBeGreaterThanOrEqual(n);
				const dayBefore = UTC.dayStart(r.day) - 1;
				expect(dailyStreak(before(dayBefore), dayBefore, UTC, vacation).best).toBeLessThan(n);
				// reachedAt is the first valid review of the reached day.
				const first = g.reviews.filter((x) => x.payload.grade <= 4 && UTC.dayOf(Date.parse(x.ts)) === r.day).map((x) => Date.parse(x.ts));
				expect(r.at).toBe(Math.min(...first));
			}
		});
	}
});

describe('reachedFromLog', () => {
	const base = (): LogInputs => ({
		reviews: [],
		events: [],
		cards: [],
		deckIds: new Set([GENERAL_DECK_ID]),
		day: UTC,
		vacation: [],
		now: Date.parse('2026-02-01T00:00:00Z'),
		families: ALL
	});
	const hundred = Array.from({ length: 100 }, (_, i) => review(i, START + i * 1000, 'c-vocab-1'));

	it('disabled families yield nothing', () => {
		const got = reachedFromLog({ ...base(), reviews: hundred, families: new Set(['days-active']) });
		expect(got.map((r) => r.id)).toEqual([]);
		expect(reachedFromLog({ ...base(), reviews: hundred }).map((r) => r.id)).toEqual(['reviews:100']);
	});

	it('a review after now is ignored', () => {
		expect(reachedFromLog({ ...base(), reviews: hundred, now: START + 98_000 })).toEqual([]);
		expect(reachedFromLog({ ...base(), reviews: hundred, now: START + 99_000 }).map((r) => r.id)).toEqual(['reviews:100']);
	});

	it('review events in the event log are not counted twice', () => {
		const events = hundred.map((r) => ({ ...r, payload: r.payload as unknown }) as StudyEvent);
		expect(reachedFromLog({ ...base(), reviews: hundred.slice(0, 99), events })).toEqual([]);
	});

	it('a read without bookId counts its seconds', () => {
		const got = reachedFromLog({ ...base(), events: [event(1, START, 'read', { seconds: 3600 })] });
		expect(got.map((r) => r.id)).toEqual(['reading-hours:1']);
	});

	it('a journal event with a numeric, empty or missing entryId moves neither journal-entries nor days-active', () => {
		const events = [
			event(1, START, 'journal', { entryId: 4 }),
			event(2, START, 'journal', { entryId: '' }),
			event(3, START, 'journal', {}),
			event(4, START, 'journal', null)
		];
		const days = Array.from({ length: 10 }, (_, i) => event(10 + i, START + i * 86_400_000, 'journal', { entryId: 5 }));
		expect(reachedFromLog({ ...base(), events: [...events, ...days] })).toEqual([]);
	});

	it('journalEntryId reads a non-empty string only', () => {
		expect(journalEntryId({ entryId: '01KA' })).toBe('01KA');
		for (const p of [{ entryId: 1 }, { entryId: '' }, {}, null, 'x', [1]]) expect(journalEntryId(p)).toBeNull();
	});

	it('memoises: an equal reloaded log returns the same array', () => {
		const events = [event(1, START, 'read', { seconds: 3600 })];
		const first = reachedFromLog({ ...base(), reviews: hundred, events });
		const again = reachedFromLog({ ...base(), reviews: hundred.map((r) => ({ ...r })), events });
		expect(again).toBe(first);
		// A different day (now moved) or another family set is a different answer.
		expect(reachedFromLog({ ...base(), reviews: hundred, events, now: Date.parse('2026-02-03T00:00:00Z') })).not.toBe(first);
		expect(reachedFromLog({ ...base(), reviews: hundred, events, families: new Set(['reviews']) })).not.toBe(first);
	});
});
