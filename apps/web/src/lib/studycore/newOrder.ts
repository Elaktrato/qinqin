// The order of new cards (#75): in the order added (a deck's default), most
// frequent first, or by level. A deck carries one in its `deckcfg:` row,
// a session setup may override it. Only new items are reordered; reviews,
// due order and the daily admission stay as they are.
// Contract: docs/contracts/frequency/README.md.

export type NewOrder = { by: 'added' } | { by: 'frequency' } | { by: 'level'; packId: string };
/**
 * A session setup may also ask for 'random' (the default, #seeded shuffle).
 * Random is never stored in a deck's settings: only a session chooses it,
 * so the synced deck rows keep their contract.
 */
export type SessionNewOrder = 'deck' | 'random' | NewOrder;
export type ResolvedOrder = NewOrder | { by: 'random' };

export const ADDED: NewOrder = { by: 'added' };

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * parseNewOrder reads a stored order, normalised to its shape (fields
 * beyond it are dropped). null = absent or malformed, which means added.
 */
export function parseNewOrder(raw: unknown): NewOrder | null {
	if (!isRecord(raw)) return null;
	switch (raw.by) {
		case 'added':
			return { by: 'added' };
		case 'frequency':
			return { by: 'frequency' };
		case 'level':
			return typeof raw.packId === 'string' && raw.packId !== ''
				? { by: 'level', packId: raw.packId }
				: null;
		default:
			return null;
	}
}

/** sameOrder compares two orders; null is added. */
export function sameOrder(a: NewOrder | null, b: NewOrder | null): boolean {
	const x = a ?? ADDED;
	const y = b ?? ADDED;
	if (x.by !== y.by) return false;
	return x.by !== 'level' || x.packId === (y as { packId: string }).packId;
}

/**
 * orderNew sorts stably by key ascending; items without a key (null)
 * follow every keyed item in their incoming order. The input is not
 * changed.
 */
export function orderNew<T>(items: readonly T[], keyOf: (item: T) => number | null): T[] {
	const keyed: { item: T; key: number; index: number }[] = [];
	const rest: T[] = [];
	items.forEach((item, index) => {
		const key = keyOf(item);
		if (key === null || !Number.isFinite(key)) rest.push(item);
		else keyed.push({ item, key, index });
	});
	keyed.sort((a, b) => a.key - b.key || a.index - b.index);
	return [...keyed.map((k) => k.item), ...rest];
}

/**
 * randomKey is a stable pseudo-random key in [0, 1) per entry for one seed
 * (a hash, not a stream), so sorting by it shuffles the new items and an
 * item keeps its place relative to the others however many have left: a
 * reload of the same session (same seed) shows the same order. Tests pass
 * a fixed seed; the setup draws a fresh one when a session starts.
 */
export function randomKey(seed: number): (entryId: number) => number {
	return (entryId) => {
		let h = (Math.imul(seed | 0, 0x9e3779b1) ^ Math.imul(entryId | 0, 0x85ebca6b)) >>> 0;
		h = Math.imul(h ^ (h >>> 16), 0x7feb352d) >>> 0;
		h = Math.imul(h ^ (h >>> 15), 0x846ca68b) >>> 0;
		h = (h ^ (h >>> 16)) >>> 0;
		return h / 4294967296;
	};
}

/**
 * resolveSessionOrder turns a session setup's order into the one the
 * queue follows: an explicit order wins; 'deck' takes the selected decks'
 * common order, or added when they differ (`mixed`), since one queue
 * cannot follow two orders.
 */
export function resolveSessionOrder(
	session: SessionNewOrder,
	deckOrders: readonly (NewOrder | null)[]
): { order: ResolvedOrder; mixed: boolean } {
	if (session === 'random') return { order: { by: 'random' }, mixed: false };
	if (session !== 'deck') return { order: session, mixed: false };
	if (deckOrders.length === 0) return { order: ADDED, mixed: false };
	const first = deckOrders[0];
	if (deckOrders.every((o) => sameOrder(o, first))) return { order: first ?? ADDED, mixed: false };
	return { order: ADDED, mixed: true };
}
