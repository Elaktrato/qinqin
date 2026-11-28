import { describe, expect, it } from 'vitest';
import { STUDY_PULL_COLLECTIONS } from '$lib/studycore/sync/pull';
import { parsePullPage, pullAll, firstPageUrl } from '../sync/pager';
import { cardRow } from '$lib/studycore/rows';
import { StudyServer } from './studyServer';
import * as build from './study';

const WS = 7;
const meta = (at: string) => ({ workspaceId: WS, version: 1, updatedAt: at, deletedAt: null });

function seeded(now: number, n: number, pageSize = 2): StudyServer {
	const s = new StudyServer({ now: () => now, pageSize });
	for (let i = 1; i <= n; i++) s.putTyped('cards', { ...cardRow(build.card({ id: `c${i}`, entryId: i })), ...meta('2026-01-01T00:00:00Z') });
	return s;
}

const get = (s: StudyServer) => async (path: string) => (await s.fetch(path)).json() as Promise<unknown>;

describe('the fake study server', () => {
	it('serves contract pages: a paged round, then a cursor', async () => {
		const s = seeded(Date.parse('2026-02-01T10:00:00.400Z'), 5);
		const first = firstPageUrl({ collections: STUDY_PULL_COLLECTIONS, workspace: WS, tombstones: true });
		const page = await (await s.fetch(first)).json();
		expect(parsePullPage(page, STUDY_PULL_COLLECTIONS)).not.toBeNull();
		const round = await pullAll(get(s), first, STUDY_PULL_COLLECTIONS);
		expect(round.pages).toBe(3);
		expect(round.collections.cards).toHaveLength(5);
		expect(s.counts.pullPages).toBe(4);
	});

	it('leaves a row of the round second out, and a delta from the cursor brings it', async () => {
		let now = Date.parse('2026-02-01T10:00:00.400Z');
		const s = new StudyServer({ now: () => now });
		s.putTyped('cards', { ...cardRow(build.card({ id: 'late' })), ...meta('2026-02-01T10:00:00.100Z') });
		const first = firstPageUrl({ collections: STUDY_PULL_COLLECTIONS, workspace: WS, tombstones: true });
		const round = await pullAll(get(s), first, STUDY_PULL_COLLECTIONS);
		expect(round.collections.cards).toEqual([]);
		now += 1000;
		const delta = await pullAll(get(s), firstPageUrl({ collections: STUDY_PULL_COLLECTIONS, workspace: WS, tombstones: true, since: round.cursor }), STUDY_PULL_COLLECTIONS);
		expect(delta.collections.cards).toHaveLength(1);
	});

	it('applies a push by last write wins at second precision and counts skips', async () => {
		const s = seeded(Date.parse('2026-02-01T10:00:00Z'), 1);
		const item = (at: string) => ({ ...cardRow(build.card({ id: 'c1', entryId: 1, deckIds: ['x'] })), workspaceId: WS, updatedAt: at });
		const push = async (at: string) => (await s.fetch('/api/sync/push', { method: 'POST', body: JSON.stringify({ cards: [item(at)] }) })).json();
		expect(await push('2025-12-31T23:59:59Z')).toMatchObject({ dataAccepted: 0, dataSkipped: 1 });
		expect(await push('2026-01-01T00:00:00.500Z')).toMatchObject({ dataAccepted: 1, dataSkipped: 0 });
		expect(s.typedRows('cards', WS)[0]).toMatchObject({ deckIds: ['x'], updatedAt: '2026-01-01T00:00:00.500Z' });
	});

	it('stamps plugin-data writes with its own clock', async () => {
		const s = new StudyServer({ now: () => Date.parse('2026-02-01T10:00:00Z') });
		const put = await (await s.fetch('/api/rows/k?workspace=7', { method: 'PUT', body: '{"a":1}' })).json();
		expect(put).toMatchObject({ key: 'k', workspaceId: 7, data: { a: 1 }, updatedAt: '2026-02-01T10:00:00.000Z' });
		expect((await s.fetch('/api/rows/k', { method: 'DELETE' })).status).toBe(404);
		expect((await s.fetch('/api/rows/k?workspace=7', { method: 'DELETE' })).status).toBe(204);
	});
});
