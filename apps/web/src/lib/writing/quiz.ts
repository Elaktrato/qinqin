import type { CharOutcome } from '$lib/study/writing';
import type { MatchResult } from './matcher';

export interface QuizState {
	total: number;
	next: number;
	done: number[];
	mistakes: number;
	mistakesOnStroke: number;
	autoHinted: boolean;
	outline: boolean;
	manualHints: number;
	complete: boolean;
}
export type QuizEffect = { snap: number[] } | { miss: true; glow?: number } | { none: true };

const MISSES_FOR_HINT = 3;

export function startQuiz(total: number): QuizState {
	return {
		total, next: 0, done: [], mistakes: 0, mistakesOnStroke: 0,
		autoHinted: false, outline: false, manualHints: 0, complete: total <= 0
	};
}

export function applyResult(state: QuizState, result: MatchResult): { state: QuizState; effect: QuizEffect } {
	if (state.complete || result.kind === 'ignored') return { state, effect: { none: true } };
	if (result.kind === 'match') {
		const next = Math.max(state.next, Math.max(...result.strokes) + 1);
		return {
			state: { ...state, next, done: [...state.done, ...result.strokes], mistakesOnStroke: 0, complete: next >= state.total },
			effect: { snap: result.strokes }
		};
	}
	const mistakes = state.mistakes + 1;
	const mistakesOnStroke = state.mistakesOnStroke + 1;
	if (mistakesOnStroke >= MISSES_FOR_HINT && !state.autoHinted) {
		return {
			state: { ...state, mistakes, mistakesOnStroke, autoHinted: true, outline: true },
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
	return state.manualHints + (state.autoHinted ? 1 : 0);
}
