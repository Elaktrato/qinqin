// The plain, quadratic form of sessionMix.ts `spaceOut`, step by step as the
// contract (docs/contracts/cards/README.md, Session mix) states it. Tests
// compare the fast implementation with it on random blocks.

const PRESSURE_SLACK = 2;

export function spaceOutReference<T extends { entryId: number }>(
	items: readonly T[],
	gap: number,
	placed: readonly number[] = [],
	options: { leads?: (item: T) => boolean } = {}
): T[] {
	const lastAt = new Map<number, number>();
	placed.forEach((entryId, at) => lastAt.set(entryId, at));
	const rest = [...items];
	const out: T[] = [];
	let position = placed.length;
	const sep = (entryId: number): number => {
		const at = lastAt.get(entryId);
		return at === undefined ? Infinity : position - at - 1;
	};
	const leads = options.leads;
	// A word's other items wait until none of its lead items is left.
	const eligible = (item: T): boolean =>
		leads === undefined ||
		leads(item) ||
		!rest.some((other) => other.entryId === item.entryId && leads(other));
	while (rest.length > 0) {
		const remaining = rest.length;
		const left = (entryId: number) => rest.filter((item) => item.entryId === entryId).length;
		let pick = rest.findIndex(
			(item) => eligible(item) && 2 * left(item.entryId) - 1 >= remaining && sep(item.entryId) >= 1
		);
		if (pick < 0 && gap > 1) {
			let most = 0;
			rest.forEach((item, at) => {
				const r = left(item.entryId);
				if (
					eligible(item) &&
					r >= 2 &&
					r > most &&
					sep(item.entryId) >= gap &&
					(r - 1) * (gap + 1) + 1 >= remaining - PRESSURE_SLACK
				) {
					most = r;
					pick = at;
				}
			});
		}
		for (let need = gap; pick < 0 && need >= 0; need -= 1) {
			pick = rest.findIndex((item) => eligible(item) && sep(item.entryId) >= need);
		}
		const [item] = rest.splice(pick, 1);
		out.push(item);
		lastAt.set(item.entryId, position);
		position += 1;
	}
	return out;
}
