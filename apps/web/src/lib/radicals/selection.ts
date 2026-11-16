// Edits of a radical lookup selection and the page's labels. Pure; the
// /search/parts page and the entry page only wire these up.
import { radicalChar, radicalForms, radicalNumber, radicalsListing } from './kangxi';
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

export interface TypedOption {
	key: string;
	/** what picking it means, e.g. "radical 阜 (170)" or "part ⻖" */
	name: string;
	next: Selection;
}

/**
 * typedOptions is what one typed character can mean. A form listed under
 * several radicals (阝: 邑 163 on the right, 阜 170 on the left) offers each
 * radical, and, when isPart says the language's parts hold them, the
 * radicals' own shapes from the CJK Radicals Supplement (⻏, ⻖), so 陽 院 阿
 * and 都 部 are all reachable; the page asks which. Anything else gives the
 * single typedSelection result, nothing for text that is not one character.
 */
export function typedOptions(sel: Selection, text: string, isPart: (x: string) => boolean): TypedOption[] {
	const t = text.trim();
	if ([...t].length !== 1) return [];
	const listing = radicalsListing(t);
	if (listing.length > 1) {
		const options: TypedOption[] = listing.map((n) => ({
			key: `r:${n}`,
			name: `radical ${radicalChar(n)} (${n})`,
			next: { ...sel, p: [...sel.p], r: n }
		}));
		for (const n of listing) {
			for (const f of radicalForms(n)) {
				const c = f.codePointAt(0) ?? 0;
				if (c >= 0x2e80 && c <= 0x2eff && isPart(f) && !sel.p.includes(f)) {
					options.push({ key: `p:${f}`, name: `part ${f}`, next: togglePart(sel, f) });
				}
			}
		}
		return options;
	}
	// A radical's own character (口) counts as a part when it is a known part.
	const next = typedSelection(sel, t, isPart(t));
	return next === null ? [] : [{ key: 'one', name: t, next }];
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

export interface SelectionChip {
	key: string;
	/** visible text */
	label: string;
	/** what the chip is, for "Remove <name>" */
	name: string;
	/** the selection without this pick */
	next: Selection;
}

/**
 * selectionChips lists the current picks (radical, each part, strokes) as
 * removable chips, so a pick the pickers do not show (a rare part from a
 * link, ?p=吾) stays visible and removable.
 */
export function selectionChips(sel: Selection): SelectionChip[] {
	const chips: SelectionChip[] = [];
	if (sel.r !== undefined) {
		const c = radicalChar(sel.r);
		chips.push({ key: 'r', label: c, name: `radical ${c} (${sel.r})`, next: toggleRadical(sel, sel.r) });
	}
	for (const x of sel.p) chips.push({ key: `p:${x}`, label: x, name: `part ${x}`, next: togglePart(sel, x) });
	if (sel.s !== undefined) {
		const label = strokesLabel(sel.s);
		chips.push({ key: 's', label, name: label, next: toggleStrokes(sel, sel.s) });
	}
	return chips;
}
