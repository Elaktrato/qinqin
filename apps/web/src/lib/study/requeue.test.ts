import { describe, expect, it } from 'vitest';

import type { FlowItem } from './cardFlow';
import {
	MAX_RESHOWS,
	REQUEUE_GAP,
	progressOf,
	removeAt,
	requeueAfterGrade,
	reviewRecorded
} from './requeue';

function item(id: string, extra: Partial<FlowItem> = {}): FlowItem {
	return { cardId: id, kind: 'vocab', entryId: 1, virtual: false, card: null, ...extra };
}

function ids(queue: readonly FlowItem[]): string[] {
	return queue.map((i) => (i.reshow ? `${i.cardId}*` : i.cardId));
}

const many = (n: number) => Array.from({ length: n }, (_, i) => item(`c${i}`));

describe('requeueAfterGrade', () => {
	it('re-inserts an Again card after REQUEUE_GAP other cards', () => {
		const queue = many(10);
		const next = requeueAfterGrade(queue, 0, 1);
		expect(REQUEUE_GAP).toBe(4);
		expect(ids(next)).toEqual(['c0', 'c1', 'c2', 'c3', 'c4', 'c0*', 'c5', 'c6', 'c7', 'c8', 'c9']);
	});

	it('goes to the end when fewer than REQUEUE_GAP cards remain', () => {
		expect(ids(requeueAfterGrade(many(3), 0, 1))).toEqual(['c0', 'c1', 'c2', 'c0*']);
		expect(ids(requeueAfterGrade(many(1), 0, 1))).toEqual(['c0', 'c0*']);
	});

	it('leaves the queue alone for Hard, Good and Easy', () => {
		const queue = many(6);
		for (const grade of [2, 3, 4] as const) {
			expect(requeueAfterGrade(queue, 0, grade)).toBe(queue);
		}
	});

	it('does not mutate its input', () => {
		const queue = many(6);
		requeueAfterGrade(queue, 0, 1);
		expect(queue).toHaveLength(6);
	});

	it('keeps at most one pending re-show per card', () => {
		const queue = [...many(3), item('c0', { reshow: 1 }), item('x')];
		expect(requeueAfterGrade(queue, 0, 1)).toBe(queue);
	});

	it('a re-show graded Again re-queues again, with a rising count', () => {
		const queue = [item('a'), ...many(6).slice(1), item('a', { reshow: 1 })];
		const index = queue.length - 1;
		const next = requeueAfterGrade(queue, index, 1);
		expect(next.at(-1)).toMatchObject({ cardId: 'a', reshow: 2 });
	});

	it('a re-show graded Good leaves for good', () => {
		const queue = [item('a'), item('b'), item('a', { reshow: 1 })];
		expect(requeueAfterGrade(queue, 2, 3)).toBe(queue);
	});

	it('stops re-showing after MAX_RESHOWS', () => {
		const queue = [item('a'), item('a', { reshow: MAX_RESHOWS })];
		expect(requeueAfterGrade(queue, 1, 1)).toBe(queue);
	});

	it('orders re-shows that land together first-in first-out', () => {
		let queue = many(3);
		queue = requeueAfterGrade(queue, 0, 1); // c0* at end
		queue = requeueAfterGrade(queue, 1, 1); // c1* at end, after c0*
		expect(ids(queue)).toEqual(['c0', 'c1', 'c2', 'c0*', 'c1*']);
	});

	it('marks the re-show as a real, non-virtual item of the same card', () => {
		const queue = [item('v', { virtual: true, kind: 'sentence', sentenceId: 7 }), ...many(5)];
		const real = { id: 'v', kind: 'sentence', entryId: 1, written: 'x', deckIds: [], createdAt: '' } as never;
		const again = requeueAfterGrade(queue, 0, 1, real).find((i) => i.reshow);
		expect(again).toMatchObject({ cardId: 'v', kind: 'sentence', virtual: false, sentenceId: 7, card: real });
	});
});

describe('reviewRecorded', () => {
	it('records only first-pass items', () => {
		expect(reviewRecorded(item('a'))).toBe(true);
		expect(reviewRecorded(item('a', { reshow: 1 }))).toBe(false);
	});
});

describe('progressOf', () => {
	it('counts unique cards and ignores re-shows in the total', () => {
		const queue = requeueAfterGrade(many(6), 0, 1);
		expect(progressOf(queue, 0)).toEqual({ position: 1, total: 6, pending: 1, reshowing: false });
		expect(progressOf(queue, 5)).toEqual({ position: 5, total: 6, pending: 1, reshowing: true });
	});

	it('reaches total / total and keeps counting down the pending re-shows', () => {
		const queue = [...many(2), item('c0', { reshow: 1 })];
		expect(progressOf(queue, 1)).toEqual({ position: 2, total: 2, pending: 1, reshowing: false });
		expect(progressOf(queue, 2)).toEqual({ position: 2, total: 2, pending: 1, reshowing: true });
	});
});

describe('removeAt', () => {
	it('removes only that index, never an earlier item of the same card', () => {
		const queue = [item('a'), item('b'), item('a', { reshow: 1 })];
		expect(ids(removeAt(queue, 2))).toEqual(['a', 'b']);
	});
});
