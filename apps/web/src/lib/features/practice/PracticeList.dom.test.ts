// The Practice list hands a drill that has an overview (the tone-pair grid) its items, its own answers, the states
// and the clock's now (docs/contracts/drills/README.md, "Adding a drill").
import { cleanup, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import { drillAnswersOf, drillStates } from '$lib/studycore/drills';
import { IDENTITY_CLOCK } from '$lib/studycore/studyClock';
import { testContext } from '$lib/testing/context';
import OverviewStub from './OverviewStub.test.svelte';
import PracticeList from './PracticeList.svelte';
import { sampleDrill } from './sample/sampleDrill';
import type { DrillDef } from './types';

afterEach(cleanup);

const NOW = Date.parse('2026-11-28T12:00:00Z');
const event = (n: number, type: string, item: string) => ({
	id: `01KB0000000000000000000${n}`,
	workspaceId: 1,
	device: 'web',
	ts: '2026-11-28T10:00:00Z',
	type,
	payload: { item, mode: 'self', grade: 3 }
});
const answers = drillAnswersOf(1, [event(1, 'drill.sample', 'sample-1'), event(2, 'drill.other', 'x')]);
const states = drillStates(answers, IDENTITY_CLOCK);

describe('a drill overview on the Practice list', () => {
	it("gets the drill's items, its own answers, the states and now", () => {
		const drill: DrillDef = { ...sampleDrill, overview: OverviewStub };
		render(PracticeList, {
			props: {
				summaries: [{ drill, summary: { total: 2, due: 0, seen: 1, fresh: 1 }, items: [{ key: 'sample-1' }, { key: 'sample-2' }], answers: answers.filter((a) => a.drill === 'sample') }],
				weakestCount: 1,
				states,
				now: NOW
			},
			context: testContext().context
		});
		expect(screen.getByTestId('overview').textContent).toBe(`sample: 2 items, 1 answers, 2 states, ${NOW}`);
	});

	it('shows nothing for a drill without one', () => {
		render(PracticeList, {
			props: { summaries: [{ drill: sampleDrill, summary: { total: 1, due: 0, seen: 0, fresh: 1 }, items: [{ key: 'sample-1' }], answers: [] }], weakestCount: 0, states, now: NOW },
			context: testContext().context
		});
		expect(screen.queryByTestId('overview')).toBeNull();
	});
});
