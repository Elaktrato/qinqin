import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import { ALL_SENT_MS, offline, resetOffline } from '../pwa/offlineState';
import { flushPendingReviews, recordReview, startReviewOutbox } from './events';
import { setOutboxUser } from './outboxUser';

function ok(): Response {
	return new Response(JSON.stringify({ accepted: 1, duplicates: 0 }), { status: 200 });
}

function setVisibility(state: 'visible' | 'hidden'): void {
	Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
	document.dispatchEvent(new Event('visibilitychange'));
}

beforeEach(() => {
	vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'Date'] });
	localStorage.clear();
	localStorage.setItem('qinqin.token', 'tok');
	resetOffline();
	setOutboxUser(1);
	vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('offline'))));
	vi.spyOn(console, 'warn').mockImplementation(() => {});
	setVisibility('visible');
});
afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	setOutboxUser(null);
	vi.useRealTimers();
});

describe('review sync triggers', () => {
	it('the offline store follows the queue size', async () => {
		await recordReview(1, 'c1', 3);
		await recordReview(1, 'c2', 3);
		expect(get(offline).queued).toBe(2);
	});

	it('retries every 60 s while reviews are queued and the page is visible, then stops', async () => {
		startReviewOutbox();
		await recordReview(1, 'c1', 3);
		const fetchMock = vi.mocked(fetch);
		fetchMock.mockClear();
		await vi.advanceTimersByTimeAsync(60_000);
		expect(fetchMock).toHaveBeenCalledTimes(1);

		fetchMock.mockReset();
		fetchMock.mockImplementation(async () => ok());
		await vi.advanceTimersByTimeAsync(60_000);
		expect(fetchMock).toHaveBeenCalledTimes(1); // the successful flush
		expect(get(offline).queued).toBe(0);

		fetchMock.mockClear();
		await vi.advanceTimersByTimeAsync(180_000);
		expect(fetchMock).not.toHaveBeenCalled(); // queue empty: the interval is gone
	});

	it('does not poll while the page is hidden; becoming visible flushes at once', async () => {
		startReviewOutbox();
		await recordReview(1, 'c1', 3);
		const fetchMock = vi.mocked(fetch);
		setVisibility('hidden');
		fetchMock.mockClear();
		await vi.advanceTimersByTimeAsync(300_000);
		expect(fetchMock).not.toHaveBeenCalled();

		fetchMock.mockImplementation(async () => ok());
		setVisibility('visible');
		await vi.advanceTimersByTimeAsync(0);
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(get(offline).queued).toBe(0);
	});

	it('shows "All reviews sent." after a flush emptied a queue, for five seconds', async () => {
		await recordReview(1, 'c1', 3);
		vi.mocked(fetch).mockImplementation(async () => ok());
		await flushPendingReviews();
		expect(get(offline).allSentAt).not.toBeNull();
		await vi.advanceTimersByTimeAsync(ALL_SENT_MS);
		expect(get(offline).allSentAt).toBeNull();
	});

	it('says nothing when an empty queue is flushed', async () => {
		await flushPendingReviews();
		expect(get(offline).allSentAt).toBeNull();
	});
});
