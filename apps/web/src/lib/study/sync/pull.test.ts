import { describe, expect, it } from 'vitest';
import { STUDY_COLLECTIONS, cardRow } from '../rows';
import { StudyServer } from '../../testing/studyServer';
import * as build from '../../testing/study';
import { STUDY_PULL_COLLECTIONS, pullStudyRound } from './pull';

const WS = 7;
const get = (s: StudyServer) => async (path: string) => (await s.fetch(path)).json() as Promise<unknown>;

describe('STUDY_PULL_COLLECTIONS', () => {
	it('is the switches and plugin rows plus every typed study collection (record 0002)', () => {
		expect(STUDY_PULL_COLLECTIONS).toEqual(['pluginStates', 'pluginData', ...STUDY_COLLECTIONS]);
		for (const collection of STUDY_COLLECTIONS) expect(STUDY_PULL_COLLECTIONS).toContain(collection);
	});

});

describe('pullStudyRound', () => {
	it('reads one workspace round with tombstones, then a delta from its cursor', async () => {
		let now = Date.parse('2026-02-01T10:00:00.400Z');
		const s = new StudyServer({ now: () => now, pageSize: 1 });
		const meta = { workspaceId: WS, version: 1, updatedAt: '2026-01-01T00:00:00Z', deletedAt: null };
		s.putTyped('cards', { ...cardRow(build.card({ id: 'a', entryId: 1 })), ...meta });
		s.putTyped('cards', { ...cardRow(build.card({ id: 'b', entryId: 2 })), ...meta, deletedAt: '2026-01-01T00:00:00Z' });
		const round = await pullStudyRound(get(s), WS);
		expect(round.pages).toBe(2);
		expect(round.collections.cards).toHaveLength(2);
		expect(s.log[0]).toBe(`GET /api/sync/pull?collections=${STUDY_PULL_COLLECTIONS.join('%2C')}&tombstones=1&v=2&workspace=7`);
		now += 60_000;
		s.putTyped('cards', { ...cardRow(build.card({ id: 'c', entryId: 3 })), ...meta, updatedAt: '2026-02-01T10:00:30Z' });
		const delta = await pullStudyRound(get(s), WS, round.cursor);
		expect(delta.collections.cards.map((c) => (c as { id: string }).id)).toEqual(['c']);
		expect(s.log.at(-1)).toContain('since=');
	});
});
