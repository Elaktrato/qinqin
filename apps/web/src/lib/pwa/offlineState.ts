// What the UI knows about connectivity: whether the browser (or the last
// request) says we are offline, whether the last answers came from the
// worker's saved copy, how many reviews wait to be sent, and what offline
// preparation last saved. One small store plus the sentence it shows.

import { onSessionEnd } from '../session/sessionEnd';
import { writable } from 'svelte/store';
import { t } from '$lib/i18n';

export interface OfflineState {
	online: boolean;
	/** ISO time of the saved copy the last API answer came from; null for a live answer. */
	servedFromCacheAt: string | null;
	/** Reviews of the signed-in user waiting in the outbox. */
	queued: number;
	/** ms timestamp of the last flush that emptied the queue (shown for ALL_SENT_MS). */
	allSentAt: number | null;
	/** What offline preparation last saved for a workspace. */
	prepared: { workspaceId: number; cards: number; at: string } | null;
}

export const ALL_SENT_MS = 5000;

function initial(): OfflineState {
	return {
		online: typeof navigator === 'undefined' ? true : navigator.onLine !== false,
		servedFromCacheAt: null,
		queued: 0,
		allSentAt: null,
		prepared: null
	};
}

export const offline = writable<OfflineState>(initial());

let sentTimer: ReturnType<typeof setTimeout> | null = null;

// Queued and prepared counts belong to the session that ended.
onSessionEnd(() => resetOffline());

export function resetOffline(): void {
	if (sentTimer !== null) clearTimeout(sentTimer);
	sentTimer = null;
	offline.set(initial());
}

/** reportResponse: called with the headers of every API answer (lib/api/client.ts). */
export function reportResponse(headers: { get(name: string): string | null }): void {
	const savedAt = headers.get('x-qinqin-offline') === '1' ? (headers.get('x-qinqin-saved-at') ?? '') : null;
	offline.update((s) => ({ ...s, online: true, servedFromCacheAt: savedAt }));
}

/** reportNetworkFailure: a request could not reach the server at all. */
export function reportNetworkFailure(): void {
	offline.update((s) => ({ ...s, online: false }));
}

export function reportOnline(): void {
	offline.update((s) => ({ ...s, online: true }));
}

export function setQueued(count: number): void {
	offline.update((s) => (s.queued === count ? s : { ...s, queued: count }));
}

export function setPrepared(prepared: OfflineState['prepared']): void {
	offline.update((s) => ({ ...s, prepared }));
}

/** notifyAllSent: a flush emptied the queue; "All reviews sent." shows for five seconds. */
export function notifyAllSent(): void {
	if (sentTimer !== null) clearTimeout(sentTimer);
	offline.update((s) => ({ ...s, allSentAt: Date.now() }));
	sentTimer = setTimeout(() => {
		sentTimer = null;
		offline.update((s) => ({ ...s, allSentAt: null }));
	}, ALL_SENT_MS);
}

/** watchConnectivity: follows the browser's online/offline events; returns the unsubscribe. */
export function watchConnectivity(): () => void {
	if (typeof window === 'undefined') return () => undefined;
	window.addEventListener('online', reportOnline);
	window.addEventListener('offline', reportNetworkFailure);
	return () => {
		window.removeEventListener('online', reportOnline);
		window.removeEventListener('offline', reportNetworkFailure);
	};
}

function savedTime(iso: string): string | null {
	const at = new Date(iso);
	if (Number.isNaN(at.getTime())) return null;
	return `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
}

/** offlineMessage: the one sentence the banner shows, or null. */
export function offlineMessage(state: OfflineState, nowMs: number): string | null {
	if (!state.online) {
		if (state.queued === 0) return t('pwa.offline.noQueue');
		return t('pwa.offline.queued', { count: state.queued });
	}
	if (state.servedFromCacheAt !== null) {
		const time = savedTime(state.servedFromCacheAt);
		return time === null
			? t('pwa.offline.unreachable')
			: t('pwa.offline.unreachableSince', { time });
	}
	if (state.allSentAt !== null && nowMs - state.allSentAt < ALL_SENT_MS) return t('pwa.offline.allSent');
	return null;
}
