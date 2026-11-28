// The highlight on a look-alike answer (#228): a member drawn from the stroke data (`strokes/`, the installed strokes
// packs), its marked strokes (the ones that make the difference) in the accent colour. Data with another stroke count
// than the set's (a pack that draws the character another way) is not used: the answer shows the font's glyph.

import { parseStrokeData } from '$lib/writing/strokes';

export interface DrawnStroke {
	outline: string;
	marked: boolean;
}

/** strokesFor: the outlines of `ch` with their marks, or null when the data is unreadable or has another count. */
export function strokesFor(ch: string, data: unknown, count: number, marks: readonly number[]): DrawnStroke[] | null {
	const parsed = parseStrokeData(ch, data);
	if (parsed === null || parsed.outlines.length !== count) return null;
	return parsed.outlines.map((outline, i) => ({ outline, marked: marks.includes(i) }));
}
