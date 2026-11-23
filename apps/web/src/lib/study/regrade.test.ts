import { describe, expect, it } from 'vitest';

import type { FlowItem } from './cardFlow';
import {
	BACK_LIMIT,
	backFrom,
	pushStep,
	regradeAction,
	regradeQueue,
	replaceSessionReview,
	type GradedStep
} from './regrade';
import { MAX_RESHOWS, requeueAfterGrade } from './requeue';
import type { ReviewEvent, ReviewGrade } from './types';
import * as build from '$lib/testing/study';

function item(id: string, extra: Partial<FlowItem> = {}): FlowItem {
	return { cardId: id, kind: 'vocab', entryId: 1, virtual: false, card: null, ...extra };
}

function ids(queue: readonly FlowItem[]): string[] {
	return queue.map((i) => (i.reshow ? `${i.cardId}*${i.reshow}` : i.cardId));
}

const many = (n: number) => Array.from({ length: n }, (_, i) => item(`c${i}`));

function review(id: string, grade: ReviewGrade = 3): ReviewEvent {
	return build.review({ id, grade, workspaceId: 7, ts: '2026-11-22T09:00:00.000Z', cardId: 'c0' });
}

function step(pos: number, queue: readonly FlowItem[], grade: ReviewGrade, extra: Partial<GradedStep> = {}): GradedStep {
	return {
		pos,
		item: queue[pos],
		grade,
		suggested: null,
		finishedAt: 0,
		review: queue[pos].reshow === undefined ? review(`r${pos}`, grade) : null,
		shown: null,
		...extra
	};
}

describe('pushStep and backFrom', () => {
	it('keeps the last BACK_LIMIT steps', () => {
		expect(BACK_LIMIT).toBe(20);
		let steps: GradedStep[] = [];
		const queue = many(30);
		for (let i = 0; i < 25; i++) steps = pushStep(steps, step(i, queue, 3));
		expect(steps).toHaveLength(20);
		expect(steps[0].pos).toBe(5);
		expect(steps[19].pos).toBe(24);
	});

	it('steps back from the current card to the oldest step, then stays', () => {
		expect(backFrom(0, null)).toBeNull();
		expect(backFrom(3, null)).toBe(2);
		expect(backFrom(3, 2)).toBe(1);
		expect(backFrom(3, 0)).toBe(0);
	});
});

describe('regradeAction', () => {
	const queue = many(3);
	it('the same grade changes nothing', () => {
		expect(regradeAction(step(0, queue, 2), 2)).toBe('none');
	});
	it('a recorded step records a replacement', () => {
		expect(regradeAction(step(0, queue, 1), 3)).toBe('replace');
	});
	it('a practice step only edits the queue', () => {
		const q = [...queue, item('c0', { reshow: 1 })];
		expect(regradeAction(step(3, q, 1), 3)).toBe('queue');
	});
});

