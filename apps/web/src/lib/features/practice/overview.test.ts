import { describe, expect, it } from 'vitest';
import { drillAnswersOf, drillStates } from '$lib/studycore/drills';
import { IDENTITY_CLOCK } from '$lib/studycore/studyClock';
import type { StudyEvent } from '$lib/events';
import { drillSummary, roundOf, weakestRound } from './overview';

let n = 0;
function answer(drill: string, item: string, grade: number, ts: string): StudyEvent {
	n++;
	return { id: `01KB0000000000000000000${String(n).padStart(3, '0')}`, workspaceId: 7, device: 'web', ts, type: `drill.${drill}`, payload: { item, mode: 'produce', grade } };
}
const NOW = Date.parse('2026-11-28T12:00:00Z');
const states = drillStates(
	drillAnswersOf(7, [
		answer('sample', 'a', 1, '2026-11-28T08:00:00Z'),
		answer('sample', 'b', 4, '2026-11-28T11:59:00Z'),
		answer('sample', 'gone', 1, '2026-11-28T08:00:00Z'),
		answer('other', 'x', 1, '2026-11-20T08:00:00Z')
	]),
	IDENTITY_CLOCK
);

describe('drillSummary', () => {
	it('counts the candidate items by their state', () => {
		expect(drillSummary('sample', ['a', 'b', 'c', 'd'], states, NOW)).toEqual({ total: 4, due: 1, seen: 2, fresh: 2 });
	});

	it('counts nothing for a drill without items', () => {
		expect(drillSummary('sample', [], states, NOW)).toEqual({ total: 0, due: 0, seen: 0, fresh: 0 });
	});
});

describe('the rounds', () => {
	const items = (keys: string[]) => keys.map((key) => ({ key }));

	it('a drill round is its pick, with the items the drill gave', () => {
		const round = roundOf('sample', items(['a', 'b', 'c']), states, NOW, IDENTITY_CLOCK);
		expect(round.map((e) => [e.drill, e.item.key])).toEqual([
			['sample', 'a'],
			['sample', 'c'],
			['sample', 'b']
		]);
	});

	it('the weakest round crosses drills and keeps only items still offered', () => {
		const round = weakestRound(
			[
				{ drill: 'sample', items: items(['a', 'b']) },
				{ drill: 'other', items: items(['x']) }
			],
			states,
			NOW,
			IDENTITY_CLOCK
		);
		expect(round.map((e) => [e.drill, e.item.key])).toEqual([
			['other', 'x'],
			['sample', 'a'],
			['sample', 'b']
		]);
	});
});
