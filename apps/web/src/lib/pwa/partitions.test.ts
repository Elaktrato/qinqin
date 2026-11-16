import { describe, expect, it } from 'vitest';
import { FakeCacheStorage } from '../testing/fakeCaches';
import { API_CACHE_FAMILY, partitionName } from './sw/partition';
import { cleanupPartitions, ownPartition } from './partitions';

describe('partitionName', () => {
	it('is stable, hex, and differs per credential', async () => {
		const a = await partitionName('Bearer aaa');
		expect(a).toMatch(/^qinqin-api-v1-[0-9a-f]{32}$/);
		expect(await partitionName('Bearer aaa')).toBe(a);
		expect(await partitionName('Bearer bbb')).not.toBe(a);
		expect(a).not.toContain('aaa');
	});

	it('the page names its own partition exactly as the worker does', async () => {
		expect(await ownPartition('tok')).toBe(await partitionName('Bearer tok'));
	});
});

describe('cleanupPartitions', () => {
	async function seeded(): Promise<FakeCacheStorage> {
		const caches = new FakeCacheStorage();
		for (const name of [
			await partitionName('Bearer one'),
			await partitionName('Bearer two'),
			'qinqin-api-v0-old',
			'qinqin-shell-abc',
			'qinqin-hanzi-v1',
			'someone-else'
		]) {
			await caches.open(name);
		}
		return caches;
	}

	it('keeps only the own partition (and no foreign caches are touched)', async () => {
		const caches = await seeded();
		await cleanupPartitions(caches, await partitionName('Bearer one'));
		expect((await caches.keys()).sort()).toEqual(
			[await partitionName('Bearer one'), 'qinqin-hanzi-v1', 'qinqin-shell-abc', 'someone-else'].sort()
		);
	});

	it('deletes every partition when nothing is kept (sign-out)', async () => {
		const caches = await seeded();
		await cleanupPartitions(caches, null);
		expect((await caches.keys()).sort()).toEqual(['qinqin-hanzi-v1', 'qinqin-shell-abc', 'someone-else']);
		expect(API_CACHE_FAMILY).toBe('qinqin-api-v');
	});

	it('is a no-op without Cache Storage (plain HTTP) and never throws', async () => {
		await expect(cleanupPartitions(undefined, null)).resolves.toBeUndefined();
		const broken = {
			keys: () => Promise.reject(new Error('boom')),
			delete: () => Promise.resolve(false),
			open: () => Promise.reject(new Error('boom')),
			match: () => Promise.resolve(undefined)
		};
		await expect(cleanupPartitions(broken, null)).resolves.toBeUndefined();
	});
});
