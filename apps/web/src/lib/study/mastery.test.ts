import { IDENTITY_CLOCK } from '$lib/study/studyClock';
import { describe, expect, it } from 'vitest';

import charMasteryFixture from '../../../../../docs/contracts/decks/char-mastery.json';
import { DEFAULT_W } from './fsrs/params';
import { cardScore, masteryForChars, masteryFromSchedules, MASTERY_KINDS, MAX_STABILITY_DAYS, stageOf, type CharMastery } from './mastery';
import { scheduleFor, type Schedule } from './scheduler';
import type { ReviewEvent, ReviewGrade, StudyCard } from './types';

/** One character scored on its own: the per-character view of the batch API. */
function masteryForChar(
	char: string,
	cards: readonly StudyCard[],
	reviews: readonly ReviewEvent[],
	now: Date
): CharMastery {
	return masteryForChars([char], cards, reviews, now, DEFAULT_W, IDENTITY_CLOCK).get(char)!;
}

const DAY = 86_400_000;
const BASE = Date.parse('2025-01-01T00:00:00.000Z');
const NOW = new Date('2026-06-01T00:00:00.000Z');

function eventId(n: number): string {
	return `01JMASTERY${String(n).padStart(17, '0')}`;
}

function review(
	cardId: string,
	grade: ReviewGrade,
	ts: string,
	id = eventId(1)
): ReviewEvent {
	return {
		id,
		workspaceId: 7,
		device: 'web',
		ts,
		type: 'review',
		payload: { cardId, mode: 'vocab', grade }
	};
}

// The event log is only validated for id/ts server-side, so a stored
// payload can still be out of contract when it reaches mastery.
function malformedReview(cardId: string, grade: number, ts: string): ReviewEvent {
	return {
		id: eventId(9),
		workspaceId: 7,
		device: 'web',
		ts,
		type: 'review',
		payload: { cardId, mode: 'vocab', grade }
	} as unknown as ReviewEvent;
}

function card(id: string, written?: string): StudyCard {
	const result: StudyCard = {
		id,
		kind: 'vocab',
		entryId: 1,
		deckIds: ['general'],
		createdAt: '2025-01-01T00:00:00.000Z'
	};
	if (written !== undefined) result.written = written;
	return result;
}

// Grades Good at increasing day offsets, as a learner answering at the
// FSRS due dates would. Offsets [0,1,11,41] climb steadily.
function goodHistory(cardId: string, offsets: number[]): ReviewEvent[] {
	return offsets.map((days, index) =>
		review(cardId, 3, new Date(BASE + days * DAY).toISOString(), eventId(index + 1))
	);
}

