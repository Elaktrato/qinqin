// docs/contracts/graded/level-rule.json: how a graded text is counted against a word level list (the same counting a
// "read next" score uses, #183).
import { describe, expect, it } from 'vitest';
import fixture from '../../../../../../../docs/contracts/graded/level-rule.json';
import {
	MAX_ABOVE,
	MIN_COVERAGE_PERCENT,
	checkText,
	type LevelToken
} from './levelRule';

describe('graded level rule (contract)', () => {
	it('uses the fixture numbers', () => {
		expect(fixture.rule).toBe('graded/level-rule');
		expect(MIN_COVERAGE_PERCENT).toBe(fixture.minCoveragePercent);
		expect(MAX_ABOVE).toBe(fixture.maxAbove);
	});
	for (const c of fixture.cases) {
		it(c.name, () => {
			const r = checkText(
				c.text,
				c.names,
				c.tokens as LevelToken[],
				c.levels,
				c.declared,
				c.glosses
			);
			expect(r).toEqual(c.want);
		});
	}
});
