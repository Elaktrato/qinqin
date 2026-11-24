import { beforeEach, describe, expect, it } from 'vitest';
import { ApiError } from '../api/client';
import { STUDY_NAMESPACE } from '../sync/keyed';
import { StudyServer } from '../testing/studyServer';
import * as build from '../testing/study';
import { cardRow, deckRow, type StudyRow } from './rows';
import { pullStudyRound } from './sync/pull';
import { StudyCache, type StudyCacheDeps } from './cache';

const WS = 7;
const T0 = Date.parse('2026-02-01T10:00:00.400Z');

function meta(at: string, deletedAt: string | null = null) {
	return { workspaceId: WS, version: 1, updatedAt: at, deletedAt };
}

function cardAt(id: string, entryId: number, at: string, deletedAt: string | null = null): StudyRow {
	return { ...cardRow(build.card({ id, entryId })), ...meta(at, deletedAt) };
}

/** A clock, the fake server on it and a cache with manual timers. */
function setup(over: Partial<StudyCacheDeps> = {}) {
	const clock = { now: T0 };
	const server = new StudyServer({ now: () => clock.now, pageSize: 2 });
	const timers: { at: number; fn: () => void }[] = [];
	let epoch = 0;
	const rounds: { workspaceId: number; full: boolean }[] = [];
	const cache = new StudyCache({
		pull: (workspaceId, since) => pullStudyRound(async (path) => (await server.fetch(path)).json(), workspaceId, since),
		now: () => clock.now,
		epoch: () => epoch,
		setTimer: (fn, ms) => {
			const timer = { at: clock.now + ms, fn };
			timers.push(timer);
			return timer;
		},
		clearTimer: (timer) => {
			const at = timers.indexOf(timer as (typeof timers)[number]);
			if (at >= 0) timers.splice(at, 1);
		},
		onRound: (workspaceId, _view, full) => rounds.push({ workspaceId, full }),
		...over
	});
	/** advance moves the clock and runs the timers that are due. */
	async function advance(ms: number): Promise<void> {
		clock.now += ms;
		for (const timer of timers.filter((t) => t.at <= clock.now)) {
			timers.splice(timers.indexOf(timer), 1);
			timer.fn();
		}
		await settle();
	}
	return { clock, server, cache, timers, rounds, advance, endSession: () => (epoch += 1) };
}

/** Lets every pending promise of the fake server and the cache run. */
async function settle(): Promise<void> {
	for (let i = 0; i < 20; i++) await Promise.resolve();
	await new Promise((resolve) => setTimeout(resolve, 0));
}

const ids = (cards: { id: string }[]) => cards.map((card) => card.id);

