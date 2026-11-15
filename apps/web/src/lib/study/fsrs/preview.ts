// What a weight change would do to the schedule, computed before it is
// applied, and the gate that decides whether it may be applied.

import { isValidReview, scheduleFor, sortedReviews } from '../scheduler';
import type { ReviewEvent, StudyCard } from '../types';

const DAY = 86_400_000;
const MOVED = 10;

export interface Preview {
	dueNow: [number, number];
	due7: [number, number];
	due30: [number, number];
	medianIntervalDays: [number, number];
	moved: { cardId: string; written: string; before: string; after: string }[];
	surge: boolean;
}

/** isSurge: due-now more than doubles and grows by over 50 cards. */
export function isSurge(before: number, after: number): boolean {
	return after > 2 * before && after - before > 50;
}

function median(values: number[]): number {
	if (values.length === 0) return 0;
	const sorted = [...values].sort((a, b) => a - b);
	const mid = sorted.length >> 1;
	return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function previewChange(o: {
	cards: readonly StudyCard[];
	reviews: readonly ReviewEvent[];
	from: readonly number[];
	to: readonly number[];
	now: Date;
}): Preview {
	const byCard = new Map<string, ReviewEvent[]>();
	for (const review of o.reviews) {
		if (!isValidReview(review)) continue;
		const list = byCard.get(review.payload.cardId);
		if (list === undefined) byCard.set(review.payload.cardId, [review]);
		else list.push(review);
	}
	const now = o.now.getTime();
	const counts = { now: [0, 0], d7: [0, 0], d30: [0, 0] };
	const intervals: [number[], number[]] = [[], []];
	const moves: { cardId: string; written: string; before: string; after: string; gap: number }[] =
		[];

	for (const card of o.cards) {
		const history = byCard.get(card.id);
		if (history === undefined) continue;
		const a = scheduleFor(card.id, history, o.now, o.from);
		const b = scheduleFor(card.id, history, o.now, o.to);
		if (a === null || b === null) continue;
		const last = Date.parse(sortedReviews(history)[history.length - 1].ts);
		[a, b].forEach((s, side) => {
			const due = Date.parse(s.due);
			if (due <= now) counts.now[side]++;
			if (due <= now + 7 * DAY) counts.d7[side]++;
			if (due <= now + 30 * DAY) counts.d30[side]++;
			intervals[side].push((due - last) / DAY);
		});
		const gap = Math.abs(Date.parse(b.due) - Date.parse(a.due));
		if (gap > 0) {
			moves.push({ cardId: card.id, written: card.written ?? '', before: a.due, after: b.due, gap });
		}
	}
	moves.sort((x, y) => y.gap - x.gap || (x.cardId < y.cardId ? -1 : 1));
	const pair = (v: number[]): [number, number] => [v[0], v[1]];
	return {
		dueNow: pair(counts.now),
		due7: pair(counts.d7),
		due30: pair(counts.d30),
		medianIntervalDays: [median(intervals[0]), median(intervals[1])],
		moved: moves.slice(0, MOVED).map(({ gap, ...rest }) => (void gap, rest)),
		surge: isSurge(counts.now[0], counts.now[1])
	};
}

export type ApplyCheck = { ok: true } | { ok: false; reason: string };

export function canApply(o: {
	candidate: { logLoss: number } | null;
	activeLogLoss: number;
	startedWorkspace: number;
	currentWorkspace: number | null;
	source: 'optimized' | 'imported';
}): ApplyCheck {
	if (o.currentWorkspace === null || o.currentWorkspace !== o.startedWorkspace) {
		return { ok: false, reason: 'The workspace changed. Optimise again.' };
	}
	if (o.source === 'imported') return { ok: true };
	if (o.candidate === null) return { ok: false, reason: 'There is nothing to apply.' };
	if (!(o.candidate.logLoss < o.activeLogLoss)) {
		return { ok: false, reason: 'Your current parameters already fit better.' };
	}
	return { ok: true };
}
