// The state of one practice round: pure transitions the view drives.

import { checkTyped } from './typing';
import type { Question } from './types';

export interface RunState {
	questions: readonly Question[];
	index: number;
	/** Whether the current question has been answered (the feedback is showing). */
	answered: boolean;
	/** The result of the current question once answered. */
	ok: boolean | null;
	right: number;
	done: boolean;
}

export function startRun(questions: readonly Question[]): RunState {
	return { questions, index: 0, answered: false, ok: null, right: 0, done: questions.length === 0 };
}

/** isCorrect: a choice must be one of the accepted texts exactly; typed text is compared as typed practice does. */
export function isCorrect(q: Question, given: string): boolean {
	return q.mode === 'type' ? checkTyped(given, q.accepts) : q.accepts.includes(given);
}

/** submit answers the current question; answering twice, or after the end, changes nothing. */
export function submit(state: RunState, given: string): RunState {
	if (state.done || state.answered) return state;
	const ok = isCorrect(state.questions[state.index], given);
	return { ...state, answered: true, ok, right: state.right + (ok ? 1 : 0) };
}

/** advance moves to the next question, or ends the round after the last. */
export function advance(state: RunState): RunState {
	if (state.done || !state.answered) return state;
	const index = state.index + 1;
	return { ...state, index, answered: false, ok: null, done: index >= state.questions.length };
}
