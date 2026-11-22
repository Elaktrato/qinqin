import { describe, expect, it } from 'vitest';
import fixture from '../../../../../docs/contracts/cards/session-mix.json';
import type { FlowItem } from './cardFlow';
import type { ReviewEvent, StudyCardKind } from './types';
import { spaceOutReference } from './testing/spaceOutReference';
import { fnv1a32, mixFlowQueue, mixKey, mixSession, spaceOut, typeGap, type TypeOrder } from './sessionMix';

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

	it('starts a word early enough to keep the full gap at the end of a block', () => {
		// Without it: b1 c1 a1 d1 a2 (one card between a1 and a2).
		expect(ids(spaceOut(['b1', 'c1', 'd1', 'a1', 'a2'].map(it_), 2))).toEqual(['a1', 'b1', 'c1', 'd1', 'a2']);
	});

	it('keeps the full gap in a long block whenever it fits (property)', () => {
		let state = 777;
		const next = (n: number) => {
			state = (Math.imul(state, 1103515245) + 12345) >>> 0;
			return state % n;
		};
		let misses = 0;
		for (let round = 0; round < 500; round += 1) {
			// Sessions like a deck session: many words with one to three cards each.
			const words = 8 + next(10);
			const items: Item[] = [];
			for (let w = 0; w < words; w += 1) {
				const count = 1 + next(3);
				for (let k = 0; k < count; k += 1) items.push({ id: `${w}-${k}`, entryId: w });
			}
			for (let i = items.length - 1; i > 0; i -= 1) {
				const j = next(i + 1);
				[items[i], items[j]] = [items[j], items[i]];
			}
			const out = spaceOut(items, 3);
			const last = new Map<number, number>();
			out.forEach((item, at) => {
				const before = last.get(item.entryId);
				if (before !== undefined && at - before - 1 < 3) misses += 1;
				last.set(item.entryId, at);
			});
		}
		expect(misses).toBe(0);
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
				expect(out[i].entryId, `round ${round} at ${i}: ${JSON.stringify(ids(out))}`).not.toBe(
					out[i - 1].entryId
				);
			}
		}
	});
});

type FixtureItem = { cardId: string; kind: string; entryId: number; review: boolean };
const asItems = (items: readonly FixtureItem[]) =>
	items.map((item) => ({ ...item, kind: item.kind as StudyCardKind }));

describe('docs/contracts/cards/session-mix.json queues', () => {
	it('has cases', () => {
		expect(fixture.queues.length).toBeGreaterThan(5);
	});

	for (const c of fixture.queues) {
		it(c.name, () => {
			const items = asItems(c.items);
			const out = mixSession(items, {
				seed: c.seed,
				order: c.order as TypeOrder,
				isReview: (item) => item.review
			});
			expect(out.map((item) => item.cardId)).toEqual(c.expect);
			// Same set, due block first.
			expect([...out].map((item) => item.cardId).sort()).toEqual(items.map((item) => item.cardId).sort());
			const dueCount = items.filter((item) => item.review).length;
			expect(out.slice(0, dueCount).every((item) => item.review)).toBe(true);
		});
	}
});

