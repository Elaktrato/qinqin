import { describe, expect, it } from 'vitest';

import {
	defaultExtraTypes,
	effectiveCardTypes,
	effectiveKinds,
	parseExtraChoices,
	parseRememberedTypes,
	withExtraChoice,
	withRememberedTypes
} from './cardTypesMemory';

describe('remembered card types', () => {
	it('reads one workspace, keeps known kinds in canonical order', () => {
		const raw = JSON.stringify({ '1': ['tone', 'vocab', 'bogus', 'tone'], '2': ['writing'] });
		expect(parseRememberedTypes(raw, 1)).toEqual(['vocab', 'tone']);
		expect(parseRememberedTypes(raw, 2)).toEqual(['writing']);
		expect(parseRememberedTypes(raw, 3)).toBeNull();
	});

	it('treats junk and empty lists as nothing remembered', () => {
		expect(parseRememberedTypes(null, 1)).toBeNull();
		expect(parseRememberedTypes('nope', 1)).toBeNull();
		expect(parseRememberedTypes(JSON.stringify({ '1': [] }), 1)).toBeNull();
		expect(parseRememberedTypes(JSON.stringify({ '1': ['bogus'] }), 1)).toBeNull();
		expect(parseRememberedTypes(JSON.stringify({ '1': 'vocab' }), 1)).toBeNull();
	});

	it('writes one workspace without touching others', () => {
		const raw = withRememberedTypes(JSON.stringify({ '2': ['writing'] }), 1, ['sentence', 'x']);
		expect(parseRememberedTypes(raw, 1)).toEqual(['sentence']);
		expect(parseRememberedTypes(raw, 2)).toEqual(['writing']);
		expect(parseRememberedTypes(withRememberedTypes('junk', 1, ['tone']), 1)).toEqual(['tone']);
	});

	it('prefers the tab setup, then the remembered types, then vocab', () => {
		expect(effectiveCardTypes(['tone', 'vocab'], ['writing'])).toEqual(['vocab', 'tone']);
		expect(effectiveCardTypes(null, ['writing'])).toEqual(['writing']);
		expect(effectiveCardTypes(['bogus'], ['writing'])).toEqual(['writing']);
		expect(effectiveCardTypes(null, null)).toEqual(['vocab']);
	});
});

describe('extra (opt-in) type choices', () => {
	it('reads one workspace; only booleans for the two opt-in kinds', () => {
		const raw = JSON.stringify({ '1': { reverse: false, cloze: true, bogus: false }, '2': 'x' });
		expect(parseExtraChoices(raw, 1)).toEqual({ reverse: false, cloze: true });
		expect(parseExtraChoices(raw, 2)).toEqual({});
		expect(parseExtraChoices(null, 1)).toEqual({});
		expect(parseExtraChoices('junk', 1)).toEqual({});
	});

	it('writes one workspace and kind without touching the rest', () => {
		const raw = withExtraChoice(JSON.stringify({ '2': { cloze: false } }), 1, 'reverse', false);
		expect(parseExtraChoices(raw, 1)).toEqual({ reverse: false });
		expect(parseExtraChoices(raw, 2)).toEqual({ cloze: false });
		expect(parseExtraChoices(withExtraChoice(raw, 1, 'reverse', true), 1)).toEqual({ reverse: true });
	});

	it('defaultExtraTypes: enabled kinds, checked unless unchecked before', () => {
		const enabled = new Set(['reverse', 'cloze'] as const);
		expect(defaultExtraTypes(enabled, {})).toEqual(['reverse', 'cloze']);
		expect(defaultExtraTypes(enabled, { cloze: false })).toEqual(['reverse']);
		expect(defaultExtraTypes(new Set(['cloze'] as const), { reverse: true })).toEqual(['cloze']);
	});
});

describe('effectiveKinds', () => {
	it('adds the enabled, not unchecked opt-in kinds to the remembered existing kinds', () => {
		expect(effectiveKinds(['vocab', 'tone'], new Set(['reverse'] as const), {})).toEqual([
			'vocab',
			'tone',
			'reverse'
		]);
		expect(effectiveKinds(['vocab'], new Set(['reverse', 'cloze'] as const), { reverse: false })).toEqual([
			'vocab',
			'cloze'
		]);
	});

	it('ignores opt-in entries of the remembered list and falls back to vocab', () => {
		expect(effectiveKinds(['vocab', 'reverse', 'cloze'], new Set(), {})).toEqual(['vocab']);
		expect(effectiveKinds(null, new Set(), {})).toEqual(['vocab']);
		// A setup that only had opt-in kinds never falls back to counting vocab.
		expect(effectiveKinds(['reverse'], new Set(['cloze'] as const), {})).toEqual(['cloze']);
		expect(effectiveKinds(['reverse'], new Set(), {})).toEqual([]);
	});
});
