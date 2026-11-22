import { describe, expect, it } from 'vitest';

import { DEFAULT_CONFIG, type StudySessionConfig } from '$lib/study/session';
import type { DeckSettings } from '$lib/study/deckSettings';
import { deckKinds, deckSessionConfig, levelSessionConfig } from './studyStart';

const BASE: StudySessionConfig = {
	...DEFAULT_CONFIG,
	deckIds: ['general', 'other'],
	newLimit: 7,
	reviewLimit: 42,
	cardTypes: ['vocab', 'writing']
};

describe('deckSessionConfig', () => {
	it('studies this deck only with the saved limits and the given kinds', () => {
		const config = deckSessionConfig(BASE, 'd1', ['vocab', 'reverse']);
		expect(config).toMatchObject({
			mode: 'decks',
			deckIds: ['d1'],
			newLimit: 7,
			reviewLimit: 42,
			cardTypes: ['vocab', 'reverse']
		});
	});

	it('keeps the level fields so a switch back on /study still works', () => {
		const config = deckSessionConfig({ ...BASE, schemeId: 3, levelName: 'HSK 1' }, 'd1', ['vocab']);
		expect(config.schemeId).toBe(3);
		expect(config.levelName).toBe('HSK 1');
	});
});

describe('levelSessionConfig', () => {
	it('is a levels session whose kinds always contain vocab and never reverse or cloze', () => {
		const config = levelSessionConfig({ ...BASE, cardTypes: ['writing', 'reverse', 'cloze'] }, 5, 'HSK 2');
		expect(config).toMatchObject({ mode: 'levels', schemeId: 5, levelName: 'HSK 2' });
		expect(config.cardTypes).toContain('vocab');
		expect(config.cardTypes).toContain('writing');
		expect(config.cardTypes).not.toContain('reverse');
		expect(config.cardTypes).not.toContain('cloze');
		expect(config.newLimit).toBe(7);
	});
	it('does not duplicate vocab', () => {
		expect(levelSessionConfig(BASE, 5, 'x').cardTypes.filter((k) => k === 'vocab')).toHaveLength(1);
	});
});

describe('a fresh seed per started session (#132 review)', () => {
	const old: StudySessionConfig = { ...BASE, seed: 111, studyAll: true };

	it('deckSessionConfig draws a new seed and drops a stale study-all', () => {
		const config = deckSessionConfig(old, 'd1', ['vocab'], 222);
		expect(config.seed).toBe(222);
		expect(config.studyAll).toBeUndefined();
	});

	it('levelSessionConfig draws a new seed and drops a stale study-all', () => {
		const config = levelSessionConfig(old, 5, 'HSK 2', 333);
		expect(config.seed).toBe(333);
		expect(config.studyAll).toBeUndefined();
	});

	it('draws a random seed when none is given, also without a saved setup', () => {
		const a = deckSessionConfig(DEFAULT_CONFIG, 'd1', ['vocab']);
		const b = levelSessionConfig(DEFAULT_CONFIG, 5, 'HSK 2');
		for (const config of [a, b]) {
			expect(Number.isInteger(config.seed)).toBe(true);
			expect(config.seed).toBeGreaterThanOrEqual(0);
		}
	});
});

describe('deckKinds', () => {
	const settings: Record<string, DeckSettings> = {
		d1: { deckId: 'd1', cardTypes: ['reverse'], extra: {} }
	};
	it('adds opt-in kinds a deck enables on top of the remembered kinds', () => {
		expect(deckKinds(['d1'], settings, null, null, {})).toEqual(['vocab', 'reverse']);
		expect(deckKinds(['d2'], settings, null, null, {})).toEqual(['vocab']);
	});
	it('respects a kind the learner unchecked on the setup page', () => {
		expect(deckKinds(['d1'], settings, null, null, { reverse: false })).toEqual(['vocab']);
	});
	it('uses the tab setup, then the remembered kinds', () => {
		expect(deckKinds(['d2'], settings, ['writing'], ['tone'], {})).toEqual(['writing']);
		expect(deckKinds(['d2'], settings, null, ['tone'], {})).toEqual(['tone']);
	});
});
