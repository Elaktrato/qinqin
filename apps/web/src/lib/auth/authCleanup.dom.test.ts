import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeCacheStorage } from '$lib/testing/fakeCaches';
import { notifyUnauthorized } from '$lib/api/client';
import { createAppContext, type AppContext } from '$lib/context/app.svelte';
import { fakeDeps } from '$lib/testing/context';

let fake: FakeCacheStorage;
let app: AppContext;
let stop: () => void;
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
	app = createAppContext(fakeDeps(undefined, { local: () => localStorage, window: null }));
	stop = app.start();
});
afterEach(() => {
	vi.unstubAllGlobals();
	stop();
	app.dispose();
});

describe('saved API copies follow the session', () => {
	it('booting without a token deletes them and the receipts', async () => {
		await seed();
		await app.auth.loadMe();
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
		app.auth.logout();
		await vi.waitFor(async () => expect(await empty()).toEqual([]));
		expect(localStorage.getItem('qinqin.pwa.prepared.1.7')).toBeNull();
	});
});

describe('the lookup history recorder follows the session (#72)', () => {
	it('logout and a 401 drop its buffered lookups and copies', async () => {
		localStorage.setItem('qinqin.token', 'tok');
		app.auth.set({ token: 'tok', user: { id: 1, username: 'alice' } as never });
		const r = app.session!.lookups.recorder;
		r.note(3, { entryId: 7, source: 'reader' });
		expect(r.countOf(3, 7)).toBe(1);
		app.auth.logout();
		expect(r.countOf(3, 7)).toBe(0);
		localStorage.setItem('qinqin.token', 'tok');
		app.auth.set({ token: 'tok', user: { id: 1, username: 'alice' } as never });
		const next = app.session!.lookups.recorder;
		expect(next).not.toBe(r);
		next.note(3, { entryId: 8, source: 'reader' });
		notifyUnauthorized();
		expect(next.countOf(3, 8)).toBe(0);
		await next.flush();
		expect(vi.mocked(fetch).mock.calls.some(([u]) => String(u).includes('lookups'))).toBe(false);
	});
});

describe('the lookup recorder follows the signed-in user (#72 review)', () => {
	it('another user signing in (another tab, a token swap) drops the previous buffer', () => {
		app.auth.set({ token: 'a', user: { id: 1, username: 'alice' } as never });
		const r = app.session!.lookups.recorder;
		r.note(3, { entryId: 7, source: 'reader' });
		app.auth.set({ token: 'a', user: { id: 1, username: 'alice' } as never }); // same user: kept
		expect(r.countOf(3, 7)).toBe(1);
		app.auth.set({ token: 'b', user: { id: 2, username: 'bob' } as never });
		expect(r.countOf(3, 7)).toBe(0);
	});
});
