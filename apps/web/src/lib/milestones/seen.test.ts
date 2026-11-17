import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import rowsFixture from '../../../../../docs/contracts/milestones/seen-rows.json';
import mergeFixture from '../../../../../docs/contracts/milestones/seen-merge.json';
import { compareIds, parseMilestoneId } from './catalogue';
import type { Reached } from './reached';
import {
	addPending,
	dropPending,
	parseSeenRows,
	pendingKey,
	prunePending,
	readPending,
	seenIds,
	seenRow,
	seenWritePlan,
	tombstoneStamps,
	type SeenMilestone
} from './seen';

type Row = { key: string; data: unknown; deletedAt: string | null };
type Fixture = { id: string; reachedAt: string; reachedDay: string };
const reachedOf = (r: Fixture): Reached => ({ id: r.id, at: Date.parse(r.reachedAt), day: r.reachedDay });

function fakeStorage(): Storage {
	const data = new Map<string, string>();
	return {
		getItem: (key: string) => data.get(key) ?? null,
		setItem: (key: string, value: string) => void data.set(key, value),
		removeItem: (key: string) => void data.delete(key),
		clear: () => data.clear(),
		key: (index: number) => [...data.keys()][index] ?? null,
		get length() {
			return data.size;
		}
	} as Storage;
}

describe('milestones/seen-rows.json', () => {
	it.each(rowsFixture.cases)('$name', (c) => {
		const seen = parseSeenRows(c.rows as Row[]);
		expect(Object.fromEntries([...seen].map(([id, m]) => [id, { seenAt: m.seenAt, reachedDay: m.reachedDay }]))).toEqual(c.expect.seen);
		for (const [id, m] of seen) expect(m.id).toBe(id);
		const listed = [...seen.keys()].filter((id) => parseMilestoneId(id) !== null).sort(compareIds);
		expect(listed).toEqual(c.expect.listed);
	});
});

type MergeCase = (typeof mergeFixture.cases)[number] & Record<string, unknown>;

describe('milestones/seen-merge.json', () => {
	const cases = mergeFixture.cases as MergeCase[];

	it.each(cases.filter((c) => c.op === 'union'))('union: $name', (c) => {
		// The plugin-data LWW: a pushed row older than the stored one is skipped.
		const server = new Map<string, string>();
		const results = (c.pushes as { key: string; updatedAt: string }[]).map((p) => {
			const stored = server.get(p.key);
			if (stored !== undefined && Date.parse(stored) > Date.parse(p.updatedAt)) return 'skipped';
			server.set(p.key, p.updatedAt);
			return 'accepted';
		});
		const live = parseSeenRows([...server.keys()].map((key) => ({ key, data: {}, deletedAt: null })));
		const want = c.expect as { results: string[]; seen: string[] };
		expect(results).toEqual(want.results);
		expect([...live.keys()].sort()).toEqual(want.seen);
	});

	it.each(cases.filter((c) => c.op === 'writePlan'))('writePlan: $name', (c) => {
		const live = parseSeenRows(c.live as Row[]);
		const plan = seenWritePlan((c.mark as Fixture[]).map(reachedOf), live, new Date(c.now as string), tombstoneStamps(c.live as Row[]));
		expect(plan).toEqual(c.expect);
		for (const row of plan) expect(row).not.toHaveProperty('deletedAt');
	});

	it.each(cases.filter((c) => c.op === 'seen'))('seen: $name', (c) => {
		const ids = seenIds(parseSeenRows(c.live as Row[]), c.pending as SeenMilestone[]);
		expect([...ids].sort()).toEqual(c.expect);
	});

	it.each(cases.filter((c) => c.op === 'prune'))('prune: $name', (c) => {
		vi.stubGlobal('localStorage', fakeStorage());
		addPending(1, 7, c.pending as SeenMilestone[]);
		prunePending(1, 7, parseSeenRows(c.live as Row[]));
		expect(readPending(1, 7).map((m) => m.id)).toEqual(c.expect);
		vi.unstubAllGlobals();
	});
	// The push cases are decoded by study/store.test.ts (saveSeenMilestones).
});

