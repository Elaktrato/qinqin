import { describe, expect, it } from 'vitest';

import { isStarterDismissed, setStarterDismissed, shouldOfferStarter, starterDismissKey } from './offer';

const fresh = { language: 'ja', cards: 0, marks: 0, setAvailable: true, enabled: false, dismissed: false };

describe('shouldOfferStarter', () => {
	it('offers it to a brand-new learner of a language with stages and a set', () => {
		expect(shouldOfferStarter(fresh)).toBe(true);
		expect(shouldOfferStarter({ ...fresh, language: 'zh' })).toBe(true);
	});

	it('is quiet once anything exists, like the placement offer', () => {
		expect(shouldOfferStarter({ ...fresh, cards: 1 })).toBe(false);
		expect(shouldOfferStarter({ ...fresh, marks: 3 })).toBe(false);
	});

	it('is quiet without a set, for another language, when on, or dismissed', () => {
		expect(shouldOfferStarter({ ...fresh, setAvailable: false })).toBe(false);
		expect(shouldOfferStarter({ ...fresh, language: 'es' })).toBe(false);
		expect(shouldOfferStarter({ ...fresh, enabled: true })).toBe(false);
		expect(shouldOfferStarter({ ...fresh, dismissed: true })).toBe(false);
	});
});

describe('dismissal', () => {
	it('is per workspace and remembered in storage', () => {
		localStorage.clear();
		expect(isStarterDismissed(localStorage, 4)).toBe(false);
		setStarterDismissed(localStorage, 4);
		expect(isStarterDismissed(localStorage, 4)).toBe(true);
		expect(isStarterDismissed(localStorage, 5)).toBe(false);
		expect(starterDismissKey(4)).not.toBe('qinqin.placement.dismissed.4');
	});

	it('survives missing storage', () => {
		expect(isStarterDismissed(null, 1)).toBe(false);
		expect(() => setStarterDismissed(null, 1)).not.toThrow();
	});
});
