// docs/contracts/grammar/review.json: the spaced review of grammar points (#181).

import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import reviewFixture from '../../../../../docs/contracts/grammar/review.json';
import { grammarPayload } from '$lib/events/eventPayloads';
import type { StudyEvent } from '$lib/events';
import { studyDay } from '$lib/time/studyDay';
import { DEFAULT_W } from './fsrsParams';
import { clockFromRuns } from './studyClock';
import { grammarRunsOf } from './grammarRuns';
import {
	GRAMMAR_ROUND_SIZE,
	LEARNED_PERCENT,
	NEW_GRAMMAR_PER_DAY,
	REVIEW_EXERCISES,
	REVIEW_MODE,
	grammarPointStates,
	grammarReviewRound,
	isLearned,
	reviewPick,
	runGrade
} from './grammarReview';

interface PointView {
	point: string;
	learnedAt: string;
	reviews: number;
	lastReviewed: string | null;
	due: string;
	stability: number;
	difficulty: number;
	state: number;
}
interface Fixture {
	rule: string;
	constants: { learnedPercent: number; newPerDay: number; roundSize: number; exercisesPerReview: number; reviewMode: string };
	weights: number[];
	learned: { score: number; total: number; expect: boolean }[];
	grade: { score: number; total: number; expect: number }[];
	build: { name: string; args: [string, string, number, number]; expect: unknown }[];
	states: { name: string; clock: { a: string; days: number }[]; events: StudyEvent[]; expect: PointView[] }[];
	round: {
		name: string;
		now: string;
		zone: string;
		candidates: string[];
		events: StudyEvent[];
		expect: { items: { point: string; why: string }[]; due: number; new: number; newToday: number };
	}[];
	pick: { name: string; examples: { id: string; cloze: boolean; order: boolean }[]; reviews: number; expect: { example: string; kind: string }[] }[];
}
const fixture = reviewFixture as unknown as Fixture;
const WS = 7;
const clockOf = (runs: { a: string; days: number }[]) => clockFromRuns(runs.map((r) => ({ a: Date.parse(r.a), n: r.days })));

describe('docs/contracts/grammar/review.json', () => {
	it('is the review rule with its constants and the default weights', () => {
		expect(fixture.rule).toBe('grammar/review');
		expect(LEARNED_PERCENT).toBe(fixture.constants.learnedPercent);
		expect(NEW_GRAMMAR_PER_DAY).toBe(fixture.constants.newPerDay);
		expect(GRAMMAR_ROUND_SIZE).toBe(fixture.constants.roundSize);
		expect(REVIEW_EXERCISES).toBe(fixture.constants.exercisesPerReview);
		expect(REVIEW_MODE).toBe(fixture.constants.reviewMode);
		expect(fixture.weights).toEqual([...DEFAULT_W]);
	});

	it('is what the oracle writes', () => {
		const repo = resolve(__dirname, '../../../../..');
		execFileSync(process.execPath, [resolve(repo, 'scripts/contracts/gen-grammar-review-fixtures.mjs'), '--check'], { cwd: repo, stdio: 'pipe' });
	});

	for (const c of fixture.learned) {
		it(`learned: ${c.score}/${c.total}`, () => expect(isLearned(c.score, c.total)).toBe(c.expect));
	}
	for (const c of fixture.grade) {
		it(`grade: ${c.score}/${c.total}`, () => expect(runGrade(c.score, c.total)).toBe(c.expect));
	}
	for (const c of fixture.build) {
		it(`build: ${c.name}`, () => {
			expect(JSON.stringify(grammarPayload(...c.args, REVIEW_MODE))).toBe(JSON.stringify(c.expect));
		});
	}

	for (const c of fixture.states) {
		it(`states: ${c.name}`, () => {
			const states = grammarPointStates(grammarRunsOf(WS, c.events), clockOf(c.clock));
			const got = [...states.values()].sort((a, b) => (a.point < b.point ? -1 : a.point > b.point ? 1 : 0));
			expect(got.length).toBe(c.expect.length);
			got.forEach((s, i) => {
				const want = c.expect[i];
				expect(s.point).toBe(want.point);
				expect(s.learnedAt).toBe(want.learnedAt);
				expect(s.reviews).toBe(want.reviews);
				expect(s.lastReviewed).toBe(want.lastReviewed);
				expect(Date.parse(s.due)).toBe(Date.parse(want.due));
				expect(s.stability).toBeCloseTo(want.stability, 8);
				expect(s.difficulty).toBeCloseTo(want.difficulty, 8);
				expect(s.state).toBe(want.state);
			});
		});
	}

	for (const c of fixture.round) {
		it(`round: ${c.name}`, () => {
			const clock = clockFromRuns([]);
			const states = grammarPointStates(grammarRunsOf(WS, c.events), clock);
			const day = studyDay(c.zone === 'UTC' ? [] : [{ zone: c.zone, from: null }]);
			expect(grammarReviewRound(c.candidates, states, Date.parse(c.now), day)).toEqual(c.expect);
		});
	}

	for (const c of fixture.pick) {
		it(`pick: ${c.name}`, () => expect(reviewPick(c.examples, c.reviews)).toEqual(c.expect));
	}
});
