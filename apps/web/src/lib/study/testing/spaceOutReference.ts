// The plain, quadratic form of sessionMix.ts `spaceOut`, step by step as the
// contract (docs/contracts/cards/README.md, Session mix) states it. Tests
// compare the fast implementation with it on random blocks.

const PRESSURE_SLACK = 2;

export function spaceOutReference<T extends { entryId: number }>(
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
		if (pick < 0 && gap > 1) {
			let most = 0;
			rest.forEach((item, at) => {
				const r = left.get(item.entryId) ?? 0;
				if (
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