describe('regradeQueue', () => {
	it('Again -> Good removes the pending re-show', () => {
		const start = many(10);
		const graded = requeueAfterGrade(start, 0, 1); // c0* after c4
		const s = step(0, graded, 1);
		// Two more cards graded: the current card is c3 (index 3).
		const next = regradeQueue(graded, 3, s, 3);
		expect(ids(next)).toEqual(ids(start));
	});

	it('Again -> Good removes the re-show when it is the current card', () => {
		const graded = requeueAfterGrade(many(10), 0, 1);
		const at = graded.findIndex((i) => i.reshow === 1);
		const next = regradeQueue(graded, at, step(0, graded, 1), 3);
		expect(ids(next)).toEqual(ids(many(10)));
	});

	it('keeps a re-show that was already shown', () => {
		const graded = requeueAfterGrade(many(10), 0, 1);
		const at = graded.findIndex((i) => i.reshow === 1);
		expect(regradeQueue(graded, at + 1, step(0, graded, 1), 3)).toBe(graded);
	});

	it('Good -> Again queues the re-show where the Again would have put it', () => {
		const queue = many(10);
		const next = regradeQueue(queue, 2, step(0, queue, 3), 1);
		expect(ids(next)).toEqual(ids(requeueAfterGrade(queue, 0, 1)));
		expect(next[5]).toMatchObject({ cardId: 'c0', reshow: 1, virtual: false });
	});

	it('never before or in place of the current card: right after it', () => {
		const queue = many(10);
		// c7 is the current card (its answer may already show): it stays where it is.
		const next = regradeQueue(queue, 7, step(0, queue, 3), 1);
		expect(ids(next)).toEqual(['c0', 'c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c0*1', 'c8', 'c9']);
		expect(next[7]).toBe(queue[7]);
	});

	it('right after the current card when it is the last one', () => {
		const queue = many(10);
		expect(ids(regradeQueue(queue, 9, step(0, queue, 3), 1))).toEqual([...ids(queue), 'c0*1']);
	});

	it('behind re-shows already queued at that spot', () => {
		const queue = requeueAfterGrade(many(10), 1, 1); // c1* at 6
		const next = regradeQueue(queue, 6, step(0, queue, 3), 1);
		expect(ids(next)).toEqual(['c0', 'c1', 'c2', 'c3', 'c4', 'c5', 'c1*1', 'c0*1', 'c6', 'c7', 'c8', 'c9']);
	});

	it('at the end of the session the re-show is appended', () => {
		const queue = many(3);
		const next = regradeQueue(queue, 3, step(1, queue, 3), 1);
		expect(ids(next)).toEqual(['c0', 'c1', 'c2', 'c1*1']);
	});

	it('not for the last card while others exist (as a first Again)', () => {
		const queue = many(3);
		expect(regradeQueue(queue, 3, step(2, queue, 3), 1)).toBe(queue);
	});

	it('not when the card already appears after its position', () => {
		const queue = [...many(4), item('c0', { reshow: 1 })];
		// c0 graded Again (r0) then its re-show graded Good; now the first grade goes Hard -> Again again.
		expect(regradeQueue(queue, 5, step(0, queue, 2), 1)).toBe(queue);
	});

	it('not beyond MAX_RESHOWS', () => {
		const queue = [...many(3), item('c0', { reshow: MAX_RESHOWS })];
		expect(regradeQueue(queue, 4, step(3, queue, 3), 1)).toBe(queue);
	});

	it('a practice step: Again -> Good removes the next re-show, Good -> Again adds one', () => {
		const base = [...many(3), item('c0', { reshow: 1 }), ...many(8).slice(3)];
		const again = requeueAfterGrade(base, 3, 1); // c0*2 four cards later
		expect(ids(again)).toContain('c0*2');
		expect(ids(regradeQueue(again, 5, step(3, again, 1), 3))).toEqual(ids(base));
		expect(ids(regradeQueue(base, 5, step(3, base, 3), 1))).toEqual(ids(again));
	});

	it('keeps the tier and the cloze showing on the re-show', () => {
		const queue = [item('c0', { kind: 'cloze', clozeSentenceId: 5, clozeMode: 'type', tier: 2 }), ...many(5).slice(1)];
		const next = regradeQueue(queue, 1, step(0, queue, 3), 1);
		expect(next.find((i) => i.reshow === 1)).toMatchObject({ clozeSentenceId: 5, clozeMode: 'type', tier: 2 });
	});

	it('other grades leave the queue alone', () => {
		const queue = many(6);
		expect(regradeQueue(queue, 2, step(0, queue, 2), 4)).toBe(queue);
	});
});

describe('replaceSessionReview', () => {
	it('puts the replacement in the target’s place', () => {
		const list = [review('a'), review('b', 1), review('c')];
		const next = review('d', 3);
		expect(replaceSessionReview(list, 'b', next).map((r) => r.id)).toEqual(['a', 'd', 'c']);
		expect(list.map((r) => r.id)).toEqual(['a', 'b', 'c']);
	});
});
