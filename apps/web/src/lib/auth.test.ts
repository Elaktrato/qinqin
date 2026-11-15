import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';

const { goto } = vi.hoisted(() => ({ goto: vi.fn() }));

const { clearClipCache, clearAudioCache } = vi.hoisted(() => ({ clearClipCache: vi.fn(), clearAudioCache: vi.fn() }));

vi.mock('$app/navigation', () => ({ goto }));
vi.mock('./audio/source', () => ({ clearClipCache }));
vi.mock('./api/audio', () => ({ clearAudioCache }));

import { auth, loadMe, login, logout, register, restriction } from './auth';

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
				if (url === '/api/auth/login') return jsonResponse({ token: 'token-1' });
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
			if (url === '/api/auth/login') return jsonResponse({ token: 'token-1' });
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

		expect(localStorage.getItem('qinqin.token')).toBeNull();
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
			if (url === '/api/auth/login') return jsonResponse({ token: 'token-1' });
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

		expect(localStorage.getItem('qinqin.token')).toBeNull();
		expect(get(auth)).toEqual({ token: null, user: null });
		expect(goto).not.toHaveBeenCalled();
	});

	it('logout forgets the audio caches (blob URLs and resolutions of the signed-out user)', () => {
		logout();
		expect(clearClipCache).toHaveBeenCalled();
		expect(clearAudioCache).toHaveBeenCalled();
	});
});
