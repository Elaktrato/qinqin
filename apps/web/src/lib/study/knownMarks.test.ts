import { describe, expect, it } from 'vitest';
import fixture from '../../../../../docs/contracts/reader/word-states.json';
import { KNOWN_PREFIX, knownMarkRow, parseKnownMark } from './knownMarks';

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
