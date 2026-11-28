import { describe, expect, it } from 'vitest';
import { applyResult, hintsOf, outcomeOf, requestHint, startQuiz } from './quiz';
import type { MatchResult } from './matcher';

const miss: MatchResult = { kind: 'miss', reason: 'shape' };
const hit = (...strokes: number[]): MatchResult => ({ kind: 'match', strokes, score: 0.1 });

describe('quiz', () => {
	it('a join advances by 2 and snaps both', () => {
		const r = applyResult(startQuiz(4), hit(0, 1));
		expect(r.state.next).toBe(2);
		expect(r.state.done).toEqual([0, 1]);
		expect(r.effect).toEqual({ snap: [0, 1] });
	});
	it('three misses glow the next stroke and leave only it traced, never the outline', () => {
		let s = startQuiz(3);
		let e;
		for (let i = 0; i < 2; i++) ({ state: s, effect: e } = applyResult(s, miss));
		expect(e).toEqual({ miss: true });
		expect(s.trace).toBeNull();
		({ state: s, effect: e } = applyResult(s, miss));
		expect(e).toEqual({ miss: true, glow: 0 });
		expect(s.trace).toBe(0);
		expect(s).not.toHaveProperty('outline');
		// A fourth miss on the same stroke adds nothing: the trace is still there.
		({ state: s, effect: e } = applyResult(s, miss));
		expect(e).toEqual({ miss: true });
		expect(s.trace).toBe(0);
		expect(s.mistakes).toBe(4);
		expect(hintsOf(s)).toBe(1);
	});
	it('the trace goes once the stroke is drawn', () => {
		let s = startQuiz(3);
		for (let i = 0; i < 3; i++) s = applyResult(s, miss).state;
		s = applyResult(s, hit(0)).state;
		expect(s.trace).toBeNull();
	});
	it('a join that covers the traced stroke clears it', () => {
		let s = applyResult(startQuiz(4), hit(0)).state;
		for (let i = 0; i < 3; i++) s = applyResult(s, miss).state;
		expect(s.trace).toBe(1);
		s = applyResult(s, hit(1, 2)).state;
		expect(s.trace).toBeNull();
		expect(s.next).toBe(3);
	});
	it('applies again to a later stroke that gets three misses, one hint each', () => {
		let s = startQuiz(4);
		for (let i = 0; i < 3; i++) s = applyResult(s, miss).state;
		s = applyResult(s, hit(0)).state;
		s = applyResult(s, hit(1)).state;
		let e;
		for (let i = 0; i < 2; i++) ({ state: s, effect: e } = applyResult(s, miss));
		expect(e).toEqual({ miss: true });
		({ state: s, effect: e } = applyResult(s, miss));
		expect(e).toEqual({ miss: true, glow: 2 });
		expect(s.trace).toBe(2);
		expect(s.autoHints).toBe(2);
		expect(hintsOf(s)).toBe(2);
		expect(s.mistakes).toBe(6);
	});
	it('misses spread over strokes do not add up to a hint', () => {
		let s = startQuiz(3);
		for (let i = 0; i < 2; i++) s = applyResult(s, miss).state;
		s = applyResult(s, hit(0)).state;
		const r = applyResult(s, miss);
		expect(r.effect).toEqual({ miss: true });
		expect(r.state.trace).toBeNull();
		expect(hintsOf(r.state)).toBe(0);
	});
	it('mistakesOnStroke resets on match', () => {
		let s = applyResult(startQuiz(3), miss).state;
		s = applyResult(s, hit(0)).state;
		expect(s.mistakesOnStroke).toBe(0);
	});
	it('counts manual and auto hints', () => {
		let s = startQuiz(3);
		for (let i = 0; i < 3; i++) s = applyResult(s, miss).state;
		const h1 = requestHint(s);
		expect(h1.glow).toBe(0);
		const h2 = requestHint(h1.state);
		expect(hintsOf(h2.state)).toBe(3);
	});
	it('outcomeOf reports the character', () => {
		const s = applyResult(startQuiz(2), miss).state;
		expect(outcomeOf('好', s, true)).toEqual({ char: '好', mistakes: 1, strokes: 2, revealed: true });
	});
	it('ignores results after completion and ignored results', () => {
		const s0 = startQuiz(1);
		expect(applyResult(s0, { kind: 'ignored' })).toEqual({ state: s0, effect: { none: true } });
		const done = applyResult(s0, hit(0)).state;
		expect(done.complete).toBe(true);
		const r = applyResult(done, miss);
		expect(r.state).toEqual(done);
		expect(r.effect).toEqual({ none: true });
	});
});
