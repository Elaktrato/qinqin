import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import fixture from '../../../../../docs/contracts/images/package.json';
import type { Catalogue, CatalogueRow } from '../api/packages';
import { FakeCacheStorage } from '../testing/fakeCaches';
import { sha256Hex } from './check';
import { OfflinePictures } from './offlinePictures';
import { clearPackages, PACKAGE_CACHE, PackageStore, type PackageCaches } from './store';
import { syncImagePackages } from './syncImages';

// #274: offline preparation keeps the images packages of the workspace language; the offline lookup answers an
// entry's picture from them with the server's rule. The package is the one the Go builder wrote
// (docs/contracts/images/package.qqpkg).
const file = new Uint8Array(readFileSync(join(__dirname, '../../../../../docs/contracts/images', fixture.file)));
const ORIGIN = 'https://qinqin.test';

async function catalogueWith(over: Partial<CatalogueRow> = {}): Promise<Catalogue> {
	const row: CatalogueRow = {
		id: fixture.id,
		type: 'images',
		languages: ['ja', 'zh'],
		formatVersion: 1,
		revision: fixture.revision,
		contentHash: fixture.contentHash,
		sha256: await sha256Hex(file),
		bytes: file.length,
		url: `/api/packages/${fixture.id}/${fixture.revision}`,
		state: 'ready',
		builtAt: '2026-11-16T10:00:00Z',
		requires: [],
		optional: false,
		licenseTexts: true,
		sources: [],
		updatedAt: '2026-11-16T10:00:00Z',
		deletedAt: null,
		...over
	};
	return { format: 1, instanceId: fixture.instanceId, languages: ['zh'], building: false, packages: [row] };
}

function storeOf(caches: FakeCacheStorage): PackageStore {
	return new PackageStore(caches as unknown as PackageCaches, ORIGIN);
}

describe('syncImagePackages', () => {
	it('downloads, checks and keeps the package once; a second round downloads nothing', async () => {
		const caches = new FakeCacheStorage();
		const store = storeOf(caches);
		const download = vi.fn(async () => file);
		const catalogue = await catalogueWith();
		const first = await syncImagePackages({ language: 'zh', catalogue: async () => catalogue, download, store });
		expect(first).toEqual({ downloaded: [fixture.id], removed: [], bytes: file.length });
		expect((await store.list()).map((k) => [k.id, k.revision, k.contentHash])).toEqual([[fixture.id, fixture.revision, fixture.contentHash]]);
		const second = await syncImagePackages({ language: 'zh', catalogue: async () => catalogue, download, store });
		expect(second.downloaded).toEqual([]);
		expect(download).toHaveBeenCalledTimes(1);
	});

	it('skips a package of another language and keeps nothing that fails the checks', async () => {
		const store = storeOf(new FakeCacheStorage());
		const download = vi.fn(async () => file);
		await syncImagePackages({ language: 'ko', catalogue: () => catalogueWith(), download, store });
		expect(download).not.toHaveBeenCalled();
		const tampered = file.slice();
		tampered[100] ^= 1;
		await expect(syncImagePackages({ language: 'zh', catalogue: () => catalogueWith(), download: async () => tampered, store })).rejects.toThrow();
		expect(await store.list()).toEqual([]);
	});

	it('removes a deleted package and every package of another server', async () => {
		const caches = new FakeCacheStorage();
		const store = storeOf(caches);
		await syncImagePackages({ language: 'zh', catalogue: () => catalogueWith(), download: async () => file, store });
		const deleted = await syncImagePackages({ language: 'zh', catalogue: () => catalogueWith({ state: 'deleted', url: null, deletedAt: '2026-11-17T00:00:00Z' }), download: async () => file, store });
		expect(deleted.removed).toEqual([fixture.id]);
		expect(await store.list()).toEqual([]);
		await syncImagePackages({ language: 'zh', catalogue: () => catalogueWith(), download: async () => file, store });
		const other = await catalogueWith();
		other.instanceId = '01JD8Z3Q4M5N6P7R8S9T0V1W2Y';
		other.packages = [];
		const reset = await syncImagePackages({ language: 'zh', catalogue: async () => other, download: async () => file, store });
		expect(reset.removed).toEqual([fixture.id]);
		await clearPackages(caches as unknown as PackageCaches);
		expect(caches.stores.has(PACKAGE_CACHE)).toBe(false);
	});
});

describe('OfflinePictures.lookup (an offline lookup of a picture)', () => {
	async function kept(): Promise<PackageStore> {
		const store = storeOf(new FakeCacheStorage());
		await syncImagePackages({ language: 'zh', catalogue: () => catalogueWith(), download: async () => file, store });
		return store;
	}

	it('finds the picture by the entry answer’s pictureTargets, with its credit and canonical svg', async () => {
		const store = await kept();
		const offline = new OfflinePictures({ store: () => store, entry: async () => ({ language: 'zh', pictureTargets: ['苹果', '蘋果'] }), reported: async () => [] });
		const got = await offline.lookup(7);
		expect(got).toMatchObject({ packId: 'pics-fixture', concept: '1F34E', label: 'red apple', credit: 'OpenMoji, Fixture', license: 'CC BY-SA 4.0', basis: 'manual', score: 100 });
		expect(got?.svg).toBe(fixture.pictures.find((p) => p.concept === '1F34E')?.svg);
		const ja = new OfflinePictures({ store: () => store, entry: async () => ({ language: 'ja', pictureTargets: ['j:1'] }), reported: async () => [] });
		expect((await ja.lookup(8))?.concept).toBe('1F4A7');
	});

	it('passes over a reported picture, answers null for an unmapped word and undefined with nothing kept', async () => {
		const store = await kept();
		const reported = new OfflinePictures({ store: () => store, entry: async () => ({ language: 'zh', pictureTargets: ['水'] }), reported: async () => [{ entryId: 9, packId: 'pics-fixture', concept: '1F4A7' }] });
		expect(await reported.lookup(9)).toBeNull();
		const now = new OfflinePictures({ store: () => store, entry: async () => ({ language: 'zh', pictureTargets: ['水'] }), reported: async () => { throw new Error('offline'); } });
		expect((await now.lookup(9))?.concept).toBe('1F4A7');
		now.noteReported(9, 'pics-fixture', '1F4A7');
		expect(await now.lookup(9)).toBeNull();
		const none = new OfflinePictures({ store: () => storeOf(new FakeCacheStorage()), entry: async () => ({ language: 'zh', pictureTargets: ['水'] }), reported: async () => [] });
		expect(await none.lookup(9)).toBeUndefined();
	});
});
