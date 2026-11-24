import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ALL_SENT_MS } from '../pwa/offlineState.svelte';
import { browserTimers } from '../context/deps';
import { testContext, type TestContext } from '../testing/context';

let ctx: TestContext;

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
	// The session's outbox with the browser's window, document, clock and (fake) timers.
	ctx = testContext({ token: 'tok', deps: { local: () => localStorage, timers: browserTimers, window, document, now: () => Date.now() } });
	vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('offline'))));
	vi.spyOn(console, 'warn').mockImplementation(() => {});
	setVisibility('visible');
});
afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	ctx.app.dispose();
	vi.useRealTimers();
});

describe('review sync triggers', () => {
	it('the offline store follows the queue size', async () => {
		await ctx.session.outbox.recordReview(1, 'c1', 3);
		await ctx.session.outbox.recordReview(1, 'c2', 3);
		expect(ctx.app.offline.queued).toBe(2);
	});

	it('retries every 60 s while reviews are queued and the page is visible, then stops', async () => {
		ctx.session.outbox.start();
		await ctx.session.outbox.recordReview(1, 'c1', 3);
		const fetchMock = vi.mocked(fetch);
		fetchMock.mockClear();
		await vi.advanceTimersByTimeAsync(60_000);
		expect(fetchMock).toHaveBeenCalledTimes(1);

		fetchMock.mockReset();
		fetchMock.mockImplementation(async () => ok());
		await vi.advanceTimersByTimeAsync(120_000); // the first failure backed the poll off
		expect(fetchMock).toHaveBeenCalledTimes(1); // the successful flush
		expect(ctx.app.offline.queued).toBe(0);

		fetchMock.mockClear();
		await vi.advanceTimersByTimeAsync(180_000);
		expect(fetchMock).not.toHaveBeenCalled(); // queue empty: the interval is gone
	});

	it('backs off after a failed retry: the next poll waits two minutes, a reconnect does not', async () => {
		ctx.session.outbox.start();
		await ctx.session.outbox.recordReview(1, 'c1', 3);
		const fetchMock = vi.mocked(fetch);
		fetchMock.mockClear();
		await vi.advanceTimersByTimeAsync(60_000); // first poll fails
		expect(fetchMock).toHaveBeenCalledTimes(1);
		await vi.advanceTimersByTimeAsync(60_000); // backed off
		expect(fetchMock).toHaveBeenCalledTimes(1);
		await vi.advanceTimersByTimeAsync(60_000);
		expect(fetchMock).toHaveBeenCalledTimes(2);
		fetchMock.mockImplementation(async () => ok());
		window.dispatchEvent(new Event('online')); // explicit trigger ignores the back-off
		await vi.advanceTimersByTimeAsync(0);
		expect(fetchMock).toHaveBeenCalledTimes(3);
	});

	it('does not poll while the page is hidden; becoming visible flushes at once', async () => {
		ctx.session.outbox.start();
		await ctx.session.outbox.recordReview(1, 'c1', 3);
		const fetchMock = vi.mocked(fetch);
		setVisibility('hidden');
		fetchMock.mockClear();
		await vi.advanceTimersByTimeAsync(300_000);
		expect(fetchMock).not.toHaveBeenCalled();

		fetchMock.mockImplementation(async () => ok());
		setVisibility('visible');
		await vi.advanceTimersByTimeAsync(0);
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(ctx.app.offline.queued).toBe(0);
	});

	it('shows "All reviews sent." after a flush emptied a queue, for five seconds', async () => {
		await ctx.session.outbox.recordReview(1, 'c1', 3);
		vi.mocked(fetch).mockImplementation(async () => ok());
		await ctx.session.outbox.flush();
		expect(ctx.app.offline.allSentAt).not.toBeNull();
		await vi.advanceTimersByTimeAsync(ALL_SENT_MS);
		expect(ctx.app.offline.allSentAt).toBeNull();
	});

	it('says nothing when an empty queue is flushed', async () => {
		await ctx.session.outbox.flush();
		expect(ctx.app.offline.allSentAt).toBeNull();
	});
});
