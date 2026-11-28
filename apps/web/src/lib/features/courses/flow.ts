// The lesson flows of the course player (#222, Rulings 13–25): what a lesson of each kind shows, step by step, and
// the questions of its short check; the unit test and section exam (the entry point #224 replaces); how a finished
// run is scored and graded. Pure and deterministic for a seed: the components only show the steps.

import type { Course, CourseLesson, CourseUnit } from '$lib/api/courses';
import { shuffleTokens } from '$lib/exercises/wordSalad';

/** A word as a lesson shows it: its course word plus the first gloss of its dictionary entry (null: not loaded). */
export interface WordInfo {
	key: string;
	form: string;
	reading: string;
	entryId: number;
	gloss: string | null;
}

export type QuestionType = 'meaning' | 'form' | 'listen';

export interface Question {
	id: string;
	type: QuestionType;
	/** The word's key. */
	word: string;
	/** meaning: the form; form: the gloss; listen: the form, spoken (never shown before the answer). */
	prompt: string;
	answer: string;
	choices: string[];
}

export type Step =
	| { kind: 'intro'; word: string }
	| { kind: 'character'; char: string }
	| { kind: 'scripts'; scripts: string[] }
	| { kind: 'grammar'; point: string; available: boolean }
	| { kind: 'reading' }
	| { kind: 'say'; word: string }
	| { kind: 'note'; note: 'noWords' | 'noVoice' }
	| { kind: 'question'; question: Question };

export interface LessonFlow {
	steps: Step[];
	/** The words the finished lesson records (Ruling 24). */
	words: string[];
	/** Finishing adds the words as cards with their first review (Ruling 16). */
	cards: boolean;
}

export interface TestFlow {
	steps: Step[];
	passPercent: number;
}

/** A lesson as the player gets it: a lesson of the unit, or one of its catch-up lessons (kind `words`). */
export type FlowLesson = CourseLesson;

export interface FlowInput {
	course: Course;
	info: ReadonlyMap<string, WordInfo>;
	/** Words the learner met (the derived state's `met`). */
	met: ReadonlySet<string>;
	/** A voice can speak the language (the listening questions). */
	voice: boolean;
	seed: string;
	/** The script lesson's characters, as dictionary entries where found. */
	characters?: ReadonlyMap<string, WordInfo>;
}

/** The most choices a question shows. */
export const CHOICES = 4;
/** The most words a listening or speaking lesson goes through. */
const MAX_SOUND_WORDS = 10;

/** shortGloss: the first sense's text up to its first `;` (Ruling 14); null without one. */
export function shortGloss(senses: readonly { gloss: string }[]): string | null {
	const first = senses[0]?.gloss.split(';')[0]?.trim() ?? '';
	return first === '' ? null : first;
}

function findUnit(course: Course, id: string): { unit: CourseUnit; section: Course['sections'][number] } | null {
	for (const section of course.sections) for (const unit of section.units) if (unit.id === id) return { unit, section };
	return null;
}

/** The words other choices come from, nearest first: the unit's, then the section's, then the course's (Ruling 13). */
function pool(course: Course, unitId: string, info: ReadonlyMap<string, WordInfo>): WordInfo[][] {
	const at = findUnit(course, unitId);
	const tiers: string[][] = [];
	if (at) {
		tiers.push(at.unit.words.map((w) => w.key));
		tiers.push(at.section.units.flatMap((u) => u.words.map((w) => w.key)));
	}
	tiers.push(course.sections.flatMap((s) => s.units.flatMap((u) => u.words.map((w) => w.key))));
	const seen = new Set<string>();
	return tiers.map((keys) => {
		const out: WordInfo[] = [];
		for (const k of keys) {
			const w = info.get(k);
			if (w === undefined || seen.has(k)) continue;
			seen.add(k);
			out.push(w);
		}
		return out;
	});
}

function question(type: QuestionType, w: WordInfo, others: readonly (readonly WordInfo[])[], seed: string, n: number): Question {
	const value = (x: WordInfo) => (type === 'meaning' ? x.gloss : x.form);
	const answer = value(w)!;
	// Each tier shuffled for the question, the nearest tier first.
	const ordered = others.flatMap((tier, i) => shuffleTokens([...tier], `${seed}:${w.key}:${type}:${n}:${i}`));
	const near = [...new Set(ordered.filter((o) => o.key !== w.key).map(value).filter((v): v is string => v !== null && v !== answer))].slice(0, CHOICES - 1);
	return {
		id: `${type}:${w.key}:${n}`,
		type,
		word: w.key,
		prompt: type === 'form' ? w.gloss! : w.form,
		answer,
		choices: shuffleTokens([answer, ...near], `${seed}:${w.key}:${type}:${n}:order`)
	};
}

function asked(words: readonly WordInfo[]): WordInfo[] {
	return words.filter((w) => w.gloss !== null);
}

/** checkQuestions: one meaning question per word, then form questions up to `count`, at most two per word. */
function checkQuestions(words: readonly WordInfo[], others: readonly (readonly WordInfo[])[], count: number, seed: string): Step[] {
	const ws = asked(words);
	const steps: Step[] = ws.map((w, i) => ({ kind: 'question', question: question('meaning', w, others, seed, i) }));
	const total = Math.min(Math.max(ws.length, count), 2 * ws.length);
	for (let i = 0; steps.length < total; i++) steps.push({ kind: 'question', question: question('form', ws[i % ws.length], others, seed, ws.length + i) });
	return steps;
}

function infos(keys: readonly string[], info: ReadonlyMap<string, WordInfo>): WordInfo[] {
	return keys.map((k) => info.get(k)).filter((w): w is WordInfo => w !== undefined);
}

