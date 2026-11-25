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
