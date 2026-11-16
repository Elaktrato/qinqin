import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeCacheStorage } from './testing/fakeCaches';
import { auth, loadMe, logout } from './auth';
import { notifyUnauthorized } from './api/client';
import { lookupRecorder } from './lookups/store';

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

describe('the lookup history recorder follows the session (#72)', () => {
	it('logout and a 401 drop its buffered lookups and copies', async () => {
		const r = lookupRecorder();
		r.note(3, { entryId: 7, source: 'reader' });
		expect(r.countOf(3, 7)).toBe(1);
		localStorage.setItem('qinqin.token', 'tok');
		logout();
		expect(r.countOf(3, 7)).toBe(0);
		r.note(3, { entryId: 8, source: 'reader' });
		localStorage.setItem('qinqin.token', 'tok');
		notifyUnauthorized();
		expect(r.countOf(3, 8)).toBe(0);
		await r.flush();
		expect(vi.mocked(fetch).mock.calls.some(([u]) => String(u).includes('lookups'))).toBe(false);
	});
});

describe('the lookup recorder follows the signed-in user (#72 review)', () => {
	it('another user signing in (another tab, a token swap) drops the previous buffer', () => {
		auth.set({ token: 'a', user: { id: 1, username: 'alice' } as never });
		const r = lookupRecorder();
		r.note(3, { entryId: 7, source: 'reader' });
		auth.set({ token: 'a', user: { id: 1, username: 'alice' } as never }); // same user: kept
		expect(r.countOf(3, 7)).toBe(1);
		auth.set({ token: 'b', user: { id: 2, username: 'bob' } as never });
		expect(r.countOf(3, 7)).toBe(0);
	});
});
