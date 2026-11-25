import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { aiMark, EXAMPLE_LEVELS, EXAMPLE_LIMITS, parseDraft, parseExamples, REPORT_REASONS } from '$lib/api/examples';
import { needsExamples } from './examples';

const fixture = JSON.parse(readFileSync(resolve(__dirname, '../../../../../../docs/contracts/examples/examples.json'), 'utf8')) as {
	levels: string[];
	reasons: string[];
	limits: Record<string, number>;
	draft: Record<string, unknown>;
	examples: unknown;
	kept: { ai: unknown };
	plain: { ai: unknown };
	reads: { name: string; raw: unknown; want: unknown }[];
	marks: { name: string; ai?: unknown; want: unknown }[];
};

describe('docs/contracts/examples/examples.json', () => {
	it('offers exactly the listed levels and reasons', () => {
		expect([...EXAMPLE_LEVELS]).toEqual(fixture.levels);
		expect([...REPORT_REASONS]).toEqual(fixture.reasons);
	});

	it('knows the limits the server applies', () => {
		expect(EXAMPLE_LIMITS).toEqual(fixture.limits);
	});

	it('decodes a draft and the examples answer as the server writes them', () => {
		const { createdAt: _c, ...want } = fixture.draft;
		expect(parseDraft(fixture.draft)).toEqual(want);
		expect(parseExamples(fixture.examples)).toEqual(fixture.examples);
	});

	it('marks the kept example and not the plain sentence', () => {
		expect(aiMark(fixture.kept.ai)).toEqual(fixture.kept.ai);
		expect(aiMark(fixture.plain.ai)).toBeNull();
	});

	it.each(fixture.reads)('reads: $name', ({ raw, want }) => {
		expect(parseDraft(raw)).toEqual(want);
	});

	it.each(fixture.marks)('marks: $name', ({ ai, want }) => {
		expect(aiMark(ai)).toEqual(want);
	});

	it('offers to generate below the few-examples limit, or while drafts wait', () => {
		const s = (n: number) => Array.from({ length: n }, (_, i) => ({ hanzi: `s${i}` }));
		const few = fixture.limits.fewExamples;
		expect(needsExamples(s(few - 1), [])).toBe(true);
		expect(needsExamples(s(few), [])).toBe(false);
		expect(needsExamples([...s(few), { hanzi: ' ' }], [])).toBe(false);
		expect(needsExamples([...s(few - 1), { hanzi: '  ' }], [])).toBe(true);
		expect(needsExamples(s(few + 2), [parseDraft(fixture.draft)!])).toBe(true);
	});
});
