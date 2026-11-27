// The pure rules of the review outbox v2: who owns a queued review, which
// items a user may send, and when another user's items expire. No storage
// here (events.ts reads and writes); the same cases are the contract fixture
// docs/contracts/pwa/outbox-v3.json.

import type { StudyEventBody } from '$lib/api/types';

/** Items of another user are kept this long, never sent for anyone else. */
export const OTHER_USER_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000;

export interface OutboxItem {
	/** The user the review was recorded for; null when no user was known yet. */
	userId: number | null;
	/** ISO time the item entered the queue (expiry clock). */
	queuedAt: string;
	event: StudyEventBody;
}

/**
 * settle brings the queue into the state `userId` may use: unowned items are
 * adopted by this user (today's single-user behaviour), and other users'
 * items past the 30-day limit are removed. Own items never expire. Returns a
 * new list.
 */
export function settle(state: readonly OutboxItem[], userId: number, nowMs: number): OutboxItem[] {
	const items: OutboxItem[] = [];
	for (const item of state) {
		if (item.userId === null) {
			items.push({ ...item, userId });
		} else if (item.userId === userId) {
			items.push(item);
		} else {
			const queued = Date.parse(item.queuedAt);
			if (Number.isFinite(queued) && nowMs - queued <= OTHER_USER_EXPIRY_MS) items.push(item);
		}
	}
	return items;
}

/** flushable: the items `userId` may send, in queue order. */
export function flushable(items: readonly OutboxItem[], userId: number): OutboxItem[] {
	return items.filter((item) => item.userId === userId);
}