describe('StudyCache: rounds', () => {
	let s: ReturnType<typeof setup>;
	beforeEach(() => {
		s = setup();
		s.server.putTyped('cards', cardAt('a', 1, '2026-01-01T00:00:00Z'));
		s.server.putTyped('cards', cardAt('b', 2, '2026-01-01T00:00:00Z'));
		s.server.putTyped('cards', cardAt('gone', 3, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'));
		s.server.putTyped('decks', { ...deckRow({ id: 'd', name: 'D', createdAt: '2026-01-01T00:00:00Z' }), ...meta('2026-01-01T00:00:00Z') });
	});

	it('loads a workspace with one full round, tombstones in the snapshot only', async () => {
		const view = await s.cache.view(WS);
		expect(ids(view.data.cards)).toEqual(['a', 'b']);
		expect(view.snapshot.stored.get('cards:gone')?.deletedAt).toBe('2026-01-01T00:00:00Z');
		expect(view.snapshot.knownAt.get('cards:a')).toBe('2026-01-01T00:00:00Z');
		expect(s.server.counts.pullPages).toBe(2);
		expect(s.cache.pages(WS)).toBe(2);
		expect(s.rounds).toEqual([{ workspaceId: WS, full: true }]);
	});

	it('serves a fresh slot without a request and shares one round between readers', async () => {
		const [one, two] = await Promise.all([s.cache.view(WS), s.cache.view(WS)]);
		expect(one).toBe(two);
		await s.advance(7_000);
		expect(await s.cache.view(WS)).toBe(one);
		expect(s.server.counts.pullPages).toBe(2);
	});

	it('refreshes an older slot with a delta round from its cursor and merges it by key', async () => {
		await s.cache.view(WS);
		await s.advance(9_000);
		s.server.putTyped('cards', cardAt('c', 4, new Date(s.clock.now - 2_000).toISOString()));
		s.server.putTyped('cards', cardAt('a', 1, new Date(s.clock.now - 2_000).toISOString(), new Date(s.clock.now - 2_000).toISOString()));
		s.server.resetCounts();
		const view = await s.cache.view(WS);
		expect(s.server.counts.pullPages).toBe(1);
		expect(s.server.log[0]).toContain('since=');
		expect(ids(view.data.cards)).toEqual(['b', 'c']);
		expect(view.snapshot.stored.get('cards:a')?.deletedAt).not.toBeNull();
		expect(s.rounds.at(-1)).toEqual({ workspaceId: WS, full: false });
	});

	it('reads a full round again when the last one is older than five minutes', async () => {
		await s.cache.view(WS);
		await s.advance(301_000);
		s.server.resetCounts();
		await s.cache.view(WS);
		expect(s.server.log[0]).not.toContain('since=');
		expect(s.rounds.at(-1)?.full).toBe(true);
	});

	it('force reads a delta at once; full reads a full round', async () => {
		await s.cache.view(WS);
		s.server.resetCounts();
		await s.cache.view(WS, { force: true });
		expect(s.server.log).toHaveLength(1);
		expect(s.server.log[0]).toContain('since=');
		await s.cache.view(WS, { full: true });
		expect(s.server.log[1]).not.toContain('since=');
	});

	it('a stale slot (a skipped write) reads a delta on its next use', async () => {
		await s.cache.view(WS);
		s.server.resetCounts();
		s.cache.markStale(WS);
		await s.cache.view(WS);
		expect(s.server.counts.pullPages).toBe(1);
	});

	it('a failed delta serves the rows it holds, unless the read is forced', async () => {
		const first = await s.cache.view(WS);
		await s.advance(9_000);
		s.server.beforeAnswer = () => {
			throw new TypeError('offline');
		};
		expect(ids((await s.cache.view(WS)).data.cards)).toEqual(ids(first.data.cards));
		await expect(s.cache.view(WS, { force: true })).rejects.toThrow('offline');
	});

	it('an expired cursor (410) reads a full round', async () => {
		const asked: (string | undefined)[] = [];
		const cache = new StudyCache({
			pull: async (workspaceId, since) => {
				asked.push(since);
				if (since !== undefined) throw new ApiError(410, 'expired');
				return pullStudyRound(async (path) => (await s.server.fetch(path)).json(), workspaceId);
			},
			now: () => s.clock.now,
			epoch: () => 0
		});
		await cache.view(WS);
		s.clock.now += 9_000;
		expect(ids((await cache.view(WS)).data.cards)).toEqual(['a', 'b']);
		expect(asked.map((since) => since === undefined)).toEqual([true, false, true]);
	});
});

describe('StudyCache: writes in place', () => {
	it('holds a written row at once and keeps it over an older copy a later round brings', async () => {
		const s = setup();
		s.server.putTyped('cards', cardAt('a', 1, '2026-01-01T00:00:00Z'));
		await s.cache.view(WS);
		const changed: number[] = [];
		s.cache.onChange((ws) => changed.push(ws));
		s.cache.applyTyped(WS, 'cards', [{ ...cardRow(build.card({ id: 'a', entryId: 1, deckIds: ['x'] })), ...meta('2026-02-01T10:00:00.500Z') }]);
		expect(changed).toEqual([WS]);
		expect((await s.cache.view(WS)).data.cards[0].deckIds).toEqual(['x']);
		expect(s.server.counts.pullPages).toBe(1);
		// A delta brings an older copy of the row (stamped before the write): the newer one stays.
		s.server.putTyped('cards', cardAt('a', 1, '2026-02-01T10:00:00.000Z'));
		s.clock.now += 2_000;
		await s.cache.view(WS, { force: true });
		expect(s.server.counts.pullPages).toBe(2);
		expect(s.server.log.at(-1)).toContain('since=');
		expect((await s.cache.view(WS)).data.cards[0].deckIds).toEqual(['x']);
		expect((await s.cache.view(WS)).snapshot.knownAt.get('cards:a')).toBe('2026-02-01T10:00:00.500Z');
	});

	it('a write landing while a full round runs survives the round', async () => {
		const s = setup();
		s.server.putTyped('cards', cardAt('a', 1, '2026-01-01T00:00:00Z'));
		let release: () => void = () => undefined;
		const gate = new Promise<void>((resolve) => (release = resolve));
		let gated = false;
		const cache = new StudyCache({
			pull: async (workspaceId, since) => {
				const round = await pullStudyRound(async (path) => (await s.server.fetch(path)).json(), workspaceId, since);
				if (gated) await gate;
				return round;
			},
			now: () => s.clock.now,
			epoch: () => 0
		});
		await cache.view(WS);
		gated = true;
		const running = cache.view(WS, { full: true });
		await settle();
		cache.applyTyped(WS, 'cards', [cardAt('new', 9, '2026-02-01T10:00:00.500Z')]);
		release();
		const view = await running;
		expect(ids(view.data.cards)).toEqual(['a', 'new']);
		expect(ids((await cache.view(WS)).data.cards)).toEqual(['a', 'new']);
	});

	it('a keyed user-global row goes into every loaded workspace', async () => {
		const s = setup();
		await s.cache.view(WS);
		await s.cache.view(8);
		const changed: number[] = [];
		s.cache.onChange((ws) => changed.push(ws));
		s.cache.applyKeyed(null, [
			{ pluginId: STUDY_NAMESPACE, key: 'vacation:v1', workspaceId: null, data: { version: 1, id: 'v1', start: '2026-02-01', end: '2026-02-03', scope: 'all', createdDay: '2026-02-01', createdAt: '2026-02-01T10:00:00Z' }, version: 1, updatedAt: '2026-02-01T10:00:00Z', deletedAt: null }
		]);
		expect(changed).toEqual([0]);
		expect((await s.cache.view(WS)).data.vacations).toHaveLength(1);
		expect((await s.cache.view(8)).data.vacations).toHaveLength(1);
	});

	it('a write to a workspace not loaded yet changes nothing (the first read gets it)', async () => {
		const s = setup();
		s.cache.applyTyped(WS, 'cards', [cardAt('a', 1, '2026-02-01T10:00:00Z')]);
		expect(s.cache.peek(WS)).toBeNull();
	});
});

describe('StudyCache: unreadable rows across rounds', () => {
	it('protects an unreadable row, and frees its identity when a readable version arrives', async () => {
		const s = setup();
		s.server.putTyped('cards', cardAt('a', 1, '2026-01-01T00:00:00Z'));
		// A newer client's card kind: unreadable here, identity `bad` readable.
		s.server.putTyped('cards', { ...cardAt('bad', 2, '2026-01-01T00:00:00Z'), kind: 'drawing' as never });
		const first = await s.cache.view(WS);
		expect(ids(first.data.cards)).toEqual(['a']);
		expect(first.counts).toEqual({ cards: 1 });
		expect(first.snapshot.unreadable.has('cards:bad')).toBe(true);
		await s.advance(9_000);
		s.server.putTyped('cards', cardAt('bad', 2, new Date(s.clock.now - 2_000).toISOString()));
		const second = await s.cache.view(WS);
		expect(ids(second.data.cards)).toEqual(['a', 'bad']);
		expect(second.counts).toEqual({});
		expect(second.snapshot.unreadable.size).toBe(0);
	});
});

describe('StudyCache: the same-second row (#193 acceptance)', () => {
	it('a row stamped in the round second shows after the follow-up round, and the listeners hear of it', async () => {
		const s = setup();
		// Written by another device 0.3 s before the page loads, in the same second.
		s.server.putTyped('cards', cardAt('late', 1, '2026-02-01T10:00:00.100Z'));
		const changed: number[] = [];
		s.cache.onChange((ws) => changed.push(ws));
		expect(ids((await s.cache.view(WS)).data.cards)).toEqual([]);
		expect(s.timers).toHaveLength(1);
		await s.advance(1_250);
		expect(changed).toEqual([WS]);
		expect(ids((await s.cache.view(WS)).data.cards)).toEqual(['late']);
		// A follow-up does not schedule another one.
		expect(s.timers).toHaveLength(0);
	});

	it('a follow-up that brings nothing new stays silent; nothing is scheduled without a listener', async () => {
		const s = setup();
		await s.cache.view(WS);
		expect(s.timers).toHaveLength(0);
		const changed: number[] = [];
		const off = s.cache.onChange((ws) => changed.push(ws));
		await s.cache.view(WS, { force: true });
		expect(s.timers).toHaveLength(1);
		await s.advance(1_250);
		expect(changed).toEqual([]);
		off();
	});
});

describe('StudyCache: the session end (#173)', () => {
	it('clear drops every slot and timer; the next read is a full round', async () => {
		const s = setup();
		s.cache.onChange(() => undefined);
		await s.cache.view(WS);
		expect(s.timers).toHaveLength(1);
		s.cache.clear();
		expect(s.timers).toHaveLength(0);
		expect(s.cache.peek(WS)).toBeNull();
		s.server.resetCounts();
		await s.cache.view(WS);
		expect(s.server.log[0]).not.toContain('since=');
	});

	it('an answer for a session that has ended is handed to its caller but never stored', async () => {
		const s = setup();
		s.server.putTyped('cards', cardAt('a', 1, '2026-01-01T00:00:00Z'));
		const running = s.cache.view(WS);
		s.endSession();
		s.cache.clear();
		expect(ids((await running).data.cards)).toEqual(['a']);
		expect(s.cache.peek(WS)).toBeNull();
		expect(s.rounds).toEqual([]);
	});
});

describe('StudyCache: readers joining a round (review fixes)', () => {
	function gated() {
		const clock = { now: T0 };
		const server = new StudyServer({ now: () => clock.now, pageSize: 2 });
		server.putTyped('cards', cardAt('a', 1, '2026-01-01T00:00:00Z'));
		let gate: Promise<void> | null = null;
		const kinds: boolean[] = [];
		const cache = new StudyCache({
			pull: async (workspaceId, since) => {
				const round = await pullStudyRound(async (path) => (await server.fetch(path)).json(), workspaceId, since);
				if (gate !== null) await gate;
				return round;
			},
			now: () => clock.now,
			epoch: () => 0,
			onRound: (_ws, _view, full) => kinds.push(full)
		});
		return { clock, server, cache, kinds, hold: (g: Promise<void> | null) => (gate = g) };
	}

	it('every reader of a failed refresh gets the rows held, not only the first', async () => {
		const s = gated();
		await s.cache.view(WS);
		s.clock.now += 9_000;
		s.server.beforeAnswer = () => {
			throw new TypeError('offline');
		};
		const results = await Promise.allSettled([s.cache.view(WS), s.cache.view(WS), s.cache.view(WS)]);
		expect(results.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled', 'fulfilled']);
	});

	it('a reader joining a failing follow-up round gets the rows held', async () => {
		const s = setup();
		s.cache.onChange(() => undefined);
		await s.cache.view(WS);
		s.server.beforeAnswer = () => {
			throw new TypeError('offline');
		};
		s.clock.now += 9_000;
		const timer = s.timers.shift();
		timer?.fn();
		await expect(s.cache.view(WS)).resolves.toBeDefined();
	});

	it('a full read joining a delta in flight waits for it, then reads a full round', async () => {
		const s = gated();
		await s.cache.view(WS);
		s.clock.now += 9_000;
		let release: () => void = () => undefined;
		s.hold(new Promise<void>((resolve) => (release = resolve)));
		const delta = s.cache.view(WS);
		const full = s.cache.view(WS, { full: true });
		await settle();
		s.hold(null);
		release();
		await Promise.all([delta, full]);
		expect(s.kinds).toEqual([true, false, true]);
	});

	it('a stale mark set while a round runs survives the round', async () => {
		const s = gated();
		await s.cache.view(WS);
		s.clock.now += 9_000;
		let release: () => void = () => undefined;
		s.hold(new Promise<void>((resolve) => (release = resolve)));
		const running = s.cache.view(WS);
		await settle();
		s.cache.markStale(WS);
		s.hold(null);
		release();
		await running;
		s.server.resetCounts();
		await s.cache.view(WS);
		expect(s.server.counts.pullPages).toBe(1);
	});
});

describe('StudyCache: change detection (review fixes)', () => {
	it("the server's copy of this tab's own write (another version number) is no change", async () => {
		const s = setup();
		await s.cache.view(WS);
		const mine = cardAt('a', 1, '2026-02-01T10:00:00.500Z');
		s.server.putTyped('cards', { ...mine, version: 3 });
		s.cache.applyTyped(WS, 'cards', [{ ...mine, version: 0 }]);
		const changed: number[] = [];
		s.cache.onChange((ws) => changed.push(ws));
		s.clock.now += 3_000;
		await s.cache.view(WS, { force: true });
		await s.cache.view(WS, { full: true });
		expect(changed).toEqual([]);
	});

	it('a full round keeps an unreadable row newer than a write of this tab (record 0002)', async () => {
		const s = setup();
		s.server.putTyped('cards', cardAt('a', 1, '2026-01-01T00:00:00Z'));
		let release: () => void = () => undefined;
		let gated = false;
		const gate = new Promise<void>((resolve) => (release = resolve));
		const cache = new StudyCache({
			pull: async (workspaceId, since) => {
				const round = await pullStudyRound(async (path) => (await s.server.fetch(path)).json(), workspaceId, since);
				if (gated) await gate;
				return round;
			},
			now: () => s.clock.now,
			epoch: () => 0
		});
		await cache.view(WS);
		// A newer client rewrote the card in a form this version cannot read, after this tab's write.
		s.server.putTyped('cards', { ...cardAt('a', 1, '2026-02-01T10:00:00.300Z'), kind: 'drawing' as never });
		s.clock.now += 2_000;
		gated = true;
		const running = cache.view(WS, { full: true });
		await settle();
		cache.applyTyped(WS, 'cards', [cardAt('a', 1, '2026-02-01T10:00:00.100Z')]);
		release();
		const view = await running;
		expect(view.snapshot.unreadable.has('cards:a')).toBe(true);
		expect(view.data.cards).toEqual([]);
	});
});
