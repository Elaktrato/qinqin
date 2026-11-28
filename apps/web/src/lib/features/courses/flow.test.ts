import { describe, expect, it } from 'vitest';
import { buildLessonFlow, scoreOf, shortGloss, wordGrades, type Question, type WordInfo } from './flow';
import { testCourse } from './testing/course';

const course = testCourse();
const GLOSS: Record<string, string> = { 你好: 'hello', 谢谢: 'thanks', 学习: 'to study', 银行: 'bank', 中国: 'China' };
const info = new Map<string, WordInfo>(
	course.sections.flatMap((s) => s.units.flatMap((u) => u.words)).map((w) => [w.key, { key: w.key, form: w.form, reading: w.reading, entryId: w.entryId, gloss: GLOSS[w.key] ?? null }])
);
const base = { course, info, met: new Set<string>(), voice: false, seed: 's' };
const questions = (steps: { kind: string }[]) => steps.filter((s): s is { kind: 'question'; question: Question } => s.kind === 'question').map((s) => s.question);

describe('lesson flows (#222)', () => {
	it('a word lesson introduces each word, then checks the meaning of each and the form up to the lesson count', () => {
		const flow = buildLessonFlow({ ...base, unit: 'hello', lesson: { id: 'words-1', kind: 'words', words: ['你好', '谢谢'] } })!;
		expect(flow.steps.slice(0, 2)).toEqual([
			{ kind: 'intro', word: '你好' },
			{ kind: 'intro', word: '谢谢' }
		]);
		const qs = questions(flow.steps);
		// 2 words, 5 questions asked, at most two per word: 4.
		expect(qs.map((q) => [q.type, q.word])).toEqual([
			['meaning', '你好'],
			['meaning', '谢谢'],
			['form', '你好'],
			['form', '谢谢']
		]);
		expect(flow.words).toEqual(['你好', '谢谢']);
		expect(flow.cards).toBe(true);
	});

	it('a question has the answer and up to three other choices from the unit, then the section and course, no duplicates', () => {
		const flow = buildLessonFlow({ ...base, unit: 'hello', lesson: { id: 'words-1', kind: 'words', words: ['你好', '谢谢'] } })!;
		const [meaning, , form] = questions(flow.steps);
		expect(meaning).toMatchObject({ prompt: '你好', answer: 'hello' });
		expect(meaning.choices).toHaveLength(4);
		expect(new Set(meaning.choices).size).toBe(4);
		expect(meaning.choices).toContain('hello');
		expect(meaning.choices).toContain('thanks');
		expect(form).toMatchObject({ prompt: 'hello', answer: '你好' });
		expect(form.choices).toContain('你好');
		// Deterministic for a seed.
		const again = buildLessonFlow({ ...base, unit: 'hello', lesson: { id: 'words-1', kind: 'words', words: ['你好', '谢谢'] } })!;
		expect(questions(again.steps)).toEqual(questions(flow.steps));
	});

	it('a word without a gloss is introduced but not asked (no entry offline, Ruling 9)', () => {
		const sparse = new Map(info);
		sparse.set('谢谢', { ...sparse.get('谢谢')!, gloss: null });
		const flow = buildLessonFlow({ ...base, info: sparse, unit: 'hello', lesson: { id: 'words-1', kind: 'words', words: ['你好', '谢谢'] } })!;
		expect(flow.steps.filter((s) => s.kind === 'intro')).toHaveLength(2);
		expect(questions(flow.steps).every((q) => q.word === '你好')).toBe(true);
	});

	it('a catch-up lesson is a word lesson over its words', () => {
		const flow = buildLessonFlow({ ...base, unit: 'hello', lesson: { id: 'catch-up-1', kind: 'words', words: ['谢谢'] } })!;
		expect(flow.steps[0]).toEqual({ kind: 'intro', word: '谢谢' });
		expect(flow.words).toEqual(['谢谢']);
	});

	it('practice mixes meaning and form (and listening with a voice) over the met words of the unit, twice the lesson count', () => {
		const met = new Set(['你好', '谢谢']);
		const flow = buildLessonFlow({ ...base, met, unit: 'hello', lesson: { id: 'practice', kind: 'practice' } })!;
		const qs = questions(flow.steps);
		expect(qs).toHaveLength(10);
		expect(new Set(qs.map((q) => q.type))).toEqual(new Set(['meaning', 'form']));
		expect(flow.words).toEqual([]);
		expect(flow.cards).toBe(false);
		const voiced = questions(buildLessonFlow({ ...base, met, voice: true, unit: 'hello', lesson: { id: 'practice', kind: 'practice' } })!.steps);
		expect(new Set(voiced.map((q) => q.type))).toEqual(new Set(['meaning', 'form', 'listen']));
		const listen = voiced.find((q) => q.type === 'listen')!;
		expect(listen.prompt).toBe(listen.answer);
	});

	it('practice with no met words of the unit falls back to all its words', () => {
		const qs = questions(buildLessonFlow({ ...base, unit: 'study', lesson: { id: 'practice', kind: 'practice' } })!.steps);
		expect(qs.every((q) => q.word === '学习')).toBe(true);
	});

	it('listening needs a voice and words; speaking says each word; a unit without words gets a note', () => {
		expect(buildLessonFlow({ ...base, unit: 'sounds', lesson: { id: 'listening', kind: 'listening' } })!.steps).toEqual([{ kind: 'note', note: 'noWords' }]);
		expect(buildLessonFlow({ ...base, unit: 'hello', lesson: { id: 'listening', kind: 'listening' } })!.steps).toEqual([{ kind: 'note', note: 'noVoice' }]);
		const listening = buildLessonFlow({ ...base, voice: true, unit: 'hello', lesson: { id: 'listening', kind: 'listening' } })!;
		expect(questions(listening.steps).map((q) => q.type)).toEqual(['listen', 'listen']);
		const speaking = buildLessonFlow({ ...base, unit: 'hello', lesson: { id: 'speaking', kind: 'speaking' } })!;
		expect(speaking.steps).toEqual([
			{ kind: 'say', word: '你好' },
			{ kind: 'say', word: '谢谢' }
		]);
	});

	it('script shows each character and the trainer for its scripts, then asks the meaning of characters with a gloss', () => {
		const chars = new Map<string, WordInfo>([['好', { key: '好', form: '好', reading: 'hǎo', entryId: 9, gloss: 'good' }]]);
		const flow = buildLessonFlow({ ...base, characters: chars, unit: 'hello', lesson: { id: 'script', kind: 'script', characters: ['好', '谢'], scripts: ['hiragana'] } })!;
		expect(flow.steps.slice(0, 3)).toEqual([
			{ kind: 'character', char: '好' },
			{ kind: 'character', char: '谢' },
			{ kind: 'scripts', scripts: ['hiragana'] }
		]);
		expect(questions(flow.steps).map((q) => [q.type, q.word])).toEqual([['meaning', '好']]);
	});

	it('grammar and reading are one step each', () => {
		expect(buildLessonFlow({ ...base, unit: 'hello', lesson: { id: 'grammar-shi', kind: 'grammar', point: 'g:shi', available: true } })!.steps).toEqual([
			{ kind: 'grammar', point: 'g:shi', available: true }
		]);
		expect(buildLessonFlow({ ...base, unit: 'hello', lesson: { id: 'reading', kind: 'reading' } })!.steps).toEqual([{ kind: 'reading' }]);
	});

	it('an unknown unit is null', () => {
		expect(buildLessonFlow({ ...base, unit: 'nope', lesson: { id: 'reading', kind: 'reading' } })).toBeNull();
	});

	it('scores count first tries; grades are Good for a word always right first, else Hard (Ruling 16)', () => {
		const results = [
			{ id: 'a', word: '你好', right: true, retry: false },
			{ id: 'b', word: '谢谢', right: false, retry: false },
			{ id: 'b', word: '谢谢', right: true, retry: true },
			{ id: 'a', word: '你好', right: true, retry: false }
		];
		expect(scoreOf(results)).toEqual({ score: 2, total: 3 });
		expect(wordGrades(['你好', '谢谢', '学习'], results)).toEqual(new Map([['你好', 3], ['谢谢', 2], ['学习', 3]]));
	});

	it('shortGloss: the first sense up to its first semicolon', () => {
		expect(shortGloss([{ gloss: 'hello; hi' }, { gloss: 'x' }])).toBe('hello');
		expect(shortGloss([{ gloss: '  ' }])).toBeNull();
		expect(shortGloss([])).toBeNull();
	});
});
