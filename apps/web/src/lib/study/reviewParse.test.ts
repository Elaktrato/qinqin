import { describe, expect, it } from 'vitest';

import type { StudyEvent } from '../events';
import { cardKey, parseReview } from './reviewParse';
import reviewParseFixture from '../../../../../docs/contracts/events/review-parse.json';

function event(payload: unknown, overrides: Partial<StudyEvent> = {}): StudyEvent {
	return {
		id: 'e1',
		workspaceId: 7,
		device: 'web',
		ts: '2026-03-15T08:30:00.000Z',
		type: 'review',
		payload,
		...overrides
	};
}

describe('parseReview', () => {
	it('keeps the real mode of each card kind', () => {
		for (const mode of ['vocab', 'sentence', 'writing', 'tone'] as const) {
			const parsed = parseReview(event({ cardId: 'c', mode, grade: 3 }));
			expect(parsed?.payload.mode).toBe(mode);
		}
	});

	it('defaults a missing or unknown mode to vocab', () => {
		expect(parseReview(event({ cardId: 'c', grade: 3 }))?.payload.mode).toBe('vocab');
		expect(parseReview(event({ cardId: 'c', mode: 'bogus', grade: 3 }))?.payload.mode).toBe(
			'vocab'
		);
	});

	it('rejects non-review events, bad grades and bad card ids', () => {
		expect(parseReview(event({ cardId: 'c', grade: 3 }, { type: 'other' }))).toBeNull();
		for (const grade of [0, 5, 2.5, '3', null]) {
			expect(parseReview(event({ cardId: 'c', grade }))).toBeNull();
		}
		expect(parseReview(event({ cardId: '', grade: 3 }))).toBeNull();
		expect(parseReview(event({ cardId: 4, grade: 3 }))).toBeNull();
		expect(parseReview(event(null))).toBeNull();
		expect(parseReview(event('x'))).toBeNull();
	});

	it('keeps valid meta and drops malformed meta', () => {
		const meta = { tier: 2, mistakes: 1, hints: 0, durationMs: 1500 };
		expect(parseReview(event({ cardId: 'c', grade: 3, meta }))?.payload.meta).toEqual(meta);
		for (const bad of [
			{ tier: 3 },
			{ mistakes: -1 },
			{ hints: 1.5 },
			{ durationMs: 'x' },
			'x',
			[1]
		]) {
			const parsed = parseReview(event({ cardId: 'c', grade: 3, meta: bad }));
			expect(parsed).not.toBeNull();
			expect('meta' in (parsed?.payload ?? {})).toBe(false);
		}
	});

	it('keeps the event envelope and omits meta when absent', () => {
		const parsed = parseReview(event({ cardId: 'c', grade: 4 }));
		expect(parsed).toMatchObject({ id: 'e1', workspaceId: 7, type: 'review' });
		expect('meta' in (parsed?.payload ?? {})).toBe(false);
	});
});

describe('cardKey', () => {
	it('distinguishes kinds, entries and sentence ids', () => {
		expect(cardKey('vocab', 1)).not.toBe(cardKey('sentence', 1));
		expect(cardKey('sentence', 1, 5)).not.toBe(cardKey('sentence', 1, 6));
		expect(cardKey('vocab', 1)).not.toBe(cardKey('vocab', 2));
		expect(cardKey('vocab', 1)).toBe(cardKey('vocab', 1));
	});
});

describe('docs/contracts/events/review-parse.json: parseReview', () => {
	const fixture = reviewParseFixture as unknown as {
		rule: string;
		cases: { name: string; event: StudyEvent; parsed: unknown }[];
	};
	it('has cases', () => {
		expect(fixture.rule).toBe('events/review-parse');
		expect(fixture.cases.length).toBeGreaterThan(20);
	});
	for (const c of fixture.cases) {
		it(c.name, () => {
			const got = parseReview(c.event);
			if (c.parsed === null) {
				expect(got).toBeNull();
				return;
			}
			const { payload, ...envelope } = got!;
			const { payload: _raw, ...sent } = c.event;
			expect(envelope).toEqual({ ...sent, type: 'review' });
			expect(payload).toEqual(c.parsed);
		});
	}
});
