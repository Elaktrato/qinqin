import { describe, expect, it } from 'vitest';
import type { EntryBase, Scheme } from '$lib/api/types';
import * as build from '$lib/testing/study';
import { DEFAULT_W } from '$lib/studycore/fsrsParams';
import { planSetup, type SetupPlanInput } from './setupPlan';
import { UTC_CONTEXT } from '$lib/studycore/studyContext';

const NOW = new Date('2026-03-01T12:00:00Z');

function vocab(n: number, deckIds = ['general']) {
	return build.card({ id: `c-vocab-${n}`, kind: 'vocab', entryId: n, written: `w${n}`, deckIds, createdAt: `2026-01-0${n}T00:00:00.000Z` });
}

const charScheme = {
	id: 3,
	name: 'JLPT kanji',
	unit: 'character',
	language: 'ja',
	levels: [{ id: 31, ord: 1, name: 'N5' }]
} as Scheme;

const glyphs = [
	{ id: 11, kind: 'character', written: '日' },
	{ id: 12, kind: 'character', written: '月' },
	{ id: 13, kind: 'character', written: '火' }
] as unknown as EntryBase[];

function input(over: Partial<SetupPlanInput> = {}): SetupPlanInput {
	return {
		status: 'ready',
		mode: 'decks',
		deckIds: ['general'],
		kinds: ['vocab'],
		newLimit: 20,
		reviewLimit: 100,
		cards: [],
		reviews: [],
		deckSettings: {},
		weights: DEFAULT_W,
		ctx: UTC_CONTEXT,
		language: 'ja',
		level: { scheme: null, levelName: null, schemesLoaded: false, schemeError: '', schemeCount: 0, entries: [], loading: false, error: '' },
		...over
	};
}

describe('planSetup, decks', () => {
	it('counts due and new cards of the selected decks', () => {
		const reviewed = build.review({ cardId: 'c-vocab-1', ts: '2026-02-01T10:00:00Z', grade: 3 });
		const plan = planSetup(input({ cards: [vocab(1), vocab(2), vocab(3), vocab(4, ['d9'])], reviews: [reviewed] }), NOW);
		expect(plan.counts).toEqual({ due: 1, fresh: 2 });
		expect(plan.session).toBe(3);
		expect(plan.guidance).toBe('');
	});

	it('"this session" is capped by the saved limits, the counts are not', () => {
		const plan = planSetup(input({ cards: [vocab(1), vocab(2), vocab(3)], newLimit: 2 }), NOW);
		expect(plan.counts.fresh).toBe(3);
		expect(plan.session).toBe(2);
	});

	it('the daily limits apply to both, Study all ignores them', () => {
		const ctx = { ...UTC_CONTEXT, limits: { workspace: { new: 1 }, decks: {}, existingDecks: null } } as never;
		const plan = planSetup(input({ cards: [vocab(1), vocab(2), vocab(3)], ctx }), NOW);
		expect(plan.counts.fresh).toBe(1);
		expect(plan.allCounts.fresh).toBe(3);
		expect(plan.noDailyLimit).toBe(false);
	});

	it('says what is missing', () => {
		expect(planSetup(input({ status: 'no-workspace' }), NOW).guidance).toMatch(/Choose a workspace/);
		expect(planSetup(input({ status: 'loading' }), NOW).guidance).toMatch(/Loading/);
		expect(planSetup(input({ kinds: [] }), NOW).guidance).toBe('Select at least one card type.');
		expect(planSetup(input({ deckIds: [] }), NOW).guidance).toBe('Select at least one deck to start.');
		expect(planSetup(input(), NOW).guidance).toMatch(/^The selected decks have no cards yet/);
		const reviewed = build.review({ cardId: 'c-vocab-1', ts: '2026-02-28T10:00:00Z', grade: 4 });
		expect(planSetup(input({ cards: [vocab(1)], reviews: [reviewed] }), NOW).guidance).toBe(
			'Nothing is due and no new cards are left in the selected decks.'
		);
	});

	it('warns about a selected kind with nothing to study', () => {
		const plan = planSetup(input({ cards: [vocab(1)], kinds: ['vocab', 'reverse'] }), NOW);
		expect(plan.warnings).toEqual(['Reverse: nothing to study in the selected decks right now.']);
	});

	it('counts the companions a deck session plans', () => {
		const plan = planSetup(input({ cards: [vocab(1)], kinds: ['vocab', 'writing'], language: 'ja' }), NOW);
		expect(plan.byKind.writing).toBeGreaterThanOrEqual(0);
		expect(plan.companions).toBe(plan.byKind.writing);
	});
});

describe('planSetup, levels', () => {
	const level = { scheme: charScheme, levelName: 'N5', schemesLoaded: true, schemeError: '', schemeCount: 1, entries: glyphs, loading: false, error: '' };

	it('counts a character level', () => {
		const plan = planSetup(input({ mode: 'levels', level }), NOW);
		expect(plan.counts).toEqual({ due: 0, fresh: 3 });
		expect(plan.levelUnit).toBe('character');
		expect(plan.levelEntryTotal).toBe(3);
		expect(plan.guidance).toBe('');
	});

	it('a level not resolved yet or gone says so', () => {
		expect(planSetup(input({ mode: 'levels', level: { ...level, schemesLoaded: false } }), NOW).guidance).toBe('Loading level schemes…');
		expect(planSetup(input({ mode: 'levels', level: { ...level, scheme: null, schemeCount: 0 } }), NOW).guidance).toBe(
			'No level schemes are installed for this workspace language.'
		);
		expect(planSetup(input({ mode: 'levels', level: { ...level, levelName: 'N1' } }), NOW).guidance).toBe(
			'Choose a scheme and a level to start.'
		);
		expect(planSetup(input({ mode: 'levels', level: { ...level, loading: true } }), NOW).guidance).toBe('Loading this level…');
	});

	it('never counts reverse or cloze, and warns about other kinds', () => {
		const plan = planSetup(input({ mode: 'levels', level, kinds: ['vocab', 'sentence', 'reverse'] }), NOW);
		expect(plan.warnings).toEqual(['Character levels study recognition and writing cards.']);
	});
});

describe('planSetup on a vacation day', () => {
	it('counts nothing', () => {
		const ctx = { ...UTC_CONTEXT, vacationToday: true };
		const plan = planSetup(input({ cards: [vocab(1)], ctx }), NOW);
		expect(plan.counts).toEqual({ due: 0, fresh: 0 });
	});
});
