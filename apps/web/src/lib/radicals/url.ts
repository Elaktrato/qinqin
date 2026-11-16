// The radical lookup's state in the URL: /search/parts?r=85&p=口&p=木&s=8.
// Pure. Contract: docs/contracts/radicals/README.md (Android notes).
import { isRadical } from './kangxi';
import type { Selection } from './lookup';

/** At most this many parts are kept from a URL. */
export const MAX_PARTS = 8;
const MAX_STROKES = 64;

function positiveInt(raw: string | null, max: number): number | undefined {
	if (raw === null || !/^\d{1,3}$/.test(raw)) return undefined;
	const n = Number(raw);
	return n >= 1 && n <= max ? n : undefined;
}

/** selectionFromParams reads a selection, dropping anything invalid. */
export function selectionFromParams(params: URLSearchParams): Selection {
	const sel: Selection = { p: [] };
	const r = positiveInt(params.get('r'), 214);
	if (r !== undefined && isRadical(r)) sel.r = r;
	for (const x of params.getAll('p')) {
		if ([...x].length !== 1 || sel.p.includes(x)) continue;
		if (sel.p.length >= MAX_PARTS) break;
		sel.p.push(x);
	}
	const s = positiveInt(params.get('s'), MAX_STROKES);
	if (s !== undefined) sel.s = s;
	return sel;
}

/** partsHref is the page URL of a selection, in the stable order r, p..., s. */
export function partsHref(sel: Selection): string {
	const params = new URLSearchParams();
	if (sel.r !== undefined) params.set('r', String(sel.r));
	for (const x of sel.p) params.append('p', x);
	if (sel.s !== undefined) params.set('s', String(sel.s));
	const q = params.toString();
	return q ? `/search/parts?${q}` : '/search/parts';
}
