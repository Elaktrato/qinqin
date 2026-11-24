// What the UI knows about connectivity (record 0009: tab-wide, the app
// context's Connectivity): whether the browser (or the last request) says we are
// offline, whether the last answers came from the worker's saved copy, how
// many reviews wait to be sent, and what offline preparation last saved. The
// queued and prepared counts belong to a session and are reset when it ends.

import { t } from '$lib/i18n';
import type { EventSource, Timers } from '../context/deps';

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

export interface ConnectivityDeps {
	now(): number;
	timers: Timers;
	/** Whether the browser says it is online now (navigator.onLine). */
	browserOnline(): boolean;
}

export class Connectivity implements OfflineState {
	readonly #deps: ConnectivityDeps;
	online = $state(true);
	servedFromCacheAt = $state<string | null>(null);
	queued = $state(0);
	allSentAt = $state<number | null>(null);
	prepared = $state.raw<OfflineState['prepared']>(null);
	#sentTimer: unknown = null;

	constructor(deps: ConnectivityDeps) {
		this.#deps = deps;
		this.online = deps.browserOnline();
	}

	/** endSession: the queued and prepared counts belong to the session that ended. */
	endSession(): void {
		this.#clearSent();
		this.servedFromCacheAt = null;
		this.queued = 0;
		this.prepared = null;
		this.online = this.#deps.browserOnline();
	}

	/** reportResponse: called with the headers of every API answer (the API observer). */
	reportResponse(headers: { get(name: string): string | null }): void {
		this.online = true;
		this.servedFromCacheAt = headers.get('x-qinqin-offline') === '1' ? (headers.get('x-qinqin-saved-at') ?? '') : null;
	}

	/** reportNetworkFailure: a request could not reach the server at all. */
	reportNetworkFailure(): void {
		this.online = false;
	}

	reportOnline(): void {
		this.online = true;
	}

	setQueued(count: number): void {
		if (this.queued !== count) this.queued = count;
	}

	setPrepared(prepared: OfflineState['prepared']): void {
		this.prepared = prepared;
	}

	/** notifyAllSent: a flush emptied the queue; "All reviews sent." shows for five seconds. */
	notifyAllSent(): void {
		this.#clearSent();
		this.allSentAt = this.#deps.now();
		this.#sentTimer = this.#deps.timers.set(() => {
			this.#sentTimer = null;
			this.allSentAt = null;
		}, ALL_SENT_MS);
	}

	/** watch: follows the browser's online/offline events on `target`; returns the unsubscribe. */
	watch(target: EventSource | null): () => void {
		if (target === null) return () => undefined;
		const online = (): void => this.reportOnline();
		const offline = (): void => this.reportNetworkFailure();
		target.addEventListener('online', online);
		target.addEventListener('offline', offline);
		return () => {
			target.removeEventListener('online', online);
			target.removeEventListener('offline', offline);
		};
	}

	/** dispose: the pending "All reviews sent." timer stops. */
	dispose(): void {
		this.#clearSent();
	}

	#clearSent(): void {
		if (this.#sentTimer !== null) this.#deps.timers.clear(this.#sentTimer);
		this.#sentTimer = null;
		this.allSentAt = null;
	}
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
		return time === null ? t('pwa.offline.unreachable') : t('pwa.offline.unreachableSince', { time });
	}
	if (state.allSentAt !== null && nowMs - state.allSentAt < ALL_SENT_MS) return t('pwa.offline.allSent');
	return null;
}
