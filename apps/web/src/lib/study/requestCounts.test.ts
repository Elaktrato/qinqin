import { newSession, studyContext, type TestContext } from '$lib/testing/context';
// How many requests a read or a write costs (#193), on the fake study server
// with a workspace of 2,000 cards at 100 rows per page (a full round is 21
// pages). Before #193 every write pulled a full round first (21 pages), the
// reader's "is this studied" check pulled one more, and every page load pulled
// one; the numbers are in docs/superpowers/plans/2026-11-24-study-data-layer.md.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

import { invalidateWorkspaceEvents } from '../events';
import { StudyServer } from '../testing/studyServer';
import * as build from '../testing/study';
import { cardRow, deckRow } from './rows';
import { addCard, deleteCards } from './commands/cards';
import { renameDeck } from './commands/decks';
import { setKnownMark } from './commands/keyed';
import { getStudyData, loadStudyData, loadStudyHistory, onStudyChange } from './data';

let ctx: TestContext = studyContext();
beforeEach(() => {
	ctx = studyContext();
});

const WS = 7;
let server: StudyServer;

beforeEach(() => {
	newSession(ctx);
	invalidateWorkspaceEvents();
	server = new StudyServer({ pageSize: 100 });
	const at = '2026-01-01T00:00:00Z';
	const meta = { workspaceId: WS, version: 1, updatedAt: at, deletedAt: null };
	for (let d = 0; d < 5; d++) server.putTyped('decks', { ...deckRow({ id: `deck-${d}`, name: `D${d}`, createdAt: at }), ...meta });
	for (let i = 1; i <= 2000; i++) {
		server.putTyped('cards', { ...cardRow(build.card({ id: `c-vocab-${i}`, entryId: i, deckIds: ['deck-1'], createdAt: at })), ...meta });
	}
	vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => undefined, removeItem: () => undefined });
	vi.stubGlobal('fetch', vi.fn(server.fetch));
});
afterEach(() => {
	newSession(ctx);
	vi.unstubAllGlobals();
});

const counts = () => ({ pulls: server.counts.pullPages, pushes: server.counts.pushes, dataWrites: server.counts.dataWrites, logs: server.counts.events });

describe('requests per flow', () => {
	it('addCard on a cold tab: one full round, one push (before: 21 + 1)', async () => {
		await addCard(ctx.session.study, WS, 5000);
		expect(counts()).toEqual({ pulls: 21, pushes: 1, dataWrites: 0, logs: 0 });
	});

	it('the reader: the is-studied check, then add: one full round, one push (before: 42 + 1)', async () => {
		await getStudyData(ctx.session.study, WS);
		await addCard(ctx.session.study, WS, 5000);
		expect(counts()).toEqual({ pulls: 21, pushes: 1, dataWrites: 0, logs: 0 });
	});

	it('rename a deck after the study page loaded: one push (before: 21 + 1)', async () => {
		await loadStudyData(ctx.session.study, WS);
		server.resetCounts();
		await renameDeck(ctx.session.study, WS, 'deck-1', 'x');
		expect(counts()).toEqual({ pulls: 0, pushes: 1, dataWrites: 0, logs: 0 });
	});

	it('delete three cards after the study page loaded: three pushes (before: 21 + 3)', async () => {
		await loadStudyData(ctx.session.study, WS);
		server.resetCounts();
		await deleteCards(ctx.session.study, WS, ['c-vocab-1', 'c-vocab-2', 'c-vocab-3']);
		expect(counts()).toEqual({ pulls: 0, pushes: 3, dataWrites: 0, logs: 0 });
	});

	it('a known mark after the home widgets: one PUT (as before)', async () => {
		await loadStudyHistory(ctx.session.study, WS);
		server.resetCounts();
		await setKnownMark(ctx.session.study, WS, 5, true);
		expect(counts()).toEqual({ pulls: 0, pushes: 0, dataWrites: 1, logs: 0 });
	});

	it('the study page: a full round and the log, then the log only (before: 21 + 1 each time)', async () => {
		await loadStudyData(ctx.session.study, WS);
		expect(counts()).toEqual({ pulls: 21, pushes: 0, dataWrites: 0, logs: 1 });
		server.resetCounts();
		await loadStudyData(ctx.session.study, WS);
		expect(counts()).toEqual({ pulls: 0, pushes: 0, dataWrites: 0, logs: 1 });
	});

	it('rename with the study page listening: one push, one reload; the echo of the write reloads nothing', async () => {
		await loadStudyData(ctx.session.study, WS);
		let reloads = 0;
		const reloading: Promise<unknown>[] = [];
		const off = onStudyChange(ctx.session.study, () => {
			reloads++;
			reloading.push(loadStudyData(ctx.session.study, WS));
		});
		server.resetCounts();
		await renameDeck(ctx.session.study, WS, 'deck-1', 'x');
		await Promise.all(reloading);
		// The next delta round, two seconds on, brings the server's copy of the write back.
		server.now = () => Date.now() + 2_000;
		await loadStudyHistory(ctx.session.study, WS, { force: true });
		await Promise.all(reloading);
		off();
		expect(reloads).toBe(1);
		expect(counts()).toEqual({ pulls: 1, pushes: 1, dataWrites: 0, logs: 2 });
	});
});
