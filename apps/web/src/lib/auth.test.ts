import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';

const { goto } = vi.hoisted(() => ({ goto: vi.fn() }));

vi.mock('$app/navigation', () => ({ goto }));

import { auth, loadMe, login, logout, register } from './auth';

const user = { id: 1, username: 'ada', admin: true };

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

		await expect(login('ada', 'pw')).rejects.toMatchObject({ status: 500 });

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

	it('logout clears storage and the store; the layout guard does the navigation', async () => {
		localStorage.setItem('qinqin.token', 'stored');
		auth.set({ token: 'stored', user });

		logout();

		expect(localStorage.getItem('qinqin.token')).toBeNull();
		expect(get(auth)).toEqual({ token: null, user: null });
		expect(goto).not.toHaveBeenCalled();
	});
});
