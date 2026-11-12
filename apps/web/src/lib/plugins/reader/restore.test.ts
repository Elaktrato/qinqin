import { describe, expect, it } from 'vitest';
import { restoreDecision, restorePlan } from './restore';

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
