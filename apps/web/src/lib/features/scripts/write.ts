// The write mode (#62): a kana drawn stroke by stroke on the writing pad answers its question. Pure.

import type { Question } from './types';

/** A glyph drawn with at most this many wrong strokes still counts (a beginner's hand: one slip is allowed). */
export const WRITE_MAX_MISTAKES = 1;

/** The part of the pad's outcome the verdict reads. */
export interface WriteOutcome {
	mistakes: number;
	revealed: boolean;
}

/**
 * writeVerdict: right when the glyph was finished with at most WRITE_MAX_MISTAKES wrong strokes, without the
 * reveal and without a stroke hint (a hint or the reveal is help the answer should not count for).
 */
export function writeVerdict(outcome: WriteOutcome, hints: number): boolean {
	return !outcome.revealed && hints === 0 && outcome.mistakes <= WRITE_MAX_MISTAKES;
}

/** writeAnswer is the text the run submits for a drawn glyph: the glyph itself when right, nothing when not. */
export function writeAnswer(q: Question, right: boolean): string {
	return right ? q.answer : '';
}