describe('masteryForChar', () => {
	it('reports unknown when no card containing the character was reviewed', () => {
		const cards = [card('c1', '猫')];

		expect(masteryForChar('猫', cards, [], NOW)).toEqual({
			score: 0,
			stage: 'unknown',
			reviewedCards: 0
		});
		expect(masteryForChar('猫', cards, goodHistory('other', [0]), NOW)).toEqual({
			score: 0,
			stage: 'unknown',
			reviewedCards: 0
		});
	});

	it('gives a single Good review a low fresh score', () => {
		const result = masteryForChar('猫', [card('c1', '猫')], goodHistory('c1', [0]), NOW);

		expect(result.reviewedCards).toBe(1);
		expect(result.score).toBeGreaterThan(0);
		expect(result.score).toBeLessThan(25);
		expect(result.stage).toBe('fresh');
	});

	it('ranks a longer spaced history higher than a single review', () => {
		const short = masteryForChar('猫', [card('short', '猫')], goodHistory('short', [0]), NOW);
		const long = masteryForChar(
			'猫',
			[card('long', '猫')],
			goodHistory('long', [0, 1, 11, 41]),
			NOW
		);

		expect(long.score).toBeGreaterThan(short.score);
		expect(long.stage).toBe('learned');
	});

	it('derives the stage from the score band', () => {
		const cases: Array<{ offsets: number[]; stage: string }> = [
			{ offsets: [0], stage: 'fresh' },
			{ offsets: [0, 1], stage: 'learning' },
			{ offsets: [0, 1, 11], stage: 'mature' },
			{ offsets: [0, 1, 11, 41], stage: 'learned' }
		];

		for (const { offsets, stage } of cases) {
			const result = masteryForChar(
				'猫',
				[card(`c-${offsets.join('-')}`, '猫')],
				goodHistory(`c-${offsets.join('-')}`, offsets),
				NOW
			);
			expect(result.stage).toBe(stage);
		}
	});

	it('averages the mastery of every reviewed card containing the character', () => {
		const low = card('low', '猫');
		const high = card('high', '猫咪');
		const lowReviews = goodHistory('low', [0, 1]);
		const highReviews = goodHistory('high', [0, 1, 11, 41]);

		const lowOnly = masteryForChar('猫', [low], lowReviews, NOW);
		const highOnly = masteryForChar('猫', [high], highReviews, NOW);
		const both = masteryForChar('猫', [low, high], [...lowReviews, ...highReviews], NOW);

		expect(lowOnly.score).toBeLessThan(highOnly.score);
		expect(both.reviewedCards).toBe(2);
		expect(both.score).toBeGreaterThan(lowOnly.score);
		expect(both.score).toBeLessThan(highOnly.score);
		// The score is the rounded mean of the per-card scores; each card
		// score is itself rounded, so allow a point of rounding drift.
		expect(Math.abs(both.score - (lowOnly.score + highOnly.score) / 2)).toBeLessThanOrEqual(1);
	});

	it('gives two cards with the same history the same score as one', () => {
		const history = goodHistory('c1', [0, 1, 11]);
		const one = masteryForChar('猫', [card('c1', '猫')], history, NOW);
		const two = masteryForChar(
			'猫',
			[card('c1', '猫'), card('c2', '猫咪')],
			[...history, ...goodHistory('c2', [0, 1, 11])],
			NOW
		);

		expect(two.score).toBe(one.score);
		expect(two.stage).toBe(one.stage);
		expect(two.reviewedCards).toBe(2);
	});

	it('never counts an unreviewed card towards the average', () => {
		const reviewed = card('reviewed', '猫');
		const unreviewed = card('unreviewed', '猫');
		const history = goodHistory('reviewed', [0, 1, 11]);

		const alone = masteryForChar('猫', [reviewed], history, NOW);

		expect(masteryForChar('猫', [reviewed, unreviewed], history, NOW)).toEqual(alone);
	});

	it('ignores malformed review events', () => {
		const clean = masteryForChar('猫', [card('c1', '猫')], [], NOW);

		expect(
			masteryForChar(
				'猫',
				[card('c1', '猫')],
				[
					malformedReview('c1', 9, new Date(BASE).toISOString()),
					malformedReview('c1', 3, 'not-a-timestamp'),
					malformedReview('', 3, new Date(BASE).toISOString())
				],
				NOW
			)
		).toEqual(clean);

		const valid = goodHistory('c1', [0, 1, 11]);
		expect(
			masteryForChar(
				'猫',
				[card('c1', '猫')],
				[
					...valid,
					malformedReview('c1', 9, new Date(BASE + 2 * DAY).toISOString()),
					malformedReview('c1', 3, 'not-a-timestamp')
				],
				NOW
			)
		).toEqual(masteryForChar('猫', [card('c1', '猫')], valid, NOW));
	});

	it('ignores legacy cards without a written snapshot', () => {
		const legacy = card('legacy');
		const history = goodHistory('legacy', [0, 1, 11, 41]);

		expect(masteryForChar('猫', [legacy], history, NOW)).toEqual({
			score: 0,
			stage: 'unknown',
			reviewedCards: 0
		});
	});

	it('only matches characters present in the written snapshot', () => {
		const cards = [card('c1', '猫咪')];
		const history = goodHistory('c1', [0, 1, 11]);

		expect(masteryForChar('猫', cards, history, NOW).reviewedCards).toBe(1);
		expect(masteryForChar('狗', cards, history, NOW).reviewedCards).toBe(0);
	});
});

describe('masteryForChars across card kinds', () => {
	function kindCard(id: string, kind: StudyCard['kind'], written?: string): StudyCard {
		return { ...card(id, written), kind };
	}

	it('counts writing and sentence cards for their written characters', () => {
		const cards = [kindCard('w1', 'writing', '猫'), kindCard('s1', 'sentence', '我爱猫')];
		const reviews = [
			...goodHistory('w1', [0, 1, 11]),
			...goodHistory('s1', [0, 1, 11])
		];
		const map = masteryForChars(['猫', '爱', '狗'], cards, reviews, NOW, DEFAULT_W, IDENTITY_CLOCK);
		expect(map.get('猫')?.reviewedCards).toBe(2);
		expect(map.get('爱')?.reviewedCards).toBe(1);
		expect(map.get('狗')?.stage).toBe('unknown');
	});

	it('ignores a non-vocab card without a snapshot', () => {
		const cards = [kindCard('w1', 'writing')];
		const map = masteryForChars(['猫'], cards, goodHistory('w1', [0, 1]), NOW, DEFAULT_W, IDENTITY_CLOCK);
		expect(map.get('猫')?.reviewedCards).toBe(0);
	});
});

