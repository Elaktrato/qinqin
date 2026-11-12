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
