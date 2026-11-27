// Reviews this device sent in the last days. Offline, the cached event log may
// be older than the reviews done online since; without these a card answered
// minutes ago would show as due again. Merged into the history like queued
// reviews (store.ts), deduplicated by id, so a refreshed log makes them moot.

import type { StudyEventBody } from '$lib/api/types';

export const RECENT_SENT_KEY = 'qinqin.study.sent.v1';
export const RECENT_SENT_TTL_MS = 3 * 24 * 60 * 60 * 1000;
export const RECENT_SENT_MAX = 300;

// Kept per user id, so another account never reads them; an explicit sign-out
// still drops them (the session's dispose, context/session.svelte.ts).

interface Item {
	userId: number;
	sentAt: number;
	event: StudyEventBody;
}

function defaultStorage(): Storage | null {
	try {
		return typeof localStorage === 'undefined' ? null : localStorage;
	} catch {
		return null;
	}
}

function read(store: Storage | null): Item[] {
	try {
		const parsed: unknown = JSON.parse(store?.getItem(RECENT_SENT_KEY) ?? '[]');
		return Array.isArray(parsed)
			? parsed.filter(
					(i): i is Item =>
						typeof i === 'object' && i !== null && typeof i.userId === 'number' && typeof i.sentAt === 'number' && typeof i.event?.id === 'string'
				)
			: [];
	} catch {
		return [];
	}
}

/** rememberSent records events the server accepted. Never throws. */
export function rememberSent(
	userId: number,
	events: readonly StudyEventBody[],
	nowMs: number = Date.now(),
	store: Storage | null = defaultStorage()
): void {
	if (store === null) return;
	try {
		const kept = read(store).filter((i) => nowMs - i.sentAt <= RECENT_SENT_TTL_MS);
		const next = [...kept, ...events.filter((e) => e.type === 'review').map((event) => ({ userId, sentAt: nowMs, event }))];
		store.setItem(RECENT_SENT_KEY, JSON.stringify(next.slice(-RECENT_SENT_MAX)));
	} catch {
		// Storage full or denied: the cache refresh covers it.
	}
}

export function recentSentReviews(
	userId: number,
	workspaceId: number,
	nowMs: number = Date.now(),
	store: Storage | null = defaultStorage()
): StudyEventBody[] {
	return read(store)
		.filter((i) => i.userId === userId && i.event.workspaceId === workspaceId && nowMs - i.sentAt <= RECENT_SENT_TTL_MS)
		.map((i) => i.event);
}

export function clearRecentSent(store: Storage | null = defaultStorage()): void {
	try {
		store?.removeItem(RECENT_SENT_KEY);
	} catch {
		// Nothing to clear.
	}
}
