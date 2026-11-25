import { describe, expect, it } from 'vitest';
import { advance, isCorrect, startRun, submit } from './run';
import type { Question } from './types';

const choice: Question = { mode: 'recognise', system: 'hiragana', itemId: 'hiragana:あ', prompt: 'あ', speak: 'あ', options: ['a', 'i'], answer: 'a', accepts: ['a'] };
const typed: Question = { mode: 'type', system: 'cyrillic', itemId: 'cyrillic:Д', prompt: 'd', speak: null, options: [], answer: 'д', accepts: ['Д', 'д'] };

describe('run', () => {
	it('an empty round is done at once', () => {
		expect(startRun([]).done).toBe(true);
	});

	it('checks a choice exactly and a typed answer leniently', () => {
		expect(isCorrect(choice, 'a')).toBe(true);
		expect(isCorrect(choice, 'A')).toBe(false);
		expect(isCorrect(typed, ' д ')).toBe(true);
		expect(isCorrect(typed, 'г')).toBe(false);
	});

	it('walks a round: answer, then advance, then done', () => {
		let s = startRun([choice, typed]);
		s = submit(s, 'a');
		expect(s).toMatchObject({ answered: true, ok: true, right: 1, index: 0 });
		s = advance(s);
		expect(s).toMatchObject({ answered: false, ok: null, index: 1, done: false });
		s = submit(s, 'х');
		expect(s).toMatchObject({ ok: false, right: 1 });
		s = advance(s);
		expect(s.done).toBe(true);
	});

	it('does not count a question twice or skip one unanswered', () => {
		let s = startRun([choice, typed]);
		expect(advance(s)).toBe(s);
		s = submit(s, 'a');
		expect(submit(s, 'a').right).toBe(1);
		expect(submit(s, 'i')).toBe(s);
	});

	it('ignores input after the end', () => {
		let s = startRun([choice]);
		s = advance(submit(s, 'i'));
		expect(s.done).toBe(true);
		expect(submit(s, 'a')).toBe(s);
	});
});
