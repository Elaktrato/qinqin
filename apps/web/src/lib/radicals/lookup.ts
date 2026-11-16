// The radical and part lookup: filter the character universe by radical,
// contained parts and total strokes, and say which further picks can still
// narrow it. Pure. Rule and fixtures: docs/contracts/radicals/ (lookup.json).
import type { CharRow, ComponentPart } from '$lib/api/types';

/** The picker lists parts used by at least this many characters (unless "Show all"). */
export const MIN_PART_USE = 10;
/** At most this many result cells render until "Show all". */
export const RESULT_CAP = 300;

export interface Selection {
	/** Kangxi radical number */
	r?: number;
	/** chosen parts, all must be contained (AND) */
	p: string[];
	/** total strokes */
	s?: number;
}

export interface LookupIndex {
	cells: CharRow[];
	/** parts of each cell (its glyph's and its variants'), by cell position */
	parts: Set<string>[];
	byRadical: Map<number, number[]>;
	byPart: Map<string, number[]>;
}

export interface ResultGroup {
	/** total strokes; 0 = unknown */
	s: number;
	/** all matches with this stroke count */
	count: number;
	/** the matches of this group among the rendered (capped) results */
	cells: CharRow[];
}

export interface LookupResult {
	results: CharRow[];
	total: number;
	groups: ResultGroup[];
	availableParts: Set<string>;
	availableStrokes: number[];
}

const strokesOf = (c: CharRow): number => (typeof c.s === 'number' && c.s > 0 ? c.s : 0);

/** buildIndex prepares the universe and the components map for repeated lookups. */
export function buildIndex(chars: CharRow[], components: Record<string, string[]>): LookupIndex {
	const byRadical = new Map<number, number[]>();
	const byPart = new Map<string, number[]>();
	const parts = chars.map((cell, i) => {
		const set = new Set<string>();
		for (const g of [cell.c, ...(cell.v ?? [])]) for (const x of components[g] ?? []) set.add(x);
		for (const x of set) {
			const list = byPart.get(x);
			if (list) list.push(i);
			else byPart.set(x, [i]);
		}
		if (typeof cell.k === 'number' && cell.k > 0) {
			const list = byRadical.get(cell.k);
			if (list) list.push(i);
			else byRadical.set(cell.k, [i]);
		}
		return set;
	});
	return { cells: chars, parts, byRadical, byPart };
}

/** isEmpty reports a selection with nothing picked. */
export function isEmpty(sel: Selection): boolean {
	return sel.r === undefined && sel.p.length === 0 && sel.s === undefined;
}

// matchRadicalAndParts returns the cell positions matching sel's radical and
// parts (every cell when neither is set), from the smallest candidate list.
function matchRadicalAndParts(index: LookupIndex, sel: Selection): number[] {
	const lists: number[][] = [];
	if (sel.r !== undefined) lists.push(index.byRadical.get(sel.r) ?? []);
	for (const x of sel.p) lists.push(index.byPart.get(x) ?? []);
	if (lists.length === 0) return index.cells.map((_, i) => i);
	lists.sort((a, b) => a.length - b.length);
	const [first] = lists;
	return first.filter(
		(i) => (sel.r === undefined || index.cells[i].k === sel.r) && sel.p.every((x) => index.parts[i].has(x))
	);
}

function compareCells(a: CharRow, b: CharRow): number {
	const sa = strokesOf(a);
	const sb = strokesOf(b);
	if ((sa === 0) !== (sb === 0)) return sa === 0 ? 1 : -1;
	if (sa !== sb) return sa - sb;
	return (a.c.codePointAt(0) ?? 0) - (b.c.codePointAt(0) ?? 0);
}

/** lookup applies sel to the index (see the contract for every rule). */
export function lookup(index: LookupIndex, sel: Selection, opts: { cap?: number } = {}): LookupResult {
	const cap = opts.cap ?? RESULT_CAP;
	const rp = matchRadicalAndParts(index, sel);
	const strokes = [...new Set(rp.map((i) => strokesOf(index.cells[i])).filter((s) => s > 0))].sort((a, b) => a - b);
	if (isEmpty(sel)) {
		return { results: [], total: 0, groups: [], availableParts: new Set(index.byPart.keys()), availableStrokes: strokes };
	}
	const matches = (sel.s === undefined ? rp : rp.filter((i) => strokesOf(index.cells[i]) === sel.s)).map(
		(i) => index.cells[i]
	);
	const positions = new Map<CharRow, number>();
	for (const i of rp) positions.set(index.cells[i], i);
	matches.sort(compareCells);

	const chosen = new Set(sel.p);
	const availableParts = new Set<string>();
	for (const cell of matches) {
		for (const x of index.parts[positions.get(cell)!]) if (!chosen.has(x)) availableParts.add(x);
	}
	const results = matches.slice(0, cap);
	const groups: ResultGroup[] = [];
	matches.forEach((cell, n) => {
		const s = strokesOf(cell);
		let last = groups.at(-1);
		if (!last || last.s !== s) {
			last = { s, count: 0, cells: [] };
			groups.push(last);
		}
		last.count += 1;
		if (n < cap) last.cells.push(cell);
	});
	return { results, total: matches.length, groups, availableParts, availableStrokes: strokes };
}

export interface PickerGroup {
	/** part strokes; 0 = unknown, shown as "?" and listed last */
	s: number;
	parts: { c: string; disabled: boolean }[];
}

/** pickerParts groups the parts for the picker: n >= MIN_PART_USE unless showAll. */
export function pickerParts(parts: ComponentPart[], available: Set<string>, showAll: boolean): PickerGroup[] {
	const groups = new Map<number, ComponentPart[]>();
	for (const x of parts) {
		if (!showAll && x.n < MIN_PART_USE) continue;
		const list = groups.get(x.s);
		if (list) list.push(x);
		else groups.set(x.s, [x]);
	}
	return [...groups.keys()]
		.sort((a, b) => (a === 0 ? 1 : b === 0 ? -1 : a - b))
		.map((s) => ({
			s,
			parts: groups
				.get(s)!
				.slice()
				.sort((a, b) => (a.c.codePointAt(0) ?? 0) - (b.c.codePointAt(0) ?? 0))
				.map((x) => ({ c: x.c, disabled: !available.has(x.c) }))
		}));
}
