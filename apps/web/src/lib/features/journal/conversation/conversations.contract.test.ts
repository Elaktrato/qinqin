import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LEVELS, LIMITS, parseConversation } from './conversations';
import { sendableText, startBody, turnGate } from './talk';

type FxString = string | { repeat: string; times: number };
const str = (s: FxString): string => (typeof s === 'string' ? s : s.repeat.repeat(s.times));

const fixture = JSON.parse(
	readFileSync(resolve(__dirname, '../../../../../../../docs/contracts/journal/conversations.json'), 'utf8')
) as {
	levels: string[];
	limits: Record<string, number>;
	conversation: unknown;
	start: { accept: { topic: FxString; level: string }[]; refuse: { topic: FxString; level: string; why: string }[] };
	turn: { text: FxString; hasMessages: boolean; code: string; why?: string }[];
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

	it('sends every accepted start as it is, and turns a refused one into one the server takes', () => {
		for (const c of fixture.start.accept) expect(startBody(str(c.topic), c.level as never)).toEqual({ topic: str(c.topic), level: c.level });
		for (const c of fixture.start.refuse) {
			const body = startBody(str(c.topic), c.level as never);
			expect(LEVELS, c.why).toContain(body.level);
			expect([...body.topic].length, c.why).toBeLessThanOrEqual(LIMITS.topicRunes);
			expect(body.topic, c.why).not.toMatch(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/);
		}
	});

	it.each(fixture.turn)('turn: $why ($code)', ({ text, hasMessages, code }) => {
		const ready = { available: true, banner: null, opened: hasMessages, full: false, busy: false };
		const gate = turnGate({ ...ready, text: str(text) });
		if (code === '' ) expect(gate.enabled).toBe(true);
		else if (code === 'bad_request') {
			// The client sends the text without the control characters the server refuses.
			expect(sendableText(str(text))).not.toMatch(/[\u0000-\u0008]/);
			expect(gate.enabled).toBe(true);
		} else expect(gate.enabled).toBe(false);
		if (code === 'too_long') expect(gate.hint).not.toBeNull();
	});

	it.each(fixture.reads)('reads: $why', ({ doc, expect: want }) => {
		expect(parseConversation(doc)).toEqual(want);
	});
});
