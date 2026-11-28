import { describe, expect, it } from 'vitest';

import deriveFixture from '../../../../../docs/contracts/courses/derive.json';
import changesFixture from '../../../../../docs/contracts/courses/changes.json';
import type { StudyEvent } from '$lib/events';
import { coursePayload, type CoursePayload } from '$lib/events/eventPayloads';
import { COURSE_EVENT, deriveCourseState, parseCourseEvent, type DeriveCourse } from './courseProgress';
import { historyOf } from './readModel';

interface DeriveCase {
	name: string;
	course: DeriveCourse;
	events: Omit<StudyEvent, 'workspaceId' | 'device'>[];
	known: string[];
	expect: unknown;
}
interface Fixture {
	rule: string;
	course: string;
	build?: { name: string; builder: 'coursePayload'; args: [CoursePayload]; expect: unknown }[];
	cases: DeriveCase[];
}
const derive = deriveFixture as unknown as Fixture;
const changes = changesFixture as unknown as Fixture;

const asEvents = (events: DeriveCase['events']): StudyEvent[] => events.map((e) => ({ ...e, workspaceId: 1, device: 'web' }));

describe('docs/contracts/courses/derive.json build', () => {
	for (const c of derive.build ?? []) {
		it(c.name, () => {
			expect(c.builder).toBe('coursePayload');
			const built = coursePayload(...c.args);
			// Member order is part of the shape: the server stores the JSON text as sent.
			expect(JSON.stringify(built)).toBe(JSON.stringify(c.expect));
			expect(parseCourseEvent({ id: '01JD0000000000000000000001', ts: '2026-11-28T10:00:00Z', type: COURSE_EVENT, payload: built })).not.toBeNull();
		});
	}
});

for (const [file, fixture, rule] of [
	['derive.json', derive, 'courses/derive'],
	['changes.json', changes, 'courses/changes']
] as const) {
	describe(`docs/contracts/courses/${file}`, () => {
		it(`is the ${rule} rule`, () => {
			expect(fixture.rule).toBe(rule);
			expect(fixture.cases.length).toBeGreaterThanOrEqual(5);
		});
		for (const c of fixture.cases) {
			it(c.name, () => {
				const state = deriveCourseState(c.course, fixture.course, asEvents(c.events), c.known);
				// The same JSON as the server's Derive, member order included.
				expect(JSON.stringify(state)).toBe(JSON.stringify(c.expect));
			});
		}
	});
}

describe('the study history carries the course events (#222)', () => {
	it('historyOf keeps the workspace course events, readable or not, in log order', () => {
		const lesson: StudyEvent = {
			id: 'c1',
			workspaceId: 7,
			device: 'web',
			ts: '2026-11-28T08:00:00Z',
			type: 'course',
			payload: { kind: 'lesson-started', course: 'zh', unit: 'u', lesson: 'words-1' }
		};
		const other: StudyEvent = { ...lesson, id: 'c2', workspaceId: 8 };
		const grammar: StudyEvent = { ...lesson, id: 'g1', type: 'grammar' };
		const history = historyOf(7, { decks: [], cards: [] } as never, [lesson, other, grammar]);
		expect(history.courseEvents.map((e) => e.id)).toEqual(['c1']);
	});
});
