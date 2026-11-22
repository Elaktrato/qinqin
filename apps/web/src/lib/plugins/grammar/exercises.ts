// Pure exercise logic for a lesson: cloze (fill the gap) and word order.

import { shuffleTokens } from '$lib/study/wordSalad';
import type { Example, Lesson } from './types';

export type Exercise =
	| { kind: 'cloze'; example: Example; choices: string[] }
	| { kind: 'order'; example: Example };

/** convertLesson runs every displayed string of the examples through `convert` (script variant). */
export function convertLesson(lesson: Lesson, convert: (s: string) => string): Lesson {
	return {
		...lesson,
		title: convert(lesson.title),
		summary: convert(lesson.summary),
		pattern: lesson.pattern.map(convert),
		body: lesson.body.map(convert),
		examples: lesson.examples.map((e) => ({
			...e,
			text: convert(e.text),
			focus: convert(e.focus),
			distractors: e.distractors.map(convert)
		}))
	};
}

/** clozeParts splits the text around the first occurrence of focus; null when there is none. */
export function clozeParts(text: string, focus: string): { before: string; after: string } | null {
	if (focus === '') return null;
	const at = text.indexOf(focus);
	if (at === -1) return null;
	return { before: text.slice(0, at), after: text.slice(at + focus.length) };
}

function hasCloze(e: Example): boolean {
	return e.focus !== '' && e.distractors.length >= 2 && clozeParts(e.text, e.focus) !== null;
}

/** buildExercises: the clozes in example order, then one word-order exercise per example, shuffled. */
export function buildExercises(lesson: Lesson, seed: string): Exercise[] {
	const clozes: Exercise[] = lesson.examples.filter(hasCloze).map((example) => ({
		kind: 'cloze',
		example,
		choices: shuffleTokens([example.focus, ...example.distractors], seed + example.id)
	}));
	const orders: Exercise[] = shuffleTokens(
		lesson.examples.filter((e) => !e.noOrder),
		seed
	).map((example) => ({
		kind: 'order',
		example
	}));
	// The word order of the sentence just practised as a cloze would be a free answer.
	const last = clozes.at(-1);
	if (last && orders.length > 1 && orders[0].example.id === last.example.id) {
		[orders[0], orders[1]] = [orders[1], orders[0]];
	}
	return [...clozes, ...orders];
}

/** firstTry: a word-order exercise counts when solved with no wrong check and no give-up. */
export function firstTry(r: { wrongChecks: number; gaveUp: boolean }): boolean {
	return r.wrongChecks === 0 && !r.gaveUp;
}
