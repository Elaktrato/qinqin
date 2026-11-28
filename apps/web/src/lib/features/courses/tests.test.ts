import { describe, expect, it } from 'vitest';
import fixture from '../../../../../../docs/contracts/courses/tests.json';
import { EMPTY_KNOWN_INDEX, type KnownIndex } from '$lib/studycore/known';
import type { Question, Step, WordInfo } from './flow';
import {
	budget,
	buildSectionExam,
	buildUnitTest,
	decide,
	judge,
	placementFirst,
	placementNext,
	reviewOf,
	sampleWords,
	sentencesOf,
	textGap,
	wordsToLoad,
	toneVariants,
	type GapItem
} from './tests';
import { testCourse } from './testing/course';

const marks = (ids: number[]): KnownIndex => ({ ...EMPTY_KNOWN_INDEX, marks: new Set(ids) });

describe('docs/contracts/courses/tests.json', () => {
	it('budget', () => {
		for (const c of fixture.budget.cases) {
			expect(budget({ questions: c.questions, words: c.words, grammar: c.grammar, text: c.text }), c.name).toEqual(c.expect);
		}
	});

	it('sample: the level check planner over the strata, unproven words first', () => {
		for (const c of fixture.sample.cases) {
			const picked = sampleWords(c.strata, marks(c.known), c.size, 7);
			expect(
				picked.perStratum.map((p) => p.length),
				c.name
			).toEqual(c.expect.perStratum);
			const all = picked.perStratum.flat();
			expect(new Set(all).size, c.name).toBe(all.length);
			for (const id of c.expect.includes) expect(all, c.name).toContain(id);
			// Deterministic for a seed.
			expect(sampleWords(c.strata, marks(c.known), c.size, 7)).toEqual(picked);
		}
	});

	it('tones', () => {
		for (const c of fixture.tones.cases) {
			expect(toneVariants(c.reading)).toEqual({ answer: c.answer, variants: c.variants });
		}
	});

	it('sentences', () => {
		for (const c of fixture.sentences.cases) expect(sentencesOf(c.text)).toEqual(c.expect);
	});

	it('gap', () => {
		for (const c of fixture.gap.cases) {
			const gap = textGap(c.sentence, c.form, c.candidates, 's');
			if (c.expect === null) expect(gap, c.name).toBeNull();
			else {
				expect(gap, c.name).toMatchObject({ before: c.expect.before, after: c.expect.after, answer: c.form });
				expect(gap!.choices, c.name).toHaveLength(c.expect.choices + 1);
				expect(gap!.choices).toContain(c.form);
				for (const choice of gap!.choices) if (choice !== c.form) expect(c.sentence.includes(choice)).toBe(false);
			}
		}
	});

	it('judge', () => {
		for (const c of fixture.judge.cases) expect(judge(c.score, c.total, c.passPercent)).toBe(c.passed);
	});

	it('decide', () => {
		for (const c of fixture.decide.cases) expect(decide(c.score, c.asked, c.total, c.passPercent)).toBe(c.expect);
	});

	it('placement', () => {
		const sections = fixture.placement.sections;
		expect(placementFirst(sections)).toBe(fixture.placement.first);
		for (const c of fixture.placement.cases) expect(placementNext(sections, c.section, c.passed)).toEqual(c.expect);
	});
});

const course = testCourse();
const GLOSS: Record<string, string> = { 你好: 'hello', 谢谢: 'thanks', 学习: 'to study', 银行: 'bank', 中国: 'China' };
const info = new Map<string, WordInfo>(
	course.sections.flatMap((s) => s.units.flatMap((u) => u.words)).map((w) => [w.key, { key: w.key, form: w.form, reading: w.reading, entryId: w.entryId, gloss: GLOSS[w.key] ?? null }])
);
const grammarItem: GapItem = { id: 'ex1', before: '我', after: '学生。', answer: '是', choices: ['是', '有', '在'], translation: 'I am a student.' };
const base = { course, info, index: EMPTY_KNOWN_INDEX, voice: false, readingShown: () => true, grammar: new Map([['g:shi', [grammarItem]]]), seed: 's' };
const questions = (steps: Step[]) => steps.filter((s): s is { kind: 'question'; question: Question } => s.kind === 'question').map((s) => s.question);

