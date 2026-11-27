import { describe, expect, it } from 'vitest';

import { cleanCardTypes, enabledKinds, type DeckSettings } from './deckSettings';

describe('cleanCardTypes', () => {
	it('keeps the known opt-in kinds in kind order, once each', () => {
		expect(cleanCardTypes(['cloze', 'reverse', 'bogus', 'vocab', 'cloze'])).toEqual(['reverse', 'cloze']);
	});
});

describe('enabledKinds', () => {
	const settings: Record<string, DeckSettings> = {
		a: { deckId: 'a', cardTypes: ['reverse'], extra: {} },
		b: { deckId: 'b', cardTypes: ['cloze'], extra: {} }
	};
	it('unions over the given decks only', () => {
		expect([...enabledKinds(settings, ['a'])]).toEqual(['reverse']);
		expect([...enabledKinds(settings, ['a', 'b', 'zz'])].sort()).toEqual(['cloze', 'reverse']);
		expect(enabledKinds(undefined, ['a']).size).toBe(0);
	});
});
