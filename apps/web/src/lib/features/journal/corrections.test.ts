import { describe, expect, it } from 'vitest';
import { corrections, categoryLabel, correctionCounts, nextId } from './corrections';
import type { Annotation, Review } from './types';

function ann(id: string, kind: 'mistake' | 'suggestion' = 'mistake'): Annotation {
	return { id, quote: id, prefix: '', suffix: '', correction: 'x', explanation: 'e', category: 'grammar', kind };
}

function review(annotations: Annotation[]): Review {
	return {
		entryId: 'e',
		textHash: 'h',
		annotations,
		overall: { summary: '', strengths: [], focus: [] },
		model: 'm',
		dropped: { notFound: 0, wrongScript: 0, noChange: 0, overlap: 0, empty: 0, tooMany: 0 },
		createdAt: ''
	};
}

const a = ann('a'),
	b = ann('b', 'suggestion'),
	c = ann('c'),
	d = ann('d', 'suggestion');

describe('corrections', () => {
	it('orders placed corrections by position, then list-only, then missing', () => {
		const list = corrections(review([d, b, c, a]), {
			placed: [
				{ annotation: c, start: 20, end: 21 },
				{ annotation: a, start: 2, end: 3 }
			],
			listOnly: [b],
			missing: [d]
		});
		expect(list.map((x) => [x.annotation.id, x.state, x.index])).toEqual([
			['a', 'placed', 0],
			['c', 'placed', 1],
			['b', 'listOnly', 2],
			['d', 'missing', 3]
		]);
	});

	it('carries each annotation kind', () => {
		const list = corrections(review([a, b]), {
			placed: [{ annotation: a, start: 0, end: 1 }],
			listOnly: [b],
			missing: []
		});
		expect(list.map((x) => x.kind)).toEqual(['mistake', 'suggestion']);
	});

	it('counts mistakes and suggestions, excluding missing ones', () => {
		const list = corrections(review([a, b, c]), {
			placed: [{ annotation: a, start: 0, end: 1 }],
			listOnly: [b],
			missing: [c]
		});
		expect(correctionCounts(list)).toEqual({ mistakes: 1, suggestions: 1 });
	});

	it('pages forward and back and stops at the ends', () => {
		const list = corrections(review([a, b]), {
			placed: [
				{ annotation: a, start: 0, end: 1 },
				{ annotation: b, start: 2, end: 3 }
			],
			listOnly: [],
			missing: []
		});
		expect(nextId(list, a.id, 1)).toBe(b.id);
		expect(nextId(list, b.id, -1)).toBe(a.id);
		expect(nextId(list, a.id, -1)).toBeNull();
		expect(nextId(list, b.id, 1)).toBeNull();
		expect(nextId(list, 'unknown', 1)).toBeNull();
	});
});

describe('categoryLabel', () => {
	it('maps the five schema categories to the catalogue', () => {
		expect(categoryLabel('grammar')).toBe('Grammar');
		expect(categoryLabel('word choice')).toBe('Word choice');
		expect(categoryLabel('spelling')).toBe('Spelling');
		expect(categoryLabel('style')).toBe('Style');
		expect(categoryLabel('other')).toBe('Other');
	});

	it('passes another category through, cut to 40 code points', () => {
		expect(categoryLabel('punctuation')).toBe('punctuation');
		expect(categoryLabel('字'.repeat(60))).toHaveLength(40);
	});
});
