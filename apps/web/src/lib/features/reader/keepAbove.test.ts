import { describe, expect, it } from 'vitest';
import { scrollDeltaAbove, WORD_MARGIN_PX } from './keepAbove';

const word = (top: number, height = 30) => ({ top, bottom: top + height });
const m = WORD_MARGIN_PX;

describe('scrollDeltaAbove', () => {
	it('a word already above the sheet does not move', () => {
		expect(scrollDeltaAbove(word(100), { top: 0, bottom: 400 })).toBe(0);
		expect(scrollDeltaAbove(word(400 - 30 - m), { top: 0, bottom: 400 })).toBe(0);
	});

	it('a word under the sheet scrolls up until it sits the margin above the sheet', () => {
		expect(scrollDeltaAbove(word(600), { top: 0, bottom: 400 })).toBe(600 + 30 + m - 400);
		// Just inside the margin counts as covered.
		expect(scrollDeltaAbove(word(400 - 30 - m + 1), { top: 0, bottom: 400 })).toBe(1);
	});

	it('never pushes the word past the top: on a tall sheet the word’s top stops the margin under it', () => {
		// Room above the sheet: 50 px; the word needs 30 + 2 margins.
		expect(scrollDeltaAbove(word(600), { top: 0, bottom: 50 })).toBe(600 - m);
		expect(scrollDeltaAbove(word(600), { top: 64, bottom: 50 })).toBe(600 - 64 - m);
	});

	it('a word above the visible top scrolls down to the margin under it', () => {
		expect(scrollDeltaAbove(word(-80), { top: 0, bottom: 400 })).toBe(-80 - m);
	});

	it('a word near the top under a tall sheet is not scrolled back above the top', () => {
		expect(scrollDeltaAbove(word(5), { top: 0, bottom: 20 })).toBe(0);
	});

	it('takes another margin', () => {
		expect(scrollDeltaAbove(word(600), { top: 0, bottom: 400 }, 0)).toBe(230);
	});
});
