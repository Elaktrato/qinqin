import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LEVELS, LIMITS, parseConversation } from './conversations';

const fixture = JSON.parse(
	readFileSync(resolve(__dirname, '../../../../../../../docs/contracts/journal/conversations.json'), 'utf8')
) as {
	levels: string[];
	limits: Record<string, number>;
	conversation: unknown;
	reads: { why: string; doc: unknown; expect: unknown }[];
};

describe('docs/contracts/journal/conversations.json', () => {
	it('offers exactly the listed levels, easiest first', () => {
		expect([...LEVELS]).toEqual(fixture.levels);
	});

	it('knows the limits the server applies', () => {
		expect(LIMITS).toEqual(fixture.limits);
	});

	it('decodes the conversation as the server answers it', () => {
		expect(parseConversation(fixture.conversation)).toEqual(fixture.conversation);
	});

	it.each(fixture.reads)('reads: $why', ({ doc, expect: want }) => {
		expect(parseConversation(doc)).toEqual(want);
	});
});
