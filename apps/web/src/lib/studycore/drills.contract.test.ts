// docs/contracts/drills/: ids, item keys, the answer event, schedules, rounds (drills framework, v0.9.0).

import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import drillsFixture from '../../../../../docs/contracts/drills/drills.json';
import scheduleFixture from '../../../../../docs/contracts/drills/schedule.json';
import pickFixture from '../../../../../docs/contracts/drills/pick.json';
import { drillPayload } from '$lib/events/eventPayloads';
import type { StudyEvent } from '$lib/events';
import { DEFAULT_W } from './fsrsParams';
import { clockFromRuns } from './studyClock';
import {
	DRILL_EVENT_PREFIX,
	DRILL_FEATURE,
	DRILL_IDS,
	MAX_DRILL_ID_LENGTH,
	MAX_ITEM_LENGTH,
	NEW_PER_ROUND,
	RESERVED_DRILL_IDS,
	ROUND_SIZE,
	drillAnswersOf,
	drillEventType,
	drillStates,
	parseDrillAnswer,
	pickRound,
	pickWeakest,
	retrievability,
	stateOf,
	validDrillId,
	validItemKey
} from './drills';

interface DrillsFixture {
	rule: string;
	constants: { eventPrefix: string; feature: string; maxIdLength: number; maxItemLength: number; reservedIds: string[] };
	registry: string[];
	ids: { name: string; id: unknown; valid: boolean }[];
	items: { name: string; item: unknown; valid: boolean }[];
	build: { name: string; drill: string; item: string; mode: string; grade: 1 | 2 | 3 | 4; expect: { type: string; payload: unknown } }[];
	parse: { name: string; event: StudyEvent; expect: Record<string, unknown> | null }[];
}
const drills = drillsFixture as unknown as DrillsFixture;

interface ClockCase {
	a: string;
	days: number;
}
const clockOf = (runs: readonly ClockCase[]) => clockFromRuns(runs.map((r) => ({ a: Date.parse(r.a), n: r.days })));

interface ScheduleFixture {
	rule: string;
	weights: number[];
	cases: {
		name: string;
		now: string;
		clock: ClockCase[];
		events: StudyEvent[];
		items: { drill: string; item: string; due: string; stability: number; difficulty: number; state: number; answers: number; retrievability: number }[];
	}[];
}
const schedule = scheduleFixture as unknown as ScheduleFixture;

interface PickFixture {
	rule: string;
	constants: { roundSize: number; newPerRound: number };
	round: { name: string; now: string; drill: string; items: string[]; events: StudyEvent[]; expect: { item: string; why: string }[] }[];
	weakest: { name: string; now: string; candidates: { drill: string; items: string[] }[]; events: StudyEvent[]; expect: { drill: string; item: string }[] }[];
}
const pick = pickFixture as unknown as PickFixture;

const WS = 7;

describe('docs/contracts/drills/drills.json', () => {
	it('is the drills rule, with the constants and the registry of this client', () => {
		expect(drills.rule).toBe('drills/drills');
		expect(DRILL_EVENT_PREFIX).toBe(drills.constants.eventPrefix);
		expect(DRILL_FEATURE).toBe(drills.constants.feature);
		expect(MAX_DRILL_ID_LENGTH).toBe(drills.constants.maxIdLength);
		expect(MAX_ITEM_LENGTH).toBe(drills.constants.maxItemLength);
		expect([...RESERVED_DRILL_IDS]).toEqual(drills.constants.reservedIds);
		expect([...DRILL_IDS]).toEqual(drills.registry);
		for (const id of DRILL_IDS) expect(validDrillId(id), id).toBe(true);
	});

	for (const c of drills.ids) {
		it(`id: ${c.name}`, () => expect(validDrillId(c.id)).toBe(c.valid));
	}
	for (const c of drills.items) {
		it(`item: ${c.name}`, () => expect(validItemKey(c.item)).toBe(c.valid));
	}
	for (const c of drills.build) {
		it(`build: ${c.name}`, () => {
			expect(drillEventType(c.drill)).toBe(c.expect.type);
			// Member order is part of the shape: the server stores the JSON text as sent.
			expect(JSON.stringify(drillPayload(c.item, c.mode, c.grade))).toBe(JSON.stringify(c.expect.payload));
		});
	}
	for (const c of drills.parse) {
		it(`parse: ${c.name}`, () => {
			const answer = parseDrillAnswer(c.event);
			if (c.expect === null) {
				expect(answer).toBeNull();
				return;
			}
			expect(answer).toEqual({
				id: c.event.id,
				workspaceId: c.event.workspaceId,
				ts: c.event.ts,
				at: Date.parse(c.event.ts),
				...c.expect
			});
		});
	}
});

describe('the generated fixtures', () => {
	it('schedule.json and pick.json are what the oracle writes', () => {
		const repo = resolve(__dirname, '../../../../..');
		// Exits 1 (and throws here) when a file differs from a fresh run.
		execFileSync(process.execPath, [resolve(repo, 'scripts/contracts/gen-drills-fixtures.mjs'), '--check'], { cwd: repo, stdio: 'pipe' });
	});
});

describe('docs/contracts/drills/schedule.json', () => {
	it('is the schedule rule with the default weights', () => {
		expect(schedule.rule).toBe('drills/schedule');
		expect(schedule.weights).toEqual([...DEFAULT_W]);
		expect(schedule.cases.length).toBeGreaterThanOrEqual(5);
	});

	for (const c of schedule.cases) {
		it(c.name, () => {
			const clock = clockOf(c.clock);
			const now = Date.parse(c.now);
			const states = drillStates(drillAnswersOf(WS, c.events), clock);
			expect(states.size).toBe(c.items.length);
			for (const want of c.items) {
				const got = stateOf(states, want.drill, want.item);
				expect(got, `${want.drill} ${want.item}`).toBeDefined();
				expect(Date.parse(got!.due)).toBe(Date.parse(want.due));
				expect(got!.stability).toBeCloseTo(want.stability, 8);
				expect(got!.difficulty).toBeCloseTo(want.difficulty, 8);
				expect(got!.state).toBe(want.state);
				expect(got!.answers).toBe(want.answers);
				expect(retrievability(got!, now, clock)).toBeCloseTo(want.retrievability, 8);
			}
		});
	}
});

describe('docs/contracts/drills/pick.json', () => {
	it('is the pick rule with the round constants', () => {
		expect(pick.rule).toBe('drills/pick');
		expect(ROUND_SIZE).toBe(pick.constants.roundSize);
		expect(NEW_PER_ROUND).toBe(pick.constants.newPerRound);
	});

	const clock = clockFromRuns([]);
	for (const c of pick.round) {
		it(`round: ${c.name}`, () => {
			const states = drillStates(drillAnswersOf(WS, c.events), clock);
			expect(pickRound(c.drill, c.items, states, Date.parse(c.now), clock)).toEqual(c.expect);
		});
	}
	for (const c of pick.weakest) {
		it(`weakest: ${c.name}`, () => {
			const states = drillStates(drillAnswersOf(WS, c.events), clock);
			expect(pickWeakest(c.candidates, states, Date.parse(c.now), clock)).toEqual(c.expect);
		});
	}
});
