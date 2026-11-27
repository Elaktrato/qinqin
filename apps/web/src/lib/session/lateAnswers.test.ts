// #173: an answer requested for the session that ended never sets
// per-user state afterwards: the workspace list and the plugin states. And ending the session empties the content-keyed memos.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { WORKSPACE_KEY } from '$lib/workspace/workspaces.svelte';
import { newSession, testContext, workspacesState } from '../testing/context';

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
			if (url === '/api/features') return Response.json([{ id: 'journal', enabled: true, updatedAt: null }]);
			return new Response('{}', { status: 404 });
		})
	);
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
		const ctx = testContext();
		const session = ctx.session;
		const late = session.features.load();
		ctx.app.auth.expire();
		release();
		await late;
		expect(session.features.list).toEqual([]);
		expect(session.features.status).not.toBe('ready');
	});
});

describe('a new session starts with empty content-keyed memos (#173, record 0009)', () => {
	it('replay timelines, week log passes and reached milestones are computed again', async () => {
		const { timelinesFor } = await import('../weekly/replay');
		const { summaryStats, weekSummary } = await import('../weekly/summary');
		const { reachedFromLog, reachedStats } = await import('../milestones/reached');
		const { studyDay } = await import('../time/studyDay');
		const { IDENTITY_CLOCK } = await import('$lib/studycore/studyClock');
		const { DEFAULT_W } = await import('$lib/studycore/fsrsParams');
		const ctx = testContext();
		const day = studyDay([]);
		const now = Date.parse('2026-11-17T12:00:00Z');
		const reviews = [
			{ id: 'r1', workspaceId: 1, device: 'web', ts: '2026-11-16T10:00:00Z', type: 'review', payload: { cardId: 'c1', mode: 'vocab', grade: 3 } }
		] as never[];
		const cards = [{ id: 'c1', kind: 'vocab', entryId: 1, deckIds: ['general'], createdAt: 't' }] as never[];
		const week = () =>
			weekSummary(ctx.session.caches.weekPasses, { monday: '2026-11-16', now, day, workspaceId: 1, reviews, vacation: [], activity: { sources: [], cells: [] }, goals: null, mature: () => 0 } as never);
		const reached = () =>
			reachedFromLog(ctx.session.caches.reached, { reviews, events: [], cards, deckIds: new Set(['general']), day, vacation: [], now, families: new Set(['reviews'] as never[]), workspaceId: 1 } as never);
		const timelines = () => timelinesFor(ctx.session.caches.timelines, reviews, DEFAULT_W, IDENTITY_CLOCK);

		const t1 = timelines();
		week();
		const passes = summaryStats.logPasses;
		const r1 = reached();
		const reachedPasses = reachedStats.passes;
		// Memo hits within the session.
		expect(timelines()).toBe(t1);
		week();
		expect(summaryStats.logPasses).toBe(passes);
		expect(reached()).toBe(r1);

		newSession(ctx);

		expect(timelines()).not.toBe(t1);
		week();
		expect(summaryStats.logPasses).toBe(passes + 1);
		expect(reached()).not.toBe(r1);
		expect(reachedStats.passes).toBeGreaterThan(reachedPasses);
	});
});
