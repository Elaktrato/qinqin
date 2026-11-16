// The order of new cards (#75): in the order added (the default), most
// frequent first, or by level. A deck carries one in its `deckcfg:` row,
// a session setup may override it. Only new items are reordered; reviews,
// due order and the daily admission stay as they are.
// Contract: docs/contracts/frequency/README.md.

export type NewOrder = { by: 'added' } | { by: 'frequency' } | { by: 'level'; packId: string };
export type SessionNewOrder = 'deck' | NewOrder;

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
 * resolveSessionOrder turns a session setup's order into the one the
 * queue follows: an explicit order wins; 'deck' takes the selected decks'
 * common order, or added when they differ (`mixed`), since one queue
 * cannot follow two orders.
 */
export function resolveSessionOrder(
	session: SessionNewOrder,
	deckOrders: readonly (NewOrder | null)[]
): { order: NewOrder; mixed: boolean } {
	if (session !== 'deck') return { order: session, mixed: false };
	if (deckOrders.length === 0) return { order: ADDED, mixed: false };
	const first = deckOrders[0];
	if (deckOrders.every((o) => sameOrder(o, first))) return { order: first ?? ADDED, mixed: false };
	return { order: ADDED, mixed: true };
}