describe('masteryForChars', () => {
	it('scores each character the same alone or in a batch of many', () => {
		// 40 characters, two cards each, with a mix of short and long
		// histories plus a few unreviewed cards. Every card's written form
		// is a two-character word, so most characters share cards.
		const chars = Array.from({ length: 40 }, (_, index) =>
			String.fromCodePoint(0x4e00 + index)
		);
		const cards: StudyCard[] = [];
		const reviews: ReviewEvent[] = [];
		for (let index = 0; index < chars.length; index += 1) {
			const next = chars[(index + 1) % chars.length];
			const pair = card(`pair-${index}`, `${chars[index]}${next}`);
			const single = card(`single-${index}`, chars[index]);
			cards.push(pair, single);
			if (index % 7 !== 0) {
				const offsets = index % 3 === 0 ? [0] : [0, 1, 11, 41];
				reviews.push(
					...goodHistory(pair.id, offsets),
					...goodHistory(single.id, offsets)
				);
			}
		}
		// A character no card contains, and a legacy card with no snapshot.
		cards.push(card('legacy'));
		const requested = [...chars, '龍'];

		const map = masteryForChars(requested, cards, reviews, NOW, DEFAULT_W, IDENTITY_CLOCK);

		for (const char of requested) {
			expect(map.get(char), char).toEqual(masteryForChar(char, cards, reviews, NOW));
		}
	});

	it('reports unknown for the empty character', () => {
		const cards = [card('c1', '猫')];
		const history = goodHistory('c1', [0, 1, 11, 41]);

		expect(masteryForChars([''], cards, history, NOW, DEFAULT_W, IDENTITY_CLOCK).get('')).toEqual({
			score: 0,
			stage: 'unknown',
			reviewedCards: 0
		});
		expect(masteryForChar('', cards, history, NOW)).toEqual({
			score: 0,
			stage: 'unknown',
			reviewedCards: 0
		});
	});

	it('includes every requested character, even without a reviewed card', () => {
		const map = masteryForChars(['猫', '狗'], [card('c1', '猫')], goodHistory('c1', [0]), NOW, DEFAULT_W, IDENTITY_CLOCK);

		expect(map.size).toBe(2);
		expect(map.get('狗')).toEqual({ score: 0, stage: 'unknown', reviewedCards: 0 });
	});

	it('counts one card once per character even when the written form repeats it', () => {
		const history = goodHistory('c1', [0, 1, 11]);
		const once = masteryForChar('猫', [card('c1', '猫')], history, NOW);
		const repeated = masteryForChar('猫', [card('c1', '猫猫')], history, NOW);

		expect(repeated).toEqual(once);
		expect(repeated.reviewedCards).toBe(1);
	});

	it('returns an empty map for no characters', () => {
		expect(masteryForChars([], [card('c1', '猫')], goodHistory('c1', [0]), NOW, DEFAULT_W, IDENTITY_CLOCK).size).toBe(0);
	});
});

describe('stageOf', () => {
	it('maps the exact band boundaries', () => {
		const cases: Array<[number, string]> = [
			[0, 'unknown'],
			[1, 'fresh'],
			[24, 'fresh'],
			[25, 'learning'],
			[49, 'learning'],
			[50, 'mature'],
			[79, 'mature'],
			[80, 'learned'],
			[100, 'learned']
		];

		for (const [score, stage] of cases) {
			expect(stageOf(score), String(score)).toBe(stage);
		}
	});
});

describe('reverse and cloze cards never move mastery', () => {
	it('leaves every character equal to the result without them', () => {
		const base = card('c-vocab-1', '喜欢');
		const reverse: StudyCard = { ...card('c-reverse-1', '喜欢'), kind: 'reverse' };
		const cloze: StudyCard = { ...card('c-cloze-1', '喜欢'), kind: 'cloze' };
		const vocabReviews = [review('c-vocab-1', 3, '2026-05-01T00:00:00.000Z', eventId(1))];
		const easy = [1, 2, 3, 4, 5, 6].map((n) =>
			review(`c-${n % 2 === 0 ? 'reverse' : 'cloze'}-1`, 4, `2026-0${n}-01T00:00:00.000Z`, eventId(10 + n))
		);
		const without = masteryForChars(['喜', '欢'], [base], vocabReviews, NOW, DEFAULT_W, IDENTITY_CLOCK);
		const withNew = masteryForChars(
			['喜', '欢'],
			[base, reverse, cloze],
			[...vocabReviews, ...easy],
			NOW,
			DEFAULT_W
		, IDENTITY_CLOCK);
		expect([...withNew]).toEqual([...without]);
	});

	it('MASTERY_KINDS lists only the four existing kinds', () => {
		expect([...MASTERY_KINDS]).toEqual(['vocab', 'sentence', 'writing', 'tone']);
	});
});

