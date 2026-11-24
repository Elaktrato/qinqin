import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppContext, type AppContext } from '$lib/context/app.svelte';
import { fakeDeps } from '$lib/testing/context';

const user = (id: number) => ({ id, username: `u${id}`, admin: false, email: null, emailVerified: false, mustChangePassword: false, createdAt: 't' });

function storageEvent(key: string | null): void {
	window.dispatchEvent(new StorageEvent('storage', { key }));
}

let app: AppContext;
let stop: () => void;

beforeEach(() => {
	localStorage.clear();
	localStorage.setItem('qinqin.token', 'tokA');
	app = createAppContext(fakeDeps(undefined, { window, local: () => localStorage }));
	stop = app.start();
	app.auth.set({ token: 'tokA', user: user(1) });
	vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(user(2)), { status: 200 })));
});
afterEach(() => {
	vi.unstubAllGlobals();
	stop();
	app.dispose();
});

describe('auth across tabs', () => {
	it('a token written by another tab makes this tab see the new user at once', async () => {
		const first = app.session;
		expect((app.session?.user ?? null)).toBe(1);
		localStorage.setItem('qinqin.token', 'tokB');
		storageEvent('qinqin.token');
		await vi.waitFor(() => expect((app.session?.user ?? null)).toBe(2));
		expect(app.auth.token).toBe('tokB');
		expect(first?.alive).toBe(false);
		expect(app.session?.user).toBe(2);
	});

	it('a token removed by another tab (sign-out there) signs this tab out', () => {
		localStorage.removeItem('qinqin.token');
		storageEvent('qinqin.token');
		expect(app.auth.state).toEqual({ token: null, user: null });
		expect(app.session).toBeNull();
		expect((app.session?.user ?? null)).toBeNull();
	});

	it('unrelated keys and an unchanged token do nothing', () => {
		storageEvent('qinqin.reader.prefs');
		storageEvent('qinqin.token');
		expect((app.session?.user ?? null)).toBe(1);
		expect(fetch).not.toHaveBeenCalled();
	});

	it('a stopped app context no longer follows other tabs', () => {
		stop();
		localStorage.removeItem('qinqin.token');
		storageEvent('qinqin.token');
		expect(app.auth.token).toBe('tokA');
	});
});
