import { describe, expect, it } from 'vitest';

import type { ReviewEvent, StudyCard } from '../types';
import { DEFAULT_W } from './params';
import type { HeldOut } from './optimize';
import { canApply, isSurge, previewChange } from './preview';

const NOW = new Date('2026-06-01T00:00:00.000Z');

function card(id: string): StudyCard {
	return { id, kind: 'vocab', entryId: 1, deckIds: ['general'], createdAt: '2026-01-01T00:00:00.000Z', written: `字${id}` };
}

let n = 0;
function review(cardId: string, grade: 1 | 2 | 3 | 4, ts: string): ReviewEvent {
	n++;
	return {
		id: `01JPREV${String(n).padStart(19, '0')}`,
		workspaceId: 1,
		device: 'web',
		ts,
		type: 'review',
		payload: { cardId, mode: 'vocab', grade }
	};
}

function history() {
	const cards: StudyCard[] = [];
	const reviews: ReviewEvent[] = [];
	for (let i = 0; i < 15; i++) {
		const id = `c${i}`;
		cards.push(card(id));
		reviews.push(review(id, 3, `2026-04-${String(1 + i).padStart(2, '0')}T10:00:00.000Z`));
		reviews.push(review(id, 3, `2026-04-${String(10 + i).padStart(2, '0')}T10:00:00.000Z`));
	}
	cards.push(card('never'));
	return { cards, reviews };
}

describe('previewChange', () => {
	it('shows no change for identical weights', () => {
		const { cards, reviews } = history();
		const p = previewChange({ cards, reviews, from: DEFAULT_W, to: [...DEFAULT_W], now: NOW });
		expect(p.dueNow[0]).toBe(p.dueNow[1]);
		expect(p.due7[0]).toBe(p.due7[1]);
		expect(p.due30[0]).toBe(p.due30[1]);
		expect(p.medianIntervalDays[0]).toBe(p.medianIntervalDays[1]);
		expect(p.moved).toEqual([]);
		expect(p.surge).toBe(false);
	});

	it('a doubled w8 lengthens intervals and lists the largest moves', () => {
		const { cards, reviews } = history();
		const to = [...DEFAULT_W];
		to[8] *= 2;
		const p = previewChange({ cards, reviews, from: DEFAULT_W, to, now: NOW });
		expect(p.medianIntervalDays[1]).toBeGreaterThan(p.medianIntervalDays[0]);
		expect(p.moved).toHaveLength(10);
		expect(p.moved[0]).toMatchObject({ written: expect.stringMatching(/^字c/) });
		expect(Date.parse(p.moved[0].after)).toBeGreaterThan(Date.parse(p.moved[0].before));
	});

	it('flags a surge only when due-now more than doubles and grows by over 50', () => {
		expect(isSurge(30, 81)).toBe(true);
		expect(isSurge(30, 70)).toBe(false);
		expect(isSurge(60, 100)).toBe(false);
	});
});

describe('canApply', () => {
	const base = { startedWorkspace: 1, currentWorkspace: 1, activeLogLoss: 0.4 };

	it('allows a better fit', () => {
		expect(canApply({ ...base, candidate: { logLoss: 0.3 }, source: 'optimized' })).toEqual({ ok: true });
	});

	it('refuses a worse or equal fit', () => {
		const r = canApply({ ...base, candidate: { logLoss: 0.4 }, source: 'optimized' });
		expect(r).toEqual({ ok: false, reason: 'Your current parameters already fit better.' });
	});

	it('refuses a workspace mismatch', () => {
		expect(canApply({ ...base, currentWorkspace: 2, candidate: { logLoss: 0.1 }, source: 'optimized' })).toEqual({
			ok: false,
			reason: 'The workspace changed. Optimise again.'
		});
		expect(canApply({ ...base, currentWorkspace: null, candidate: { logLoss: 0.1 }, source: 'optimized' }).ok).toBe(false);
	});

	it('allows an import regardless of log loss', () => {
		expect(canApply({ ...base, candidate: null, source: 'imported' })).toEqual({ ok: true });
		expect(canApply({ ...base, candidate: { logLoss: 0.9 }, source: 'imported' })).toEqual({ ok: true });
	});

	it('refuses an optimised result that is missing', () => {
		expect(canApply({ ...base, candidate: null, source: 'optimized' }).ok).toBe(false);
	});
});

describe('canApply held-out gate', () => {
	const base = { startedWorkspace: 1, currentWorkspace: 1, activeLogLoss: 0.4, source: 'optimized' as const };
	const held = (o: Partial<HeldOut>): HeldOut => ({
		items: 100,
		candidate: 0.3,
		current: 0.31,
		gain: 0.01,
		se: 0.004,
		small: true,
		...o
	});

	it('offers a small log only when the gain is more than twice its noise', () => {
		expect(canApply({ ...base, candidate: { logLoss: 0.3, heldOut: held({ gain: 0.01, se: 0.004 }) } })).toEqual({ ok: true });
		const r = canApply({ ...base, candidate: { logLoss: 0.3, heldOut: held({ gain: 0.01, se: 0.006 }) } });
		expect(r.ok).toBe(false);
		expect(!r.ok && r.reason).toMatch(/most recent reviews/);
	});

	it('lets a large log through unless it is clearly worse on its latest reviews', () => {
		expect(canApply({ ...base, candidate: { logLoss: 0.3, heldOut: held({ small: false, gain: -0.0005 }) } }).ok).toBe(true);
		expect(canApply({ ...base, candidate: { logLoss: 0.3, heldOut: held({ small: false, gain: -0.01 }) } }).ok).toBe(false);
	});
});
