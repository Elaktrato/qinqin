import type { SegmentMatch } from '$lib/api/types';

export type LookupKind = 'character' | 'word';

function clamp(n: number, lo: number, hi: number): number {
	return Math.min(Math.max(n, lo), hi);
}

function isHighSurrogate(unit: number): boolean {
	return unit >= 0xd800 && unit <= 0xdbff;
}

/**
 * utf16ToCodePoint converts a UTF-16 index (what the DOM reports) into a
 * code-point index (what the tokenizer uses). An index pointing inside a
 * surrogate pair maps to that pair's code point; out-of-range indexes clamp.
 */
export function utf16ToCodePoint(text: string, utf16Index: number): number {
	const end = clamp(utf16Index, 0, text.length);
	let cp = 0;
	for (let i = 0; i < end; i++) {
		if (isHighSurrogate(text.charCodeAt(i)) && i + 1 < end) i++;
		cp++;
	}
	// An index between the halves of a pair counted the high half as a
	// whole code point: step back so it maps to the pair itself.
	if (end > 0 && end < text.length && isHighSurrogate(text.charCodeAt(end - 1))) cp--;
	return cp;
}

/** codePointToUtf16 is the inverse of utf16ToCodePoint; out-of-range indexes clamp. */
export function codePointToUtf16(text: string, cpIndex: number): number {
	let i = 0;
	for (let cp = 0; cp < cpIndex && i < text.length; cp++) {
		i += isHighSurrogate(text.charCodeAt(i)) && i + 1 < text.length ? 2 : 1;
	}
	return i;
}

/** pickEntry returns the match's candidate of the given kind, if any. */
export function pickEntry(
	match: SegmentMatch,
	kind: LookupKind
): { id: number; kind: LookupKind } | undefined {
	return match.entries.find((entry) => entry.kind === kind);
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
