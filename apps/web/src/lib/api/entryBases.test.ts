import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./client', async (importOriginal) => ({
	...(await importOriginal<typeof import('./client')>()),
	api: vi.fn()
}));

import { api } from './client';
import { updateEntry } from './edit';
import { clearEntryBasesCache, forgetEntryBases, loadEntryBases } from './entryBases';
import type { EntryBase } from './types';

function base(id: number): EntryBase {
	return { id, language: 'zh', kind: 'word', written: `w${id}`, readings: [], attrs: {}, radicalId: null };
}

type Call = { ids: number[]; resolve: (rows: EntryBase[]) => void; reject: (e: Error) => void };
let calls: Call[];

beforeEach(() => {
	clearEntryBasesCache();
	calls = [];
	vi.mocked(api).mockImplementation((path: string, opts?: { body?: unknown }) => {
		if (path !== '/api/entries/bases') return Promise.resolve({}) as never;
		const ids = (opts?.body as { ids: number[] }).ids;
		return new Promise((resolve, reject) => {
			calls.push({ ids, resolve: (rows) => resolve(rows) as never, reject });
		}) as never;
	});
});
afterEach(() => vi.clearAllMocks());

const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

describe('loadEntryBases', () => {
	it('requests in chunks of 500 with at most two in flight', async () => {
		const done = loadEntryBases(range(1, 1250));
		await Promise.resolve();
		expect(calls).toHaveLength(2);
		expect(calls[0].ids).toHaveLength(500);
		expect(calls[1].ids).toHaveLength(500);
		calls[0].resolve(calls[0].ids.map(base));
		await vi.waitFor(() => expect(calls).toHaveLength(3));
		expect(calls[2].ids).toHaveLength(250);
		calls[1].resolve(calls[1].ids.map(base));
		calls[2].resolve(calls[2].ids.map(base));
		const result = await done;
		expect(result.size).toBe(1250);
		expect(result.get(7)?.written).toBe('w7');
	});

	it('requests the priority ids first', async () => {
		const done = loadEntryBases(range(1, 600), { priority: [600, 599, 5] });
		await Promise.resolve();
		expect(calls[0].ids.slice(0, 3)).toEqual([600, 599, 5]);
		calls.forEach((c) => c.resolve(c.ids.map(base)));
		await vi.waitFor(() => expect(calls.length).toBeGreaterThanOrEqual(1));
		await done;
	});

	it('serves cached ids without a request and omits unknown ids', async () => {
		const first = loadEntryBases([1, 2, 3]);
		await Promise.resolve();
		calls[0].resolve([base(1), base(3)]); // 2 is unknown
		const a = await first;
		expect([...a.keys()]).toEqual([1, 3]);
		const second = await loadEntryBases([1, 3]);
		expect(calls).toHaveLength(1);
		expect(second.size).toBe(2);
		// An unknown id is asked again next time (it may exist after an import).
		const third = loadEntryBases([2]);
		await Promise.resolve();
		expect(calls).toHaveLength(2);
		calls[1].resolve([]);
		expect((await third).size).toBe(0);
	});

	it('never caches a failure: the next call asks again, successes stay cached', async () => {
		const first = loadEntryBases(range(1, 700));
		await Promise.resolve();
		calls[0].resolve(calls[0].ids.map(base));
		calls[1].reject(new Error('offline'));
		await expect(first).rejects.toThrow('offline');
		const retry = loadEntryBases(range(1, 700));
		await Promise.resolve();
		expect(calls.at(-1)!.ids).toEqual(range(501, 700));
		calls.at(-1)!.resolve(calls.at(-1)!.ids.map(base));
		expect((await retry).size).toBe(700);
	});

	it('shares an in-flight request between concurrent callers', async () => {
		const a = loadEntryBases([1, 2]);
		const b = loadEntryBases([2, 3]);
		await Promise.resolve();
		expect(calls.flatMap((c) => c.ids).sort()).toEqual([1, 2, 3]);
		calls.forEach((c) => c.resolve(c.ids.map(base)));
		expect((await a).size).toBe(2);
		expect((await b).size).toBe(2);
	});

	it('forgetEntryBases drops single ids (after an edit)', async () => {
		const first = loadEntryBases([1]);
		await Promise.resolve();
		calls[0].resolve([base(1)]);
		await first;
		forgetEntryBases([1]);
		const again = loadEntryBases([1]);
		await Promise.resolve();
		expect(calls).toHaveLength(2);
		calls[1].resolve([{ ...base(1), written: 'edited' }]);
		expect((await again).get(1)?.written).toBe('edited');
	});

	it('an entry edit and the sign-out drop the cached bases', async () => {
		const first = loadEntryBases([1, 2]);
		await Promise.resolve();
		calls[0].resolve([base(1), base(2)]);
		await first;
		await updateEntry(1, { written: 'x' });
		const again = loadEntryBases([1, 2]);
		await Promise.resolve();
		expect(calls).toHaveLength(2);
		expect(calls[1].ids).toEqual([1]);
		calls[1].resolve([base(1)]);
		await again;
		const { logout } = await import('../auth');
		logout();
		const third = loadEntryBases([1, 2]);
		await Promise.resolve();
		expect(calls[2].ids).toEqual([1, 2]);
		calls[2].resolve([]);
		await third;
	});

	it('an empty list asks nothing', async () => {
		expect((await loadEntryBases([])).size).toBe(0);
		expect(calls).toHaveLength(0);
	});
});
