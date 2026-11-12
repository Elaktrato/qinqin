import { describe, expect, it, vi } from 'vitest';
import { cachedLoader } from './lruCache';

describe('cachedLoader', () => {
	it('loads each key once while it is cached', async () => {
		const load = vi.fn(async (id: number) => `entry ${id}`);
		const get = cachedLoader(load, 2);
		expect(await get(1)).toBe('entry 1');
		expect(await get(1)).toBe('entry 1');
		expect(load).toHaveBeenCalledTimes(1);
	});

	it('drops the least recently used key beyond its size', async () => {
		const load = vi.fn(async (id: number) => id);
		const get = cachedLoader(load, 2);
		await get(1);
		await get(2);
		await get(1); // 1 is now the most recent
		await get(3); // evicts 2
		await get(1);
		expect(load).toHaveBeenCalledTimes(3);
		await get(2);
		expect(load).toHaveBeenCalledTimes(4);
	});

	it('forgets failures so they are retried', async () => {
		const load = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce('ok');
		const get = cachedLoader(load, 2);
		await expect(get(1)).rejects.toThrow('offline');
		expect(await get(1)).toBe('ok');
		expect(load).toHaveBeenCalledTimes(2);
	});
});
