import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./layout', async (importOriginal) => ({ ...(await importOriginal<typeof import('./layout')>()), loadLayout: vi.fn() }));
vi.mock('./options', async (importOriginal) => ({ ...(await importOriginal<typeof import('./options')>()), loadWidgetOptions: vi.fn() }));

import { loadLayout } from './layout';
import { loadWidgetOptions, parseWidgetOptions } from './options';
import { forgetHomeCopies, heldLayout, heldOptions, refreshLayout, refreshOptions, rememberHeatmapLayout, rememberLayout } from './homeData';
import { memoryStorage, newSession, testContext, type TestContext } from '$lib/testing/context';

let ctx: TestContext;
// The device's storage, shared by every session of the test (one browser).
let localStorage: Storage;
beforeEach(() => {
	localStorage = memoryStorage();
	ctx = testContext({ deps: { local: () => localStorage } });
	vi.mocked(loadLayout).mockResolvedValue(['daily-goal']);
	vi.mocked(loadWidgetOptions).mockResolvedValue(parseWidgetOptions({ version: 1, 'activity-heatmap': { layout: 'week' } }));
});
afterEach(() => {
	vi.clearAllMocks();
});

describe('Home setup held for the session (#290)', () => {
	it('nothing is held before the first read; a read holds the layout for the session', async () => {
		expect(heldLayout(ctx.session)).toBeNull();
		expect(await refreshLayout(ctx.session)).toEqual(['daily-goal']);
		expect(heldLayout(ctx.session)).toEqual({ ids: ['daily-goal'] });
	});

	it('a save on this device updates the held copies at once', async () => {
		await refreshLayout(ctx.session);
		await refreshOptions(ctx.session);
		rememberLayout(ctx.session, ['weekly-summary']);
		rememberHeatmapLayout(ctx.session, 'month');
		expect(heldLayout(ctx.session)).toEqual({ ids: ['weekly-summary'] });
		expect(heldOptions(ctx.session)?.heatmapLayout).toBe('month');
	});

	it('a failed read keeps what is held', async () => {
		await refreshLayout(ctx.session);
		vi.mocked(loadLayout).mockRejectedValueOnce(new TypeError('offline'));
		await expect(refreshLayout(ctx.session)).rejects.toThrow('offline');
		expect(heldLayout(ctx.session)).toEqual({ ids: ['daily-goal'] });
	});

	it('the device copy gives a new session of the same user a warm start, and another user nothing', async () => {
		await refreshLayout(ctx.session);
		await refreshOptions(ctx.session);
		newSession(ctx, 'expired');
		expect(heldLayout(ctx.session)).toEqual({ ids: ['daily-goal'] });
		expect(heldOptions(ctx.session)?.heatmapLayout).toBe('week');
		const other = testContext({ user: { id: 2, username: 'bo' }, deps: { local: () => localStorage } });
		expect(heldLayout(other.session)).toBeNull();
		expect(heldOptions(other.session)).toBeNull();
	});

	it('a sign-out removes the device copies', async () => {
		await refreshLayout(ctx.session);
		newSession(ctx, 'signOut');
		expect(heldLayout(ctx.session)).toBeNull();
		expect([...Array(localStorage.length)].map((_, i) => localStorage.key(i)).filter((k) => k?.startsWith('qinqin.home.'))).toEqual([]);
	});

	it('an answer that lands after the session ended is not held', async () => {
		let resolve!: (v: string[] | null) => void;
		vi.mocked(loadLayout).mockReturnValueOnce(new Promise((r) => (resolve = r)));
		const old = ctx.session;
		const running = refreshLayout(old);
		newSession(ctx, 'expired');
		resolve(['late']);
		await running;
		expect(heldLayout(ctx.session)).toBeNull();
	});

	it('forgetHomeCopies leaves other keys alone', () => {
		localStorage.setItem('qinqin.other', '1');
		localStorage.setItem('qinqin.home.v1.1', '{}');
		forgetHomeCopies(localStorage);
		expect(localStorage.getItem('qinqin.other')).toBe('1');
		expect(localStorage.getItem('qinqin.home.v1.1')).toBeNull();
	});
});
