import { describe, expect, it } from 'vitest';
import fixture from '../../../../../docs/contracts/goals/flower-stages.json';
import type { GoalDay } from './progress';
import { FLOWER_STAGES, flowerStage } from './stage';

// docs/contracts/goals/flower-stages.json: the stage a goal day shows.
describe('flower-stages.json', () => {
	it('names the stages in order', () => {
		expect([...FLOWER_STAGES]).toEqual(fixture.stages);
	});

	it.each(fixture.cases.map((c) => [c.name, c] as const))('%s', (_n, c) => {
		expect(flowerStage(c.day as GoalDay)).toBe(c.expect);
	});
});
