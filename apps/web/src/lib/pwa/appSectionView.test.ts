import { describe, expect, it } from 'vitest';
import { appSectionView, clearOfflineData } from './appSectionView';
import { FakeCacheStorage } from '../testing/fakeCaches';

const base = {
	secure: true,
	standalone: false,
	ios: false,
	canPrompt: false,
	prepared: null,
	usage: null
};

describe('appSectionView', () => {
	it('an insecure context gets the HTTPS note and nothing else', () => {
		const v = appSectionView({ ...base, secure: false, canPrompt: true });
		expect(v.httpsNote).toMatch(/HTTPS/);
		expect(v.showInstall).toBe(false);
		expect(v.iosHint).toBe(false);
		expect(v.offlineLine).toBeNull();
		expect(v.storageLine).toBeNull();
		expect(v.showClear).toBe(false);
	});

	it('the install button needs a captured prompt and no standalone run', () => {
		expect(appSectionView({ ...base }).showInstall).toBe(false);
		expect(appSectionView({ ...base, canPrompt: true }).showInstall).toBe(true);
		expect(appSectionView({ ...base, canPrompt: true, standalone: true }).showInstall).toBe(false);
		expect(appSectionView({ ...base, standalone: true }).installedNote).toBe(true);
	});

	it('iOS gets the Share text, but not when installed or when a prompt exists', () => {
		expect(appSectionView({ ...base, ios: true }).iosHint).toBe(true);
		expect(appSectionView({ ...base, ios: true, standalone: true }).iosHint).toBe(false);
		expect(appSectionView({ ...base, ios: true, canPrompt: true }).iosHint).toBe(false);
	});

	it('offline status from what was prepared', () => {
		expect(appSectionView({ ...base }).offlineLine).toBe('Offline: not prepared yet. Open the app online and it saves today\'s cards.');
		const at = new Date(2026, 10, 16, 14, 2).toISOString();
		expect(appSectionView({ ...base, prepared: { workspaceId: 1, cards: 120, at } }).offlineLine).toBe('Offline: ready - 120 cards saved at 14:02');
		expect(appSectionView({ ...base, prepared: { workspaceId: 1, cards: 1, at } }).offlineLine).toBe('Offline: ready - 1 card saved at 14:02');
	});

	it('storage use from the estimate', () => {
		expect(appSectionView({ ...base, usage: { usage: 12.3 * 1024 * 1024, quota: 4.2 * 1024 ** 3 } }).storageLine).toBe('Storage used: 12.3 MB of 4.2 GB');
		expect(appSectionView({ ...base }).storageLine).toBeNull();
	});
});

describe('clearOfflineData', () => {
	it('deletes the API partitions and the receipts, never the review outbox', async () => {
		const caches = new FakeCacheStorage();
		for (const n of ['qinqin-api-v1-aaa', 'qinqin-api-v1-bbb', 'qinqin-shell-x', 'qinqin-hanzi-v1', 'qinqin-fonts-v1']) await caches.open(n);
		const data = new Map<string, string>([
			['qinqin.pwa.prepared.1.7', '{}'],
			['qinqin.pwa.prepared.2.3', '{}'],
			['qinqin.study.pending.v2', '[{"x":1}]'],
			['qinqin.token', 'secret']
		]);
		const storage = {
			get length() {
				return data.size;
			},
			key: (i: number) => [...data.keys()][i] ?? null,
			getItem: (k: string) => data.get(k) ?? null,
			setItem: (k: string, v: string) => void data.set(k, v),
			removeItem: (k: string) => void data.delete(k)
		} as Storage;
		await clearOfflineData(caches, storage);
		expect((await caches.keys()).sort()).toEqual(['qinqin-fonts-v1', 'qinqin-hanzi-v1', 'qinqin-shell-x']);
		expect([...data.keys()].sort()).toEqual(['qinqin.study.pending.v2', 'qinqin.token']);
	});
});
