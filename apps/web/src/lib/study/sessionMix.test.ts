import { describe, expect, it } from 'vitest';
import fixture from '../../../../../docs/contracts/cards/session-mix.json';
import { fnv1a32, mixKey, typeGap } from './sessionMix';

describe('docs/contracts/cards/session-mix.json keys', () => {
	it('pins the rule name', () => {
		expect(fixture.version).toBe(1);
		expect(fixture.rule).toBe('cards/session-mix');
		expect(fixture.keys.length).toBeGreaterThan(5);
	});

	for (const c of fixture.keys) {
		it(`fnv1a32 and mixKey of ${JSON.stringify(c.cardId)} with seed ${c.seed}`, () => {
			expect(fnv1a32(c.cardId)).toBe(c.fnv);
			expect(mixKey(c.seed, c.cardId)).toBe(c.key);
		});
	}

	it('mixKey is in [0, 1) and differs per seed', () => {
		const a = mixKey(1, 'c-vocab-1');
		const b = mixKey(2, 'c-vocab-1');
		expect(a).toBeGreaterThanOrEqual(0);
		expect(a).toBeLessThan(1);
		expect(a).not.toBe(b);
	});
});

describe('docs/contracts/cards/session-mix.json gaps', () => {
	for (const c of fixture.gaps) {
		it(`typeGap(${c.n}) = ${c.gap}`, () => {
			expect(typeGap(c.n)).toBe(c.gap);
		});
	}
});