describe('seen rows', () => {
	it('seenRow writes version 1 with the reached day and the instant seen', () => {
		expect(seenRow({ id: 'streak:7', at: 0, day: '2026-11-10' }, new Date('2026-11-17T08:00:00Z'))).toEqual({
			key: 'milestone:streak:7',
			data: { version: 1, id: 'streak:7', seenAt: '2026-11-17T08:00:00.000Z', reachedDay: '2026-11-10' }
		});
	});

	it('tombstoneStamps: the newest stamp of each tombstoned milestone row', () => {
		const stamps = tombstoneStamps([
			{ key: 'milestone:streak:3', data: {}, deletedAt: '2026-11-16T00:00:00Z', updatedAt: '2026-11-16T00:00:05Z' },
			{ key: 'milestone:streak:7', data: {}, deletedAt: '2026-11-16T00:00:00Z' },
			{ key: 'milestone:reviews:100', data: {}, deletedAt: null, updatedAt: '2026-11-16T00:00:00Z' },
			{ key: 'goals:workspace', data: {}, deletedAt: '2026-11-16T00:00:00Z' }
		]);
		expect([...stamps]).toEqual([
			['streak:3', '2026-11-16T00:00:05Z'],
			['streak:7', '2026-11-16T00:00:00Z']
		]);
	});

	it('seenWritePlan never returns an id with a live row, never a tombstone, each id once', () => {
		const ids = ['reviews:100', 'reviews:500', 'streak:3', 'streak:7', 'days-active:10'];
		for (let mask = 0; mask < 32; mask++) {
			const liveIds = ids.filter((_, i) => mask & (1 << i));
			const live = parseSeenRows(liveIds.map((id) => ({ key: `milestone:${id}`, data: null, deletedAt: null })));
			const mark = [...ids, ...ids].map((id) => ({ id, at: 1, day: '2026-11-01' }));
			const plan = seenWritePlan(mark, live, new Date(0));
			expect(plan.map((r) => r.key.slice('milestone:'.length)).sort()).toEqual(ids.filter((id) => !liveIds.includes(id)).sort());
			for (const row of plan) expect(Object.keys(row).sort()).toEqual(['data', 'key']);
		}
	});
});

describe('the pending list', () => {
	beforeEach(() => vi.stubGlobal('localStorage', fakeStorage()));
	afterEach(() => vi.unstubAllGlobals());
	const m = (id: string): SeenMilestone => ({ id, seenAt: '2026-11-17T08:00:00.000Z', reachedDay: '2026-11-10' });

	it('is keyed by user and workspace', () => {
		addPending(1, 7, [m('reviews:100')]);
		addPending(2, 7, [m('streak:3')]);
		addPending(1, 8, [m('streak:7')]);
		expect(readPending(1, 7).map((x) => x.id)).toEqual(['reviews:100']);
		expect(readPending(2, 7).map((x) => x.id)).toEqual(['streak:3']);
		expect(readPending(1, 8).map((x) => x.id)).toEqual(['streak:7']);
		expect(localStorage.getItem(pendingKey(1, 7))).not.toBeNull();
		expect(pendingKey(1, 7)).toBe('qinqin:milestones-pending:1:7');
	});

	it('adds each id once and keeps the first entry', () => {
		addPending(1, 7, [m('reviews:100')]);
		addPending(1, 7, [{ ...m('reviews:100'), reachedDay: '2026-01-01' }, m('streak:3')]);
		expect(readPending(1, 7)).toEqual([m('reviews:100'), m('streak:3')]);
	});

	it('drops ids and removes the key when empty', () => {
		addPending(1, 7, [m('reviews:100'), m('streak:3')]);
		dropPending(1, 7, ['reviews:100']);
		expect(readPending(1, 7).map((x) => x.id)).toEqual(['streak:3']);
		dropPending(1, 7, ['streak:3']);
		expect(localStorage.getItem(pendingKey(1, 7))).toBeNull();
	});

	it('reads garbage as nothing and skips malformed items', () => {
		localStorage.setItem(pendingKey(1, 7), 'not json');
		expect(readPending(1, 7)).toEqual([]);
		localStorage.setItem(pendingKey(1, 7), JSON.stringify([m('streak:3'), { id: 5 }, null, { id: '' }]));
		expect(readPending(1, 7)).toEqual([m('streak:3')]);
	});

	it('a throwing storage reads [] and never throws', () => {
		const boom = () => {
			throw new Error('denied');
		};
		vi.stubGlobal('localStorage', { getItem: boom, setItem: boom, removeItem: boom } as unknown as Storage);
		expect(readPending(1, 7)).toEqual([]);
		expect(() => addPending(1, 7, [m('streak:3')])).not.toThrow();
		expect(() => prunePending(1, 7, new Map())).not.toThrow();
		expect(() => dropPending(1, 7, ['streak:3'])).not.toThrow();
	});

	it('no storage at all reads []', () => {
		vi.stubGlobal('localStorage', undefined);
		expect(readPending(1, 7)).toEqual([]);
		expect(() => addPending(1, 7, [m('streak:3')])).not.toThrow();
	});
});
