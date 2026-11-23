// The order of card types inside a session (#132): the plan (cardFlow.ts,
// levelQueue.ts) decides which items a session holds; this module only
// decides their order. Due reviews stay first; inside the due block and the
// new block the kinds are interleaved and two cards of one word are kept
// apart. Pure; the same seed and items give the same queue.
// Contract: docs/contracts/cards/README.md (Session mix), session-mix.json.

import type { FlowItem } from './cardFlow';
import { randomKey } from './newOrder';
import { isValidReview } from './scheduler';
import { CARD_KINDS, type ReviewEvent, type StudyCardKind } from './types';

/** How a session orders its card types: interleaved (the default) or one type after another. */
export type TypeOrder = 'mixed' | 'grouped';

/** The setup's choices, the default first. */
export const TYPE_ORDERS: readonly TypeOrder[] = ['mixed', 'grouped'];

/**
 * How far (in items) the jitter may move an item from its even-merge
 * place: enough to mix the kinds, small enough that the chosen order (due
 * order, the new order) still holds roughly.
 */
export const MIX_SPREAD = 8;

/** What the mix reads of a queue item. */
export interface MixItem {
	cardId: string;
	kind: StudyCardKind;
	entryId: number;
}

/**
 * fnv1a32 is the 32-bit FNV-1a hash of the UTF-8 bytes of `text`, as an
 * unsigned integer: a stable number per card id for mixKey.
 */
export function fnv1a32(text: string): number {
	let h = 0x811c9dc5;
	for (const byte of new TextEncoder().encode(text)) {
		h = Math.imul(h ^ byte, 0x01000193) >>> 0;
	}
	return h >>> 0;
}

/**
 * mixKey is a stable pseudo-random number in [0, 1) per card for one
 * session seed: randomKey (newOrder.ts) of the card id's hash.
 */
export function mixKey(seed: number, cardId: string): number {
	return randomKey(seed)(fnv1a32(cardId));
}

/**
 * typeGap is how many other cards should sit between two cards of one word
 * in a block of `n` items: fewer in short blocks, which cannot hold more.
 */
export function typeGap(n: number): number {
	if (n < 8) return 1;
	if (n < 16) return 2;
	return 3;
}

/** A binary min-heap of item indices. */
class MinHeap {
	private readonly data: number[] = [];

	size(): number {
		return this.data.length;
	}

	peek(): number {
		return this.data[0];
	}

	push(value: number): void {
		const data = this.data;
		data.push(value);
		let at = data.length - 1;
		while (at > 0) {
			const parent = (at - 1) >> 1;
			if (data[parent] <= value) break;
			data[at] = data[parent];
			at = parent;
		}
		data[at] = value;
	}

	pop(): number {
		const data = this.data;
		const top = data[0];
		const last = data.pop() as number;
		if (data.length > 0) {
			let at = 0;
			for (;;) {
				const left = 2 * at + 1;
				if (left >= data.length) break;
				const right = left + 1;
				const child = right < data.length && data[right] < data[left] ? right : left;
				if (data[child] >= last) break;
				data[at] = data[child];
				at = child;
			}
			data[at] = last;
		}
		return top;
	}
}

/**
 * How early (in items) spaceOut starts a word that needs the rest of the
 * block to keep the gap. 2 kept the full gap in every feasible simulated
 * deck session with the least change of order (spec, Ruling).
 */
export const PRESSURE_SLACK = 2;

/**
 * spaceOut places the items one by one so that two items of one word
 * (`entryId`) are at least `gap` other items apart where it can, keeping
 * the incoming order otherwise. Per step, with R items left:
 *
 * 1. an item whose word holds r of them with 2r - 1 >= R, and whose word
 *    was not placed last, goes now: later, that word could only end back
 *    to back;
 * 2. else (gap > 1), among the items whose word has r >= 2 left, was
 *    placed at least `gap` items ago and nearly needs every slot left to
 *    keep the gap, (r - 1) * (gap + 1) + 1 >= R - PRESSURE_SLACK, the first
 *    of the word with the most left goes now: later, the gap could no
 *    longer hold at the end of the block;
 * 3. else the first item whose word was placed at least `need` items ago,
 *    for need = gap down to 0 (0 always matches: the best effort when a
 *    block cannot hold the gap, e.g. one word's four types).
 *
 * With `leads`, a word's other items wait until none of its lead items
 * is left (only the items that may go take part in each step).
 *
 * `placed` lists the words of the items already placed before (an earlier
 * block), oldest first. The input is not changed. O(n log n): words are
 * bucketed by how many items they have left and their first items kept in
 * a heap, so a Study all session of thousands of cards spaces at once; the
 * output equals the plain step-by-step form (lib/testing/spaceOutReference.ts).
 */
