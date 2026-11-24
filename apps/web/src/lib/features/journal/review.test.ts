import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { annotationKind, parseReview } from './review';

interface Case {
	name: string;
	doc: unknown;
	expect: unknown;
}

const fixture = JSON.parse(
	readFileSync(resolve(__dirname, '../../../../../../docs/contracts/journal/review-docs.json'), 'utf8')
) as { cases: Case[] };

describe('docs/contracts/journal/review-docs.json', () => {
	it.each(fixture.cases)('$name', ({ doc, expect: want }) => {
		expect(parseReview(doc)).toEqual(want);
	});
});

describe('malformed ids', () => {
	it('drops an annotation without an id and a duplicate id', () => {
		const r = parseReview({
			entryId: 'e',
			annotations: [
				{ quote: 'a', correction: 'b' },
				{ id: 'a1', quote: 'a', correction: 'b' },
				{ id: 'a1', quote: 'c', correction: 'd' }
			]
		});
		expect(r?.annotations.map((a) => a.quote)).toEqual(['a']);
	});
});

describe('annotationKind', () => {
	it('only "suggestion" is a suggestion; everything else is a mistake', () => {
		expect(annotationKind({ kind: 'suggestion' })).toBe('suggestion');
		expect(annotationKind({ kind: 'mistake' })).toBe('mistake');
		expect(annotationKind({ kind: ' Suggestion ' })).toBe('mistake');
		expect(annotationKind({ kind: 3 })).toBe('mistake');
		expect(annotationKind({})).toBe('mistake');
		expect(annotationKind(null)).toBe('mistake');
	});
});
