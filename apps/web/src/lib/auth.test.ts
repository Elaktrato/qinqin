import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';

const { goto } = vi.hoisted(() => ({ goto: vi.fn() }));

vi.mock('$app/navigation', () => ({ goto }));
const { reloadPage } = vi.hoisted(() => ({ reloadPage: vi.fn() }));
vi.mock('./i18n/reloadPage', () => ({ reloadPage }));

import { getToken, notifyUnauthorized } from './api/client';
import { auth, loadMe, login, logout, register, restriction } from './auth';
import { onSessionEnd, type SessionEndReason } from './session/sessionEnd';

const user = {
	id: 1,
	username: 'ada',
	admin: true,
	email: null,
	emailVerified: false,
	mustChangePassword: false,
	createdAt: '2026-01-01T00:00:00Z'
};

function fakeStorage(): Storage {
	const data = new Map<string, string>();
	return {
		getItem: (key: string) => data.get(key) ?? null,
		setItem: (key: string, value: string) => void data.set(key, value),
		removeItem: (key: string) => void data.delete(key),
		clear: () => data.clear(),
		key: (index: number) => [...data.keys()][index] ?? null,
		get length() {
			return data.size;
		}
	} as Storage;
}

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json' }
	});
}

describe('auth store', () => {
	beforeEach(() => {
		vi.stubGlobal('localStorage', fakeStorage());
		vi.stubGlobal(
			'fetch',
			vi.fn(async (input: RequestInfo | URL) => {
				const url = String(input);
				if (url === '/api/auth/register') return jsonResponse(user, 201);
				if (url === '/api/auth/login') return jsonResponse({ status: 'ok', token: 'token-1' });
				if (url === '/api/auth/me') return jsonResponse(user);
				return new Response('not found', { status: 404 });
			})
		);
		auth.set({ token: null, user: null });
		goto.mockReset();
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('logs in, persists the token, and hydrates the user', async () => {
		await login('ada', 'pw');

		expect(localStorage.getItem('qinqin.token')).toBe('token-1');
		expect(get(auth)).toEqual({ token: 'token-1', user });
		expect(vi.mocked(fetch).mock.calls.map(([url]) => String(url))).toEqual([
			'/api/auth/login',
			'/api/auth/me'
		]);
	});

	it('login keeps the token for a forced password change and exposes the restriction', async () => {
		const restricted = { ...user, mustChangePassword: true, restriction: 'password_change' };
		vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
			const url = String(input);
			if (url === '/api/auth/login') {
				return jsonResponse({ status: 'password_change_required', token: 'token-2', user: restricted });
			}
			if (url === '/api/auth/me') return jsonResponse(restricted);
			return new Response('not found', { status: 404 });
		});

		await login('ada', 'pw');

		expect(localStorage.getItem('qinqin.token')).toBe('token-2');
		expect(get(auth).token).toBe('token-2');
		expect(get(restriction)).toBe('password_change');
	});

	it('a full session has no restriction', async () => {
		await login('ada', 'pw');
		expect(get(restriction)).toBeNull();
	});

	it('registers and then auto-logs-in', async () => {
		const created = await register('ada', 'pw');

		expect(created).toEqual(user);
		expect(localStorage.getItem('qinqin.token')).toBe('token-1');
		expect(get(auth)).toEqual({ token: 'token-1', user });
		expect(vi.mocked(fetch).mock.calls.map(([url]) => String(url))).toEqual([
			'/api/auth/register',
			'/api/auth/login',
			'/api/auth/me'
		]);
	});

	it('hydrates the user from a stored token', async () => {
		localStorage.setItem('qinqin.token', 'stored');

		await loadMe();

		expect(get(auth)).toEqual({ token: 'stored', user });
	});

	it('mirrors the account interface language and reloads only when it differs from the running one', async () => {
		localStorage.setItem('qinqin.token', 'stored');
		reloadPage.mockReset();
		await loadMe();
		expect(localStorage.getItem('qq.interfaceLanguage')).toBe('en');
		expect(reloadPage).not.toHaveBeenCalled();
	});

	it('keeps the stored token when the user cannot be loaded', async () => {
		localStorage.setItem('qinqin.token', 'stored');
		vi.mocked(fetch).mockRejectedValue(new TypeError('offline'));

		await expect(loadMe()).rejects.toThrow('offline');

		expect(get(auth)).toEqual({ token: 'stored', user: null });
	});

	it('stays signed out when no token is stored', async () => {
		await loadMe();

		expect(get(auth)).toEqual({ token: null, user: null });
		expect(fetch).not.toHaveBeenCalled();
	});

	it('login drops the token again when the user cannot be loaded (non-401 failure)', async () => {
		vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
			const url = String(input);
			if (url === '/api/auth/login') return jsonResponse({ status: 'ok', token: 'token-1' });
			return new Response('boom', { status: 500 });
		});

		const seen: Array<string | null> = [];
		const stop = auth.subscribe((state) => seen.push(state.token));
		try {
			await expect(login('ada', 'pw')).rejects.toMatchObject({ status: 500 });
		} finally {
			stop();
		}
		// The store never claimed a session, so the guard cannot bounce the
		// login page away before it shows the error.
		expect(seen.every((t) => t === null)).toBe(true);

		expect(getToken()).toBeNull();
		expect(get(auth)).toEqual({ token: null, user: null });
	});

	it('login works when storage is blocked: the known token is used for /me', async () => {
		vi.stubGlobal('localStorage', {
			getItem: () => null,
			setItem: () => {
				throw new DOMException('blocked', 'SecurityError');
			},
			removeItem: () => undefined
		});
		const calls: Array<string | undefined> = [];
		vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = String(input);
			if (url === '/api/auth/login') return jsonResponse({ status: 'ok', token: 'token-1' });
			calls.push((init?.headers as Record<string, string>).authorization);
			return jsonResponse(user);
		});

		await login('ada', 'pw');

		expect(calls).toEqual(['Bearer token-1']);
		expect(get(auth)).toEqual({ token: 'token-1', user });
	});

	it('logout forgets the persisted workspace selection', () => {
		localStorage.setItem('qinqin.workspace', '3');
		logout();
		expect(localStorage.getItem('qinqin.workspace')).toBeNull();
	});

	it('logout clears storage and the store; the layout guard does the navigation', async () => {
		localStorage.setItem('qinqin.token', 'stored');
		auth.set({ token: 'stored', user });

		logout();

		expect(getToken()).toBeNull();
		expect(get(auth)).toEqual({ token: null, user: null });
		expect(goto).not.toHaveBeenCalled();
	});

	it('logout asks the server to end the session, then clears local state', async () => {
		localStorage.setItem('qinqin.token', 'stored');
		auth.set({ token: 'stored', user });
		vi.mocked(fetch).mockImplementation(async () => new Response(null, { status: 204 }));

		logout();

		// State is cleared at once, without waiting for the request.
		expect(get(auth)).toEqual({ token: null, user: null });
		expect(getToken()).toBeNull();
		await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
		const [url, init] = vi.mocked(fetch).mock.calls[0];
		expect(String(url)).toBe('/api/auth/logout');
		expect(init?.method).toBe('POST');
		// The token was read before it was cleared.
		expect((init?.headers as Record<string, string>).authorization).toBe('Bearer stored');
	});

	it('logout clears local state even when the request fails', async () => {
		localStorage.setItem('qinqin.token', 'stored');
		auth.set({ token: 'stored', user });
		vi.mocked(fetch).mockRejectedValue(new TypeError('offline'));

		expect(() => logout()).not.toThrow();

		expect(get(auth)).toEqual({ token: null, user: null });
		await new Promise((r) => setTimeout(r, 0));
		expect(get(auth)).toEqual({ token: null, user: null });
	});

	it('logout without a token sends nothing', () => {
		logout();
		expect(fetch).not.toHaveBeenCalled();
	});

	describe('ends the session for every registered cache (#173)', () => {
		const ended: SessionEndReason[] = [];
		let off: () => void = () => undefined;
		beforeEach(() => {
			ended.length = 0;
			off = onSessionEnd((reason) => ended.push(reason));
		});
		afterEach(() => off());

		it('logout: signOut, and the workspace choice goes', () => {
			auth.set({ token: 'stored', user });
			localStorage.setItem('qinqin.workspace', '3');
			logout();
			expect(ended).toEqual(['signOut']);
			expect(localStorage.getItem('qinqin.workspace')).toBeNull();
		});

		it('a 401 that ends the session: expired, and the workspace choice stays', () => {
			auth.set({ token: 'stored', user });
			localStorage.setItem('qinqin.workspace', '3');
			notifyUnauthorized();
			expect(ended).toEqual(['expired']);
			expect(get(auth)).toEqual({ token: null, user: null });
			expect(localStorage.getItem('qinqin.workspace')).toBe('3');
		});

		it('the user changing under this tab (another tab, a token swap): switched, once', () => {
			auth.set({ token: 'stored', user });
			auth.set({ token: 'other', user: { ...user, id: 2 } });
			expect(ended).toEqual(['switched']);
			auth.set({ token: 'other', user: { ...user, id: 2 } });
			expect(ended).toEqual(['switched']);
		});

		it('another tab signing out ends it too', () => {
			auth.set({ token: 'stored', user });
			auth.set({ token: null, user: null });
			expect(ended).toEqual(['switched']);
		});

		it('hydrating the same user again (a reload of me) ends nothing', () => {
			auth.set({ token: 'stored', user });
			auth.set({ token: 'stored', user: { ...user, username: 'ada2' } });
			expect(ended).toEqual([]);
		});
	});
});

describe('an unknown login status', () => {
	it('is not stored as a session', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => jsonResponse({ status: 'mfa_required', token: 'half' }))
		);
		auth.set({ token: null, user: null });
		await expect(login('ada', 'pw')).rejects.toThrow(/not supported/);
		expect(getToken()).toBeNull();
		vi.unstubAllGlobals();
	});
});
