// Writes plan against the study cache and update it in place (#193); a write
// the server skips refreshes the cache and plans once more.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

import { endSession } from '../../session/sessionEnd';
import { PartialPushError } from '../../sync/push';
import { StudyServer } from '../../testing/studyServer';
import { deckRow, type DeckRow } from '../rows';
import { getStudyData, studyCache } from '../data';
import { renameDeck } from './decks';
import { saveVacation, setKnownMark, setKnownMarks } from './keyed';

const WS = 7;
/** The server's clock runs a minute ahead of this device's. */
const AHEAD = 60_000;
let server: StudyServer;

function deckAt(name: string, at: string) {
	return { ...deckRow({ id: 'd1', name, createdAt: '2026-01-01T00:00:00Z' }), workspaceId: WS, version: 1, updatedAt: at, deletedAt: null };
}

beforeEach(() => {
	endSession('signOut');
	server = new StudyServer({ now: () => Date.now() + AHEAD });
	server.putTyped('decks', deckAt('One', '2026-01-01T00:00:00Z'));
	vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => undefined, removeItem: () => undefined });
	vi.stubGlobal('fetch', vi.fn(server.fetch));
});
afterEach(() => {
	endSession('signOut');
	vi.unstubAllGlobals();
});

describe('a write the server skips', () => {
	it('refreshes the cache with a delta round and plans once more, stamped after the newer row', async () => {
		await getStudyData(WS);
		// Another device renamed the deck a moment ago, by the server's clock: newer than this device's now.
		const theirs = new Date(Date.now() + AHEAD - 1_000).toISOString();
		server.putTyped('decks', deckAt('Theirs', theirs));
		server.resetCounts();
		await renameDeck(WS, 'd1', 'Mine');
		expect(server.counts).toMatchObject({ pushes: 2, pullPages: 1 });
		expect(server.log[1]).toContain('since=');
		expect((server.typedRows('decks', WS)[0] as DeckRow).name).toBe('Mine');
		expect(Date.parse(server.typedRows('decks', WS)[0].updatedAt)).toBeGreaterThan(Date.parse(theirs));
		expect((await getStudyData(WS)).decks[0].name).toBe('Mine');
	});

	it('a second skip is the PartialPushError it was, and the cache reads again next time', async () => {
		await getStudyData(WS);
		// The server skips every push.
		const push = server.fetch;
		vi.mocked(fetch).mockImplementation(async (input, init) =>
			String(input) === '/api/sync/push'
				? new Response(JSON.stringify({ dataAccepted: 0, dataSkipped: 1, dataRefused: 0 }))
				: push(input, init)
		);
		await expect(renameDeck(WS, 'd1', 'Mine')).rejects.toBeInstanceOf(PartialPushError);
		expect(studyCache.peek(WS)?.data.decks[0].name).toBe('One');
		server.resetCounts();
		await getStudyData(WS);
		expect(server.counts.pullPages).toBe(1);
	});

	it('keyed batch rows re-plan the same way', async () => {
		await getStudyData(WS);
		server.putData({ pluginId: 'qinqin-flashcards', key: 'known:5', workspaceId: WS, data: { version: 1, entryId: 5, createdAt: '2026-01-01T00:00:00Z' }, updatedAt: new Date(Date.now() + AHEAD - 1_000).toISOString(), deletedAt: null });
		server.resetCounts();
		await setKnownMarks(WS, [5], false);
		expect(server.counts).toMatchObject({ pushes: 2, pullPages: 1 });
		expect([...server.data.values()].find((row) => row.key === 'known:5')?.deletedAt).not.toBeNull();
	});
});

describe('held keyed writes (review fixes)', () => {
	it("a deleted keyed row is held stamped just after what the server held, not by this device's clock", async () => {
		server.putData({ pluginId: 'qinqin-flashcards', key: 'known:5', workspaceId: WS, data: { version: 1, entryId: 5, createdAt: '2026-01-01T00:00:00Z' }, updatedAt: '2026-01-02T00:00:00Z', deletedAt: null });
		await getStudyData(WS);
		await setKnownMark(WS, 5, false);
		expect(studyCache.peek(WS)?.snapshot.knownAt.get('known:5')).toBe('2026-01-02T00:00:00.001Z');
		expect(studyCache.peek(WS)?.data.known).toBeUndefined();
	});

	it("a user-global write answered after sign-out never lands in the next user's rows", async () => {
		const serverB = new StudyServer({ now: () => Date.now() + AHEAD });
		let release: () => void = () => undefined;
		const held = new Promise<void>((resolve) => (release = resolve));
		let user: 'A' | 'B' = 'A';
		vi.mocked(fetch).mockImplementation(async (input, init) => {
			if (user === 'A') {
				if (init?.method === 'PUT') await held;
				return server.fetch(input, init);
			}
			return serverB.fetch(input, init);
		});
		await getStudyData(WS);
		const period = { version: 1 as const, id: 'v1', start: '2026-02-01', end: '2026-02-03', scope: 'all' as const, createdDay: '2026-02-01', createdAt: '2026-02-01T10:00:00Z' };
		const writing = saveVacation(period);
		await new Promise((resolve) => setTimeout(resolve, 0));
		endSession('signOut');
		user = 'B';
		await getStudyData(WS);
		const changed: number[] = [];
		studyCache.onChange((ws) => changed.push(ws));
		release();
		await writing;
		expect(studyCache.peek(WS)?.data.vacations).toBeUndefined();
		expect(changed).toEqual([]);
	});
});
