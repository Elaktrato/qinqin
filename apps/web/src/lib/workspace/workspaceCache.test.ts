import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createWorkspaceCache } from './workspaceCache';

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (err: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

describe('createWorkspaceCache', () => {
	const TTL = 8_000;
	let clock = 0;
	const now = () => clock;

	beforeEach(() => {
		clock = 1_000;
	});

	it('serves one load within the TTL and reloads after it', async () => {
		const load = vi.fn(async (id: number) => ({ id }));
		const cache = createWorkspaceCache(load, now, TTL);

		const first = await cache.get(3);
		clock += TTL - 1;
		expect(await cache.get(3)).toBe(first);
		clock += 1;
		await cache.get(3);

		expect(load).toHaveBeenCalledTimes(2);
	});

	it('joins a load in flight, also with force', async () => {
		const pending = deferred<string[]>();
		const load = vi.fn(() => pending.promise);
		const cache = createWorkspaceCache(load, now, TTL);

		const a = cache.get(3);
		const b = cache.get(3, { force: true });
		pending.resolve(['x']);

		expect(await b).toBe(await a);
		expect(load).toHaveBeenCalledTimes(1);
	});

	it('force skips a cached value', async () => {
		const load = vi.fn(async () => 'v');
		const cache = createWorkspaceCache(load, now, TTL);

		await cache.get(3);
		await cache.get(3, { force: true });

		expect(load).toHaveBeenCalledTimes(2);
	});

	it('never caches an error', async () => {
		const load = vi
			.fn<(id: number) => Promise<string>>()
			.mockRejectedValueOnce(new Error('down'))
			.mockResolvedValueOnce('ok');
		const cache = createWorkspaceCache(load, now, TTL);

		await expect(cache.get(3)).rejects.toThrow('down');
		expect(await cache.get(3)).toBe('ok');
	});

	it('keeps workspaces apart, also on invalidate', async () => {
		const load = vi.fn(async (id: number) => `w${id}`);
		const cache = createWorkspaceCache(load, now, TTL);

		expect(await cache.get(3)).toBe('w3');
		expect(await cache.get(4)).toBe('w4');
		cache.invalidate(3);
		await cache.get(4);
		await cache.get(3);

		expect(load.mock.calls.map(([id]) => id)).toEqual([3, 4, 3]);
	});

	it('drops a load that was in flight when invalidated', async () => {
		const stale = deferred<string>();
		const load = vi
			.fn<(id: number) => Promise<string>>()
			.mockReturnValueOnce(stale.promise)
			.mockResolvedValueOnce('fresh');
		const cache = createWorkspaceCache(load, now, TTL);

		const before = cache.get(3);
		cache.invalidate();
		stale.resolve('stale');

		expect(await before).toBe('stale');
		expect(await cache.get(3)).toBe('fresh');
	});
});

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('createWorkspaceCache with revalidate (#290)', () => {
	const TTL = 8_000;
	let clock = 0;
	const now = () => clock;
	beforeEach(() => {
		clock = 1_000;
	});

	function setup(load: (id: number) => Promise<string[]>) {
		const refreshed: number[] = [];
		const failed: number[] = [];
		const cache = createWorkspaceCache(load, now, TTL, {
			revalidate: { changed: (a, b) => a.join() !== b.join(), refreshed: (id) => refreshed.push(id), failed: (id) => failed.push(id) }
		});
		return { cache, refreshed, failed };
	}

	it('serves a held value after the TTL at once and refreshes it in the background', async () => {
		let n = 0;
		const later = deferred<string[]>();
		const load = vi.fn(async () => (++n === 1 ? ['a'] : later.promise));
		const { cache, refreshed } = setup(load);
		const first = await cache.get(3);
		clock += TTL;
		expect(await cache.get(3)).toBe(first);
		expect(await cache.get(3)).toBe(first);
		expect(load).toHaveBeenCalledTimes(2);
		later.resolve(['a', 'b']);
		await flush();
		expect(refreshed).toEqual([3]);
		expect(await cache.get(3)).toEqual(['a', 'b']);
		expect(load).toHaveBeenCalledTimes(2);
	});

	it('markStale keeps the value for the next read and refreshes it behind; an unchanged answer is not announced', async () => {
		const load = vi.fn(async () => ['a']);
		const { cache, refreshed } = setup(load);
		const first = await cache.get(3);
		cache.markStale(3);
		expect(await cache.get(3)).toBe(first);
		await flush();
		expect(load).toHaveBeenCalledTimes(2);
		expect(refreshed).toEqual([]);
	});

	it('a failed background load keeps the value and reports it; force still waits and fails', async () => {
		let n = 0;
		const load = vi.fn(async () => {
			if (++n === 1) return ['a'];
			throw new TypeError('offline');
		});
		const { cache, failed } = setup(load);
		const first = await cache.get(3);
		clock += TTL;
		expect(await cache.get(3)).toBe(first);
		await flush();
		expect(failed).toEqual([3]);
		await expect(cache.get(3, { force: true })).rejects.toThrow('offline');
	});

	it('invalidate still drops the value: the next read waits', async () => {
		const load = vi.fn(async () => ['a']);
		const { cache } = setup(load);
		await cache.get(3);
		cache.invalidate(3);
		const pending = cache.get(3);
		expect(load).toHaveBeenCalledTimes(2);
		await pending;
	});
});
