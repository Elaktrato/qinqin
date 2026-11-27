import { describe, expect, it } from 'vitest';
import newOrderFixture from '../../../../../docs/contracts/frequency/new-order.json';
import deckcfgFixture from '../../../../../docs/contracts/frequency/deckcfg-new-order.json';
import { orderNew, parseNewOrder, randomKey, resolveSessionOrder, type NewOrder } from './newOrder';

describe('orderNew (frequency/new-order.json)', () => {
	it.each(newOrderFixture.cases)('$name', (c) => {
		const keys = c.keys as Record<string, number | null>;
		const got = orderNew(c.items, (item) => keys[String(item.entryId)] ?? null);
		expect(got.map((item) => item.id)).toEqual(c.expected);
	});

	it('does not mutate its input', () => {
		const items = [{ id: 'a' }, { id: 'b' }];
		orderNew(items, (item) => (item.id === 'a' ? 2 : 1));
		expect(items.map((item) => item.id)).toEqual(['a', 'b']);
	});
});

describe('parseNewOrder (frequency/deckcfg-new-order.json)', () => {
	it.each(deckcfgFixture.cases)('$name', (c) => {
		expect(parseNewOrder((c.row as Record<string, unknown>).newOrder)).toEqual(c.newOrder);
	});
});

describe('resolveSessionOrder', () => {
	const freq: NewOrder = { by: 'frequency' };
	const level: NewOrder = { by: 'level', packId: 'hsk-words' };
	it('an explicit order wins', () => {
		expect(resolveSessionOrder(level, [freq, freq])).toEqual({
			order: level,
			mixed: false
		});
	});
	it("'deck' with equal orders takes that order", () => {
		expect(resolveSessionOrder('deck', [freq, { by: 'frequency' }])).toEqual({
			order: freq,
			mixed: false
		});
		expect(resolveSessionOrder('deck', [level, { by: 'level', packId: 'hsk-words' }])).toEqual({
			order: level,
			mixed: false
		});
	});
	it("'deck' with differing orders is added and mixed", () => {
		expect(resolveSessionOrder('deck', [freq, level])).toEqual({
			order: { by: 'added' },
			mixed: true
		});
		expect(resolveSessionOrder('deck', [freq, null])).toEqual({
			order: { by: 'added' },
			mixed: true
		});
		expect(resolveSessionOrder('deck', [level, { by: 'level', packId: 'jlpt-kanji' }])).toEqual({
			order: { by: 'added' },
			mixed: true
		});
	});
	it('null counts as added', () => {
		expect(resolveSessionOrder('deck', [null, { by: 'added' }])).toEqual({
			order: { by: 'added' },
			mixed: false
		});
	});
	it('all null or no decks is added', () => {
		expect(resolveSessionOrder('deck', [null, null])).toEqual({
			order: { by: 'added' },
			mixed: false
		});
		expect(resolveSessionOrder('deck', [])).toEqual({
			order: { by: 'added' },
			mixed: false
		});
	});
});

describe('randomKey', () => {
	it('is a stable key in [0, 1) per seed and entry', () => {
		const a = randomKey(42);
		for (let id = 1; id < 200; id++) {
			const key = a(id) as number;
			expect(key).toBeGreaterThanOrEqual(0);
			expect(key).toBeLessThan(1);
			expect(randomKey(42)(id)).toBe(key);
		}
	});
	it('a different seed gives a different order, and it is not the id order', () => {
		const ids = Array.from({ length: 30 }, (_, i) => i + 1);
		const order = (seed: number) => orderNew(ids, randomKey(seed));
		expect(order(1)).not.toEqual(order(2));
		expect(order(1)).not.toEqual(ids);
		expect([...order(1)].sort((x, y) => x - y)).toEqual(ids);
	});
	it('an item keeps its relative place when others leave (stable within a session)', () => {
		const ids = Array.from({ length: 30 }, (_, i) => i + 1);
		const full = orderNew(ids, randomKey(7));
		const fewer = orderNew(ids.filter((id) => id % 3 !== 0), randomKey(7));
		expect(full.filter((id) => id % 3 !== 0)).toEqual(fewer);
	});
});

describe("resolveSessionOrder 'random'", () => {
	it('is random whatever the decks say', () => {
		expect(resolveSessionOrder('random', [{ by: 'frequency' }, null])).toEqual({
			order: { by: 'random' },
			mixed: false
		});
	});
});
