// Resolves a text selection to dictionary results. DOM-free: the caller
// maps the selection to code-point offsets in the displayed paragraph and
// injects the lookup function (lookupAt, usually through a cache).
import type { LookupResult } from '$lib/api/types';
import { selectionTarget, type LookupKind } from './lookup';
import type { LookupFn } from './lookupCache';
import { sliceCodePoints } from './paragraphText';

export const START_NOTE = 'Showing matches at the start of your selection.';

export interface SpanTarget {
	start: number;
	end: number;
	text: string;
	kind: LookupKind;
}

export interface SelectionResult {
	/** Offsets are in the paragraph. */
	results: LookupResult[];
	note: string;
}

const EDGE_LEAD = /^[\s\p{P}\p{S}\p{Z}]+/u;
const EDGE_TRAIL = /[\s\p{P}\p{S}\p{Z}]+$/u;

/**
 * selectionSpanTarget slices [start,end) of the paragraph, drops
 * whitespace and punctuation at both edges (a sloppy drag often grabs the
 * full stop), and returns the remaining span's offsets with its target.
 */
export function selectionSpanTarget(paragraph: string, start: number, end: number): SpanTarget | null {
	const selected = sliceCodePoints(paragraph, start, end);
	const lead = Array.from(selected.match(EDGE_LEAD)?.[0] ?? '').length;
	const target = selectionTarget(selected.replace(EDGE_LEAD, '').replace(EDGE_TRAIL, ''));
	if (!target) return null;
	const length = Array.from(target.text).length;
	return { start: start + lead, end: start + lead + length, ...target };
}

/**
 * lookupSelection finds what a selection means:
 * - one code point: its character entries (the text sent is just the
 *   character, so a longer word starting there cannot shadow it);
 * - several: the results for the selected text itself that cover all of it
 *   (selecting 中文 in 中文课本 shows 中文, not a longer word), else the
 *   paragraph results at the selection start that cover it (this catches
 *   inflected forms, 食べ in 食べた), else every result at the start with
 *   START_NOTE. Nothing is ever invented.
 */
export async function lookupSelection(
	lang: string,
	paragraph: string,
	target: SpanTarget,
	lookup: LookupFn,
	signal?: AbortSignal
): Promise<SelectionResult> {
	const shift = (r: LookupResult) => ({ ...r, start: r.start + target.start, end: r.end + target.start });
	if (target.kind === 'character') {
		const found = await lookup(lang, target.text, 0, ['character'], signal);
		return { results: found.map(shift), note: '' };
	}
	const length = target.end - target.start;
	const exact = (await lookup(lang, target.text, 0, undefined, signal)).filter((r) => r.end === length);
	if (exact.length > 0) return { results: exact.map(shift), note: '' };
	const atStart = await lookup(lang, paragraph, target.start, undefined, signal);
	const covering = atStart.filter((r) => r.end >= target.end);
	if (covering.length > 0) return { results: covering, note: '' };
	return { results: atStart, note: atStart.length > 0 ? START_NOTE : '' };
}
