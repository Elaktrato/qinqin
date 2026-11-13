import { describe, expect, it } from 'vitest';
import { jumpPlan, restoreDecision, restorePlan } from './restore';

describe('restorePlan', () => {
	it('scrolls within the URL chapter when it is the saved one', () => {
		expect(restorePlan('2:9', 5, 2)).toEqual({ kind: 'scroll', target: { chapter: 2, paragraph: 9 } });
	});

	it('jumps to the saved chapter only from the default chapter 0', () => {
		expect(restorePlan('3:4', 5, 0)).toEqual({ kind: 'navigate', target: { chapter: 3, paragraph: 4 } });
		expect(restorePlan('3:4', 5, 1)).toEqual({ kind: 'none' });
	});

	it('ignores missing, malformed or out-of-range positions', () => {
		expect(restorePlan('', 5, 0)).toEqual({ kind: 'none' });
		expect(restorePlan('x', 5, 0)).toEqual({ kind: 'none' });
		expect(restorePlan('5:0', 5, 0)).toEqual({ kind: 'none' });
	});
});

describe('restoreDecision', () => {
	const target = { chapter: 2, paragraph: 7 };

	it('waits while the target chapter is loading', () => {
		expect(restoreDecision({ target, urlChapter: 2, loadedChapter: null, loadFailed: false })).toBe('wait');
		// A previous chapter's content is still shown.
		expect(restoreDecision({ target, urlChapter: 2, loadedChapter: 0, loadFailed: false })).toBe('wait');
	});

	it('restores once the target chapter is loaded', () => {
		expect(restoreDecision({ target, urlChapter: 2, loadedChapter: 2, loadFailed: false })).toBe(
			'restore'
		);
	});

	it('skips when the reader navigated away before it loaded', () => {
		expect(restoreDecision({ target, urlChapter: 3, loadedChapter: null, loadFailed: false })).toBe('skip');
		expect(restoreDecision({ target, urlChapter: 0, loadedChapter: 2, loadFailed: false })).toBe('skip');
	});

	it('skips when the chapter failed to load', () => {
		expect(restoreDecision({ target, urlChapter: 2, loadedChapter: null, loadFailed: true })).toBe('skip');
	});
});

describe('jumpPlan', () => {
	it('scrolls within the chapter on screen', () => {
		expect(jumpPlan('3:7', 10, 3)).toEqual({ kind: 'scroll', target: { chapter: 3, paragraph: 7 } });
	});

	it('navigates to any other chapter, not only from chapter 0', () => {
		expect(jumpPlan('1:2', 10, 5)).toEqual({ kind: 'navigate', target: { chapter: 1, paragraph: 2 } });
		expect(jumpPlan('6:0', 10, 0)).toEqual({ kind: 'navigate', target: { chapter: 6, paragraph: 0 } });
	});

	it('does nothing for a malformed position or a chapter the book no longer has', () => {
		expect(jumpPlan('x', 10, 0)).toEqual({ kind: 'none' });
		expect(jumpPlan('10:0', 10, 0)).toEqual({ kind: 'none' });
	});
});
