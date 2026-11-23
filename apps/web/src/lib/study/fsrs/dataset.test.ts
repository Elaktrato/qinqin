import { describe, expect, it } from 'vitest';

import type { ReviewEvent } from '../types';
import steps from '../../../../../../docs/contracts/scheduler/optimizer-steps.json';
import { buildDataset } from './dataset';
import { clockFromRuns, IDENTITY_CLOCK } from '../studyClock';
import * as build from '$lib/testing/study';

let n = 0;
function review(cardId: string, grade: number, ts: string, id?: string): ReviewEvent {
	n += 1;
	return build.review({ id: id ?? build.eventId(n), workspaceId: 7, ts, cardId, grade });
}

describe('buildDataset', () => {
	it('gives a once-reviewed card no labelled item', () => {
		const data = buildDataset([review('a', 3, '2026-01-01T10:00:00Z')], IDENTITY_CLOCK);
		expect(data.labelled).toBe(0);
		expect(data.cards).toEqual([
			{ cardId: 'a', steps: [{ t: 0, g: 3 }], days: [Date.UTC(2026, 0, 1) / 86_400_000] }
		]);
	});

	it('labels one item for Good, Good (same day), Again on day 3', () => {
		const data = buildDataset([
			review('a', 3, '2026-01-01T08:00:00Z'),
			review('a', 3, '2026-01-01T20:00:00Z'),
			review('a', 1, '2026-01-04T09:00:00Z')
		], IDENTITY_CLOCK);
		expect(data.labelled).toBe(1);
		expect(data.cards[0].steps).toEqual([
			{ t: 0, g: 3 },
			{ t: 0, g: 3 },
			{ t: 3, g: 1 }
		]);
	});

	it('skips invalid reviews', () => {
		const data = buildDataset([
			review('a', 3, '2026-01-01T08:00:00Z'),
			review('a', 9, '2026-01-02T08:00:00Z'),
			review('a', 3, 'not a date'),
			review('', 3, '2026-01-02T08:00:00Z')
		], IDENTITY_CLOCK);
		expect(data.cards).toEqual([
			{ cardId: 'a', steps: [{ t: 0, g: 3 }], days: [Date.UTC(2026, 0, 1) / 86_400_000] }
		]);
		expect(data.labelled).toBe(0);
	});

	it('orders by time then id, and cards by id', () => {
		const data = buildDataset([
			review('b', 3, '2026-01-01T08:00:00Z'),
			review('a', 4, '2026-01-02T08:00:00Z', '02'),
			review('a', 2, '2026-01-02T08:00:00Z', '01'),
			review('a', 3, '2026-01-01T08:00:00Z')
		], IDENTITY_CLOCK);
		expect(data.cards.map((c) => c.cardId)).toEqual(['a', 'b']);
		expect(data.cards[0].steps.map((s) => s.g)).toEqual([3, 2, 4]);
		expect(data.cards[0].steps.map((s) => s.t)).toEqual([0, 1, 0]);
		expect(data.labelled).toBe(1);
	});
});

describe('fixtures: optimizer steps on the study clock', () => {
	for (const c of steps.cases) {
		it(c.name, () => {
			const clock = clockFromRuns(c.runs.map((r) => ({ a: Date.parse(r.a), n: r.n })));
			const data = buildDataset(
				c.reviews.map((r, i) => review('c1', r.grade, r.ts, `01JFIX${String(i).padStart(20, '0')}`)),
				clock
			);
			expect(data.cards[0].steps).toEqual(c.steps);
			expect(data.labelled).toBe(c.labelled);
		});
	}

	it('keeps the training days real', () => {
		const clock = clockFromRuns([{ a: Date.parse('2026-01-04T15:00:00Z'), n: 7 }]);
		const data = buildDataset(
			[review('a', 3, '2026-01-02T03:00:00Z'), review('a', 3, '2026-01-13T03:00:00Z')],
			clock
		);
		expect(data.cards[0].days).toEqual([
			Math.floor(Date.parse('2026-01-02T03:00:00Z') / 86_400_000),
			Math.floor(Date.parse('2026-01-13T03:00:00Z') / 86_400_000)
		]);
	});

	it('survives a structured-clone round trip of the serialisable inputs', () => {
		const runs = [{ a: 1_700_000_000_000, n: 3 }];
		expect(structuredClone(runs)).toEqual(runs);
		const a = clockFromRuns(runs);
		const b = clockFromRuns(structuredClone(runs));
		expect(b.v(1_700_000_000_000 + 9 * 86_400_000)).toBe(a.v(1_700_000_000_000 + 9 * 86_400_000));
	});
});
