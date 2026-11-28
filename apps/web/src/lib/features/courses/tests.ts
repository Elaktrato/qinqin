// The course's unit tests and section exams (#224, rules: docs/contracts/courses/README.md "Tests and exams",
// fixture tests.json; plan docs/superpowers/plans/2026-11-28-224-course-tests.md). A test mixes word questions
// (meaning, form, reading, listening), the grammar lessons' own gap exercises and gaps in the unit's reading text.
// The word questions are sampled with the level check's planner (#82, lib/placement/levelCheck.ts): stratified over
// the unit's word lessons or the section's units, seeded with the placement test's generator, words the app already
// calls known left out first. Judging, the placement exams' early stop and the placement chain live here too. Pure
// and deterministic for a seed.

import type { Course, CourseSection, CourseUnit, CourseWord } from '$lib/api/courses';
import { blankSpans, pickDistractors } from '$lib/exercises/cloze';
import { markedSyllable, parsePinyin, type Tone } from '$lib/exercises/tones';
import { shuffleTokens } from '$lib/exercises/wordSalad';
import { planCheck } from '$lib/placement/levelCheck';
import { EMPTY_KNOWN_INDEX, familiarity, type KnownIndex } from '$lib/studycore/known';
import { CHOICES, choicePool, findUnit, question, type Answer, type Question, type Step, type WordInfo } from './flow';

/** A fill-the-gap item of a grammar lesson (grammar's cloze exercise), as a test asks it. */
export interface GapItem {
	id: string;
	before: string;
	after: string;
	answer: string;
	choices: string[];
	translation: string | null;
	/** The grammar lesson's title (the review list names it). */
	title?: string;
}

export interface TestInput {
	course: Course;
	info: ReadonlyMap<string, WordInfo>;
	/** The shared known predicate's index (lib/studycore/known.ts). */
	index: KnownIndex;
	/** A device voice can speak the language. */
	voice: boolean;
	/** Whether the learner's romanisation setting shows this reading (#284). */
	readingShown: (reading: string) => boolean;
	/** The gap items of the installed grammar lessons, by point. */
	grammar: ReadonlyMap<string, readonly GapItem[]>;
	seed: string;
}

export interface TestFlow {
	steps: Step[];
	passPercent: number;
}

/** The share of a test each of grammar and text may take: a fifth (Ruling 1). */
const PART = 5;

/** budget: how many questions a test gives its words, grammar and text (Ruling 1). */
export function budget(have: { questions: number; words: number; grammar: number; text: number }): { words: number; grammar: number; text: number } {
	const part = Math.ceil(have.questions / PART);
	let grammar = Math.min(have.grammar, part);
	let text = Math.min(have.text, part);
	const share = Math.max(0, have.questions - grammar - text);
	const words = Math.min(share, 2 * have.words);
	let left = share - words;
	const moreGrammar = Math.min(have.grammar - grammar, left);
	grammar += moreGrammar;
	left -= moreGrammar;
	text += Math.min(have.text - text, left);
	return { words, grammar, text };
}

/** A string seed as the planner's number (FNV-1a). */
function seedNumber(seed: string): number {
	let h = 0x811c9dc5;
	for (let i = 0; i < seed.length; i++) {
		h ^= seed.charCodeAt(i);
		h = Math.imul(h, 0x01000193);
	}
	return h >>> 0;
}

/**
 * sampleWords: up to `size` entries of the strata, with the level check's planner: each stratum an even share of the
 * entries the app does not call known; known ones fill only what is left (Ruling 2).
 */
