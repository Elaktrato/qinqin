// docs/contracts/graded/catalogue.json: the answer of GET /api/library/graded, and what the Sources page derives from it.
import { describe, expect, it } from 'vitest';
import fixture from '../../../../../../../docs/contracts/graded/catalogue.json';
import type { GradedText } from '$lib/api/types';
import { KIND_KEYS, levelChoices, textsAt } from './catalogue';

const texts = fixture.answer.texts as GradedText[];

describe('graded catalogue (contract)', () => {
	it('decodes every key of an entry', () => {
		expect(fixture.rule).toBe('graded/catalogue');
		for (const t of texts) {
			expect(Object.keys(t).sort()).toEqual(
				[
					'glosses',
					'humanReviewed',
					'id',
					'kind',
					'language',
					'length',
					'level',
					'levelName',
					'levels',
					'names',
					'scheme',
					'title'
				].sort()
			);
			expect(t.id.startsWith(`${t.language}-`)).toBe(true);
			expect(t.level).toBeGreaterThanOrEqual(0);
			expect(t.level).toBeLessThan(t.levels);
			expect(Object.keys(KIND_KEYS)).toContain(t.kind);
			for (const g of t.glosses)
				expect(Object.keys(g).sort()).toEqual(['meaning', 'reading', 'word']);
		}
	});

	it('offers each level of a language once, lowest first, and filters by it', () => {
		const zh = texts.filter((t) => t.language === 'zh');
		const choices = levelChoices([...zh].reverse());
		expect(choices.map((c) => c.level)).toEqual(
			[...new Set(zh.map((t) => t.level))].sort((a, b) => a - b)
		);
		expect(choices[0].name).toBe(
			zh.find((t) => t.level === choices[0].level)?.levelName
		);
		expect(textsAt(zh, null)).toEqual(zh);
		expect(
			textsAt(zh, choices[0].level).every((t) => t.level === choices[0].level)
		).toBe(true);
		expect(textsAt(zh, 99)).toEqual([]);
	});
});
