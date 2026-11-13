import { describe, expect, it } from 'vitest';

import { effectiveCardTypes, parseRememberedTypes, withRememberedTypes } from './cardTypesMemory';

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
