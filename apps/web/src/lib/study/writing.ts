import { loadStrokeData } from './strokeData';
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
	load: (ch: string) => Promise<unknown | null> = (ch) => loadStrokeData(ch)
): Promise<string[]> {
	const chars = writableChars(written);
	const data = await Promise.all(chars.map((ch) => load(ch)));
	return chars.filter((_, i) => data[i] !== null);
}

/**
 * hanzi-writer quiz settings: leniency 1 and drawingWidth 4 are the library
 * defaults; the hint appears after 3 misses on a stroke.
 */
export function quizOptions(): { showHintAfterMisses: number; leniency: number; drawingWidth: number } {
	return { showHintAfterMisses: 3, leniency: 1, drawingWidth: 4 };
}
