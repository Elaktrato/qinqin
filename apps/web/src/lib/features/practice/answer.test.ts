import { describe, expect, it } from 'vitest';
import { parseDrillAnswer } from '$lib/studycore/drills';
import { answerEvent, roundResult } from './answer';

describe('answerEvent', () => {
	it('is a drill.<id> event the core reads back as the same answer', () => {
		const now = Date.parse('2026-11-28T12:00:00.250Z');
		const event = answerEvent(7, 'sample', 'sample-1', 'self', 3, now);
		expect(event).toMatchObject({ workspaceId: 7, device: 'web', ts: '2026-11-28T12:00:00.250Z', type: 'drill.sample' });
		expect(JSON.stringify(event.payload)).toBe('{"item":"sample-1","mode":"self","grade":3}');
		expect(event.id).toMatch(/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/);
		expect(parseDrillAnswer(event)).toMatchObject({ drill: 'sample', item: 'sample-1', mode: 'self', grade: 3 });
	});

	it("adds a drill's own members after the grade (#228: asked and given)", () => {
		const event = answerEvent(7, 'look-alikes', '未末', 'choose', 1, Date.parse('2026-11-28T12:00:00Z'), { asked: '未', given: '末' });
		expect(JSON.stringify(event.payload)).toBe('{"item":"未末","mode":"choose","grade":1,"asked":"未","given":"末"}');
		expect(parseDrillAnswer(event)).toMatchObject({ drill: 'look-alikes', item: '未末', mode: 'choose', grade: 1 });
	});

	it('never lets a member replace the item, the mode or the grade', () => {
		const event = answerEvent(7, 'sample', 'sample-1', 'self', 3, 0, { item: 'x', grade: '1', given: 'y' });
		expect(JSON.stringify(event.payload)).toBe('{"item":"sample-1","mode":"self","grade":3,"given":"y"}');
	});
});

describe('roundResult', () => {
	it('counts Hard, Good and Easy as right, Again as wrong, and lists the missed items once', () => {
		const e = (drill: string, key: string) => ({ drill, item: { key } });
		const b = e('sample', 'b');
		expect(
			roundResult([
				{ entry: e('sample', 'a'), grade: 3 },
				{ entry: b, grade: 1 },
				{ entry: e('sample', 'c'), grade: 2 },
				{ entry: e('sample', 'b'), grade: 1 },
				{ entry: e('other', 'b'), grade: 1 },
				{ entry: e('sample', 'd'), grade: 4 }
			])
		).toEqual({ right: 3, total: 6, missed: [b, e('other', 'b')] });
	});
});
