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

/**
 * spaceOut places the items one by one so that two items of one word
 * (`entryId`) are at least `gap` other items apart where it can, keeping
 * the incoming order otherwise. Per step, with R items left:
 *
 * 1. an item whose word holds r of them with 2r - 1 >= R, and whose word
 *    was not placed last, goes now: later, that word could only end back
 *    to back;
 * 2. else the first item whose word was placed at least `need` items ago,
 *    for need = gap down to 0 (0 always matches: the best effort when a
 *    block cannot hold the gap, e.g. one word's four types).
 *
 * `placed` lists the words of the items already placed before (an earlier
 * block), oldest first. The input is not changed.
 */
export function spaceOut<T extends { entryId: number }>(
	items: readonly T[],
	gap: number,
	placed: readonly number[] = []
): T[] {
	const lastAt = new Map<number, number>();
	placed.forEach((entryId, at) => lastAt.set(entryId, at));
	const left = new Map<number, number>();
	for (const item of items) left.set(item.entryId, (left.get(item.entryId) ?? 0) + 1);
	const rest = [...items];
	const out: T[] = [];
	let position = placed.length;
	const sep = (entryId: number): number => {
		const at = lastAt.get(entryId);
		return at === undefined ? Infinity : position - at - 1;
	};
	while (rest.length > 0) {
		const remaining = rest.length;
		let pick = rest.findIndex(
			(item) => 2 * (left.get(item.entryId) ?? 0) - 1 >= remaining && sep(item.entryId) >= 1
		);
		for (let need = gap; pick < 0 && need >= 0; need -= 1) {
			pick = rest.findIndex((item) => sep(item.entryId) >= need);
		}
		if (pick < 0) pick = 0;
		const [item] = rest.splice(pick, 1);
		out.push(item);
		lastAt.set(item.entryId, position);
		left.set(item.entryId, (left.get(item.entryId) ?? 1) - 1);
		position += 1;
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
 * mixBlock interleaves the kinds of one block: item j of a kind with n
 * items is placed evenly at ((j + 0.5) / n) * N, moved by up to
 * MIX_SPREAD places by its mixKey, then spaced apart by word (spaceOut).
 */
function mixBlock<T extends MixItem>(block: readonly T[], seed: number, placed: readonly number[]): T[] {
	const size = block.length;
	const perKind = new Map<StudyCardKind, number>();
	const ranked = block.map((item) => {
		const j = perKind.get(item.kind) ?? 0;
		perKind.set(item.kind, j + 1);
		return { item, j };
	});
	const keyed = ranked.map(({ item, j }) => {
		const n = perKind.get(item.kind) ?? 1;
		const position = ((j + 0.5) / n) * size;
		return { item, j, key: position + MIX_SPREAD * mixKey(seed, item.cardId) };
	});
	keyed.sort(
		(a, b) => a.key - b.key || kindRank(a.item.kind) - kindRank(b.item.kind) || a.j - b.j
	);
	return spaceOut(
		keyed.map(({ item }) => item),
		typeGap(size),
		placed
	);
}

/**
 * mixSession orders a planned session: the due block (isReview) first,
 * then the new block, each keeping its items. Mixed interleaves the kinds
 * and keeps two cards of one word apart (the gap counts across the block
 * boundary); grouped puts one kind after another in kind order. The same
 * seed and items give the same queue. The input is not changed.
 */
export function mixSession<T extends MixItem>(
	items: readonly T[],
	options: { seed: number; order: TypeOrder; isReview: (item: T) => boolean }
): T[] {
	const due = items.filter((item) => options.isReview(item));
	const fresh = items.filter((item) => !options.isReview(item));
	if (options.order === 'grouped') return [...groupByKind(due), ...groupByKind(fresh)];
	const dueMixed = mixBlock(due, options.seed, []);
	const freshMixed = mixBlock(
		fresh,
		options.seed,
		dueMixed.map((item) => item.entryId)
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
	options: { seed: number; order: TypeOrder }
): FlowItem[] {
	const reviewed = new Set<string>();
	for (const review of reviews) if (isValidReview(review)) reviewed.add(review.payload.cardId);
	return mixSession(queue, {
		...options,
		isReview: (item) => !item.virtual && reviewed.has(item.cardId)
	});
}
