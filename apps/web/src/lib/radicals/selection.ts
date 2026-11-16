// Edits of a radical lookup selection and the page's labels. Pure; the
// /search/parts page and the entry page only wire these up.
import { radicalChar, radicalNumber } from './kangxi';
import type { Selection } from './lookup';
import { MAX_PARTS, partsHref } from './url';

function without<K extends keyof Selection>(sel: Selection, key: K): Selection {
	const next = { ...sel, p: [...sel.p] };
	delete next[key];
	return next;
}

/** toggleRadical picks radical n, or drops it when it is the current one. */
export function toggleRadical(sel: Selection, n: number): Selection {
	return sel.r === n ? without(sel, 'r') : { ...sel, p: [...sel.p], r: n };
}

/** togglePart adds part x (up to MAX_PARTS) or removes it when chosen. */
export function togglePart(sel: Selection, x: string): Selection {
	if (sel.p.includes(x)) return { ...sel, p: sel.p.filter((y) => y !== x) };
	if (sel.p.length >= MAX_PARTS) return sel;
	return { ...sel, p: [...sel.p, x] };
}

/** toggleStrokes picks total strokes s, or drops it when it is the current one. */
export function toggleStrokes(sel: Selection, s: number): Selection {
	return sel.s === s ? without(sel, 's') : { ...sel, p: [...sel.p], s };
}

/**
 * typedSelection applies one typed character. A radical form that is not
 * itself a radical's character (氵, 讠) sets the radical. A radical's own
 * character (口) is a part when the language has parts (hasParts), else the
 * radical. Anything else is added as a part. Text that is not exactly one
 * character gives null.
 */
export function typedSelection(sel: Selection, text: string, hasParts: boolean): Selection | null {
	const t = text.trim();
	if ([...t].length !== 1) return null;
	const n = radicalNumber(t);
	if (n > 0 && (radicalChar(n) !== t || !hasParts)) return { ...sel, p: [...sel.p], r: n };
	return sel.p.includes(t) ? sel : togglePart(sel, t);
}

/** statusLine is the live result count; '' before anything is picked. */
export function statusLine(sel: Selection, total: number): string {
	if (sel.r === undefined && sel.p.length === 0 && sel.s === undefined) return '';
	if (total === 0) return 'No characters match.';
	return `${total} ${total === 1 ? 'character' : 'characters'}`;
}

/** strokesLabel names a result group; 0 is unknown. */
export function strokesLabel(s: number): string {
	if (s <= 0) return '? strokes';
	return `${s} ${s === 1 ? 'stroke' : 'strokes'}`;
}

export interface EntryRadicalLinks {
	/** "All characters with this radical": the character's radical */
	withRadical?: string;
	/** "Browse by stroke count": the entry is itself a table radical */
	browse?: string;
}

/**
 * entryRadicalLinks are the entry page's lookup links: written and kind
 * are the entry's, radicalWritten its radical entry's written form ('' when
 * it has none or it has not loaded).
 */
export function entryRadicalLinks(written: string, kind: string, radicalWritten: string): EntryRadicalLinks {
	if (kind !== 'character') return {};
	const links: EntryRadicalLinks = {};
	const r = radicalNumber(radicalWritten);
	if (r > 0) links.withRadical = partsHref({ r, p: [] });
	const own = radicalNumber(written);
	if (own > 0 && radicalChar(own) === written) links.browse = partsHref({ r: own, p: [] });
	return links;
}
