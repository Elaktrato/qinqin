import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import {
	ALL_SENT_MS,
	offline,
	offlineMessage,
	reportNetworkFailure,
	reportOnline,
	reportResponse,
	resetOffline,
	setQueued,
	notifyAllSent,
	type OfflineState
} from './offlineState';

const base: OfflineState = { online: true, servedFromCacheAt: null, queued: 0, allSentAt: null, prepared: null };

describe('offlineMessage', () => {
	it('is null when everything is normal', () => {
		expect(offlineMessage(base, 0)).toBeNull();
	});

	it('offline, nothing queued', () => {
		expect(offlineMessage({ ...base, online: false }, 0)).toBe("You're offline. Study works with saved cards.");
	});

	it('offline with a queue, singular and plural', () => {
		expect(offlineMessage({ ...base, online: false, queued: 1 }, 0)).toBe(
			"You're offline. 1 review is saved on this device and will be sent when you're back online."
		);
		expect(offlineMessage({ ...base, online: false, queued: 3 }, 0)).toBe(
			"You're offline. 3 reviews are saved on this device and will be sent when you're back online."
		);
	});

	it('data served from the saved copy shows its local time', () => {
		const at = new Date(2026, 10, 16, 14, 2, 0).toISOString();
		expect(offlineMessage({ ...base, servedFromCacheAt: at }, 0)).toBe(
			"Can't reach the server. Showing saved data from 14:02."
		);
	});

	it('a saved-copy time that cannot be read still gives a sentence', () => {
		expect(offlineMessage({ ...base, servedFromCacheAt: 'garbage' }, 0)).toBe("Can't reach the server. Showing saved data.");
	});

	it('"All reviews sent." only for its five seconds', () => {
		expect(offlineMessage({ ...base, allSentAt: 1000 }, 1000 + ALL_SENT_MS - 1)).toBe('All reviews sent.');
		expect(offlineMessage({ ...base, allSentAt: 1000 }, 1000 + ALL_SENT_MS)).toBeNull();
	});

	it('offline wins over a stale saved-copy notice', () => {
		const at = new Date().toISOString();
		expect(offlineMessage({ ...base, online: false, servedFromCacheAt: at }, 0)).toMatch(/^You're offline/);
	});
});

describe('the store', () => {
	beforeEach(() => {
		resetOffline();
		vi.useFakeTimers();
	});
	afterEach(() => vi.useRealTimers());

	it('a response from the saved copy is remembered; a live one clears it and marks online', () => {
		reportResponse(new Headers({ 'x-qinqin-offline': '1', 'x-qinqin-saved-at': '2026-11-16T14:02:00.000Z' }));
		expect(get(offline).servedFromCacheAt).toBe('2026-11-16T14:02:00.000Z');
		reportResponse(new Headers());
		expect(get(offline).servedFromCacheAt).toBeNull();
		expect(get(offline).online).toBe(true);
	});

	it('a network failure marks offline; a later response marks online again', () => {
		reportNetworkFailure();
		expect(get(offline).online).toBe(false);
		reportOnline();
		expect(get(offline).online).toBe(true);
	});

	it('tracks the queue size', () => {
		setQueued(4);
		expect(get(offline).queued).toBe(4);
	});

	it('"All reviews sent." clears itself after five seconds', () => {
		notifyAllSent();
		expect(get(offline).allSentAt).not.toBeNull();
		vi.advanceTimersByTime(ALL_SENT_MS);
		expect(get(offline).allSentAt).toBeNull();
	});
});
