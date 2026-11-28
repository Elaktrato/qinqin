import { describe, expect, it } from 'vitest';
import fixture from '../../../../../docs/contracts/reader/sentence-sources.json';
import type { SentenceSource } from '$lib/api/types';
import { sourceLabel, sourceText } from './sentenceSource';

describe('sentence source label (contract reader/sentence-sources.json)', () => {
	it('is version 1 of its rule', () => {
		expect(fixture.version).toBe(1);
		expect(fixture.rule).toBe('reader/sentence-sources');
	});
	for (const c of fixture.label) {
		it(`label: ${c.name}`, () => {
			const got = sourceLabel(c.source as SentenceSource);
			expect({ title: got.title, chapter: got.chapter, linked: got.href !== null }).toEqual(c.want);
		});
	}
	it('reads "From title, chapter n"', () => {
		expect(sourceText(fixture.label[0].source as SentenceSource)).toBe('From Book five, chapter 3');
		expect(sourceText(fixture.label[1].source as SentenceSource)).toBe('From an untitled book, chapter 1');
	});
});
