import type { CharOutcome } from '$lib/exercises/writing';
import type { MatchResult } from './matcher';

export interface QuizState {
	total: number;
	next: number;
	done: number[];
	mistakes: number;
	mistakesOnStroke: number;
	/** Strokes hinted automatically after MISSES_FOR_HINT misses (#287: each one counts as a hint). */
	autoHints: number;
	/** The stroke shown dimmed, with its start, until it is drawn (#287), or null. Never the whole character. */
	trace: number | null;
	manualHints: number;
	complete: boolean;
}
export type QuizEffect = { snap: number[] } | { miss: true; glow?: number } | { none: true };

const MISSES_FOR_HINT = 3;

export function startQuiz(total: number): QuizState {
	return {
		total, next: 0, done: [], mistakes: 0, mistakesOnStroke: 0,
		autoHints: 0, trace: null, manualHints: 0, complete: total <= 0
	};
}

export function applyResult(state: QuizState, result: MatchResult): { state: QuizState; effect: QuizEffect } {
	if (state.complete || result.kind === 'ignored') return { state, effect: { none: true } };
	if (result.kind === 'match') {
		const next = Math.max(state.next, Math.max(...result.strokes) + 1);
		return {
			state: {
				...state,
				next,
				done: [...state.done, ...result.strokes],
				mistakesOnStroke: 0,
				// The traced stroke is always the expected one, so any match draws it.
				trace: null,
				complete: next >= state.total
			},
			effect: { snap: result.strokes }
		};
	}
	const mistakes = state.mistakes + 1;
	const mistakesOnStroke = state.mistakesOnStroke + 1;
	// The third miss on a stroke shows that stroke only (#287): a glow, then dimmed until it is drawn. Once per
	// stroke; any later stroke that gets three misses is hinted again.
	if (mistakesOnStroke === MISSES_FOR_HINT) {
		return {
			state: { ...state, mistakes, mistakesOnStroke, autoHints: state.autoHints + 1, trace: state.next },
			effect: { miss: true, glow: state.next }
		};
	}
	return { state: { ...state, mistakes, mistakesOnStroke }, effect: { miss: true } };
}

export function requestHint(state: QuizState): { state: QuizState; glow: number } {
	return { state: { ...state, manualHints: state.manualHints + 1 }, glow: state.next };
}

export function outcomeOf(char: string, state: QuizState, revealed: boolean): CharOutcome {
	return { char, mistakes: state.mistakes, strokes: state.total, revealed };
}

export function hintsOf(state: QuizState): number {
	return state.manualHints + state.autoHints;
}