/** buildLessonFlow: the steps of one lesson of a unit; null for a unit the course does not have. */
export function buildLessonFlow(input: FlowInput & { unit: string; lesson: FlowLesson }): LessonFlow | null {
	const at = findUnit(input.course, input.unit);
	if (at === null) return null;
	const { unit } = at;
	const { lesson, info, seed } = input;
	const others = pool(input.course, unit.id, info);
	const lessonQuestions = input.course.checkpoints.lesson.questions;
	const unitWords = infos(
		unit.words.map((w) => w.key),
		info
	);
	const none: LessonFlow = { steps: [], words: [], cards: false };
	switch (lesson.kind) {
		case 'words': {
			const words = infos(lesson.words, info);
			const steps: Step[] = lesson.words.map((word) => ({ kind: 'intro', word }));
			steps.push(...checkQuestions(words, others, lessonQuestions, seed));
			return { steps, words: [...lesson.words], cards: true };
		}
		case 'script': {
			const steps: Step[] = lesson.characters.map((char) => ({ kind: 'character', char }));
			if (lesson.scripts.length > 0) steps.push({ kind: 'scripts', scripts: [...lesson.scripts] });
			const chars = asked(lesson.characters.map((c) => input.characters?.get(c)).filter((w): w is WordInfo => w !== undefined));
			const charPool = [chars, ...others];
			chars.forEach((w, i) => steps.push({ kind: 'question', question: question('meaning', w, charPool, seed, i) }));
			return { ...none, steps };
		}
		case 'grammar':
			return { ...none, steps: [{ kind: 'grammar', point: lesson.point, available: lesson.available }] };
		case 'reading':
			return { ...none, steps: [{ kind: 'reading' }] };
		case 'practice': {
			const metWords = unitWords.filter((w) => input.met.has(w.key));
			const ws = asked(metWords.length > 0 ? metWords : unitWords);
			if (ws.length === 0) return { ...none, steps: [{ kind: 'note', note: 'noWords' }] };
			const types: QuestionType[] = input.voice ? ['meaning', 'form', 'listen'] : ['meaning', 'form'];
			const order = shuffleTokens(ws, `${seed}:practice`);
			const steps: Step[] = [];
			for (let i = 0; i < 2 * lessonQuestions; i++) {
				steps.push({ kind: 'question', question: question(types[i % types.length], order[i % order.length], others, seed, i) });
			}
			return { ...none, steps };
		}
		case 'listening': {
			const ws = unitWords.slice(0, MAX_SOUND_WORDS);
			if (ws.length === 0) return { ...none, steps: [{ kind: 'note', note: 'noWords' }] };
			if (!input.voice) return { ...none, steps: [{ kind: 'note', note: 'noVoice' }] };
			return { ...none, steps: ws.map((w, i) => ({ kind: 'question', question: question('listen', w, others, seed, i) })) };
		}
		case 'speaking': {
			const ws = unitWords.slice(0, MAX_SOUND_WORDS);
			if (ws.length === 0) return { ...none, steps: [{ kind: 'note', note: 'noWords' }] };
			return { ...none, steps: ws.map((w) => ({ kind: 'say', word: w.key })) };
		}
	}
}

function testSteps(words: readonly WordInfo[], others: readonly (readonly WordInfo[])[], count: number, seed: string): Step[] {
	const ws = shuffleTokens(asked(words), `${seed}:test`);
	const steps: Step[] = [];
	const total = Math.min(count, 2 * ws.length);
	for (let i = 0; i < total; i++) {
		const type: QuestionType = i < ws.length ? 'meaning' : 'form';
		steps.push({ kind: 'question', question: question(type, ws[i % ws.length], others, seed, i) });
	}
	return steps;
}

/** buildTestFlow: the unit test over the unit's words (Ruling 25); null for an unknown unit. */
export function buildTestFlow(input: FlowInput & { unit: string }): TestFlow | null {
	const at = findUnit(input.course, input.unit);
	if (at === null) return null;
	const words = infos(
		at.unit.words.map((w) => w.key),
		input.info
	);
	const { questions, passPercent } = input.course.checkpoints.unit;
	return { steps: testSteps(words, pool(input.course, at.unit.id, input.info), questions, input.seed), passPercent };
}

/** buildExamFlow: the section exam over the section's words (Ruling 25); null for an unknown section. */
export function buildExamFlow(input: FlowInput & { section: string }): TestFlow | null {
	const section = input.course.sections.find((s) => s.id === input.section);
	if (section === undefined) return null;
	const keys = [...new Set(section.units.flatMap((u) => u.words.map((w) => w.key)))];
	const words = infos(keys, input.info);
	const { questions, passPercent } = input.course.checkpoints.section;
	return { steps: testSteps(words, [words, ...pool(input.course, '', input.info)], questions, input.seed), passPercent };
}

export interface Answer {
	word: string;
	right: boolean;
	/** A wrong question asked once more at the end (Ruling 15); it does not count in the score. */
	retry: boolean;
}

/** scoreOf: first tries right of all first tries. */
export function scoreOf(results: readonly Answer[]): { score: number; total: number } {
	const first = results.filter((r) => !r.retry);
	return { score: first.filter((r) => r.right).length, total: first.length };
}

/** wordGrades: Good (3) for a word whose every first try was right (or that was not asked), else Hard (2). */
export function wordGrades(words: readonly string[], results: readonly Answer[]): Map<string, 2 | 3> {
	const wrong = new Set(results.filter((r) => !r.retry && !r.right).map((r) => r.word));
	return new Map(words.map((w) => [w, wrong.has(w) ? 2 : 3]));
}

/** passed: the score reaches the pass mark; a test with nothing to ask passes. */
export function passed(score: number, total: number, passPercent: number): boolean {
	return total === 0 || score * 100 >= passPercent * total;
}
