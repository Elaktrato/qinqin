// Puts a review's annotations on the current text. The server computed
// prefix and suffix from the text it reviewed; after edits they may no
// longer match. An annotation goes to the right place, to `missing`, or
// to the list only; it never points at a different occurrence.

import { textHash } from './textHash';
import type { Annotation, Review } from './types';

export interface Placed {
	annotation: Annotation;
	start: number;
	end: number;
}

export interface Anchoring {
	placed: Placed[];
	missing: Annotation[];
	listOnly: Annotation[];
}

export type Segment = { text: string; annotationId?: string };

function occurrences(text: string, quote: string): number[] {
	const found: number[] = [];
	if (quote === '') return found;
	for (let i = text.indexOf(quote); i !== -1; i = text.indexOf(quote, i + 1)) found.push(i);
	return found;
}

// Compared against the text cut at its bounds, so an empty prefix only
// matches at the very start and an empty suffix only at the very end.
function prefixMatches(text: string, start: number, prefix: string): boolean {
	return start >= prefix.length && text.slice(start - prefix.length, start) === prefix;
}

function suffixMatches(text: string, end: number, suffix: string): boolean {
	return text.slice(end, end + suffix.length) === suffix;
}

interface Candidate {
	annotation: Annotation;
	start: number;
	end: number;
	score: number; // 2 = exact context, 1 = one side or unique quote, 0 = unique quote only
	exact: boolean;
}

function locate(text: string, a: Annotation): Candidate | null {
	const starts = occurrences(text, a.quote);
	if (starts.length === 0) return null;
	const make = (start: number, exact: boolean): Candidate => {
		const end = start + a.quote.length;
		const score = Number(prefixMatches(text, start, a.prefix)) + Number(suffixMatches(text, end, a.suffix));
		return { annotation: a, start, end, score, exact };
	};

	const exact = starts.find(
		(s) => prefixMatches(text, s, a.prefix) && suffixMatches(text, s + a.quote.length, a.suffix)
	);
	if (exact !== undefined) return make(exact, true);
	if (starts.length === 1) return make(starts[0], false);

	const byPrefix = starts.filter((s) => prefixMatches(text, s, a.prefix));
	if (byPrefix.length === 1) return make(byPrefix[0], false);
	if (byPrefix.length === 0) {
		const bySuffix = starts.filter((s) => suffixMatches(text, s + a.quote.length, a.suffix));
		if (bySuffix.length === 1) return make(bySuffix[0], false);
	}
	return null;
}

export function anchorAnnotations(text: string, annotations: Annotation[]): Anchoring {
	const missing: Annotation[] = [];
	const listOnly: Annotation[] = [];
	const found: Candidate[] = [];

	for (const a of annotations) {
		const c = locate(text, a);
		if (c) found.push(c);
		else missing.push(a);
	}

	// Two annotations that settle on the very same span without an exact
	// match are competing for one occurrence: the better context wins, the
	// other is missing rather than pointing at the winner's words.
	const bySpan = new Map<string, Candidate[]>();
	for (const c of found) {
		const key = `${c.start}:${c.end}`;
		bySpan.set(key, [...(bySpan.get(key) ?? []), c]);
	}
	const contested = new Set<Candidate>();
	for (const group of bySpan.values()) {
		const loose = group.filter((c) => !c.exact);
		if (group.length < 2 || loose.length === 0) continue;
		const winner = group.reduce((best, c) => (c.score > best.score ? c : best));
		for (const c of group) if (c !== winner && !c.exact) contested.add(c);
	}

	const placed: Placed[] = [];
	const kept = found
		.filter((c) => {
			if (!contested.has(c)) return true;
			missing.push(c.annotation);
			return false;
		})
		.sort((a, b) => a.start - b.start);
	let lastEnd = 0;
	for (const c of kept) {
		if (c.start >= lastEnd) {
			placed.push({ annotation: c.annotation, start: c.start, end: c.end });
			lastEnd = c.end;
		} else {
			listOnly.push(c.annotation);
		}
	}

	return { placed, missing, listOnly };
}

/** Splits the text into plain and annotated runs; the runs cover the text exactly, in order. */
export function segments(text: string, placed: Placed[]): Segment[] {
	const out: Segment[] = [];
	let at = 0;
	for (const p of placed) {
		if (p.start > at) out.push({ text: text.slice(at, p.start) });
		out.push({ text: text.slice(p.start, p.end), annotationId: p.annotation.id });
		at = p.end;
	}
	if (at < text.length) out.push({ text: text.slice(at) });
	return out;
}

export function isOutdated(text: string, review: Review): boolean {
	return textHash(text) !== review.textHash;
}
