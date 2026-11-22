import { describe, expect, it } from 'vitest';
import fixture from '../../../../../docs/contracts/cards/session-mix.json';
import { fnv1a32, mixKey, spaceOut, typeGap } from './sessionMix';

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

type Item = { id: string; entryId: number };
const it_ = (id: string): Item => ({ id, entryId: id.charCodeAt(0) });
const ids = (items: readonly Item[]) => items.map((item) => item.id);

describe('spaceOut', () => {
	it('alternates two words', () => {
		expect(ids(spaceOut(['a1', 'a2', 'b1', 'b2'].map(it_), 1))).toEqual(['a1', 'b1', 'a2', 'b2']);
	});

	it('starts a word that would otherwise end back to back (2r - 1 >= R)', () => {
		expect(ids(spaceOut(['b1', 'b2', 'a1', 'a2', 'a3'].map(it_), 1))).toEqual(['a1', 'b1', 'a2', 'b2', 'a3']);
	});

	it('keeps the incoming order when every item is of one word (best effort)', () => {
		expect(ids(spaceOut(['a1', 'a2', 'a3', 'a4'].map(it_), 1))).toEqual(['a1', 'a2', 'a3', 'a4']);
	});

	it('takes the first item that keeps the full gap', () => {
		expect(ids(spaceOut(['a1', 'a2', 'b1', 'c1'].map(it_), 2))).toEqual(['a1', 'b1', 'c1', 'a2']);
	});

	it('falls back to a smaller gap before putting a word back to back', () => {
		// gap 3 cannot hold: a2 needs three others but only b1 and c1 exist.
		expect(ids(spaceOut(['a1', 'a2', 'b1', 'c1'].map(it_), 3))).toEqual(['a1', 'b1', 'c1', 'a2']);
	});

	it('counts the cards placed before (an earlier block)', () => {
		const a = 'a'.charCodeAt(0);
		expect(ids(spaceOut(['a1', 'b1'].map(it_), 1, [a]))).toEqual(['b1', 'a1']);
	});

	it('does not change its input', () => {
		const input = ['a1', 'a2', 'b1'].map(it_);
		const copy = input.map((item) => ({ ...item }));
		spaceOut(input, 1);
		expect(input).toEqual(copy);
	});

	it('never puts a word back to back when the block allows it (property)', () => {
		let state = 12345;
		const next = (n: number) => {
			state = (Math.imul(state, 1103515245) + 12345) >>> 0;
			return state % n;
		};
		for (let round = 0; round < 3000; round += 1) {
			const size = 1 + next(30);
			const words = 1 + next(8);
			const items = Array.from({ length: size }, (_, i) => ({ id: String(i), entryId: next(words) }));
			const gap = 1 + next(3);
			const out = spaceOut(items, gap);
			expect([...out].sort((x, y) => Number(x.id) - Number(y.id))).toEqual(items);
			const counts = new Map<number, number>();
			for (const item of items) counts.set(item.entryId, (counts.get(item.entryId) ?? 0) + 1);
			const feasible = Math.max(...counts.values()) <= Math.ceil(size / 2);
			if (!feasible) continue;
			for (let i = 1; i < out.length; i += 1) {
				expect(out[i].entryId, `round ${round} at ${i}: ${JSON.stringify(ids(out))}`).not.toBe(out[i - 1].entryId);
			}
		}
	});
});
