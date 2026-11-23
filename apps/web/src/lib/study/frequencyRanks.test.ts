import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/api/client', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/api/client')>()),
	api: vi.fn()
}));

import { api } from '$lib/api/client';
import { clearFrequencyCaches, loadRanks } from './frequencyRanks';

type Call = {
	language: string;
	ids: number[];
	resolve: (body: unknown) => void;
	reject: (e: Error) => void;
};
let calls: Call[];
let inFlight: number;
let maxInFlight: number;

const PACK = {
	id: 3,
	packId: 'jiten-frequency',
	name: 'Jiten frequency list',
	license: 'CC BY-SA 4.0',
	attribution: 'Jiten'
};

function answer(call: Call, rankOf: (id: number) => number | null = (id) => id * 10) {
	call.resolve({
		pack: PACK,
		ranks: call.ids.flatMap((id) => (rankOf(id) === null ? [] : [{ id, rank: rankOf(id) }]))
	});
}

beforeEach(() => {
	clearFrequencyCaches();
	calls = [];
	inFlight = 0;
	maxInFlight = 0;
	vi.mocked(api).mockImplementation((path: string, opts?: { body?: unknown }) => {
		if (path !== '/api/entries/frequency-ranks') return Promise.reject(new Error(path)) as never;
		const body = opts?.body as { language: string; ids: number[] };
		inFlight += 1;
		maxInFlight = Math.max(maxInFlight, inFlight);
		return new Promise((resolve, reject) => {
			calls.push({
				language: body.language,
				ids: body.ids,
				resolve: (b) => {
					inFlight -= 1;
					resolve(b as never);
				},
				reject: (e) => {
					inFlight -= 1;
					reject(e);
				}
			});
		}) as never;
	});
});
afterEach(() => vi.clearAllMocks());

const range = (from: number, to: number) =>
	Array.from({ length: to - from + 1 }, (_, i) => from + i);

describe('loadRanks', () => {
	it('asks in chunks of 500 with at most two in flight', async () => {
		const done = loadRanks('ja', range(1, 1100));
		await vi.waitFor(() => expect(calls).toHaveLength(2));
		expect(calls.map((c) => c.ids.length)).toEqual([500, 500]);
		expect(calls[0].language).toBe('ja');
		answer(calls[0]);
		await vi.waitFor(() => expect(calls).toHaveLength(3));
		expect(calls[2].ids).toHaveLength(100);
		answer(calls[1]);
		answer(calls[2]);
		const { pack, rankOf } = await done;
		expect(maxInFlight).toBe(2);
		expect(pack).toEqual({ id: 3, packId: 'jiten-frequency', name: 'Jiten frequency list' });
		expect(rankOf(7)).toBe(70);
		expect(rankOf(1100)).toBe(11000);
	});

	it('an entry without a rank is null, and only unknown ids are asked again', async () => {
		const first = loadRanks('ja', [1, 2, 3]);
		await vi.waitFor(() => expect(calls).toHaveLength(1));
		answer(calls[0], (id) => (id === 2 ? null : id));
		const a = await first;
		expect([a.rankOf(1), a.rankOf(2), a.rankOf(3)]).toEqual([1, null, 3]);
		expect(a.rankOf(99)).toBeNull();

		const second = loadRanks('ja', [3, 2, 4]);
		await vi.waitFor(() => expect(calls).toHaveLength(2));
		expect(calls[1].ids).toEqual([4]);
		answer(calls[1]);
		const b = await second;
		expect([b.rankOf(2), b.rankOf(3), b.rankOf(4)]).toEqual([null, 3, 40]);

		// Everything cached: no request.
		const c = await loadRanks('ja', [1, 4]);
		expect(calls).toHaveLength(2);
		expect(c.rankOf(4)).toBe(40);
		expect(c.pack?.packId).toBe('jiten-frequency');
	});

	it('caches per language', async () => {
		const ja = loadRanks('ja', [1]);
		await vi.waitFor(() => expect(calls).toHaveLength(1));
		answer(calls[0]);
		await ja;
		const zh = loadRanks('zh', [1]);
		await vi.waitFor(() => expect(calls).toHaveLength(2));
		expect(calls[1].language).toBe('zh');
		calls[1].resolve({ pack: null, ranks: [] });
		const z = await zh;
		expect(z.pack).toBeNull();
		expect(z.rankOf(1)).toBeNull();
	});

	it('a failure rejects and is not cached', async () => {
		const first = loadRanks('ja', [1, 2]);
		await vi.waitFor(() => expect(calls).toHaveLength(1));
		calls[0].reject(new Error('offline'));
		await expect(first).rejects.toThrow('offline');
		const again = loadRanks('ja', [1, 2]);
		await vi.waitFor(() => expect(calls).toHaveLength(2));
		expect(calls[1].ids).toEqual([1, 2]);
		answer(calls[1]);
		expect((await again).rankOf(2)).toBe(20);
	});

	it('a different ranking pack (re-install) drops the older ranks', async () => {
		const first = loadRanks('ja', [1]);
		await vi.waitFor(() => expect(calls).toHaveLength(1));
		answer(calls[0]);
		await first;
		const second = loadRanks('ja', [2]);
		await vi.waitFor(() => expect(calls).toHaveLength(2));
		calls[1].resolve({ pack: { ...PACK, id: 9 }, ranks: [{ id: 2, rank: 5 }] });
		const b = await second;
		expect(b.pack?.id).toBe(9);
		expect(b.rankOf(2)).toBe(5);
		expect(b.rankOf(1)).toBeNull();
	});

	it('a pack switch in the middle of a load reloads what the older pack answered', async () => {
		const done = loadRanks('ja', range(1, 1000));
		await vi.waitFor(() => expect(calls).toHaveLength(2));
		answer(calls[0]); // ids 1..500 from pack 3
		calls[1].resolve({ pack: { ...PACK, id: 9 }, ranks: calls[1].ids.map((id) => ({ id, rank: id })) });
		// The ids pack 3 answered are asked again, from pack 9.
		await vi.waitFor(() => expect(calls).toHaveLength(3));
		expect(calls[2].ids).toEqual(range(1, 500));
		calls[2].resolve({ pack: { ...PACK, id: 9 }, ranks: calls[2].ids.map((id) => ({ id, rank: id })) });
		const r = await done;
		expect(r.pack?.id).toBe(9);
		expect(r.rankOf(7)).toBe(7);
		expect(r.rankOf(700)).toBe(700);
	});

	it('a pack that keeps switching rejects instead of mixing ranks', async () => {
		let n = 0;
		vi.mocked(api).mockImplementation((async (_p: string, opts?: { body?: unknown }) => {
			n += 1;
			const ids = (opts?.body as { ids: number[] }).ids;
			return { pack: { ...PACK, id: n }, ranks: ids.map((id) => ({ id, rank: id })) };
		}) as never);
		await expect(loadRanks('ja', range(1, 1000))).rejects.toThrow('The frequency list changed while loading');
	});

	it('no ids: no request', async () => {
		const r = await loadRanks('ja', []);
		expect(calls).toHaveLength(0);
		expect(r.rankOf(1)).toBeNull();
	});
});
