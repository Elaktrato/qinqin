import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The real study history (sync pull, event log, canonical merge); only the
// network, the zone and navigation are faked.
const { goto } = vi.hoisted(() => ({ goto: vi.fn() }));
vi.mock('$app/navigation', () => ({ goto }));
vi.mock('../time/zone', async () => {
	const { studyDay } = await import('../time/studyDay');
	return { currentStudyDay: () => studyDay([]) };
});

import { invalidateStudyHistory } from '../study/history';
import { loadGoalStatus } from './loadGoal';
import { pagedPull } from '$lib/testing/legacyCodec';
import * as build from '$lib/testing/study';

const NOW = Date.parse('2026-11-16T12:00:00Z');
const json = (body: unknown) =>
	new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
const row = (key: string, data: unknown) => ({
	pluginId: 'qinqin-flashcards',
	key,
	userId: 1,
	workspaceId: 3,
	data,
	version: 1,
	updatedAt: '2026-01-01T00:00:00Z',
	deletedAt: null
});
const review = (id: string, ts: string, cardId: string) => build.review({ id, ts, cardId, workspaceId: 3 });

beforeEach(() => {
	const store = new Map<string, string>();
	vi.stubGlobal('localStorage', {
		getItem: (k: string) => store.get(k) ?? null,
		setItem: (k: string, v: string) => void store.set(k, v),
		removeItem: (k: string) => void store.delete(k),
		clear: () => store.clear(),
		key: () => null,
		length: 0
	});
	invalidateStudyHistory();
});
afterEach(() => {
	vi.unstubAllGlobals();
	invalidateStudyHistory();
});

describe('loadGoalStatus through the canonical merge', () => {
	it('counts a merged duplicate card once as new', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async (input: RequestInfo | URL) => {
				const url = String(input);
				if (url.startsWith('/api/sync/pull')) {
					return json(pagedPull({
						pluginData: [
							row('goals:workspace', {
								version: 1,
								showStreak: false,
								history: [{ from: '2026-11-01', metric: 'flashcards:new', target: 2 }]
							}),
							// Two stored rows of the same vocab card (pre-deterministic ids).
							row('card:01JOLDCARD0000000000000001', { id: '01JOLDCARD0000000000000001', kind: 'vocab', entryId: 7, deckIds: ['general'], createdAt: '2026-01-01T00:00:00Z' }),
							row('card:01JOLDCARD0000000000000002', { id: '01JOLDCARD0000000000000002', kind: 'vocab', entryId: 7, deckIds: ['general'], createdAt: '2026-01-02T00:00:00Z' })
						]
					}));
				}
				if (url.startsWith('/api/events')) {
					return json([
						review('01JMERGE000000000000000001', '2026-11-16T09:00:00Z', '01JOLDCARD0000000000000001'),
						review('01JMERGE000000000000000002', '2026-11-16T09:05:00Z', '01JOLDCARD0000000000000002')
					]);
				}
				throw new Error(`unexpected ${url}`);
			})
		);
		const view = await loadGoalStatus(3, { now: NOW });
		expect(view.today.status).toBe('open');
		expect(view.today.amount).toBe(1);
	});
});
