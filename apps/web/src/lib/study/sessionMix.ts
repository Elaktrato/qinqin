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
