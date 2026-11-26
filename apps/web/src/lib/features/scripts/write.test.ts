import { describe, expect, it } from 'vitest';
import { systemById } from './packs';
import { buildRound, seeded } from './queue';
import { isCorrect, startRun, submit } from './run';
import { canWrite, MODES, WRITABLE_SYSTEMS } from './types';
import { WRITE_MAX_MISTAKES, writeAnswer, writeVerdict } from './write';

const hira = systemById('hiragana')!;
const kata = systemById('katakana')!;
const hangul = systemById('hangul')!;
const T0 = Date.parse('2026-11-26T10:00:00Z');

describe('the write mode', () => {
	it('is the fifth mode and only the kana have it', () => {
		expect(MODES).toContain('write');
		expect(WRITABLE_SYSTEMS).toEqual(['hiragana', 'katakana']);
		expect(canWrite('hiragana')).toBe(true);
		expect(canWrite('katakana')).toBe(true);
		expect(canWrite('hangul')).toBe(false);
		expect(canWrite('cyrillic')).toBe(false);
	});

	it('asks single kana by their sound and expects the glyph; digraphs are left out', () => {
		for (const system of [hira, kata]) {
			const round = buildRound(system, 'write', new Map(), T0, seeded(3));
			expect(round).toHaveLength(10);
			for (const q of round) {
				expect(q.mode).toBe('write');
				expect([...q.answer]).toHaveLength(1);
				expect(q.accepts).toEqual([q.answer]);
				expect(q.options).toEqual([]);
				expect(q.speak).not.toBeNull();
				expect(q.itemId).toBe(`${system.id}:${q.answer}`);
				expect(system.items.find((i) => i.id === q.itemId)?.group).not.toBe('combo');
			}
			expect(new Set(round.map((q) => q.itemId)).size).toBe(round.length);
		}
	});

	it('has nothing to ask for a system without stroke data', () => {
		expect(buildRound(hangul, 'write', new Map(), T0, seeded(1))).toEqual([]);
	});

	it('is checked like a choice: the glyph is right, anything else wrong', () => {
		const [q] = buildRound(hira, 'write', new Map(), T0, seeded(5));
		expect(isCorrect(q, q.answer)).toBe(true);
		expect(isCorrect(q, '')).toBe(false);
		const run = submit(startRun([q]), writeAnswer(q, true));
		expect(run.ok).toBe(true);
		expect(submit(startRun([q]), writeAnswer(q, false)).ok).toBe(false);
	});
});

describe('writeVerdict', () => {
	it(`counts a glyph drawn with at most ${WRITE_MAX_MISTAKES} wrong stroke, no hint and no reveal`, () => {
		expect(writeVerdict({ mistakes: 0, revealed: false }, 0)).toBe(true);
		expect(writeVerdict({ mistakes: WRITE_MAX_MISTAKES, revealed: false }, 0)).toBe(true);
		expect(writeVerdict({ mistakes: WRITE_MAX_MISTAKES + 1, revealed: false }, 0)).toBe(false);
	});
	it('does not count a hint or a reveal', () => {
		expect(writeVerdict({ mistakes: 0, revealed: false }, 1)).toBe(false);
		expect(writeVerdict({ mistakes: 0, revealed: true }, 0)).toBe(false);
	});
});