describe('unit tests and section exams (#224)', () => {
	it('a unit test mixes the unit words, its grammar and its text, up to the question count', () => {
		const flow = buildUnitTest({ ...base, unit: 'hello' })!;
		const qs = questions(flow.steps);
		expect(flow.passPercent).toBe(80);
		expect(flow.steps.every((s) => s.kind === 'question')).toBe(true);
		const types = qs.map((q) => q.type);
		expect(types.filter((t) => t === 'grammar')).toHaveLength(1);
		// 你好！谢谢！ has no sentence with context: no text question.
		expect(types).not.toContain('text');
		// Two words, two questions each.
		expect(qs.filter((q) => q.type !== 'grammar')).toHaveLength(4);
		expect(new Set(qs.filter((q) => q.type !== 'grammar').map((q) => q.word))).toEqual(new Set(['你好', '谢谢']));
		for (const q of qs) {
			expect(q.choices).toContain(q.answer);
			expect(new Set(q.choices).size).toBe(q.choices.length);
			expect(q.unit).toBe('hello');
		}
		const grammar = qs.find((q) => q.type === 'grammar')!;
		expect(grammar).toMatchObject({ word: 'g:shi', point: 'g:shi', answer: '是', gap: { before: '我', after: '学生。', translation: 'I am a student.' } });
		expect(buildUnitTest({ ...base, unit: 'hello' })).toEqual(flow);
	});

	it('word questions rotate meaning, form, reading (and listening with a voice); no reading with pinyin hidden', () => {
		const types = (over: Partial<typeof base>) => new Set(questions(buildUnitTest({ ...base, ...over, unit: 'hello' })!.steps).map((q) => q.type));
		expect(types({})).toEqual(new Set(['meaning', 'form', 'reading', 'grammar']));
		expect(types({ readingShown: () => false })).toEqual(new Set(['meaning', 'form', 'grammar']));
		const reading = questions(buildUnitTest({ ...base, unit: 'hello' })!.steps).find((q) => q.type === 'reading')!;
		expect(reading.prompt).toBe(info.get(reading.word)!.form);
		expect(reading.answer).toBe(info.get(reading.word)!.reading);
		expect(reading.choices).toHaveLength(4);
		const voiced = questions(buildUnitTest({ ...base, voice: true, course: { ...course, checkpoints: { ...course.checkpoints, unit: { questions: 20, passPercent: 80 } } }, unit: 'money' })!.steps);
		expect(voiced.map((q) => q.type)).toContain('listen');
	});

	it('words the app already calls known are asked only when nothing else is left', () => {
		const small = { ...course, checkpoints: { ...course.checkpoints, unit: { questions: 1, passPercent: 80 } } };
		const qs = questions(buildUnitTest({ ...base, grammar: new Map(), course: small, index: marks([101]), unit: 'hello' })!.steps);
		expect(qs.map((q) => q.word)).toEqual(['谢谢']);
	});

	it('a text question is a gap in a sentence of the unit text', () => {
		const withText = structuredClone(course);
		withText.sections[2].units[0].text = { title: '银行', body: '我在银行工作。' };
		withText.sections[1].units[1].words.push({ key: '工作', form: '工作', reading: 'gōng zuò', entryId: 106, rank: null, topics: [] });
		const qs = questions(buildUnitTest({ ...base, course: withText, unit: 'money' })!.steps);
		const text = qs.find((q) => q.type === 'text')!;
		expect(text).toMatchObject({ word: '银行', answer: '银行', gap: { before: '我在', after: '工作。' }, unit: 'money' });
		expect(text.choices).not.toContain('工作');
	});

	it('the section exam samples over its units and judges at the section mark', () => {
		const exam = buildSectionExam({ ...base, section: 'level-1' })!;
		const qs = questions(exam.steps);
		expect(exam.passPercent).toBe(75);
		expect(new Set(qs.filter((q) => q.type !== 'grammar').map((q) => q.word))).toEqual(new Set(['你好', '谢谢', '学习']));
		expect(qs.find((q) => q.word === '学习')!.unit).toBe('study');
		expect(qs.some((q) => q.type === 'grammar')).toBe(true);
		expect(buildSectionExam({ ...base, section: 'nope' })).toBeNull();
		expect(buildUnitTest({ ...base, unit: 'nope' })).toBeNull();
		expect(buildUnitTest({ ...base, unit: 'sounds' })!.steps).toEqual([]);
	});

	it('no two questions in a row ask about the same word when it can be helped', () => {
		const qs = questions(buildUnitTest({ ...base, unit: 'hello' })!.steps);
		for (let i = 1; i < qs.length; i++) expect(qs[i].word).not.toBe(qs[i - 1].word);
	});

	it('what to review: the missed words and grammar points, and the units with misses', () => {
		const exam = buildSectionExam({ ...base, section: 'level-1' })!;
		const qs = questions(exam.steps);
		const results = qs.map((q) => ({ id: q.id, word: q.word, right: q.word !== '学习' && q.type !== 'grammar', retry: false }));
		expect(reviewOf(course, exam.steps, results)).toEqual({ words: ['学习'], grammar: ['g:shi'], units: ['hello', 'study'] });
		expect(reviewOf(course, exam.steps, qs.map((q) => ({ id: q.id, word: q.word, right: true, retry: false })))).toEqual({ words: [], grammar: [], units: [] });
	});

	it('wordsToLoad: a unit test loads its unit words; an exam a stratified sample of its section, before any gloss is known', () => {
		expect(wordsToLoad(course, { unit: 'hello' }, EMPTY_KNOWN_INDEX, 's').map((w) => w.key)).toEqual(['你好', '谢谢']);
		expect(wordsToLoad(course, { section: 'level-1' }, EMPTY_KNOWN_INDEX, 's').map((w) => w.key).sort()).toEqual(['你好', '学习', '谢谢'].sort());
		const two = wordsToLoad(course, { section: 'level-1' }, EMPTY_KNOWN_INDEX, 's', 2).map((w) => w.key);
		expect(two).toHaveLength(2);
		expect(two).toContain('学习');
		expect(wordsToLoad(course, { section: 'nope' }, EMPTY_KNOWN_INDEX, 's')).toEqual([]);
	});
});
