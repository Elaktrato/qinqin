import { contextFor, UTC_CONTEXT, type StudyContext } from '$lib/study/studyContext';
import { describe, expect, it } from 'vitest';

import { DEFAULT_W } from './fsrs/params';
import { studyDay, type ZoneChange } from '../time/studyDay';
import fixtures from '../../../../../docs/contracts/levels/character-level-queue.json';
import idFixtures from '../../../../../docs/contracts/levels/level-card-ids.json';
import { newCardId } from './canonical';
import {
	buildLevelPlan,
	buildLevelQueue,
	levelEntryCount,
	levelPlanCounts,
	levelTypeWarnings,
	levelUsable,
	virtualLevelId,
	type LevelEntry,
	type LevelUnit
} from './levelQueue';
import type { StudyCardKind } from './types';
import type { ReviewEvent, ReviewGrade, StudyCard } from './types';

function eventId(n: number): string {
	return `01JTEST${String(n).padStart(19, '0')}`;
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

function card(id: string, entryId: number, createdAt = '2026-01-01T00:00:00.000Z'): StudyCard {
	return { id, kind: 'vocab', entryId, deckIds: ['general'], createdAt };
}

function entry(id: number, kind = 'word'): LevelEntry {
	return { id, kind };
}

const NOW = new Date('2026-06-01T00:00:00.000Z');

describe('buildLevelQueue', () => {
	it('returns an empty queue for empty inputs', () => {
		expect(
			buildLevelQueue({ ctx: UTC_CONTEXT, w: DEFAULT_W,
				entries: [],
				cards: [],
				reviews: [],
				newLimit: 20,
				reviewLimit: 100,
				now: NOW
			})
		).toEqual([]);
	});

	it('reuses an existing card instead of creating a virtual item', () => {
		const queue = buildLevelQueue({ ctx: UTC_CONTEXT, w: DEFAULT_W,
			entries: [entry(1)],
			cards: [card('c1', 1)],
			reviews: [review('c1', 3, '2026-01-01T00:00:00.000Z')],
			newLimit: 20,
			reviewLimit: 100,
			now: NOW
		});

		expect(queue).toEqual([{ cardId: 'c1', entryId: 1, virtual: false, kind: 'vocab' }]);
	});

	it('creates stable virtual ids in level entry order', () => {
		const queue = buildLevelQueue({ ctx: UTC_CONTEXT, w: DEFAULT_W,
			entries: [entry(7), entry(3), entry(12)],
			cards: [],
			reviews: [],
			newLimit: 20,
			reviewLimit: 100,
			now: NOW
		});

		expect(queue).toEqual([
			{ cardId: 'level:7', entryId: 7, virtual: true, kind: 'vocab' },
			{ cardId: 'level:3', entryId: 3, virtual: true, kind: 'vocab' },
			{ cardId: 'level:12', entryId: 12, virtual: true, kind: 'vocab' }
		]);
	});

	it('puts due cards first, ordered by due, then virtual entries', () => {
		const queue = buildLevelQueue({ ctx: UTC_CONTEXT, w: DEFAULT_W,
			entries: [entry(1), entry(2), entry(3), entry(4)],
			cards: [card('c2', 2), card('c1', 1)],
			reviews: [
				// c2 is due later than c1.
				review('c1', 3, '2026-01-01T00:00:00.000Z', eventId(1)),
				review('c2', 3, '2026-02-01T00:00:00.000Z', eventId(2))
			],
			newLimit: 20,
			reviewLimit: 100,
			now: NOW
		});

		expect(queue.map((item) => item.cardId)).toEqual(['c1', 'c2', 'level:3', 'level:4']);
	});

	it('orders equal due instants by entry id', () => {
		const queue = buildLevelQueue({ ctx: UTC_CONTEXT, w: DEFAULT_W,
			entries: [entry(1), entry(2)],
			cards: [card('c2', 2), card('c1', 1)],
			reviews: [
				review('c2', 3, '2026-01-01T00:00:00.000Z', eventId(1)),
				review('c1', 3, '2026-01-01T00:00:00.000Z', eventId(2))
			],
			newLimit: 20,
			reviewLimit: 100,
			now: NOW
		});

		expect(queue.map((item) => item.entryId)).toEqual([1, 2]);
	});

	it('leaves out cards that are reviewed but not due', () => {
		const queue = buildLevelQueue({ ctx: UTC_CONTEXT, w: DEFAULT_W,
			entries: [entry(1), entry(2), entry(3)],
			cards: [card('c1', 1), card('c2', 2)],
			reviews: [
				review('c1', 3, '2026-01-01T00:00:00.000Z', eventId(1)),
				// c2 was reviewed a minute ago, so it is neither due nor virtual.
				review('c2', 3, '2026-05-31T23:59:00.000Z', eventId(2))
			],
			newLimit: 20,
			reviewLimit: 100,
			now: NOW
		});

		expect(queue.map((item) => item.cardId)).toEqual(['c1', 'level:3']);
	});

	it('includes an existing unreviewed card as new, with its real id', () => {
		const queue = buildLevelQueue({ ctx: UTC_CONTEXT, w: DEFAULT_W,
			entries: [entry(1), entry(2)],
			cards: [card('c1', 1)],
			reviews: [],
			newLimit: 20,
			reviewLimit: 100,
			now: NOW
		});

		expect(queue).toEqual([
			{ cardId: 'c1', entryId: 1, virtual: false, kind: 'vocab' },
			{ cardId: 'level:2', entryId: 2, virtual: true, kind: 'vocab' }
		]);
	});

	it('caps the combined new bucket, existing cards before virtual entries', () => {
		const queue = buildLevelQueue({ ctx: UTC_CONTEXT, w: DEFAULT_W,
			entries: [entry(1), entry(2), entry(3), entry(4)],
			cards: [card('c3', 3), card('c2', 2)],
			reviews: [],
			newLimit: 2,
			reviewLimit: 100,
			now: NOW
		});

		// Existing never-reviewed cards sort by entry id and consume the
		// cap first; entry 1 and 4 stay out this session.
		expect(queue).toEqual([
			{ cardId: 'c2', entryId: 2, virtual: false, kind: 'vocab' },
			{ cardId: 'c3', entryId: 3, virtual: false, kind: 'vocab' }
		]);
	});

	it('orders the combined new bucket: existing by entry id, then virtual in level order', () => {
		const queue = buildLevelQueue({ ctx: UTC_CONTEXT, w: DEFAULT_W,
			entries: [entry(4), entry(3), entry(2), entry(1)],
			cards: [card('c2', 2), card('c3', 3)],
			reviews: [],
			newLimit: 20,
			reviewLimit: 100,
			now: NOW
		});

		expect(queue.map((item) => item.entryId)).toEqual([2, 3, 4, 1]);
	});

	it('caps due cards and virtual entries independently', () => {
		const queue = buildLevelQueue({ ctx: UTC_CONTEXT, w: DEFAULT_W,
			entries: [entry(1), entry(2), entry(3), entry(4)],
			cards: [card('c1', 1), card('c2', 2)],
			reviews: [
				review('c1', 3, '2026-01-01T00:00:00.000Z', eventId(1)),
				review('c2', 3, '2026-02-01T00:00:00.000Z', eventId(2))
			],
			newLimit: 1,
			reviewLimit: 1,
			now: NOW
		});

		expect(queue).toEqual([
			{ cardId: 'c1', entryId: 1, virtual: false, kind: 'vocab' },
			{ cardId: 'level:3', entryId: 3, virtual: true, kind: 'vocab' }
		]);
	});

	it('keeps virtual entries when the review cap is zero', () => {
		const queue = buildLevelQueue({ ctx: UTC_CONTEXT, w: DEFAULT_W,
			entries: [entry(1), entry(2)],
			cards: [card('c1', 1)],
			reviews: [review('c1', 3, '2026-01-01T00:00:00.000Z')],
			newLimit: 20,
			reviewLimit: 0,
			now: NOW
		});

		expect(queue).toEqual([{ cardId: 'level:2', entryId: 2, virtual: true, kind: 'vocab' }]);
	});

	it('skips non-word entries', () => {
		const queue = buildLevelQueue({ ctx: UTC_CONTEXT, w: DEFAULT_W,
			entries: [entry(1, 'character'), entry(2, 'word'), entry(3, 'sentence')],
			cards: [],
			reviews: [],
			newLimit: 20,
			reviewLimit: 100,
			now: NOW
		});

		expect(queue).toEqual([{ cardId: 'level:2', entryId: 2, virtual: true, kind: 'vocab' }]);
	});

	it('skips a non-word entry even when a card matches it', () => {
		const queue = buildLevelQueue({ ctx: UTC_CONTEXT, w: DEFAULT_W,
			entries: [entry(1, 'character')],
			cards: [card('c1', 1)],
			reviews: [review('c1', 3, '2026-01-01T00:00:00.000Z')],
			newLimit: 20,
			reviewLimit: 100,
			now: NOW
		});

		expect(queue).toEqual([]);
	});

	it('dedupes repeated entries and keeps the first occurrence', () => {
		const queue = buildLevelQueue({ ctx: UTC_CONTEXT, w: DEFAULT_W,
			entries: [entry(5), entry(3), entry(5)],
			cards: [],
			reviews: [],
			newLimit: 20,
			reviewLimit: 100,
			now: NOW
		});

		expect(queue).toEqual([
			{ cardId: 'level:5', entryId: 5, virtual: true, kind: 'vocab' },
			{ cardId: 'level:3', entryId: 3, virtual: true, kind: 'vocab' }
		]);
	});

	it('does not mark a card due from reviews of other cards', () => {
		const queue = buildLevelQueue({ ctx: UTC_CONTEXT, w: DEFAULT_W,
			entries: [entry(1)],
			cards: [card('c1', 1)],
			reviews: [review('other', 3, '2026-01-01T00:00:00.000Z')],
			newLimit: 20,
			reviewLimit: 100,
			now: NOW
		});

		// Still unreviewed as far as its own history goes, so it is new.
		expect(queue).toEqual([{ cardId: 'c1', entryId: 1, virtual: false, kind: 'vocab' }]);
	});
});

interface FixtureCase {
	name: string;
	unit: LevelUnit;
	kinds: StudyCardKind[];
	history: ZoneChange[];
	now: string;
	entries: { id: number; kind: string; written?: string; strokeData?: boolean }[];
	cards: { id: string; kind: StudyCardKind; entryId: number; createdAt: string }[];
	reviews: { cardId: string; grade: ReviewGrade; ts: string }[];
	newLimit: number;
	reviewLimit: number;
	queue: Record<string, unknown>[];
	reserve: Record<string, unknown>[];
}

describe('character level queue fixtures', () => {
	const cases = (fixtures as { cases: FixtureCase[] }).cases;

	it('has the spec case list', () => {
		expect(cases.map((c) => c.name)).toHaveLength(13);
	});

	for (const c of cases) {
		it(c.name, () => {
			const reviews = c.reviews.map((r, i) => ({
				...review(r.cardId, r.grade, r.ts, eventId(i + 1)),
				payload: {
					cardId: r.cardId,
					mode: c.cards.find((k) => k.id === r.cardId)?.kind ?? 'vocab',
					grade: r.grade
				}
			}));
			const plan = buildLevelPlan({
				unit: c.unit,
				kinds: c.kinds,
				ctx: contextFor(studyDay(c.history)),
				entries: c.entries,
				hasStrokes: (glyph: string) =>
					!c.entries.some((e) => e.written === glyph && e.strokeData === false),
				cards: c.cards.map((k) => ({ ...k, deckIds: ['general'] })),
				reviews,
				newLimit: c.newLimit,
				reviewLimit: c.reviewLimit,
				now: new Date(c.now),
				w: DEFAULT_W
			});
			expect(plan.queue).toEqual(c.queue);
			expect(plan.reserve).toEqual(c.reserve);
			expect(JSON.stringify(c)).not.toContain('dropInSession');
		});
	}
});

describe('level card ids', () => {
	for (const c of (idFixtures as { cases: { virtualId: string; kind: StudyCardKind; entryId: number; cardId: string }[] }).cases) {
		it(c.virtualId, () => {
			expect(virtualLevelId(c.kind, c.entryId)).toBe(c.virtualId);
			expect(newCardId(c.kind, c.entryId)).toBe(c.cardId);
		});
	}
});

describe('levelPlanCounts', () => {
	const base = { ctx: UTC_CONTEXT, w: DEFAULT_W, cards: [], reviews: [], now: NOW };

	it('counts a fresh character level as characters x 1 while writing is locked', () => {
		const counts = levelPlanCounts({
			...base,
			unit: 'character',
			kinds: ['vocab', 'writing'],
			entries: [entry(1, 'character'), entry(2, 'character'), entry(9)]
		});
		expect(counts).toEqual({ due: 0, fresh: 2, items: 2, unitLabel: 'characters' });
	});

	it('counts due and new separately, before any session cap', () => {
		const counts = levelPlanCounts({
			...base,
			unit: 'character',
			kinds: ['vocab'],
			entries: [entry(1, 'character'), entry(2, 'character')],
			cards: [{ ...card('c1', 1), createdAt: '2026-01-01T00:00:00.000Z' }],
			reviews: [review('c1', 3, '2026-01-01T00:00:00.000Z')]
		});
		expect(counts).toEqual({ due: 1, fresh: 1, items: 2, unitLabel: 'characters' });
	});

	it('labels word levels as words and ignores non-vocab kinds', () => {
		const counts = levelPlanCounts({
			...base,
			kinds: ['writing'],
			entries: [entry(1), entry(2)]
		});
		expect(counts).toEqual({ due: 0, fresh: 0, items: 0, unitLabel: 'words' });
	});
});

describe('level setup helpers', () => {
	it('is usable only with a kind the unit studies', () => {
		expect(levelUsable('word', ['writing'])).toBe(false);
		expect(levelUsable('word', ['vocab'])).toBe(true);
		expect(levelUsable('character', ['writing'])).toBe(true);
		expect(levelUsable('character', ['tone', 'sentence'])).toBe(false);
	});

	it('warns per unit about kinds a level does not study', () => {
		expect(levelTypeWarnings('word', ['vocab'])).toEqual([]);
		expect(levelTypeWarnings('word', ['vocab', 'tone'])).toEqual([
			'Level sessions study vocab cards only; the other types apply to deck sessions.'
		]);
		expect(levelTypeWarnings('character', ['vocab', 'writing'])).toEqual([]);
		expect(levelTypeWarnings('character', ['vocab', 'tone'])).toEqual([
			'Character levels study recognition and writing cards.'
		]);
	});

	it('counts the entries a unit studies', () => {
		const entries = [entry(1), entry(2, 'character'), entry(3, 'sentence')];
		expect(levelEntryCount(entries, 'word')).toBe(1);
		expect(levelEntryCount(entries, 'character')).toBe(1);
	});
});

describe('character level skip set', () => {
	it('never plans a virtual item found ineligible, and refills from the rest', () => {
		const plan = buildLevelPlan({ ctx: UTC_CONTEXT,
			w: DEFAULT_W,
			unit: 'character',
			kinds: ['writing'],
			entries: [entry(1, 'character'), entry(2, 'character'), entry(3, 'character')],
			cards: [],
			reviews: [],
			newLimit: 2,
			reviewLimit: 10,
			now: NOW,
			skip: new Set(['writing:1'])
		});
		expect(plan.queue.map((i) => i.cardId)).toEqual(['level:writing:2', 'level:writing:3']);
	});
});

describe('stroke-less glyphs and the new-card budget', () => {
	// 60 unlocked kanji without stroke data followed by 30 fresh ones.
	const stroked = (n: number) => entry(n, 'character');
	const entries = [
		...Array.from({ length: 60 }, (_, i) => ({ ...stroked(100 + i), written: `X${i}` })),
		...Array.from({ length: 30 }, (_, i) => ({ ...stroked(200 + i), written: `日${i}` }))
	];
	const cards = Array.from({ length: 60 }, (_, i) => card(`c-vocab-${100 + i}`, 100 + i));
	const reviews = Array.from({ length: 60 }, (_, i) =>
		review(`c-vocab-${100 + i}`, 4, '2026-05-31T12:00:00.000Z', eventId(i + 1))
	);
	const base = {
		ctx: UTC_CONTEXT,
		w: DEFAULT_W,
		unit: 'character' as const,
		kinds: ['vocab', 'writing'] as const,
		entries,
		cards,
		reviews,
		now: NOW,
		hasStrokes: (glyph: string) => !glyph.startsWith('X')
	};

	it('still yields newLimit new recognition cards', () => {
		const plan = buildLevelPlan({ ...base, newLimit: 10, reviewLimit: 100 });
		expect(plan.queue).toHaveLength(10);
		expect(plan.queue.every((i) => i.kind === 'vocab' && i.entryId >= 200)).toBe(true);
		expect(plan.queue.filter((i) => i.kind === 'writing')).toHaveLength(0);
	});

	it('counts no droppable writing item as new on the setup page', () => {
		// Unlimited daily limits: this is about which items are new, not the allowance.
		const counts = levelPlanCounts({
			...base,
			ctx: { ...UTC_CONTEXT, limits: { workspace: { new: null, reviews: null }, decks: {}, existingDecks: null } }
		});
		// 60 locked-in stroke-less writing items are not new; only the 30 fresh recognitions.
		expect(counts.fresh).toBe(30);
	});
});

describe('level sessions and daily limits', () => {
	const NOW2 = new Date('2026-03-10T12:00:00Z');
	const entries = Array.from({ length: 10 }, (_, i) => ({ id: i + 1, kind: 'word' }));
	const withLimits = (rows: Partial<{ new: number | null; reviews: number | null }>, decks = {}): StudyContext => ({
		...UTC_CONTEXT,
		limits: { workspace: rows, decks, existingDecks: null }
	});
	const base = { entries, cards: [] as StudyCard[], reviews: [] as ReviewEvent[], newLimit: 50, reviewLimit: 50, now: NOW2, w: DEFAULT_W };

	it('virtual items count against general: 4 new allowed gives 4 virtual items and a reserve', () => {
		const plan = buildLevelPlan({ ...base, newLimit: 3, ctx: withLimits({ new: 4 }) });
		expect(plan.queue).toHaveLength(3);
		expect(plan.reserve).toHaveLength(1);
	});

	it('an existing card counts against its own deck, not general', () => {
		const cards: StudyCard[] = [
			{ id: 'c1', kind: 'vocab', entryId: 1, deckIds: ['full'], createdAt: '2026-01-01T00:00:00Z' }
		];
		const ctx = withLimits({}, { full: { new: 0 } });
		const queue = buildLevelPlan({ ...base, cards, ctx }).queue;
		expect(queue.some((item) => item.cardId === 'c1')).toBe(false);
		expect(queue.filter((item) => item.virtual)).toHaveLength(9);
	});

	it('is empty on a vacation day', () => {
		expect(buildLevelPlan({ ...base, ctx: { ...UTC_CONTEXT, vacationToday: true } }).queue).toEqual([]);
	});
});
