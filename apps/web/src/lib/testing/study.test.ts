import { describe, expect, it } from 'vitest';
import { scheduleFor } from '$lib/studycore/scheduler';
import { DEFAULT_W } from '$lib/studycore/fsrsParams';
import { IDENTITY_CLOCK } from '$lib/studycore/studyClock';
import { card, eventId, history, review, strongReviews } from './study';

describe('card', () => {
	it('fills every required field with a default', () => {
		expect(card()).toStrictEqual({
			id: 'c1',
			kind: 'vocab',
			entryId: 1,
			deckIds: ['general'],
			createdAt: '2026-01-01T00:00:00.000Z'
		});
	});

	it('takes overrides, and an override of undefined leaves an optional field absent', () => {
		const c = card({ id: 'x', kind: 'writing', entryId: 4, written: '学', deckIds: ['d1'], sentenceId: undefined });
		expect(c).toStrictEqual({
			id: 'x',
			kind: 'writing',
			entryId: 4,
			written: '学',
			deckIds: ['d1'],
			createdAt: '2026-01-01T00:00:00.000Z'
		});
		expect('sentenceId' in c).toBe(false);
		expect(card({ deckIds: undefined, createdAt: undefined })).toStrictEqual(card());
	});

	it('never shares the default deck list between cards', () => {
		const a = card();
		a.deckIds.push('d9');
		expect(card().deckIds).toEqual(['general']);
	});
});

describe('review', () => {
	it('builds a Good vocab review with an id from card and instant', () => {
		expect(review({ cardId: 'c1', ts: '2026-03-01T09:00:00.000Z' })).toStrictEqual({
			id: 'c1-2026-03-01T09:00:00.000Z',
			workspaceId: 1,
			device: 'web',
			ts: '2026-03-01T09:00:00.000Z',
			type: 'review',
			payload: { cardId: 'c1', mode: 'vocab', grade: 3 }
		});
	});

	it('takes every field, and meta and replaces only when given', () => {
		expect(
			review({ cardId: 'c2', ts: 't', grade: 1, id: 'r9', mode: 'writing', workspaceId: 7, device: 'd', meta: { hints: 1 }, replaces: 'r8' })
		).toStrictEqual({
			id: 'r9',
			workspaceId: 7,
			device: 'd',
			ts: 't',
			type: 'review',
			payload: { cardId: 'c2', mode: 'writing', grade: 1, meta: { hints: 1 }, replaces: 'r8' }
		});
	});
});

describe('history', () => {
	it('is empty by default and takes overrides', () => {
		expect(history()).toStrictEqual({ decks: [], cards: [], reviews: [], merged: 0, grammarRuns: [] });
		const cards = [card()];
		expect(history({ cards, merged: 2 })).toStrictEqual({ decks: [], cards, reviews: [], merged: 2, grammarRuns: [] });
	});
});

describe('eventId', () => {
	it('is a 26-character id that sorts by n', () => {
		expect(eventId(1)).toBe('01JTEST0000000000000000001');
		expect(eventId(12, '01JX')).toBe('01JX0000000000000000000012');
		expect(eventId(9) < eventId(10)).toBe(true);
		expect(eventId(3, '01JMASTERY', 27)).toBe('01JMASTERY00000000000000003');
	});
});

describe('strongReviews', () => {
	it('answers Easy at every due date, so the card ends well above the learned edge', () => {
		const events = strongReviews('c1');
		expect(events).toHaveLength(8);
		expect(events.every((e) => e.payload.grade === 4 && e.payload.cardId === 'c1')).toBe(true);
		for (let i = 1; i < events.length; i++) expect(events[i].ts > events[i - 1].ts).toBe(true);
		const s = scheduleFor('c1', events, new Date(events.at(-1)!.ts), DEFAULT_W, IDENTITY_CLOCK);
		expect(s!.stability).toBeGreaterThan(21);
	});
});
