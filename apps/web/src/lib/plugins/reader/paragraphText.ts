// Maps between the rendered paragraph (one element per run, ruby kept
// apart) and the paragraph string the tokenizer sees. The string is the
// concatenation of the DISPLAYED run texts, never the ruby, so a DOM
// position inside run i at UTF-16 offset k has one code-point offset.
import { codePointToUtf16, utf16ToCodePoint } from './lookup';
import { convertText, type Variant } from './variants';

export interface Run {
	text: string;
	ruby?: string;
}

/** displayRuns applies the script variant per run; ruby stays as is. */
export function displayRuns(paragraph: Run[], variant: Variant): Run[] {
	if (variant === 'original') return paragraph;
	return paragraph.map((run) => ({ ...run, text: convertText(run.text, variant) }));
}

export function paragraphString(runs: Run[]): string {
	return runs.map((run) => run.text).join('');
}

function codePointLength(text: string): number {
	return utf16ToCodePoint(text, text.length);
}

/** offsetFromRun maps (run, UTF-16 offset in that run) to a code-point offset in the paragraph. */
export function offsetFromRun(runs: Run[], runIndex: number, utf16OffsetInRun: number): number {
	let offset = 0;
	const last = Math.min(runIndex, runs.length);
	for (let i = 0; i < last; i++) offset += codePointLength(runs[i].text);
	if (runIndex < 0 || runIndex >= runs.length) return offset;
	return offset + utf16ToCodePoint(runs[runIndex].text, utf16OffsetInRun);
}

/**
 * locate is the inverse of offsetFromRun. A boundary between two runs is
 * reported as the start of the later run; the paragraph end as the end of
 * the last run.
 */
export function locate(runs: Run[], cpOffset: number): { runIndex: number; utf16Offset: number } {
	let remaining = Math.max(cpOffset, 0);
	for (let i = 0; i < runs.length; i++) {
		const length = codePointLength(runs[i].text);
		if (remaining < length || i === runs.length - 1) {
			return { runIndex: i, utf16Offset: codePointToUtf16(runs[i].text, remaining) };
		}
		remaining -= length;
	}
	return { runIndex: 0, utf16Offset: 0 };
}

/** sliceCodePoints is String.slice over code points. */
export function sliceCodePoints(text: string, start: number, end: number): string {
	return text.slice(codePointToUtf16(text, start), codePointToUtf16(text, Math.max(start, end)));
}

/**
 * segmentAt resolves a UTF-16 offset in a run's displayed text to one of
 * the run's pieces (`o`: where the piece starts in the run, `length`: its
 * UTF-16 length). With bias 'start' a boundary between pieces belongs to
 * the later one, with 'end' to the earlier one (a range then never starts
 * at the end of one text node or ends at the start of the next). Offsets
 * past the end clamp to the end of the last piece. Null without pieces.
 */
export function segmentAt(
	segs: readonly { o: number; length: number }[],
	utf16: number,
	bias: 'start' | 'end'
): { index: number; offset: number } | null {
	if (segs.length === 0) return null;
	for (let i = 0; i < segs.length; i++) {
		const { o, length } = segs[i];
		const inside = bias === 'start' ? utf16 >= o && utf16 < o + length : utf16 > o && utf16 <= o + length;
		if (inside) return { index: i, offset: utf16 - o };
	}
	if (utf16 <= segs[0].o) return { index: 0, offset: 0 };
	const last = segs.length - 1;
	return { index: last, offset: segs[last].length };
}