export function sampleWords(strata: readonly (readonly number[])[], index: KnownIndex, size: number, seed: number): { perStratum: number[][] } {
	const perStratum: number[][] = strata.map(() => []);
	if (strata.length === 0 || size <= 0) return { perStratum };
	const levels = (lists: readonly (readonly number[])[]) => lists.map((entryIds, i) => ({ id: i, name: String(i), entryIds }));
	const first = planCheck({ levels: levels(strata), target: strata.length, index, seed, sampleSize: size });
	first.sample.forEach((id, i) => perStratum[first.sampleLevel[i]].push(id));
	const left = size - first.sample.length;
	if (left > 0) {
		const proven = strata.map((list) => list.filter((id) => familiarity(id, index) === 'known'));
		const second = planCheck({ levels: levels(proven), target: proven.length, index: EMPTY_KNOWN_INDEX, seed: (seed ^ 0x5bd1e995) >>> 0, sampleSize: left });
		second.sample.forEach((id, i) => {
			if (!perStratum.some((s) => s.includes(id))) perStratum[second.sampleLevel[i]].push(id);
		});
	}
	return { perStratum };
}

const TONES: Tone[] = [1, 2, 3, 4];

/** toneVariants: a pinyin reading's answer form and its one-tone-changed variants, in order (Ruling 4). */
export function toneVariants(reading: string): { answer: string | null; variants: string[] } {
	const syllables = parsePinyin(reading);
	if (syllables.length === 0) return { answer: null, variants: [] };
	const texts = syllables.map((s) => s.text);
	const answer = texts.join(' ');
	const variants: string[] = [];
	syllables.forEach((s, j) => {
		for (const tone of TONES) {
			if (tone === s.tone) continue;
			const v = [...texts];
			v[j] = markedSyllable(s.plain, tone);
			const text = v.join(' ');
			if (text !== answer && !variants.includes(text)) variants.push(text);
		}
	});
	return { answer, variants };
}

const SENTENCE = /[^。！？!?\n]+[。！？!?]*/gu;

/** sentencesOf: a reading text cut into sentences (Ruling 6). */
export function sentencesOf(text: string): string[] {
	return [...text.matchAll(SENTENCE)].map((m) => m[0].trim()).filter((s) => s !== '');
}

const LETTER = /\p{L}/gu;

/** textGap: a gap for `form` in the sentence with three wrong choices, or null (Ruling 6). */
export function textGap(sentence: string, form: string, candidates: readonly string[], seed: string): Omit<GapItem, 'id' | 'translation'> | null {
	const span = blankSpans(sentence, { id: -1, written: form }, [])[0];
	if (span === undefined) return null;
	const chars = [...sentence];
	const before = chars.slice(0, span.start).join('');
	const after = chars.slice(span.end).join('');
	if (((before + after).match(LETTER)?.length ?? 0) < 2) return null;
	const wrong = pickDistractors({ answer: form, sentence, candidates, seed });
	if (wrong.length < CHOICES - 1) return null;
	return { before, after, answer: form, choices: shuffleTokens([form, ...wrong], `${seed}:order`) };
}

/** judge: the one pass rule of every test (Ruling 9). */
export function judge(score: number, total: number, passPercent: number): boolean {
	return total === 0 || score * 100 >= passPercent * total;
}

/** decide: a placement exam's result once it cannot change (Ruling 14); null while open. */
export function decide(score: number, asked: number, total: number, passPercent: number): 'pass' | 'fail' | null {
	if (score * 100 >= passPercent * total) return 'pass';
	if ((score + (total - asked)) * 100 < passPercent * total) return 'fail';
	return null;
}

type ExamSection = Pick<CourseSection, 'id' | 'exam'>;

/** placementFirst: the section placement starts at, the first with an exam; null when none has one. */
export function placementFirst(sections: readonly ExamSection[]): string | null {
	return sections.find((s) => s.exam)?.id ?? null;
}

export type PlacementStep = { next: string | null; start: string | null } | { place: string };

/** placementNext: after a placement exam of `section`, what comes next (Ruling 13). */
export function placementNext(sections: readonly ExamSection[], section: string, passed: boolean): PlacementStep {
	const at = sections.findIndex((s) => s.id === section);
	if (passed) {
		return { next: sections.slice(at + 1).find((s) => s.exam)?.id ?? null, start: sections[at + 1]?.id ?? null };
	}
	return { place: section === placementFirst(sections) ? (sections[0]?.id ?? section) : section };
}

// --- Assembly ---

interface Part {
	unit: CourseUnit;
	/** The unit's words as strata (a unit test: its word lessons). */
	strata: CourseWord[][];
}

