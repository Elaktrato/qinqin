import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
	STUDY_SETUP_KEY,
	defaultSetup,
	parseSetup,
	repairSetup,
	setupDeckIds,
	setupKinds,
	setupSessionConfig,
	withSetup,
	type StudySetup
} from './setup';
import type { OptInKind } from '$lib/studycore/types';

interface Fixture {
	key: string;
	defaults: unknown;
	parse: { name: string; row: unknown; expect: unknown }[];
	repair: {
		name: string;
		row: unknown;
		context: { decks: string[] | null; schemes: { id: number; language: string; levels: string[] }[] | null; language: string };
		expect: unknown;
		notes: string[];
	}[];
	write: { name: string; stored: unknown; next: StudySetup; expect: unknown }[];
}

const fixture = JSON.parse(
	readFileSync(resolve(__dirname, '../../../../../../../docs/contracts/study/setup.json'), 'utf8')
) as Fixture;

describe('docs/contracts/study/setup.json', () => {
	it('names the key and the defaults', () => {
		expect(STUDY_SETUP_KEY).toBe(fixture.key);
		expect(defaultSetup()).toEqual(fixture.defaults);
	});

	it.each(fixture.parse)('parse: $name', ({ row, expect: want }) => {
		expect(parseSetup(row)).toEqual(want);
	});

	it.each(fixture.repair)('repair: $name', ({ row, context, expect: want, notes }) => {
		const schemes =
			context.schemes === null
				? null
				: context.schemes.map((s) => ({ id: s.id, language: s.language, levels: s.levels.map((name) => ({ name })) }));
		const got = repairSetup(parseSetup(row), { deckIds: context.decks, schemes, language: context.language });
		expect(got.setup).toEqual(want);
		expect(got.notes).toEqual(notes);
	});

	it.each(fixture.write)('write: $name', ({ stored, next, expect: want }) => {
		expect(withSetup(stored, next)).toEqual(want);
	});
});

describe('setupDeckIds', () => {
	const decks = [{ id: 'd1' }, { id: 'd2' }];
	it('"all" is General and every deck, so a deck made later joins', () => {
		expect(setupDeckIds(defaultSetup(), decks)).toEqual(['general', 'd1', 'd2']);
		expect(setupDeckIds(defaultSetup(), [...decks, { id: 'd3' }])).toEqual(['general', 'd1', 'd2', 'd3']);
	});
	it('an explicit list keeps what exists, in its own order', () => {
		expect(setupDeckIds({ ...defaultSetup(), decks: ['d2', 'gone', 'general'] }, decks)).toEqual(['d2', 'general']);
	});
	it('an explicit list with nothing left is every deck', () => {
		expect(setupDeckIds({ ...defaultSetup(), decks: ['gone'] }, decks)).toEqual(['general', 'd1', 'd2']);
	});
});

describe('setupKinds', () => {
	const none = new Set<OptInKind>();
	it('the defaults study vocab', () => {
		expect(setupKinds(defaultSetup(), none, 'ja')).toEqual(['vocab']);
	});
	it('an opt-in kind a deck switches on joins unless unchecked', () => {
		const on = new Set<OptInKind>(['reverse', 'cloze']);
		expect(setupKinds(defaultSetup(), on, 'ja')).toEqual(['vocab', 'reverse', 'cloze']);
		expect(setupKinds({ ...defaultSetup(), unchecked: ['cloze'] }, on, 'ja')).toEqual(['vocab', 'reverse']);
	});
	it('kinds the language lacks never count', () => {
		expect(setupKinds({ ...defaultSetup(), cardTypes: ['vocab', 'tone', 'writing'] }, none, 'es')).toEqual(['vocab']);
		expect(setupKinds({ ...defaultSetup(), cardTypes: ['vocab', 'tone'] }, none, 'zh')).toEqual(['vocab', 'tone']);
	});
	it('a setup of opt-in kinds only never adds vocab', () => {
		expect(setupKinds({ ...defaultSetup(), cardTypes: [] }, new Set<OptInKind>(['reverse']), 'ja')).toEqual(['reverse']);
		expect(setupKinds({ ...defaultSetup(), cardTypes: [] }, none, 'ja')).toEqual([]);
	});
});

describe('setupSessionConfig', () => {
	it('is the running session of a setup: its limits, orders, scope, kinds, seed and origin', () => {
		const setup: StudySetup = {
			...defaultSetup(),
			newLimit: 7,
			reviewLimit: 30,
			newOrder: { by: 'frequency' },
			typeOrder: 'grouped'
		};
		expect(setupSessionConfig(setup, ['general', 'd1'], ['vocab', 'reverse'], { seed: 5, from: '/flashcards' })).toEqual({
			mode: 'decks',
			schemeId: null,
			levelName: null,
			deckIds: ['general', 'd1'],
			newLimit: 7,
			reviewLimit: 30,
			cardTypes: ['vocab', 'reverse'],
			newOrder: { by: 'frequency' },
			typeOrder: 'grouped',
			seed: 5,
			from: '/flashcards'
		});
	});
	it('Study all is marked', () => {
		const config = setupSessionConfig(defaultSetup(), ['general'], ['vocab'], { seed: 1, from: '/', studyAll: true });
		expect(config.studyAll).toBe(true);
	});
});
