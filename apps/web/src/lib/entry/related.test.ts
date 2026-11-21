import { describe, expect, it } from 'vitest';
import type { Entry } from '$lib/api/types';
import { relatedWords } from './related';

const entry = {
	id: 1,
	language: 'ja',
	kind: 'word',
	written: '為る',
	readings: [],
	attrs: {},
	radicalId: null,
	badges: [],
	variants: [],
	sentences: [],
	senses: [],
	senseGroups: [
		{ dictionaryId: 1, dictionaryName: 'J', packId: 'j', license: 'x', attribution: 'x', pos: [], tags: [], glosses: [], xrefs: ['為さる', 'する・為る'] },
		{ dictionaryId: 2, dictionaryName: 'K', packId: 'k', license: 'x', attribution: 'x', pos: [], tags: [], glosses: [], xrefs: ['為さる', ''] }
	]
} as unknown as Entry;

describe('relatedWords (#104)', () => {
	it('parses xrefs, keeps the order, drops duplicates and the word itself', () => {
		expect(relatedWords(entry)).toEqual(['為さる', 'する']);
	});
	it('is empty without xrefs', () => {
		expect(relatedWords({ ...entry, senseGroups: [] } as Entry)).toEqual([]);
	});
});
