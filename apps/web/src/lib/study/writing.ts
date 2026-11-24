import type { ReviewGrade } from './types';

// Script=Han also admits 々 〆 〇; usableChars drops them (no stroke files).
const HAN =/^\p{Script=Han}$/u;

export function isHan(ch: string): boolean {
	return HAN.test(ch);
}

/** Distinct Han characters in order of first appearance. */
export function writableChars(written: string): string[] {
	const seen = new Set<string>();
	for (const ch of written) {
		if (isHan(ch)) seen.add(ch);
	}
	return [...seen];
}

export interface CharOutcome {
	char: string;
	mistakes: number;
	strokes: number;
	revealed: boolean;
}

export function suggestWritingGrade(outcomes: CharOutcome[]): ReviewGrade {
	if (outcomes.length === 0) return 1;
	if (outcomes.some((o) => o.revealed)) return 1;
	const mistakes = outcomes.reduce((sum, o) => sum + o.mistakes, 0);
	if (mistakes === 0) return 3;
	const strokes = outcomes.reduce((sum, o) => sum + o.strokes, 0);
	return mistakes <= strokes * 0.25 ? 2 : 1;
}

/** Writable characters for which stroke data is available. */
export async function usableChars(
	written: string,
	load: (ch: string) => Promise<unknown | null>
): Promise<string[]> {
	const chars = writableChars(written);
	const data = await Promise.all(chars.map((ch) => load(ch)));
	return chars.filter((_, i) => data[i] !== null);
}

/**
 * maskWritten shows the word with every usable character that is not yet
 * written replaced by a box; `done` counts the characters completed in
 * order. Kana and other characters stay visible as context.
 */
export function maskWritten(written: string, chars: readonly string[], done: number): string {
	let out = '';
	for (const ch of written) {
		const at = chars.indexOf(ch);
		out += at >= 0 && at >= done ? '□' : ch;
	}
	return out;
}
