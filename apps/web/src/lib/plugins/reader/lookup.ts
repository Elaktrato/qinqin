import type { SegmentCandidate, SegmentMatch } from '$lib/api/types';

export type LookupKind = 'character' | 'word';

function clamp(n: number, lo: number, hi: number): number {
	return Math.min(Math.max(n, lo), hi);
}

// True when a surrogate pair starts at UTF-16 index i. A lone surrogate
// (high without a following low, or a stray low) is one code point, as
// Array.from and the server count it.
function pairAt(text: string, i: number): boolean {
	const high = text.charCodeAt(i);
	const low = text.charCodeAt(i + 1);
	return high >= 0xd800 && high <= 0xdbff && low >= 0xdc00 && low <= 0xdfff;
}

/**
 * utf16ToCodePoint converts a UTF-16 index (what the DOM reports) into a
 * code-point index (what the tokenizer uses). An index pointing inside a
 * surrogate pair maps to that pair's code point; out-of-range indexes clamp.
 */
export function utf16ToCodePoint(text: string, utf16Index: number): number {
	const end = clamp(utf16Index, 0, text.length);
	let cp = 0;
	let i = 0;
	while (i < end) {
		i += pairAt(text, i) ? 2 : 1;
		cp++;
	}
	// Overshot into the middle of a pair: the index belongs to that pair.
	return i > end ? cp - 1 : cp;
}

/** codePointToUtf16 is the inverse of utf16ToCodePoint; out-of-range indexes clamp. */
export function codePointToUtf16(text: string, cpIndex: number): number {
	let i = 0;
	for (let cp = 0; cp < cpIndex && i < text.length; cp++) {
		i += pairAt(text, i) ? 2 : 1;
	}
	return i;
}

/** pickEntry returns the match's candidate of the given kind, if any. */
export function pickEntry(
	match: SegmentMatch,
	kind: LookupKind
): SegmentCandidate | undefined {
	return match.entries.find((entry) => entry.kind === kind);
}

/**
 * preferredEntry picks the candidate to show: the preferred kind, else the
 * other kind for the same written form (never an unrelated entry).
 */
export function preferredEntry(
	match: SegmentMatch | null,
	kind: LookupKind
): SegmentCandidate | undefined {
	if (!match) return undefined;
	return pickEntry(match, kind) ?? pickEntry(match, kind === 'word' ? 'character' : 'word');
}

/**
 * homophoneNote describes the other entries a reading match resolves to:
 * when the shown candidate matched by its kana reading and more
 * candidates of the shown kind did too, the count of the others and a
 * link to the search page for the reading. Null otherwise.
 */
export function homophoneNote(
	match: SegmentMatch | null,
	kind: LookupKind
): { count: number; href: string; text: string } | null {
	const shown = preferredEntry(match, kind);
	if (!match || !shown?.reading) return null;
	const count = match.entries.filter((e) => e.kind === shown.kind && e.reading).length - 1;
	if (count < 1) return null;
	return {
		count,
		href: `/search?q=${encodeURIComponent(match.lemma)}`,
		text:
			count === 1
				? '1 other entry is read this way — search for it'
				: `${count} other entries are read this way — search for it`
	};
}

// Whitespace, punctuation and symbols never have a dictionary entry.
const NOTHING_TO_LOOK_UP = /^[\s\p{P}\p{S}\p{Z}]*$/u;

/**
 * selectionTarget decides what a selection looks up: one code point is a
 * character, more is a word. Null for empty or punctuation-only text.
 */
export function selectionTarget(selected: string): { text: string; kind: LookupKind } | null {
	const text = selected.trim();
	if (NOTHING_TO_LOOK_UP.test(text)) return null;
	return { text, kind: Array.from(text).length === 1 ? 'character' : 'word' };
}

// Hovering these never looks anything up: whitespace, punctuation,
// symbols, Latin letters and digits (zh/ja dictionaries have no entry
// for them, and a "not found" popup over every Latin word is noise).
const NOT_HOVERABLE = /^[\s\p{P}\p{S}\p{Z}\p{N}\p{Script=Latin}]$/u;

/** hoverable reports whether hovering the code point `ch` may start a lookup. */
export function hoverable(ch: string): boolean {
	return Array.from(ch).length === 1 && !NOT_HOVERABLE.test(ch);
}
