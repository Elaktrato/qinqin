import { describe, expect, it } from 'vitest';
import families from '../../../../../docs/contracts/conjugation/families.json';
import fixture from '../../../../../docs/contracts/conjugation/settings.json';
import {
	CONJUGATION_FAMILIES,
	DEFAULT_CONJUGATION_FAMILIES,
	FAMILY_FORMS,
	conjugationFamilyPatch,
	enabledFamilies,
	hasConjugationSettings
} from './conjugationSettings';

describe('conjugation settings (docs/contracts/conjugation/settings.json)', () => {
	it('knows the contract families, their forms and defaults', () => {
		expect(CONJUGATION_FAMILIES).toEqual(families.families.map((f) => f.id));
		expect(DEFAULT_CONJUGATION_FAMILIES).toEqual(families.families.filter((f) => f.default).map((f) => f.id));
		for (const f of families.families) expect(FAMILY_FORMS[f.id as keyof typeof FAMILY_FORMS]).toEqual(f.forms);
	});

	for (const c of fixture.parse) {
		it(`parse: ${c.name}`, () => {
			expect(enabledFamilies(c.settings as Record<string, unknown>)).toEqual(c.on);
		});
	}

	for (const c of fixture.patch) {
		it(`patch: ${c.family} ${c.on}`, () => {
			expect(conjugationFamilyPatch(c.family as (typeof CONJUGATION_FAMILIES)[number], c.on)).toEqual(c.patch);
		});
	}

	it('is a Japanese setting', () => {
		expect(hasConjugationSettings('ja')).toBe(true);
		expect(hasConjugationSettings('zh')).toBe(false);
		expect(enabledFamilies(null)).toEqual(DEFAULT_CONJUGATION_FAMILIES);
	});
});
