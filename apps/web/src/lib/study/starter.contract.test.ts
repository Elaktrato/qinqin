import { describe, expect, it } from 'vitest';

import fixture from '../../../../../docs/contracts/starter/stages.json';
import {
	MIN_GAP_MINUTES,
	STARTER_THRESHOLDS,
	finalStage,
	replayStarter,
	stageSpec,
	type StarterProfile,
	type StarterReview
} from './starter';
import type { ReviewGrade } from './types';

const toReviews = (list: { at: string; grade: number }[]): StarterReview[] =>
	list.map((r) => ({ at: r.at, grade: r.grade as ReviewGrade }));

describe('starter contract: the rule constants', () => {
	it('matches the fixture', () => {
		expect(MIN_GAP_MINUTES).toBe(fixture.minGapMinutes);
		expect(STARTER_THRESHOLDS).toEqual(fixture.thresholds);
	});

	it('has the pinned final stages', () => {
		expect(finalStage('ja', { usuallyKana: false })).toBe(fixture.finalStage.ja.normal);
		expect(finalStage('ja', { usuallyKana: true })).toBe(fixture.finalStage.ja.usuallyKana);
		expect(finalStage('zh', { usuallyKana: false })).toBe(fixture.finalStage.zh.normal);
		// usually-kana is a Japanese notion
		expect(finalStage('zh', { usuallyKana: true })).toBe(fixture.finalStage.zh.normal);
	});
});

describe('starter contract: what each stage shows', () => {
	for (const profile of ['ja', 'zh'] as StarterProfile[]) {
		for (const row of fixture.stages[profile]) {
			it(`${profile} stage ${row.stage}`, () => {
				const spec = stageSpec(profile, row.stage, { usuallyKana: false });
				expect(spec).toEqual(row);
			});
		}
	}

	it('a usually-kana word shows its kana as its normal card at stage 4', () => {
		expect(stageSpec('ja', 4, { usuallyKana: true })).toEqual(fixture.usuallyKanaLastStage);
	});
});

describe('starter contract: histories', () => {
	for (const h of fixture.histories) {
		it(h.name, () => {
			const got = replayStarter(h.profile as StarterProfile, { usuallyKana: 'usuallyKana' in h && h.usuallyKana === true }, toReviews(h.reviews));
			expect(got).toEqual(h.expect);
		});
	}
});