function hasHan(text: string): boolean {
	return /\p{Script=Han}/u.test(text);
}

/** The reading question of a word, or null when its language or its reading gives none (Ruling 4). */
function readingQuestion(course: Course, w: WordInfo, others: readonly (readonly WordInfo[])[], seed: string, n: number, shown: (r: string) => boolean): Question | null {
	if (w.reading === '' || !shown(w.reading)) return null;
	let answer: string;
	let wrong: string[];
	if (course.language === 'zh') {
		const tones = toneVariants(w.reading);
		if (tones.answer === null) return null;
		answer = tones.answer;
		wrong = shuffleTokens(tones.variants, `${seed}:${w.key}:reading:${n}`).slice(0, CHOICES - 1);
	} else if (course.language === 'ja') {
		if (!hasHan(w.form) || w.reading === w.form) return null;
		answer = w.reading;
		const ordered = others.flatMap((tier, i) => shuffleTokens([...tier], `${seed}:${w.key}:reading:${n}:${i}`));
		wrong = [...new Set(ordered.filter((o) => o.key !== w.key && o.reading !== '' && o.reading !== answer).map((o) => o.reading))].slice(0, CHOICES - 1);
	} else return null;
	if (wrong.length < CHOICES - 1) return null;
	return { id: `reading:${w.key}:${n}`, type: 'reading', word: w.key, prompt: w.form, answer, choices: shuffleTokens([answer, ...wrong], `${seed}:${w.key}:reading:${n}:order`) };
}

type WordType = 'meaning' | 'form' | 'reading' | 'listen';

function wordQuestion(input: TestInput, w: WordInfo, others: readonly (readonly WordInfo[])[], n: number): Question {
	const types: WordType[] = ['meaning', 'form', 'reading', 'listen'];
	for (let k = 0; k < types.length; k++) {
		const type = types[(n + k) % types.length];
		if (type === 'listen' && !input.voice) continue;
		if (type === 'reading') {
			const q = readingQuestion(input.course, w, others, input.seed, n, input.readingShown);
			if (q !== null) return q;
			continue;
		}
		return question(type, w, others, input.seed, n);
	}
	return question('meaning', w, others, input.seed, n);
}

/** Round robin over lists: the first of each, then the second of each, … */
function roundRobin<T>(lists: readonly (readonly T[])[]): T[] {
	const out: T[] = [];
	for (let i = 0; lists.some((l) => i < l.length); i++) for (const l of lists) if (i < l.length) out.push(l[i]);
	return out;
}

function grammarItems(parts: readonly Part[], grammar: TestInput['grammar']): { unit: string; point: string; item: GapItem }[][] {
	const out: { unit: string; point: string; item: GapItem }[][] = [];
	const seen = new Set<string>();
	for (const { unit } of parts) {
		for (const point of unit.grammar) {
			if (seen.has(point)) continue;
			seen.add(point);
			out.push((grammar.get(point) ?? []).map((item) => ({ unit: unit.id, point, item })));
		}
	}
	return out;
}

function textItems(course: Course, parts: readonly Part[], seed: string): { unit: string; word: string; gap: Omit<GapItem, 'id' | 'translation'> }[][] {
	const all = course.sections.flatMap((s) => s.units.flatMap((u) => u.words.map((w) => w.form)));
	return parts.map(({ unit }) => {
		if (unit.text === null) return [];
		const section = course.sections.find((s) => s.units.some((u) => u.id === unit.id))!;
		// Wrong choices from the nearest words that give three: the unit's, then with the section's, then the course's.
		const own = unit.words.map((w) => w.form);
		const near = [...own, ...section.units.flatMap((u) => u.words.map((w) => w.form))];
		const tiers = [own, near, [...near, ...all]];
		const used = new Set<string>();
		const out: { unit: string; word: string; gap: Omit<GapItem, 'id' | 'translation'> }[] = [];
		for (const sentence of sentencesOf(unit.text.body)) {
			for (const w of unit.words) {
				if (used.has(w.key)) continue;
				let gap: Omit<GapItem, 'id' | 'translation'> | null = null;
				for (const candidates of tiers) {
					gap = textGap(sentence, w.form, candidates, `${seed}:${unit.id}:${w.key}`);
					if (gap !== null || blankSpans(sentence, { id: -1, written: w.form }, []).length === 0) break;
				}
				if (gap === null) continue;
				used.add(w.key);
				out.push({ unit: unit.id, word: w.key, gap });
				break;
			}
		}
		return out;
	});
}

