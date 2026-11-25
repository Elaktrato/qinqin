import { describe, expect, it } from 'vitest';

import { defaultSetup, type StudySetup } from '$lib/study/setup';
import type { DeckSettings } from '$lib/study/deckSettings';
import { deckSessionConfig, levelSessionConfig, sessionKinds } from './studyStart';

const SETUP: StudySetup = {
	...defaultSetup(),
	decks: ['general', 'other'],
	newLimit: 7,
	reviewLimit: 42,
	cardTypes: ['vocab', 'writing']
};

describe('deckSessionConfig', () => {
	it('studies this deck only with the saved limits and the given kinds, and remembers where it started', () => {
		const config = deckSessionConfig(SETUP, 'd1', ['vocab', 'reverse'], '/flashcards');
		expect(config).toMatchObject({
			mode: 'decks',
			deckIds: ['d1'],
			newLimit: 7,
			reviewLimit: 42,
			cardTypes: ['vocab', 'reverse'],
			from: '/flashcards'
		});
		expect(config.studyAll).toBeUndefined();
	});

	it('is a deck session even when the saved setup studies a level', () => {
		const config = deckSessionConfig({ ...SETUP, mode: 'levels', schemeId: 3, levelName: 'HSK 1' }, 'd1', ['vocab'], '/');
		expect(config.mode).toBe('decks');
	});
});

describe('levelSessionConfig', () => {
	it('is a levels session whose kinds always contain vocab and never reverse or cloze', () => {
		const config = levelSessionConfig({ ...SETUP, cardTypes: ['writing'] }, 5, 'HSK 2', '/flashcards/system/x');
		expect(config).toMatchObject({ mode: 'levels', schemeId: 5, levelName: 'HSK 2', newLimit: 7, from: '/flashcards/system/x' });
		expect(config.cardTypes).toEqual(['vocab', 'writing']);
	});
	it('does not duplicate vocab', () => {
		expect(levelSessionConfig(SETUP, 5, 'x', '/').cardTypes.filter((k) => k === 'vocab')).toHaveLength(1);
	});
});

describe('a fresh seed per started session (#132 review)', () => {
	it('uses the given seed', () => {
		expect(deckSessionConfig(SETUP, 'd1', ['vocab'], '/', 222).seed).toBe(222);
		expect(levelSessionConfig(SETUP, 5, 'HSK 2', '/', 333).seed).toBe(333);
	});

	it('draws a random seed when none is given', () => {
		for (const config of [deckSessionConfig(defaultSetup(), 'd1', ['vocab'], '/'), levelSessionConfig(defaultSetup(), 5, 'HSK 2', '/')]) {
			expect(Number.isInteger(config.seed)).toBe(true);
			expect(config.seed).toBeGreaterThanOrEqual(0);
		}
	});
});

describe('sessionKinds', () => {
	const settings: Record<string, DeckSettings> = {
		d1: { deckId: 'd1', cardTypes: ['reverse'], extra: {} }
	};
	it('adds opt-in kinds a deck enables on top of the saved kinds', () => {
		expect(sessionKinds(defaultSetup(), ['d1'], settings, 'ja')).toEqual(['vocab', 'reverse']);
		expect(sessionKinds(defaultSetup(), ['d2'], settings, 'ja')).toEqual(['vocab']);
	});
	it('respects a kind the learner unchecked', () => {
		expect(sessionKinds({ ...defaultSetup(), unchecked: ['reverse'] }, ['d1'], settings, 'ja')).toEqual(['vocab']);
	});
	it('uses the saved kinds the language offers', () => {
		expect(sessionKinds({ ...defaultSetup(), cardTypes: ['writing', 'tone'] }, ['d2'], settings, 'ja')).toEqual(['writing']);
	});
});
