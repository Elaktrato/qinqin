import { describe, expect, it } from 'vitest';

import {
	LEVEL_CHECK_MIN_CARDS,
	isLevelCheckDismissed,
	levelCheckDismissKey,
	setLevelCheckDismissed,
	shouldOfferLevelCheck
} from './levelCheckOffer';

const ready = { cards: LEVEL_CHECK_MIN_CARDS, marks: 0, schemes: 1, dismissed: false };

describe('shouldOfferLevelCheck (#82, owner ruling 2026-11-26: also on Home)', () => {
	it('is offered to a learner who has started and whose language has a level list', () => {
		expect(shouldOfferLevelCheck(ready)).toBe(true);
		expect(shouldOfferLevelCheck({ ...ready, cards: 0, marks: 1 })).toBe(true);
	});

	it('is quiet for a brand-new workspace (that is the placement and Starter offers)', () => {
		expect(shouldOfferLevelCheck({ ...ready, cards: 0, marks: 0 })).toBe(false);
		expect(shouldOfferLevelCheck({ ...ready, cards: LEVEL_CHECK_MIN_CARDS - 1 })).toBe(false);
	});

	it('is quiet without a level list or when dismissed', () => {
		expect(shouldOfferLevelCheck({ ...ready, schemes: 0 })).toBe(false);
		expect(shouldOfferLevelCheck({ ...ready, dismissed: true })).toBe(false);
	});
});

describe('dismissal', () => {
	it('is per workspace, remembered on this device, and has its own key', () => {
		localStorage.clear();
		expect(isLevelCheckDismissed(localStorage, 4)).toBe(false);
		setLevelCheckDismissed(localStorage, 4);
		expect(isLevelCheckDismissed(localStorage, 4)).toBe(true);
		expect(isLevelCheckDismissed(localStorage, 5)).toBe(false);
		expect(levelCheckDismissKey(4)).not.toBe('qinqin.placement.dismissed.4');
		expect(levelCheckDismissKey(4)).not.toBe('qinqin.starter.dismissed.4');
	});

	it('survives missing storage', () => {
		expect(isLevelCheckDismissed(null, 1)).toBe(false);
		expect(() => setLevelCheckDismissed(null, 1)).not.toThrow();
	});
});
