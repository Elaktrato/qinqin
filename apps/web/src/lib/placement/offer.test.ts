import { describe, expect, it } from 'vitest';
import { dismissKey, isDismissed, setDismissed, shouldOffer } from './offer';

const base = { cards: 0, marks: 0, schemes: 1, dismissed: false };

describe('shouldOffer', () => {
	it('offers on a fresh workspace with a level list', () => {
		expect(shouldOffer(base)).toBe(true);
	});
	it('does not once there is a card, a mark or a declaration', () => {
		expect(shouldOffer({ ...base, cards: 1 })).toBe(false);
		expect(shouldOffer({ ...base, marks: 1 })).toBe(false);
	});
	it('does not without a level list or after Not now', () => {
		expect(shouldOffer({ ...base, schemes: 0 })).toBe(false);
		expect(shouldOffer({ ...base, dismissed: true })).toBe(false);
	});
});

function fakeStorage(): Storage {
	const map = new Map<string, string>();
	return {
		getItem: (k) => map.get(k) ?? null,
		setItem: (k, v) => void map.set(k, v),
		removeItem: (k) => void map.delete(k),
		clear: () => map.clear(),
		key: () => null,
		length: 0
	} as Storage;
}

describe('dismissal', () => {
	it('is remembered per workspace', () => {
		const s = fakeStorage();
		expect(isDismissed(s, 1)).toBe(false);
		setDismissed(s, 1);
		expect(isDismissed(s, 1)).toBe(true);
		expect(isDismissed(s, 2)).toBe(false);
		expect(dismissKey(1)).toBe('qinqin.placement.dismissed.1');
	});
	it('survives missing or throwing storage', () => {
		expect(isDismissed(null, 1)).toBe(false);
		const broken = {
			getItem: () => {
				throw new Error('denied');
			},
			setItem: () => {
				throw new Error('denied');
			}
		} as unknown as Storage;
		expect(isDismissed(broken, 1)).toBe(false);
		expect(() => setDismissed(broken, 1)).not.toThrow();
		expect(() => setDismissed(null, 1)).not.toThrow();
	});
});
