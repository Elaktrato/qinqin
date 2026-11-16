import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import { auth } from './auth';
import { outboxToken, outboxUser } from './study/outboxUser';

const user = (id: number) => ({ id, username: `u${id}`, admin: false, email: null, emailVerified: false, mustChangePassword: false, createdAt: 't' });

function storageEvent(key: string | null): void {
	window.dispatchEvent(new StorageEvent('storage', { key, storageArea: localStorage }));
}

beforeEach(() => {
	localStorage.clear();
	localStorage.setItem('qinqin.token', 'tokA');
	auth.set({ token: 'tokA', user: user(1) });
	vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(user(2)), { status: 200 })));
});
afterEach(() => {
	vi.unstubAllGlobals();
	auth.set({ token: null, user: null });
});

describe('auth across tabs', () => {
	it('a token written by another tab makes this tab see the new user at once', async () => {
		expect(outboxUser()).toBe(1);
		localStorage.setItem('qinqin.token', 'tokB');
		storageEvent('qinqin.token');
		await vi.waitFor(() => expect(outboxUser()).toBe(2));
		expect(outboxToken()).toBe('tokB');
		expect(get(auth).token).toBe('tokB');
	});

	it('a token removed by another tab (sign-out there) signs this tab out', () => {
		localStorage.removeItem('qinqin.token');
		storageEvent('qinqin.token');
		expect(get(auth)).toEqual({ token: null, user: null });
		expect(outboxUser()).toBeNull();
	});

	it('unrelated keys and an unchanged token do nothing', () => {
		storageEvent('qinqin.reader.prefs');
		storageEvent('qinqin.token');
		expect(outboxUser()).toBe(1);
		expect(fetch).not.toHaveBeenCalled();
	});
});
