import { describe, expect, it } from 'vitest';
import type { Question, Step } from './flow';
import { FlowRun } from './run.svelte';

const q = (word: string): Step => ({ kind: 'question', question: { id: `meaning:${word}:0`, type: 'meaning', word, prompt: word, answer: `${word}!`, choices: [`${word}!`, 'x'] } });

describe('FlowRun: one pass through a lesson (#222)', () => {
	it('walks the steps; a question needs an answer before it can move on', () => {
		const run = new FlowRun([{ kind: 'intro', word: 'a' }, q('a')], { retry: true });
		expect(run.step).toEqual({ kind: 'intro', word: 'a' });
		expect(run.canContinue).toBe(true);
		run.next();
		expect(run.step?.kind).toBe('question');
		expect(run.canContinue).toBe(false);
		expect(run.answer('a!')).toBe(true);
		expect(run.chosen).toBe('a!');
		expect(run.canContinue).toBe(true);
		run.next();
		expect(run.done).toBe(true);
		expect(run.results).toEqual([{ word: 'a', right: true, retry: false }]);
		expect(run.progress).toBe(1);
	});

	it('a wrong answer comes back once at the end (lessons); a second answer to one question is ignored', () => {
		const run = new FlowRun([q('a'), q('b')], { retry: true });
		expect(run.answer('x')).toBe(false);
		expect(run.answer('a!')).toBe(false);
		run.next();
		run.answer('b!');
		run.next();
		expect(run.done).toBe(false);
		expect((run.step as { question: Question }).question.word).toBe('a');
		expect(run.retrying).toBe(true);
		run.answer('x');
		run.next();
		expect(run.done).toBe(true);
		expect(run.results).toEqual([
			{ word: 'a', right: false, retry: false },
			{ word: 'b', right: true, retry: false },
			{ word: 'a', right: false, retry: true }
		]);
	});

	it('tests ask each question once', () => {
		const run = new FlowRun([q('a')], { retry: false });
		run.answer('x');
		run.next();
		expect(run.done).toBe(true);
	});

	it('progress counts the steps passed of all steps, and an empty flow is done at once', () => {
		const run = new FlowRun([q('a'), q('b')], { retry: true });
		expect(run.progress).toBe(0);
		run.answer('a!');
		run.next();
		expect(run.progress).toBe(0.5);
		expect(new FlowRun([], { retry: true }).done).toBe(true);
	});
});
