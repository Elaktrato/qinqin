import { describe, expect, it } from 'vitest';
import { EXPLANATION_LANGUAGES } from './languages';

describe('EXPLANATION_LANGUAGES', () => {
	it('has the codes of the server list, in order, without duplicates', () => {
		const codes = EXPLANATION_LANGUAGES.map((l) => l.code);
		expect(codes).toEqual(['en', 'de', 'fr', 'es', 'it', 'pt', 'nl', 'ru', 'ja', 'zh-Hans', 'zh-Hant', 'ko']);
		expect(new Set(codes).size).toBe(codes.length);
		expect(EXPLANATION_LANGUAGES.every((l) => l.label.length > 0)).toBe(true);
	});
});