/** No two questions in a row on the same word, where a later one can be swapped in (Ruling 8). */
function spread(steps: Step[]): Step[] {
	const out = [...steps];
	const wordOf = (s: Step) => (s.kind === 'question' ? s.question.word : '');
	for (let i = 1; i < out.length; i++) {
		if (wordOf(out[i]) !== wordOf(out[i - 1])) continue;
		const j = out.findIndex((s, k) => k > i && wordOf(s) !== wordOf(out[i - 1]) && (k + 1 >= out.length || wordOf(out[k + 1]) !== wordOf(out[i])));
		const at = j >= 0 ? j : out.findIndex((s, k) => k > i && wordOf(s) !== wordOf(out[i - 1]));
		if (at >= 0) [out[i], out[at]] = [out[at], out[i]];
	}
	return out;
}

function assemble(input: TestInput, parts: readonly Part[], questions: number, poolUnit: string): Step[] {
	const { info, seed } = input;
	// The askable words: those with a gloss, in their strata, each once (its first stratum).
	const strata: WordInfo[][] = [];
	const unitOf = new Map<string, string>();
	const seen = new Set<string>();
	for (const part of parts) {
		for (const list of part.strata) {
			const ws: WordInfo[] = [];
			for (const w of list) {
				const wi = info.get(w.key);
				if (wi === undefined || wi.gloss === null || seen.has(w.key)) continue;
				seen.add(w.key);
				unitOf.set(w.key, part.unit.id);
				ws.push(wi);
			}
			strata.push(ws);
		}
	}
	const askable = strata.flat();
	const grammar = roundRobin(grammarItems(parts, input.grammar));
	const text = roundRobin(textItems(input.course, parts, seed));
	const split = budget({ questions, words: askable.length, grammar: grammar.length, text: text.length });

	// The word sample: the level check's planner over the strata, by entry.
	const byEntry = new Map<number, WordInfo>();
	for (const w of askable) if (!byEntry.has(w.entryId)) byEntry.set(w.entryId, w);
	const firstRound = Math.min(split.words, byEntry.size);
	const picked = sampleWords(
		strata.map((ws) => ws.map((w) => w.entryId)),
		input.index,
		firstRound,
		seedNumber(seed)
	);
	const sampled = roundRobin(picked.perStratum).map((id) => byEntry.get(id)!);
	const words: WordInfo[] = [];
	for (let i = 0; words.length < split.words && sampled.length > 0; i++) words.push(sampled[i % sampled.length]);

	const others = (key: string) => choicePool(input.course, poolUnit === '' ? (unitOf.get(key) ?? '') : poolUnit, info);
	const steps: Step[] = words.map((w, n) => ({ kind: 'question', question: { ...wordQuestion(input, w, others(w.key), n), unit: unitOf.get(w.key) } }));
	grammar.slice(0, split.grammar).forEach(({ unit, point, item }) => {
		steps.push({
			kind: 'question',
			question: {
				id: `grammar:${point}:${item.id}`,
				type: 'grammar',
				word: point,
				point,
				prompt: item.translation ?? '',
				answer: item.answer,
				choices: shuffleTokens([...item.choices], `${seed}:${point}:${item.id}`),
				gap: { before: item.before, after: item.after, translation: item.translation },
				unit
			}
		});
	});
	text.slice(0, split.text).forEach(({ unit, word, gap }) => {
		steps.push({
			kind: 'question',
			question: { id: `text:${unit}:${word}`, type: 'text', word, prompt: '', answer: gap.answer, choices: gap.choices, gap: { before: gap.before, after: gap.after, translation: null }, unit }
		});
	});
	return spread(shuffleTokens(steps, `${seed}:order`));
}

