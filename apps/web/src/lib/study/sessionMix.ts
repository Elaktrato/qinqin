// The order of card types inside a session (#132): the plan (cardFlow.ts,
// levelQueue.ts) decides which items a session holds; this module only
// decides their order. Due reviews stay first; inside the due block and the
// new block the kinds are interleaved and two cards of one word are kept
// apart. Pure; the same seed and items give the same queue.
// Contract: docs/contracts/cards/README.md (Session mix), session-mix.json.

import { randomKey } from './newOrder';

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