describe('mixSession', () => {
	const items = asItems([
		{ cardId: 'c-vocab-1', kind: 'vocab', entryId: 1, review: false },
		{ cardId: 'c-vocab-2', kind: 'vocab', entryId: 2, review: false },
		{ cardId: 'c-vocab-3', kind: 'vocab', entryId: 3, review: false },
		{ cardId: 'companion:writing:1', kind: 'writing', entryId: 1, review: false },
		{ cardId: 'companion:writing:2', kind: 'writing', entryId: 2, review: false },
		{ cardId: 'companion:tone:3', kind: 'tone', entryId: 3, review: false }
	]);
	const mixed = (seed: number) =>
		mixSession(items, { seed, order: 'mixed', isReview: () => false }).map((item) => item.cardId);

	it('gives the same queue for the same seed (a reload)', () => {
		expect(mixed(11)).toEqual(mixed(11));
	});

	it('differs between sessions (seeds)', () => {
		const orders = new Set([1, 2, 3, 4, 5, 6, 7, 8].map((seed) => mixed(seed).join(' ')));
		expect(orders.size).toBeGreaterThan(1);
	});

	it('no longer puts every companion after the word cards', () => {
		for (const seed of [1, 2, 3, 4, 5]) {
			const out = mixed(seed);
			expect(
				out.slice(0, 3).some((id) => id.startsWith('companion:')),
				`seed ${seed}: ${out.join(' ')}`
			).toBe(true);
		}
	});

	it('grouped ignores the seed', () => {
		const grouped = (seed: number) =>
			mixSession(items, { seed, order: 'grouped', isReview: () => false }).map((item) => item.cardId);
		expect(grouped(1)).toEqual(grouped(2));
		expect(grouped(1)).toEqual(items.map((item) => item.cardId));
	});

	it('does not change its input and handles an empty queue', () => {
		const copy = items.map((item) => ({ ...item }));
		mixSession(items, { seed: 1, order: 'mixed', isReview: () => false });
		expect(items).toEqual(copy);
		expect(mixSession([], { seed: 1, order: 'mixed', isReview: () => false })).toEqual([]);
	});
});

describe('mixFlowQueue', () => {
	const flow = (cardId: string, kind: StudyCardKind, entryId: number, virtual = false): FlowItem => ({
		cardId,
		kind,
		entryId,
		virtual,
		card: null
	});
	const review = (cardId: string): ReviewEvent =>
		({
			id: `r-${cardId}`,
			type: 'review',
			ts: '2026-11-01T09:00:00Z',
			payload: { cardId, grade: 3, mode: 'vocab' }
		}) as unknown as ReviewEvent;

	it('puts the real cards with a valid review first (the due block)', () => {
		const queue = [
			flow('c-vocab-1', 'vocab', 1),
			flow('c-vocab-2', 'vocab', 2),
			flow('companion:writing:3', 'writing', 3, true)
		];
		const out = mixFlowQueue(queue, [review('c-vocab-2')], { seed: 4, order: 'grouped' });
		expect(out.map((item) => item.cardId)).toEqual(['c-vocab-2', 'c-vocab-1', 'companion:writing:3']);
	});
});

describe('spaceOut performance (#132 review)', () => {
	function lcg(seed: number) {
		let state = seed;
		return (n: number) => {
			state = (Math.imul(state, 1103515245) + 12345) >>> 0;
			return state % n;
		};
	}

	it('gives exactly the reference output on random blocks', () => {
		const next = lcg(4242);
		for (let round = 0; round < 1500; round += 1) {
			const size = 1 + next(60);
			const words = 1 + next(20);
			const items = Array.from({ length: size }, (_, i) => ({ id: String(i), entryId: next(words) }));
			const gap = 1 + next(3);
			const placed = Array.from({ length: next(4) }, () => next(words));
			expect(ids(spaceOut(items, gap, placed)), `round ${round}`).toEqual(
				ids(spaceOutReference(items, gap, placed))
			);
		}
	});

	const timed = (items: Item[]) => {
		const started = performance.now();
		const out = spaceOut(items, 3);
		const ms = performance.now() - started;
		expect(out).toHaveLength(items.length);
		return ms;
	};

	it('spaces 20,000 items of a Study all session quickly', () => {
		const next = lcg(9);
		const items: Item[] = [];
		for (let w = 0; items.length < 20_000; w += 1) {
			const count = 1 + next(4);
			for (let k = 0; k < count && items.length < 20_000; k += 1) items.push({ id: `${w}-${k}`, entryId: w });
		}
		for (let i = items.length - 1; i > 0; i -= 1) {
			const j = next(i + 1);
			[items[i], items[j]] = [items[j], items[i]];
		}
		expect(timed(items)).toBeLessThan(1500);
	});

	it('stays quick when one or two words hold the block', () => {
		const one = Array.from({ length: 20_000 }, (_, i) => ({ id: String(i), entryId: 1 }));
		const two = Array.from({ length: 20_000 }, (_, i) => ({ id: String(i), entryId: i < 10_000 ? 1 : 2 }));
		expect(timed(one)).toBeLessThan(1500);
		expect(timed(two)).toBeLessThan(1500);
	});
});
