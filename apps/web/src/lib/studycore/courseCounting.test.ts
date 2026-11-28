// docs/contracts/courses/counting.json, the web's part: which course events are steps, the EXP of a step and the
// streak (#225). The activity cases are the server's (Go).

import { describe, expect, it } from 'vitest';

import countingFixture from '../../../../../docs/contracts/courses/counting.json';
import type { StudyEvent } from '$lib/events';
import { grammarPayload } from '$lib/events/eventPayloads';
import { studyDay, type ZoneChange } from '$lib/time/studyDay';
import * as build from '$lib/testing/study';
import { COURSE_STEP_XP, courseStepOf, courseStepsOf } from './courseCounting';
import { dailyStreak, xpFromReviews } from './exp';
import { parseGrammarRun, type GrammarRun } from './grammarRuns';
import { parseReview } from './reviewParse';
import type { ReviewEvent } from './types';

interface Fixture {
	rule: string;
	constants: { stepXp: number };
	steps: { name: string; event: StudyEvent; expect: string[] | null }[];
	xp: { name: string; history: ZoneChange[]; events: StudyEvent[]; lessons: string[]; expect: number }[];
	streak: {
		name: string;
		now: string;
		zone: string;
		vacation: { start: string; end: string }[];
		reviews: string[];
		lessons: string[];
		drills: string[];
		course: ({ ts: string } & Record<string, unknown>)[];
		expect: { current: number; best: number; todayDone: boolean };
	}[];
}
const fixture = countingFixture as unknown as Fixture;
const WS = 7;

function lessonRun(n: number, ts: string): GrammarRun {
	return parseGrammarRun({ id: build.eventId(900 + n), workspaceId: WS, ts, type: 'grammar', payload: grammarPayload('p', 'l', 1, 1) })!;
}

describe('docs/contracts/courses/counting.json', () => {
	it('is the counting rule with the EXP of a step', () => {
		expect(fixture.rule).toBe('courses/counting');
		expect(COURSE_STEP_XP).toBe(fixture.constants.stepXp);
	});

	for (const c of fixture.steps) {
		it(`step: ${c.name}`, () => {
			expect(courseStepOf(c.event)?.item ?? null).toEqual(c.expect);
		});
	}

	for (const c of fixture.xp) {
		it(`xp: ${c.name}`, () => {
			const reviews = c.events.map((e) => (e.type === 'review' ? parseReview(e) : null)).filter((r): r is ReviewEvent => r !== null);
			const lessons = c.lessons.map((ts, i) => lessonRun(i + 1, ts));
			expect(xpFromReviews(reviews, studyDay(c.history).dayOf, lessons, [], courseStepsOf(WS, c.events))).toBe(c.expect);
		});
	}

	for (const c of fixture.streak) {
		it(`streak: ${c.name}`, () => {
			const day = studyDay([{ zone: c.zone, from: null }]);
			const reviews = c.reviews.map((ts, i) => build.review({ id: build.eventId(i + 1), cardId: `c${i}`, ts, grade: 3 }));
			const lessons = c.lessons.map((ts, i) => lessonRun(i + 1, ts));
			const drills = c.drills.map((ts) => ({ at: Date.parse(ts) }));
			const events: StudyEvent[] = c.course.map(({ ts, ...payload }, i) => ({ id: build.eventId(700 + i), workspaceId: WS, device: 'web', ts, type: 'course', payload }));
			expect(dailyStreak(reviews, Date.parse(c.now), day, c.vacation, lessons, drills, courseStepsOf(WS, events))).toEqual(c.expect);
		});
	}

	it('keeps a workspace’s steps in replay order', () => {
		const ev = (n: number, ts: string, ws = WS): StudyEvent => ({
			id: build.eventId(n),
			workspaceId: ws,
			device: 'web',
			ts,
			type: 'course',
			payload: { kind: 'unit-test', course: 'c', unit: 'u', score: 1, total: 1, passed: true, early: false }
		});
		const steps = courseStepsOf(WS, [ev(3, '2026-01-02T00:00:00Z'), ev(1, '2026-01-01T00:00:00Z'), ev(2, '2026-01-01T00:00:00Z', 8)]);
		expect(steps.map((s) => s.id)).toEqual([build.eventId(1), build.eventId(3)]);
	});
});