export function spaceOut<T extends { entryId: number }>(
	items: readonly T[],
	gap: number,
	placed: readonly number[] = [],
	options: { leads?: (item: T) => boolean } = {}
): T[] {
	const total = items.length;
	const leads = options.leads;
	// Per word, how many of its lead items are left: its other items wait.
	const leadsLeft = new Map<number, number>();
	if (leads !== undefined) {
		for (const item of items) {
			if (leads(item)) leadsLeft.set(item.entryId, (leadsLeft.get(item.entryId) ?? 0) + 1);
		}
	}
	const out: T[] = [];
	const history = [...placed];
	const lastAt = new Map<number, number>();
	history.forEach((entryId, at) => lastAt.set(entryId, at));
	const sep = (entryId: number): number => {
		const at = lastAt.get(entryId);
		return at === undefined ? Infinity : history.length - at - 1;
	};

	// Per word: its items' indices in order, a cursor past the taken ones and
	// how many are left; words bucketed by that count, so the most-left count
	// is known without a scan.
	const indices = new Map<number, number[]>();
	items.forEach((item, at) => {
		const list = indices.get(item.entryId);
		if (list === undefined) indices.set(item.entryId, [at]);
		else list.push(at);
	});
	const cursor = new Map<number, number>();
	const left = new Map<number, number>();
	const buckets: Set<number>[] = [];
	for (const [entryId, list] of indices) {
		cursor.set(entryId, 0);
		left.set(entryId, list.length);
		(buckets[list.length] ??= new Set()).add(entryId);
	}
	// The non-empty counts as a linked list, highest first (`most`): a count
	// only ever drops by one, so a word moves to the neighbouring count.
	const lower: number[] = [];
	const higher: number[] = [];
	let most = 0;
	for (let r = 1; r < buckets.length; r += 1) {
		if ((buckets[r]?.size ?? 0) === 0) continue;
		lower[r] = most;
		higher[r] = 0;
		if (most > 0) higher[most] = r;
		most = r;
	}
	const decrement = (entryId: number, r: number): void => {
		if (r - 1 > 0 && (buckets[r - 1]?.size ?? 0) === 0) {
			lower[r - 1] = lower[r];
			higher[r - 1] = r;
			if (lower[r] > 0) higher[lower[r]] = r - 1;
			lower[r] = r - 1;
		}
		if (r - 1 > 0) (buckets[r - 1] ??= new Set()).add(entryId);
		buckets[r].delete(entryId);
		if (buckets[r].size === 0) {
			const up = higher[r];
			const down = lower[r];
			if (up > 0) lower[up] = down;
			else most = down;
			if (down > 0) higher[down] = up;
		}
	};
	const taken = new Uint8Array(total);
	let head = 0;
	// The first item left of every word, earliest first (an item taken is
	// skipped when it surfaces; the word's next item is pushed on taking).
	const firsts = new MinHeap();

	/** The word's first item that may go now: its first left, or its first lead left. */
	const firstOf = (entryId: number): number => {
		const list = indices.get(entryId) ?? [];
		let at = cursor.get(entryId) ?? 0;
		while (at < list.length && taken[list[at]] === 1) at += 1;
		cursor.set(entryId, at);
		if (leads === undefined || (leadsLeft.get(entryId) ?? 0) === 0) return at < list.length ? list[at] : -1;
		for (let next = at; next < list.length; next += 1) {
			if (taken[list[next]] === 0 && leads(items[list[next]])) return list[next];
		}
		return -1;
	};
	for (const entryId of indices.keys()) firsts.push(firstOf(entryId));
	const take = (at: number): void => {
		const item = items[at];
		taken[at] = 1;
		if (leads?.(item)) leadsLeft.set(item.entryId, (leadsLeft.get(item.entryId) ?? 1) - 1);
		out.push(item);
		lastAt.set(item.entryId, history.length);
		history.push(item.entryId);
		const r = left.get(item.entryId) ?? 1;
		left.set(item.entryId, r - 1);
		decrement(item.entryId, r);
		const next = firstOf(item.entryId);
		if (next >= 0) firsts.push(next);
		while (head < total && taken[head] === 1) head += 1;
	};
	/** Whether every item left belongs to a word placed fewer than `need` items ago. */
	const allRecent = (remaining: number, need: number): boolean => {
		if (need === 0) return false;
		const recent = new Set(history.slice(Math.max(0, history.length - need)));
		let count = 0;
		for (const entryId of recent) count += left.get(entryId) ?? 0;
		return count === remaining;
	};

	while (out.length < total) {
		const remaining = total - out.length;
		let pick = -1;
		// 1. A word with 2r - 1 >= R (at most one can have it) goes now.
		if (2 * most - 1 >= remaining) {
			for (const entryId of buckets[most] ?? []) {
				if (sep(entryId) >= 1) pick = firstOf(entryId);
			}
		}
		// 2. The word with the most left that nearly needs the rest of the block.
		if (pick < 0 && gap > 1) {
			for (let r = most; r >= 2 && (r - 1) * (gap + 1) + 1 >= remaining - PRESSURE_SLACK; r = lower[r]) {
				for (const entryId of buckets[r] ?? []) {
					if (sep(entryId) < gap) continue;
					const at = firstOf(entryId);
					if (at >= 0 && (pick < 0 || at < pick)) pick = at;
				}
				if (pick >= 0) break;
			}
		}
		// 3. The first item whose word was placed at least `need` items ago:
		// the earliest word head in the heap that is not too recent.
		for (let need = gap; pick < 0 && need >= 0; need -= 1) {
			if (allRecent(remaining, need)) continue;
			const aside: number[] = [];
			while (firsts.size() > 0) {
				const at = firsts.peek();
				// Stale: taken, or no longer its word's first item that may go.
				if (taken[at] === 1 || firstOf(items[at].entryId) !== at) {
					firsts.pop();
					continue;
				}
				if (sep(items[at].entryId) >= need) {
					pick = at;
					break;
				}
				aside.push(firsts.pop());
			}
			for (const at of aside) firsts.push(at);
		}
		take(pick < 0 ? head : pick);
	}
	return out;
}

