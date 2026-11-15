import { describe, expect, it } from 'vitest';

import type { ReviewEvent } from '../types';
import { buildDataset } from './dataset';

let n = 0;
function review(cardId: string, grade: number, ts: string, id?: string): ReviewEvent {
	n += 1;
	return {
		id: id ?? `01JTEST${String(n).padStart(19, '0')}`,
		workspaceId: 7,
		device: 'web',
		ts,
		type: 'review',
		payload: { cardId, mode: 'vocab', grade: grade as 1 }
	};
}

describe('buildDataset', () => {
	it('gives a once-reviewed card no labelled item', () => {
		const data = buildDataset([review('a', 3, '2026-01-01T10:00:00Z')]);
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
		]);
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
		]);
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
		]);
		expect(data.cards.map((c) => c.cardId)).toEqual(['a', 'b']);
		expect(data.cards[0].steps.map((s) => s.g)).toEqual([3, 2, 4]);
		expect(data.cards[0].steps.map((s) => s.t)).toEqual([0, 1, 0]);
		expect(data.labelled).toBe(1);
	});
});
