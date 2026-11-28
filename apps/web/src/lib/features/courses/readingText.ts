// The reading lesson's text (#222, Ruling 23): the unit's text cut into plain runs and the words the segmenter found,
// each word with its reading when the learner has not reached it (not met in a lesson, not marked known), and the
// list of those words for their glosses. Offsets are code points, as the segmenter counts them. Pure.

import type { SegmentMatch } from '$lib/api/types';

export interface ReadingPart {
	text: string;
	/** The word's entry; null for a plain run. */
	entryId: number | null;
	/** The reading shown over an unreached word; null otherwise. */
	reading: { type: string; value: string } | null;
}

export function readingParts(text: string, matches: readonly SegmentMatch[], reached: ReadonlySet<number>): ReadingPart[] {
	const chars = [...text];
	const out: ReadingPart[] = [];
	let at = 0;
	const plain = (to: number) => {
		if (to > at) out.push({ text: chars.slice(at, to).join(''), entryId: null, reading: null });
	};
	for (const match of [...matches].sort((a, b) => a.start - b.start)) {
		const entry = match.entries[0];
		if (entry === undefined || match.start < at || match.end > chars.length || match.end <= match.start) continue;
		plain(match.start);
		const reading = !reached.has(entry.id) && match.reading ? { type: match.reading.type, value: match.reading.value } : null;
		out.push({ text: chars.slice(match.start, match.end).join(''), entryId: entry.id, reading });
		at = match.end;
	}
	plain(chars.length);
	return out;
}

/** unreachedEntries: the words shown with a reading, each entry once, in text order. */
export function unreachedEntries(parts: readonly ReadingPart[]): { entryId: number; text: string; reading: { type: string; value: string } }[] {
	const seen = new Set<number>();
	const out: { entryId: number; text: string; reading: { type: string; value: string } }[] = [];
	for (const p of parts) {
		if (p.entryId === null || p.reading === null || seen.has(p.entryId)) continue;
		seen.add(p.entryId);
		out.push({ entryId: p.entryId, text: p.text, reading: p.reading });
	}
	return out;
}
