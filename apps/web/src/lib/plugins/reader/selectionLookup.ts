// Resolves a text selection to a dictionary match. DOM-free: the caller
// maps the selection to code-point offsets in the displayed paragraph and
// injects the segment function (segmentAt, usually through a cache).
import type { SegmentMatch } from '$lib/api/types';
import { selectionTarget, type LookupKind } from './lookup';
import { sliceCodePoints } from './paragraphText';

export const START_NOTE = 'Showing the word at the start of your selection.';

export type SegmentFn = (
	lang: string,
	text: string,
	offset: number,
	signal?: AbortSignal
) => Promise<SegmentMatch | null>;

export interface SpanTarget {
	start: number;
	end: number;
	text: string;
	kind: LookupKind;
}

export interface SelectionResult {
	match: SegmentMatch | null;
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
 * - one code point: that character on its own (the text sent is just the
 *   character, so a longer word starting there cannot shadow it);
 * - several: the selected text itself when it is exactly a word (so
 *   selecting 中文 in 中文课本 shows 中文, not a longer word), else the
 *   longest match at the selection start in the paragraph when it covers
 *   the whole selection (this catches inflected forms, 食べ in 食べた),
 *   else that start match with START_NOTE. Nothing is ever invented.
 */
export async function lookupSelection(
	lang: string,
	paragraph: string,
	target: SpanTarget,
	segment: SegmentFn,
	signal?: AbortSignal
): Promise<SelectionResult> {
	const exact = await segment(lang, target.text, 0, signal);
	const length = target.end - target.start;
	if (exact && (target.kind === 'character' || exact.end === length)) {
		return {
			match: { ...exact, start: exact.start + target.start, end: exact.end + target.start },
			note: ''
		};
	}
	if (target.kind === 'character') return { match: null, note: '' };
	const atStart = await segment(lang, paragraph, target.start, signal);
	if (!atStart) return { match: null, note: '' };
	return { match: atStart, note: atStart.end >= target.end ? '' : START_NOTE };
}
