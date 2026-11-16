import { describe, expect, it } from 'vitest';
import { deckLeftText, leftTodayText, startTodayText } from './limitsText';

const left = (reviews: number, n: number, over: Partial<{ unlimited: boolean; limitedOut: number }> = {}) => ({
	reviews,
	new: n,
	unlimited: false,
	limitedOut: 0,
	...over
});

describe('leftTodayText (home widget)', () => {
	it('words reviews and new left today', () => {
		expect(leftTodayText(left(18, 5))).toBe('18 reviews · 5 new left today');
	});
	it('uses singular forms', () => {
		expect(leftTodayText(left(1, 1))).toBe('1 review · 1 new left today');
	});
	it('says the limit is reached when everything left is held back', () => {
		expect(leftTodayText(left(0, 0, { limitedOut: 4 }))).toBe('Done for today — daily limit reached');
	});
	it('says nothing is due when nothing is held back', () => {
		expect(leftTodayText(left(0, 0))).toBe('Nothing due today');
	});
	it('has no "left" wording without a limit', () => {
		expect(leftTodayText(left(18, 5, { unlimited: true }))).toBe('18 reviews · 5 new (no daily limit)');
	});
});

describe('startTodayText (study start)', () => {
	it('words the day with the limits applied', () => {
		expect(startTodayText(18, 5, false)).toBe('Today: 18 reviews and 5 new (daily limits applied)');
		expect(startTodayText(1, 1, false)).toBe('Today: 1 review and 1 new (daily limits applied)');
	});
	it('drops the note when there is no limit', () => {
		expect(startTodayText(3, 0, true)).toBe('Today: 3 reviews and 0 new');
	});
});

describe('deckLeftText', () => {
	it('shows the limited fields only', () => {
		expect(deckLeftText({ new: 5, reviews: 12 })).toBe('5 new · 12 reviews left today');
		expect(deckLeftText({ new: 1, reviews: 1 })).toBe('1 new · 1 review left today');
		expect(deckLeftText({ new: 5, reviews: null })).toBe('5 new left today');
		expect(deckLeftText({ new: null, reviews: 0 })).toBe('0 reviews left today');
	});
	it('shows nothing when both are unlimited', () => {
		expect(deckLeftText({ new: null, reviews: null })).toBeNull();
	});
});