function kindRank(kind: StudyCardKind): number {
	const at = CARD_KINDS.indexOf(kind);
	return at < 0 ? CARD_KINDS.length : at;
}

/** groupByKind sorts stably by kind order, keeping the incoming order inside a kind. */
function groupByKind<T extends MixItem>(block: readonly T[]): T[] {
	return block
		.map((item, index) => ({ item, index }))
		.sort((a, b) => kindRank(a.item.kind) - kindRank(b.item.kind) || a.index - b.index)
		.map(({ item }) => item);
}

/**
 * mixBlock interleaves the kinds of one block, then spaces it apart by word
 * (spaceOut). A new block places item j of a kind with n items evenly at
 * ((j + 0.5) / n) * N; a due block keeps each item at its due position i,
 * so the most overdue cards stay early whatever their kind. Either is moved
 * by up to MIX_SPREAD places by its mixKey when the block holds more than
 * one kind.
 */
function mixBlock<T extends MixItem>(
	block: readonly T[],
	seed: number,
	placed: readonly number[],
	options: { due: boolean; vocabFirst: boolean }
): T[] {
	const size = block.length;
	const perKind = new Map<StudyCardKind, number>();
	const ranked = block.map((item) => {
		const j = perKind.get(item.kind) ?? 0;
		perKind.set(item.kind, j + 1);
		return { item, j };
	});
	const keyed = ranked.map(({ item, j }, i) => {
		const n = perKind.get(item.kind) ?? 1;
		const position = options.due ? i : ((j + 0.5) / n) * size;
		// One kind has nothing to interleave: its order (due, level, frequency) stays.
		const jitter = perKind.size > 1 ? MIX_SPREAD * mixKey(seed, item.cardId) : 0;
		return { item, j, key: position + jitter };
	});
	keyed.sort((a, b) => a.key - b.key || kindRank(a.item.kind) - kindRank(b.item.kind) || a.j - b.j);
	return spaceOut(
		keyed.map(({ item }) => item),
		typeGap(size),
		placed,
		options.vocabFirst ? { leads: isVocab } : {}
	);
}

function isVocab(item: MixItem): boolean {
	return item.kind === 'vocab';
}

/** The options of mixSession. */
export interface MixOptions<T> {
	seed: number;
	order: TypeOrder;
	isReview: (item: T) => boolean;
	/**
	 * Deck sessions: in the new block a word's other types wait for its new
	 * vocab card (Recognise first). Level sessions leave it off: a character
	 * level gates writing by learner day itself.
	 */
	vocabFirst?: boolean;
}

/**
 * mixSession orders a planned session: the due block (isReview) first,
 * then the new block, each keeping its items. Mixed interleaves the kinds
 * and keeps two cards of one word apart; grouped puts one kind after
 * another in kind order, only keeping a word apart at a seam between two
 * groups (gap 1). The gap counts across the block boundary. The same seed
 * and items give the same queue. The input is not changed.
 */
export function mixSession<T extends MixItem>(items: readonly T[], options: MixOptions<T>): T[] {
	const due = items.filter((item) => options.isReview(item));
	const fresh = items.filter((item) => !options.isReview(item));
	const leads = options.vocabFirst === true ? { leads: isVocab } : {};
	if (options.order === 'grouped') {
		const dueGrouped = spaceOut(groupByKind(due), 1);
		const freshGrouped = spaceOut(
			groupByKind(fresh),
			1,
			dueGrouped.map((item) => item.entryId),
			leads
		);
		return [...dueGrouped, ...freshGrouped];
	}
	const dueMixed = mixBlock(due, options.seed, [], { due: true, vocabFirst: false });
	const freshMixed = mixBlock(
		fresh,
		options.seed,
		dueMixed.map((item) => item.entryId),
		{ due: false, vocabFirst: options.vocabFirst === true }
	);
	return [...dueMixed, ...freshMixed];
}

/**
 * mixFlowQueue is mixSession for a session's flow items: a real card with
 * a valid review is due (the same bucket buildQueue uses), everything else
 * (never reviewed, virtual) is new.
 */
export function mixFlowQueue(
	queue: readonly FlowItem[],
	reviews: readonly ReviewEvent[],
	options: { seed: number; order: TypeOrder; vocabFirst?: boolean }
): FlowItem[] {
	const reviewed = new Set<string>();
	for (const review of reviews) if (isValidReview(review)) reviewed.add(review.payload.cardId);
	return mixSession(queue, {
		...options,
		isReview: (item) => !item.virtual && reviewed.has(item.cardId)
	});
}
