import { describe, expect, it } from 'vitest';
import { studyDay } from '../../time/studyDay';
import popupFixture from '../../../../../../docs/contracts/reader/popup-written.json';
import { browseSeed, popupWritten, shuffleSeed } from './browse';

describe('browseSeed', () => {
	const UTC = studyDay([]);
	const TOKYO = studyDay([{ zone: 'Asia/Tokyo', from: null }]);

	it('is the learner date', () => {
		expect(browseSeed(new Date('2026-11-13T08:00:00Z'), UTC)).toBe('2026-11-13');
		expect(browseSeed(new Date('2026-11-13T08:00:00Z'), TOKYO)).toBe('2026-11-13');
	});

	it('follows the learner zone, not the device clock zone', () => {
		expect(browseSeed(new Date('2026-11-13T15:30:00Z'), TOKYO)).toBe('2026-11-14');
		expect(browseSeed(new Date('2026-11-13T15:30:00Z'), UTC)).toBe('2026-11-13');
		// 23:30 in UTC-5 is already the next day in UTC.
		expect(browseSeed(new Date('2026-11-13T23:30:00-05:00'), UTC)).toBe('2026-11-14');
	});
});

describe('shuffleSeed', () => {
	it('differs from the daily seed and fits the server limit', () => {
		const seed = shuffleSeed(() => 0.5);
		expect(seed).not.toMatch(/^\d{4}-\d{2}-\d{2}$/);
		expect(seed.length).toBeGreaterThan(0);
		expect(seed.length).toBeLessThanOrEqual(64);
	});

	it('changes with the random source', () => {
		expect(shuffleSeed(() => 0.1)).not.toBe(shuffleSeed(() => 0.9));
	});
});

describe('popupWritten (reader/popup-written.json)', () => {
	it.each(popupFixture.cases)('$name', (c) => {
		expect(popupWritten(c)).toBe(c.expected);
	});
});
