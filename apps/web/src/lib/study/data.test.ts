// The reads over the session's study cache (#193), on the fake study server:
// what replaced history.ts (8 s, merged) and studyData.ts (30 s, raw).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

import { endSession } from '../session/sessionEnd';
import { invalidateWorkspaceEvents } from '../events';
import { StudyServer } from '../testing/studyServer';
import * as build from '../testing/study';
import { cardRow, deckRow } from './rows';
import { addCard } from './commands/cards';
import { renameDeck } from './commands/decks';
import { getStudyData, hasCard, loadRawStudyData, loadStudyData, loadStudyHistory, onStudyChange, studyPullPages } from './data';

const WS = 7;
const AT = '2026-01-01T00:00:00Z';
const meta = { workspaceId: WS, version: 1, updatedAt: AT, deletedAt: null };
let server: StudyServer;

beforeEach(() => {
	endSession('signOut');
	invalidateWorkspaceEvents();
	server = new StudyServer({ pageSize: 2 });
	server.putTyped('decks', { ...deckRow({ id: 'd1', name: 'One', createdAt: AT }), ...meta });
	server.putTyped('cards', { ...cardRow(build.card({ id: 'c-vocab-1', entryId: 1, deckIds: ['d1'] })), ...meta });
	server.putTyped('cards', { ...cardRow(build.card({ id: 'c-vocab-2', entryId: 2, deckIds: ['d1'] })), ...meta });
	vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => undefined, removeItem: () => undefined });
	vi.stubGlobal('fetch', vi.fn(server.fetch));
});
afterEach(() => {
	endSession('signOut');
	vi.unstubAllGlobals();
});

describe('one study cache behind every read', () => {
	it('widgets, the is-studied check and the planners share one round', async () => {
		const [a, b, raw, data] = await Promise.all([loadStudyHistory(WS), loadStudyHistory(WS), loadRawStudyData(WS), getStudyData(WS)]);
		expect(a).toBe(b);
		expect(a.cards.map((c) => c.id)).toEqual(['c-vocab-1', 'c-vocab-2']);
		expect(raw.cards).toHaveLength(2);
		expect(hasCard(data.cards, 2)).toBe(true);
		expect(server.counts.pullPages).toBe(2);
		expect(server.counts.events).toBe(1);
		expect(studyPullPages(WS)).toBe(2);
	});

	it('a page reads the log fresh and gets its own copy; the rows come from the cache', async () => {
		const first = await loadStudyData(WS);
		first.cards.pop();
		const second = await loadStudyData(WS);
		expect(second.cards).toHaveLength(2);
		expect(server.counts.pullPages).toBe(2);
		expect(server.counts.events).toBe(2);
	});

	it('a write shows in every view at once, without a pull', async () => {
		await loadStudyHistory(WS);
		const changed: number[] = [];
		const off = onStudyChange((ws) => changed.push(ws));
		server.resetCounts();
		await addCard(WS, 3);
		await renameDeck(WS, 'd1', 'Renamed');
		expect(server.counts).toMatchObject({ pullPages: 0, pushes: 2 });
		expect(changed).toEqual([WS, WS]);
		expect(hasCard((await getStudyData(WS)).cards, 3)).toBe(true);
		expect((await loadStudyHistory(WS)).decks[0].name).toBe('Renamed');
		expect(server.counts.pullPages).toBe(0);
		off();
	});

	it('force (a widget\'s "Try again") reads a delta round and the log again', async () => {
		await loadStudyHistory(WS);
		server.resetCounts();
		await loadStudyHistory(WS, { force: true });
		expect(server.counts).toMatchObject({ pullPages: 1, events: 1 });
		expect(server.log[0]).toContain('since=');
	});

	it('keeps workspaces apart', async () => {
		await getStudyData(WS);
		expect((await getStudyData(8)).cards).toEqual([]);
	});

	it('the session end forgets every workspace', async () => {
		await getStudyData(WS);
		endSession('signOut');
		server.resetCounts();
		await getStudyData(WS);
		expect(server.counts.pullPages).toBe(2);
	});

	it('refuses a call without a workspace before any request', async () => {
		await expect(getStudyData(0)).rejects.toThrow(/workspace/);
		await expect(loadStudyHistory(Number.NaN)).rejects.toThrow(/workspace/);
		expect(fetch).not.toHaveBeenCalled();
	});
});

describe('hasCard', () => {
	it('finds a vocab card of the entry, not another kind', () => {
		const cards = [build.card({ id: 'a', entryId: 1 }), build.card({ id: 'b', kind: 'sentence', entryId: 2 })];
		expect(hasCard(cards, 1)).toBe(true);
		expect(hasCard(cards, 2)).toBe(false);
	});
});