/** The unit's words by its word lessons (its strata); words in no lesson make one more. */
function lessonStrata(unit: CourseUnit): CourseWord[][] {
	const byKey = new Map(unit.words.map((w) => [w.key, w]));
	const out: CourseWord[][] = [];
	const inLesson = new Set<string>();
	for (const lesson of unit.lessons) {
		if (lesson.kind !== 'words') continue;
		const ws = lesson.words.map((k) => byKey.get(k)).filter((w): w is CourseWord => w !== undefined);
		ws.forEach((w) => inLesson.add(w.key));
		out.push(ws);
	}
	const rest = unit.words.filter((w) => !inLesson.has(w.key));
	if (rest.length > 0) out.push(rest);
	return out;
}

/** buildUnitTest: the unit test of a unit (Rulings 1–8); null for a unit the course does not have. */
export function buildUnitTest(input: TestInput & { unit: string }): TestFlow | null {
	const at = findUnit(input.course, input.unit);
	if (at === null) return null;
	const { questions, passPercent } = input.course.checkpoints.unit;
	const steps = at.unit.test ? assemble(input, [{ unit: at.unit, strata: lessonStrata(at.unit) }], questions, at.unit.id) : [];
	return { steps, passPercent };
}

/** buildSectionExam: the section exam, each unit a stratum (Ruling 7); null for a section the course does not have. */
export function buildSectionExam(input: TestInput & { section: string }): TestFlow | null {
	const section = input.course.sections.find((s) => s.id === input.section);
	if (section === undefined) return null;
	const { questions, passPercent } = input.course.checkpoints.section;
	const parts = section.units.map((unit) => ({ unit, strata: [unit.words] }));
	return { steps: assemble(input, parts, questions, ''), passPercent };
}

export interface Review {
	/** Word keys missed (word and text questions), in question order. */
	words: string[];
	/** Grammar points missed. */
	grammar: string[];
	/** The units with a miss, in course order. */
	units: string[];
}

/** reviewOf: what a finished test asks the learner to go back to (Ruling 11). */
export function reviewOf(course: Course, steps: readonly Step[], results: readonly Answer[]): Review {
	const byId = new Map(steps.flatMap((s) => (s.kind === 'question' ? [[s.question.id, s.question] as const] : [])));
	const words: string[] = [];
	const grammar: string[] = [];
	const units = new Set<string>();
	for (const r of results) {
		if (r.retry || r.right) continue;
		const q = byId.get(r.id);
		if (q === undefined) continue;
		if (q.unit) units.add(q.unit);
		const list = q.type === 'grammar' ? grammar : words;
		if (!list.includes(q.word)) list.push(q.word);
	}
	const order = course.sections.flatMap((s) => s.units.map((u) => u.id));
	return { words, grammar, units: order.filter((u) => units.has(u)) };
}

/**
 * wordsToLoad: the words whose dictionary entries a test needs before it is assembled (their glosses): a unit test
 * every word of its unit; an exam a stratified sample of its section (the same planner), `size` words (default
 * twice the questions, at least 20), so a section of hundreds of words costs a few dozen entry reads.
 */
export function wordsToLoad(course: Course, scope: { unit: string } | { section: string }, index: KnownIndex, seed: string, size?: number): CourseWord[] {
	if ('unit' in scope) return [...(findUnit(course, scope.unit)?.unit.words ?? [])];
	const section = course.sections.find((s) => s.id === scope.section);
	if (section === undefined) return [];
	const want = size ?? Math.max(2 * course.checkpoints.section.questions, 20);
	const byEntry = new Map<number, CourseWord>();
	for (const u of section.units) for (const w of u.words) if (!byEntry.has(w.entryId)) byEntry.set(w.entryId, w);
	const picked = sampleWords(
		section.units.map((u) => u.words.map((w) => w.entryId)),
		index,
		Math.min(want, byEntry.size),
		seedNumber(`${seed}:load`)
	);
	return roundRobin(picked.perStratum).map((id) => byEntry.get(id)!);
}
