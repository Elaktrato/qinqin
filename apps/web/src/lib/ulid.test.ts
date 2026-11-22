import { describe, expect, it } from 'vitest';
import { newUlid, ulidTime } from './ulid';

// Crockford base32: the ULID alphabet, without the ambiguous I, L, O, U.
const ULID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/;

describe('newUlid', () => {
	it('is 26 Crockford base32 characters', () => {
		for (let i = 0; i < 200; i++) {
			expect(newUlid()).toMatch(ULID_PATTERN);
		}
	});

	it('never contains the ambiguous letters I, L, O or U', () => {
		for (let i = 0; i < 200; i++) {
			expect(newUlid()).not.toMatch(/[ILOU]/);
		}
	});

	it('orders lexicographically by timestamp', () => {
		const stamps = [0, 1, 999, 2 ** 40, 1_700_000_000_000];
		const ids = stamps.map((stamp) => newUlid(stamp));

		expect([...ids].sort()).toEqual(ids);
		// Equal timestamps still compare by their random suffix alone,
		// so two ids generated from one stamp must both be valid.
		for (const id of ids) expect(id).toMatch(ULID_PATTERN);
	});

	it('encodes the timestamp in the first 10 characters', () => {
		const early = newUlid(0);
		const late = newUlid(1_700_000_000_000);

		expect(early.slice(0, 10) < late.slice(0, 10)).toBe(true);
		expect(early.slice(0, 10)).toMatch(/^[0-9A-HJKMNP-TV-Z]{10}$/);
	});

	it('varies the random suffix', () => {
		const ids = new Set(Array.from({ length: 100 }, () => newUlid(1_700_000_000_000)));
		expect(ids.size).toBeGreaterThan(95);
	});
});

describe('ulidTime (#131)', () => {
	it('reads back the millisecond time of an id', () => {
		for (const ms of [0, 1, 1_763_800_000_123, 2 ** 48 - 1]) {
			expect(ulidTime(newUlid(ms))).toBe(ms);
		}
	});
	it('is case-insensitive and null for what is not a ULID time', () => {
		expect(ulidTime(newUlid(42).toLowerCase())).toBe(42);
		expect(ulidTime('not-a-ulid')).toBeNull();
		expect(ulidTime('')).toBeNull();
		expect(ulidTime('8ZZZZZZZZZ0000000000000000')).toBeNull();
	});
});
