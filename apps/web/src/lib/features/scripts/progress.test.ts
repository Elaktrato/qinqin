import { describe, expect, it } from 'vitest';
import { scriptPayload, parseScriptEvent } from './events';
import { applyAnswer, deriveProgress, isKnown, summarise, MINUTE, DAY, type ItemState } from './progress';
import type { ScriptItem } from './types';

const T0 = Date.parse('2026-11-26T10:00:00Z');
const ev = (item: string, ok: boolean, at: number, system = 'hiragana', mode = 'recognise') => ({
	id: `e${at}`,
	workspaceId: 1,
	device: 'web',
	ts: new Date(at).toISOString(),
	type: 'script',
	payload: scriptPayload(system as never, item, mode as never, ok)
});

describe('script events', () => {
	it('builds the payload in the pinned member order', () => {
		expect(JSON.stringify(scriptPayload('hiragana', 'hiragana:あ', 'recognise', true))).toBe(
			'{"system":"hiragana","item":"hiragana:あ","mode":"recognise","ok":true}'
		);
	});

	it('parses an event and rejects the unreadable ones', () => {
		const e = ev('hiragana:あ', true, T0);
		expect(parseScriptEvent(e)).toEqual({ system: 'hiragana', item: 'hiragana:あ', mode: 'recognise', ok: true, at: T0 });
		expect(parseScriptEvent({ ...e, type: 'review' })).toBeNull();
		expect(parseScriptEvent({ ...e, payload: null })).toBeNull();
		expect(parseScriptEvent({ ...e, payload: { system: 'klingon', item: 'x', mode: 'recognise', ok: true } })).toBeNull();
		expect(parseScriptEvent({ ...e, payload: { system: 'hangul', item: 'x', mode: 'fly', ok: true } })).toBeNull();
		expect(parseScriptEvent({ ...e, payload: { system: 'hangul', item: 'x', mode: 'read', ok: 'yes' } })).toBeNull();
		expect(parseScriptEvent({ ...e, ts: 'yesterday' })).toBeNull();
	});
});

describe('applyAnswer', () => {
	it('moves a new item up one box on a correct answer and schedules it', () => {
		const s = applyAnswer(undefined, true, T0);
		expect(s).toMatchObject({ box: 1, correct: 1, wrong: 0, lastAt: T0, dueAt: T0 + 10 * MINUTE });
	});

	it('sends a wrong answer back to box 0, due in a minute', () => {
		const s = applyAnswer({ box: 3, correct: 5, wrong: 0, lastAt: T0, dueAt: T0 }, false, T0 + DAY);
		expect(s).toMatchObject({ box: 0, wrong: 1, dueAt: T0 + DAY + MINUTE });
	});

	it('does not promote an item answered again before it is due (no grinding)', () => {
		const first = applyAnswer(undefined, true, T0);
		const again = applyAnswer(first, true, T0 + MINUTE);
		expect(again.box).toBe(1);
		expect(again.correct).toBe(2);
		expect(again.dueAt).toBe(first.dueAt);
	});

	it('promotes when due, up to box 5', () => {
		let s: ItemState | undefined;
		let at = T0;
		for (let i = 0; i < 9; i++) {
			s = applyAnswer(s, true, at);
			at = s.dueAt;
		}
		expect(s!.box).toBe(5);
		expect(s!.dueAt - s!.lastAt).toBe(21 * DAY);
	});
});

describe('deriveProgress', () => {
	it('replays the events in time order whatever the order they arrive in', () => {
		const events = [ev('hiragana:あ', false, T0 + 2 * DAY), ev('hiragana:あ', true, T0), ev('hiragana:あ', true, T0 + DAY)];
		const map = deriveProgress(events);
		expect(map.get('hiragana:あ')).toMatchObject({ box: 0, correct: 2, wrong: 1 });
	});

	it('ignores other event types and unreadable payloads', () => {
		const map = deriveProgress([{ id: 'x', workspaceId: 1, device: 'web', ts: new Date(T0).toISOString(), type: 'review', payload: {} }, ev('hangul:ㄱ', true, T0, 'hangul')]);
		expect([...map.keys()]).toEqual(['hangul:ㄱ']);
	});

	it('is the same replayed twice', () => {
		const events = [ev('hiragana:あ', true, T0), ev('hiragana:い', false, T0 + 5)];
		expect(deriveProgress(events)).toEqual(deriveProgress(events));
	});
});

describe('summarise and isKnown', () => {
	const item = (g: string): ScriptItem => ({ id: `hiragana:${g}`, glyph: g, roman: g, sounds: [g], group: 'basic', sound: g });
	it('counts unseen, learning, known and due', () => {
		const items = ['あ', 'い', 'う', 'え'].map(item);
		const map = new Map<string, ItemState>([
			['hiragana:あ', { box: 3, correct: 3, wrong: 0, lastAt: T0, dueAt: T0 + DAY }],
			['hiragana:い', { box: 1, correct: 1, wrong: 0, lastAt: T0, dueAt: T0 + 10 * MINUTE }],
			['hiragana:う', { box: 4, correct: 4, wrong: 0, lastAt: T0, dueAt: T0 + 5 * DAY }]
		]);
		expect(isKnown(map.get('hiragana:あ'))).toBe(true);
		expect(isKnown(map.get('hiragana:い'))).toBe(false);
		expect(isKnown(undefined)).toBe(false);
		expect(summarise(items, map, T0 + 2 * DAY)).toEqual({ total: 4, known: 2, learning: 1, unseen: 1, due: 2 });
	});
});
