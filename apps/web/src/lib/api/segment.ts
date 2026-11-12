import { api } from './client';
import type { SegmentMatch } from './types';

const WINDOW = 16;

/**
 * windowAt returns up to `size` code points of `text` starting at the
 * code-point `offset`, or null when the offset is out of range. It counts
 * code points (never UTF-16 units) so surrogate pairs are never split.
 */
export function windowAt(text: string, offset: number, size = WINDOW): string | null {
	if (!Number.isInteger(offset) || offset < 0) return null;
	const points = Array.from(text);
	if (offset >= points.length) return null;
	return points.slice(offset, offset + size).join('');
}

/**
 * segmentAt returns the longest dictionary match starting at the code-point
 * `offset` of `text`, with start/end in the original text's offsets. Only a
 * short window is sent so the GET URL stays small. Null when there is no
 * match or the offset is out of range (no request is made then).
 */
export async function segmentAt(
	lang: string,
	text: string,
	offset: number,
	signal?: AbortSignal
): Promise<SegmentMatch | null> {
	const window = windowAt(text, offset);
	if (window === null) return null;
	const query = new URLSearchParams({ lang, text: window, offset: '0' });
	const { match } = await api<{ match: SegmentMatch | null }>(`/api/segment/at?${query}`, {
		signal
	});
	if (!match) return null;
	return { ...match, start: match.start + offset, end: match.end + offset };
}

/**
 * segmentBatch segments a whole text. The server rejects texts over 5000
 * runes with 413; callers keep their text within that cap (no chunking here).
 */
export async function segmentBatch(
	lang: string,
	text: string,
	signal?: AbortSignal
): Promise<SegmentMatch[]> {
	const { matches } = await api<{ matches: SegmentMatch[] }>('/api/segment', {
		method: 'POST',
		body: { lang, text },
		signal
	});
	return matches;
}
