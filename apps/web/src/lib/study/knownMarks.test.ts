import { describe, expect, it } from 'vitest';
import fixture from '../../../../../docs/contracts/reader/word-states.json';
import { KNOWN_PREFIX, knownMarkRow, parseKnownBatch, parseKnownMark } from './knownMarks';

describe('parseKnownMark (reader/word-states.json rowCases)', () => {
	it.each(fixture.rowCases)('$name', (c) => {
		expect(parseKnownMark(c.key, c.data)).toBe(c.expect);
	});
});

describe('knownMarkRow', () => {
	it('builds the row a parse reads back', () => {
		const row = knownMarkRow(41, new Date('2026-11-16T10:00:00.000Z'));
		expect(row).toEqual({
			key: 'known:41',
			data: { version: 1, entryId: 41, createdAt: '2026-11-16T10:00:00.000Z' }
		});
		expect(parseKnownMark(row.key, row.data)).toBe(41);
		expect(row.key.startsWith(KNOWN_PREFIX)).toBe(true);
	});

	it('refuses an id that is not an entry', () => {
		expect(() => knownMarkRow(0, new Date())).toThrow();
		expect(() => knownMarkRow(1.5, new Date())).toThrow();
	});
});

describe('declaration fields (#74)', () => {
	const at = new Date('2026-11-26T10:00:00.000Z');
	const batch = { id: '01JDECLARE0000000000000000', source: 'range' as const, scope: 'HSK · up to HSK 3' };

	it('a declared mark carries the batch, still parses as a mark and reads back as a batch', () => {
		const row = knownMarkRow(7, at, batch);
		expect(row.data).toEqual({
			version: 1,
			entryId: 7,
			createdAt: at.toISOString(),
			batch: batch.id,
			source: 'range',
			scope: 'HSK · up to HSK 3'
		});
		expect(parseKnownMark(row.key, row.data)).toBe(7);
		expect(parseKnownBatch(row.data)).toEqual(batch);
	});

	it('a plain mark has no batch', () => {
		expect(parseKnownBatch(knownMarkRow(7, at).data)).toBeNull();
	});

	it('ignores a malformed batch, an unknown source and a missing scope', () => {
		expect(parseKnownBatch({ batch: 5, source: 'range', scope: 'x' })).toBeNull();
		expect(parseKnownBatch({ batch: '', source: 'range', scope: 'x' })).toBeNull();
		expect(parseKnownBatch({ batch: 'a', source: 'other', scope: 'x' })).toBeNull();
		expect(parseKnownBatch({ batch: 'a', source: 'placement' })).toEqual({ id: 'a', source: 'placement', scope: '' });
		expect(parseKnownBatch(null)).toBeNull();
	});

	it('caps the scope label', () => {
		expect(parseKnownBatch({ batch: 'a', source: 'range', scope: 'x'.repeat(500) })?.scope).toHaveLength(120);
	});
});