describe('cardScore', () => {
	it('maps stability to 0-100 on the log scale', () => {
		expect(cardScore(0)).toBe(0);
		expect(cardScore(365)).toBe(100);
		expect(cardScore(109)).toBe(80);
		expect(cardScore(108)).toBe(79);
		expect(cardScore(21)).toBe(52);
	});
});

describe('masteryFromSchedules', () => {
	const sched = (stability: number): Schedule => ({ due: '', stability, difficulty: 5, state: 2 });
	const kindCard = (id: string, kind: StudyCard['kind'], written: string): StudyCard => ({
		id,
		kind,
		entryId: 1,
		written,
		deckIds: ['general'],
		createdAt: '2025-01-01T00:00:00.000Z'
	});

	it('scores the mean strength of the given schedules, MASTERY_KINDS only, once per card', () => {
		const cards = [
			kindCard('a', 'vocab', '好好'),
			kindCard('b', 'writing', '好'),
			kindCard('r', 'reverse', '好'),
			kindCard('n', 'vocab', '好')
		];
		const given: Record<string, Schedule | null> = { a: sched(150), b: sched(5), r: sched(400), n: null };
		const m = masteryFromSchedules(['好', '学'], cards, (id) => given[id] ?? null);
		const expected = Math.round((cardScore(150) + cardScore(5)) / 2);
		expect(Math.abs(m.get('好')!.score - expected)).toBeLessThanOrEqual(1);
		expect(m.get('好')!.reviewedCards).toBe(2);
		expect(m.get('学')).toEqual({ score: 0, stage: 'unknown', reviewedCards: 0 });
	});

	it('equals masteryForChars with the replayed schedules', () => {
		const cards = [card('x', '学生'), card('y', '学'), card('z', '生日'), card('u')];
		const reviews = [
			review('x', 3, new Date(BASE).toISOString(), eventId(1)),
			review('x', 3, new Date(BASE + 5 * DAY).toISOString(), eventId(2)),
			review('x', 4, new Date(BASE + 30 * DAY).toISOString(), eventId(3)),
			review('y', 1, new Date(BASE + 2 * DAY).toISOString(), eventId(4)),
			review('z', 3, new Date(BASE + 3 * DAY).toISOString(), eventId(5))
		];
		const chars = ['学', '生', '日', '月', ''];
		const replayed = (id: string) => scheduleFor(id, reviews, NOW, DEFAULT_W, IDENTITY_CLOCK);
		expect(masteryFromSchedules(chars, cards, replayed)).toEqual(
			masteryForChars(chars, cards, reviews, NOW, DEFAULT_W, IDENTITY_CLOCK)
		);
	});
});

describe('docs/contracts/decks/char-mastery.json', () => {
	const fixture = charMasteryFixture as unknown as {
		rule: string;
		masteryKinds: string[];
		maxStabilityDays: number;
		cases: { name: string; chars: string[]; cards: StudyCard[]; schedules: Record<string, number | null>; expect: Record<string, CharMastery> }[];
		stages: { score: number; stage: string }[];
	};
	it('has the kinds and the stage bands', () => {
		expect(fixture.rule).toBe('decks/char-mastery');
		expect([...MASTERY_KINDS]).toEqual(fixture.masteryKinds);
		expect(MAX_STABILITY_DAYS).toBe(fixture.maxStabilityDays);
		expect(cardScore(fixture.maxStabilityDays)).toBe(100);
		for (const s of fixture.stages) expect(stageOf(s.score), String(s.score)).toBe(s.stage);
	});
	for (const c of fixture.cases) {
		it(c.name, () => {
			const scheduleOf = (id: string): Schedule | null => {
				const stability = c.schedules[id];
				return stability === undefined || stability === null
					? null
					: { due: '2026-01-01T00:00:00.000Z', stability, difficulty: 5, state: 2 };
			};
			expect(Object.fromEntries(masteryFromSchedules(c.chars, c.cards, scheduleOf))).toEqual(c.expect);
		});
	}
});
