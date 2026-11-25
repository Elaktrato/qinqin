import { describe, expect, it } from 'vitest';
import type { Dictionary, Scheme } from '$lib/api/types';
import { coverage, dictionaryHint, levelsHint } from './coverage';

const dict = (id: number, language: string): Dictionary => ({
	id, name: `d${id}`, version: '1', license: '', attribution: '', packId: `p${id}`, language
});
const scheme = (language: string): Scheme =>
	({ id: 1, name: 'HSK', unit: 'word', language, levels: [] }) as Scheme;

describe('coverage', () => {
	it('counts dictionaries of the language and level schemes', () => {
		const c = coverage('es', [dict(1, 'zh'), dict(2, 'es')], [scheme('zh')]);
		expect(c.dictionaries.map((d) => d.id)).toEqual([2]);
		expect(c.levels).toBe(0);
	});
	it('matches case-insensitively on the full code', () => {
		expect(coverage('ZH', [dict(1, 'zh')], [scheme('zh')])).toEqual({
			dictionaries: [dict(1, 'zh')],
			levels: 1
		});
		expect(coverage('pt', [dict(1, 'pt-br')], []).dictionaries).toHaveLength(0);
	});
});

describe('hints', () => {
	it('uses the exact copy', () => {
		expect(dictionaryHint('Spanish', true)).toBe(
			'No dictionary is installed for Spanish. Install one in Settings → Data.'
		);
		expect(dictionaryHint('Spanish', false)).toBe(
			'No dictionary is installed for Spanish. Ask the administrator of this server to install one.'
		);
		expect(levelsHint('Spanish')).toBe(
			'No level lists for Spanish: level badges and filters are unavailable.'
		);
	});
});
