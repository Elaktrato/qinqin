// docs/contracts/drills/counting.json, the web's part: drill answers earn EXP and keep the streak.

import { describe, expect, it } from 'vitest';

import countingFixture from '../../../../../docs/contracts/drills/counting.json';
import type { StudyEvent } from '$lib/events';
import { grammarPayload } from '$lib/events/eventPayloads';
import { studyDay, type ZoneChange } from '$lib/time/studyDay';
import * as build from '$lib/testing/study';
import { DRILL_ANSWER_XP, drillAnswersOf } from './drills';
import { GRADE_BONUS, dailyStreak, xpFromReviews } from './exp';
import { parseGrammarRun, type GrammarRun } from './grammarRuns';
import { parseReview } from './reviewParse';
import type { ReviewEvent } from './types';

interface Fixture {
	rule: string;
	constants: { answerXp: number; gradeBonus: Record<string, number> };
	xp: { name: string; history: ZoneChange[]; events: StudyEvent[]; lessons: string[]; expect: number }[];
	streak: {
		name: string;
		now: string;
		zone: string;
		vacation: { start: string; end: string }[];
		reviews: string[];
		lessons: string[];
		drills: string[];
		expect: { current: number; best: number; todayDone: boolean };
	}[];
}
const fixture = countingFixture as unknown as Fixture;
const WS = 7;

function lessonRun(n: number, ts: string): GrammarRun {
	return parseGrammarRun({ id: build.eventId(900 + n), workspaceId: WS, ts, type: 'grammar', payload: grammarPayload('p', 'l', 1, 1) })!;
}

function drillEvent(n: number, ts: string): StudyEvent {
	return { id: build.eventId(500 + n), workspaceId: WS, device: 'web', ts, type: 'drill.tone-pairs', payload: { item: '3-4', mode: 'produce', grade: 3 } };
}

describe('docs/contracts/drills/counting.json', () => {
	it('is the counting rule with the EXP of an answer', () => {
		expect(fixture.rule).toBe('drills/counting');
		expect(DRILL_ANSWER_XP).toBe(fixture.constants.answerXp);
		expect(GRADE_BONUS).toEqual(fixture.constants.gradeBonus);
	});

	for (const c of fixture.xp) {
		it(`xp: ${c.name}`, () => {
			const reviews = c.events.map((e) => (e.type === 'review' ? parseReview(e) : null)).filter((r): r is ReviewEvent => r !== null);
			const lessons = c.lessons.map((ts, i) => lessonRun(i + 1, ts));
			expect(xpFromReviews(reviews, studyDay(c.history).dayOf, lessons, drillAnswersOf(WS, c.events))).toBe(c.expect);
		});
	}

	for (const c of fixture.streak) {
		it(`streak: ${c.name}`, () => {
			const day = studyDay([{ zone: c.zone, from: null }]);
			const reviews = c.reviews.map((ts, i) => build.review({ id: build.eventId(i + 1), cardId: `c${i}`, ts, grade: 3 }));
			const lessons = c.lessons.map((ts, i) => lessonRun(i + 1, ts));
			const answers = drillAnswersOf(WS, c.drills.map((ts, i) => drillEvent(i + 1, ts)));
			expect(dailyStreak(reviews, Date.parse(c.now), day, c.vacation, lessons, answers)).toEqual(c.expect);
		});
	}
});
