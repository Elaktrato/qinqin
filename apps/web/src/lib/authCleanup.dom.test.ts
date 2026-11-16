import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeCacheStorage } from './testing/fakeCaches';
import { auth, loadMe, logout } from './auth';
import { notifyUnauthorized } from './api/client';

let fake: FakeCacheStorage;
async function seed(): Promise<void> {
	await fake.open('qinqin-api-v1-abc');
	await fake.open('qinqin-shell-x');
	localStorage.setItem('qinqin.pwa.prepared.1.7', '{}');
}
const empty = async () => (await fake.keys()).filter((n) => n.startsWith('qinqin-api-v'));

beforeEach(() => {
	fake = new FakeCacheStorage();
	vi.stubGlobal('caches', fake);
	vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 204 })));
	localStorage.clear();
});
afterEach(() => {
	vi.unstubAllGlobals();
	auth.set({ token: null, user: null });
});

describe('saved API copies follow the session', () => {
	it('booting without a token deletes them and the receipts', async () => {
		await seed();
		await loadMe();
		await vi.waitFor(async () => expect(await empty()).toEqual([]));
		expect(localStorage.getItem('qinqin.pwa.prepared.1.7')).toBeNull();
		expect(await fake.keys()).toEqual(['qinqin-shell-x']);
	});

	it('a 401 anywhere deletes them and the receipts', async () => {
		await seed();
		localStorage.setItem('qinqin.token', 'tok');
		notifyUnauthorized();
		await vi.waitFor(async () => expect(await empty()).toEqual([]));
		expect(localStorage.getItem('qinqin.pwa.prepared.1.7')).toBeNull();
	});

	it('logout deletes them and the receipts', async () => {
		await seed();
		localStorage.setItem('qinqin.token', 'tok');
		logout();
		await vi.waitFor(async () => expect(await empty()).toEqual([]));
		expect(localStorage.getItem('qinqin.pwa.prepared.1.7')).toBeNull();
	});
});
