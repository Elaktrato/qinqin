// Checking a conjugation answer (#178): a typed answer is compared after normalising what the IME gave (width,
// spaces, katakana, a final full stop) with every accepted answer, written or in kana; the canonical one first. The
// choices of a question never offer a second right answer: a produce question's wrong choices share no answer with
// the right form, and a recognise question accepts every form whose answers hold the form shown (食べられる is the
// potential and the passive) and offers none of them as a wrong choice.

import type { ConjugationAnswer, ConjugationWord } from './words';

export type Verdict = 'canonical' | 'accepted' | 'wrong';

/** A random number in [0, 1) (Math.random, or a seeded one in tests). */
export type Rng = () => number;

const KATAKANA = /[ァ-ヶ]/g;

/** normaliseAnswer: NFKC (full and half width), no white space, katakana as hiragana, no final 。 or . */
export function normaliseAnswer(text: string): string {
	return text
		.normalize('NFKC')
		.replace(/\s+/gu, '')
		.replace(KATAKANA, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))
		.replace(/[。.]+$/u, '');
}

/** checkTyped: whether a typed answer is the canonical answer, an accepted one, or wrong. */
export function checkTyped(input: string, answers: readonly ConjugationAnswer[]): Verdict {
	const typed = normaliseAnswer(input);
	if (typed === '') return 'wrong';
	const index = answers.findIndex((a) => normaliseAnswer(a.written) === typed || normaliseAnswer(a.reading) === typed);
	return index < 0 ? 'wrong' : index === 0 ? 'canonical' : 'accepted';
}

/** shownAnswer: the answer a question shows (the canonical one). */
export function shownAnswer(answers: readonly ConjugationAnswer[]): ConjugationAnswer {
	return answers[0];
}

function shuffled<T>(list: readonly T[], rng: Rng): T[] {
	const out = [...list];
	for (let i = out.length - 1; i > 0; i--) {
		const j = Math.floor(rng() * (i + 1));
		[out[i], out[j]] = [out[j], out[i]];
	}
	return out;
}

function keys(answers: readonly ConjugationAnswer[]): Set<string> {
	return new Set(answers.flatMap((a) => [normaliseAnswer(a.written), normaliseAnswer(a.reading)]));
}

function overlaps(a: readonly ConjugationAnswer[], b: readonly ConjugationAnswer[]): boolean {
	const k = keys(a);
	return [...keys(b)].some((x) => k.has(x));
}

/** produceChoices: the canonical written answer of the form and of up to three other forms that are not right too. */
export function produceChoices(word: ConjugationWord, form: string, rng: Rng): string[] {
	const right = word.forms[form] ?? [];
	const others = Object.entries(word.forms).filter(([id, answers]) => id !== form && !overlaps(right, answers));
	const seen = new Set([shownAnswer(right).written]);
	const wrong: string[] = [];
	for (const [, answers] of shuffled(others, rng)) {
		const w = shownAnswer(answers).written;
		if (seen.has(w)) continue;
		seen.add(w);
		wrong.push(w);
		if (wrong.length === 3) break;
	}
	return shuffled([shownAnswer(right).written, ...wrong], rng);
}

/** recogniseChoices: up to four form ids (the asked form among them) and every form id that is right. */
export function recogniseChoices(word: ConjugationWord, form: string, rng: Rng): { options: string[]; right: string[] } {
	const shown = keys([shownAnswer(word.forms[form] ?? [])]);
	const right = Object.keys(word.forms).filter((id) => [...keys(word.forms[id])].some((k) => shown.has(k)));
	const wrong = shuffled(
		Object.keys(word.forms).filter((id) => !right.includes(id)),
		rng
	).slice(0, 3);
	return { options: shuffled([form, ...wrong], rng), right: orderLike(right, Object.keys(word.forms)) };
}

function orderLike(list: string[], order: string[]): string[] {
	return [...list].sort((a, b) => order.indexOf(a) - order.indexOf(b));
}
