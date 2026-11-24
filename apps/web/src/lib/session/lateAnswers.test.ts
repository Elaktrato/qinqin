// #173: an answer requested for the session that ended never sets
// per-user state afterwards: the workspace list and the plugin states. And ending the session empties the content-keyed memos.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';

import { endSession } from './sessionEnd';
import { WORKSPACE_KEY } from '../workspaces.svelte';
import { testContext, workspacesState } from '../testing/context';
import { loadPluginStates, pluginStates } from '../plugins/states';

function storage(): Storage {
	const data = new Map<string, string>();
	return {
		getItem: (k: string) => data.get(k) ?? null,
		setItem: (k: string, v: string) => void data.set(k, v),
		removeItem: (k: string) => void data.delete(k),
		clear: () => data.clear(),
		key: (i: number) => [...data.keys()][i] ?? null,
		get length() {
			return data.size;
		}
	} as Storage;
}

let release: () => void = () => undefined;

beforeEach(() => {
	vi.stubGlobal('localStorage', storage());
	const gate = new Promise<void>((r) => (release = r));
	vi.stubGlobal(
		'fetch',
		vi.fn(async (input: unknown) => {
			await gate;
			const url = String(input);
			if (url === '/api/workspaces') return Response.json([{ id: 7, language: 'zh', name: 'A', settings: {}, updatedAt: '2026-01-01T00:00:00Z' }]);
			if (url === '/api/plugins') return Response.json([{ id: 'qinqin-journal', enabled: true, manifest: {} }]);
			return new Response('{}', { status: 404 });
		})
	);
	pluginStates.set({ list: [], status: 'idle' });
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('late answers after the session ended (#173)', () => {
	it('a workspace list in flight sets nothing', async () => {
		const ctx = testContext({ deps: { local: () => localStorage } });
		const session = ctx.session;
		const late = session.workspaces.load();
		ctx.app.auth.logout();
		release();
		await late;
		expect(workspacesState(session.workspaces)).toEqual({ list: [], current: null });
		expect(session.workspaces.loaded).toBe(false);
		expect(localStorage.getItem(WORKSPACE_KEY)).toBeNull();
	});

	it('plugin states in flight set nothing', async () => {
		const late = loadPluginStates();
		endSession('expired');
		release();
		await late;
		expect(get(pluginStates).list).toEqual([]);
		expect(get(pluginStates).status).not.toBe('ready');
	});
});

describe('ending the session empties the content-keyed memos (#173)', () => {
	it('replay timelines, week log passes, reached milestones, schedulers and day counts are computed again', async () => {
		const { timelinesFor } = await import('../weekly/replay');
		const { summaryStats, weekSummary } = await import('../weekly/summary');
		const { reachedFromLog, reachedStats } = await import('../milestones/reached');
		const { schedulerCacheSize } = await import('../study/scheduler');
		const { dayCountsCached } = await import('../study/limits');
		const { studyDay } = await import('../time/studyDay');
		const { IDENTITY_CLOCK } = await import('../study/studyClock');
		const { DEFAULT_W } = await import('../study/fsrs/params');
		const day = studyDay([]);
		const now = Date.parse('2026-11-17T12:00:00Z');
		const reviews = [
			{ id: 'r1', workspaceId: 1, device: 'web', ts: '2026-11-16T10:00:00Z', type: 'review', payload: { cardId: 'c1', mode: 'vocab', grade: 3 } }
		] as never[];
		const cards = [{ id: 'c1', kind: 'vocab', entryId: 1, deckIds: ['general'], createdAt: 't' }] as never[];
		const week = () =>
			weekSummary({ monday: '2026-11-16', now, day, workspaceId: 1, reviews, vacation: [], activity: { sources: [], cells: [] }, goals: null, mature: () => 0 } as never);
		const reached = () =>
			reachedFromLog({ reviews, events: [], cards, deckIds: new Set(['general']), day, vacation: [], now, families: new Set(['reviews'] as never[]), workspaceId: 1 } as never);

		const t1 = timelinesFor(reviews, DEFAULT_W, IDENTITY_CLOCK);
		t1.of('c1'); // builds a scheduler
		week();
		const passes = summaryStats.logPasses;
		const r1 = reached();
		const reachedPasses = reachedStats.passes;
		const ctx = { day } as never;
		const counts = dayCountsCached(cards, reviews, ctx, new Date(now));
		// Memo hits before the end.
		expect(timelinesFor(reviews, DEFAULT_W, IDENTITY_CLOCK)).toBe(t1);
		week();
		expect(summaryStats.logPasses).toBe(passes);
		expect(reached()).toBe(r1);
		expect(dayCountsCached(cards, reviews, ctx, new Date(now))).toBe(counts);
		expect(schedulerCacheSize()).toBeGreaterThan(0);

		endSession('signOut');
		expect(schedulerCacheSize()).toBe(0);

		expect(timelinesFor(reviews, DEFAULT_W, IDENTITY_CLOCK)).not.toBe(t1);
		week();
		expect(summaryStats.logPasses).toBe(passes + 1);
		expect(reached()).not.toBe(r1);
		expect(reachedStats.passes).toBeGreaterThan(reachedPasses);
		expect(dayCountsCached(cards, reviews, ctx, new Date(now))).not.toBe(counts);
	});
});
