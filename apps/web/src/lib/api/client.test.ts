import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { goto } = vi.hoisted(() => ({ goto: vi.fn() }));

vi.mock('$app/navigation', () => ({ goto }));

import { ApiError, api, apiBlob, apiErrorBody, setUnauthorizedHandler } from './client';

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

describe('api client', () => {
	beforeEach(() => {
		vi.stubGlobal('localStorage', fakeStorage());
		vi.stubGlobal('fetch', vi.fn());
		goto.mockReset();
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('sends the stored token as a bearer header and parses JSON', async () => {
		localStorage.setItem('qinqin.token', 'secret');

		vi.mocked(fetch).mockResolvedValue(jsonResponse({ id: 1, username: 'ada', admin: true }));

		const user = await api<{ id: number; username: string }>('/api/auth/me');

		expect(user).toEqual({ id: 1, username: 'ada', admin: true });
		expect(fetch).toHaveBeenCalledOnce();
		const [url, init] = vi.mocked(fetch).mock.calls[0];
		expect(url).toBe('/api/auth/me');
		expect(new Headers(init?.headers).get('authorization')).toBe('Bearer secret');
	});

	it('sends JSON bodies with a content-type header', async () => {
		vi.mocked(fetch).mockResolvedValue(jsonResponse({ token: 'fresh' }));

		await api('/api/auth/login', {
			method: 'POST',
			body: { username: 'ada', password: 'pw' },
			auth: false
		});

		const [, init] = vi.mocked(fetch).mock.calls[0];
		expect(init?.method).toBe('POST');
		expect(new Headers(init?.headers).get('content-type')).toBe('application/json');
		expect(init?.body).toBe(JSON.stringify({ username: 'ada', password: 'pw' }));
	});

	it('does not send a bearer header when no token is stored or auth is off', async () => {
		localStorage.setItem('qinqin.token', 'secret');
		vi.mocked(fetch).mockResolvedValue(jsonResponse({ token: 'fresh' }));

		await api('/api/auth/login', {
			method: 'POST',
			body: { username: 'ada', password: 'pw' },
			auth: false
		});

		const [, init] = vi.mocked(fetch).mock.calls[0];
		expect(new Headers(init?.headers).get('authorization')).toBeNull();
	});

	it('throws ApiError with the text body on a failed response', async () => {
		vi.mocked(fetch).mockResolvedValue(new Response('entry not found', { status: 404 }));

		const failure = api('/api/entries/99');
		await expect(failure).rejects.toBeInstanceOf(ApiError);
		await expect(failure).rejects.toMatchObject({ status: 404, message: 'entry not found' });
	});

	it('clears the token and redirects to /login on 401', async () => {
		localStorage.setItem('qinqin.token', 'stale');
		vi.mocked(fetch).mockResolvedValue(new Response('unauthorized', { status: 401 }));

		await expect(api('/api/auth/me')).rejects.toMatchObject({ status: 401, message: 'unauthorized' });

		expect(localStorage.getItem('qinqin.token')).toBeNull();
		expect(goto).toHaveBeenCalledWith('/login');
	});

	it('does not redirect on 401 while already on the login page', async () => {
		vi.stubGlobal('window', { location: { pathname: '/login' } });
		localStorage.setItem('qinqin.token', 'stale');
		vi.mocked(fetch).mockResolvedValue(new Response('bad credentials', { status: 401 }));

		await expect(api('/api/auth/login')).rejects.toMatchObject({ status: 401 });

		expect(localStorage.getItem('qinqin.token')).toBeNull();
		expect(goto).not.toHaveBeenCalled();
	});

	it('signs out quietly on 401 on the open Sources page, without redirecting', async () => {
		vi.stubGlobal('window', { location: { pathname: '/sources/' } });
		localStorage.setItem('qinqin.token', 'stale');
		vi.mocked(fetch).mockResolvedValue(new Response('unauthorized', { status: 401 }));

		await expect(api('/api/auth/me')).rejects.toMatchObject({ status: 401 });

		expect(localStorage.getItem('qinqin.token')).toBeNull();
		expect(goto).not.toHaveBeenCalled();
	});

	it('still redirects on 401 on a path that only starts with /sources', async () => {
		vi.stubGlobal('window', { location: { pathname: '/sourcesx' } });
		localStorage.setItem('qinqin.token', 'stale');
		vi.mocked(fetch).mockResolvedValue(new Response('unauthorized', { status: 401 }));

		await expect(api('/api/auth/me')).rejects.toMatchObject({ status: 401 });

		expect(goto).toHaveBeenCalledWith('/login');
	});
});

describe('api client FormData bodies and abort signal', () => {
	beforeEach(() => {
		vi.stubGlobal('localStorage', fakeStorage());
		vi.stubGlobal('fetch', vi.fn());
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('passes FormData through untouched with no content-type', async () => {
		vi.mocked(fetch).mockResolvedValue(jsonResponse({}));
		const form = new FormData();
		form.set('a', 'b');

		await api('/x', { body: form });

		const [, init] = vi.mocked(fetch).mock.calls[0];
		expect(init?.body).toBe(form);
		expect(new Headers(init?.headers).get('content-type')).toBeNull();
	});

	it('forwards an abort signal', async () => {
		vi.mocked(fetch).mockResolvedValue(jsonResponse({}));
		const controller = new AbortController();

		await api('/x', { signal: controller.signal });

		expect(vi.mocked(fetch).mock.calls[0][1]?.signal).toBe(controller.signal);
	});
});

describe('apiBlob and apiErrorBody', () => {
	beforeEach(() => {
		vi.stubGlobal('localStorage', fakeStorage());
		vi.stubGlobal('fetch', vi.fn());
		goto.mockReset();
	});

	afterEach(() => {
		setUnauthorizedHandler(null);
		vi.unstubAllGlobals();
	});

	it('apiBlob sends the bearer and returns the blob', async () => {
		localStorage.setItem('qinqin.token', 'tok');
		vi.mocked(fetch).mockResolvedValue(new Response('IMG', { status: 200 }));

		const blob = await apiBlob('/api/journal/photos/p1');

		expect(await blob.text()).toBe('IMG');
		const [url, init] = vi.mocked(fetch).mock.calls[0];
		expect(url).toBe('/api/journal/photos/p1');
		expect(new Headers(init?.headers).get('authorization')).toBe('Bearer tok');
	});

	it('apiBlob runs the unauthorized handler on 401', async () => {
		const handler = vi.fn();
		setUnauthorizedHandler(handler);
		vi.mocked(fetch).mockResolvedValue(new Response('nope', { status: 401 }));

		await expect(apiBlob('/x')).rejects.toMatchObject({ status: 401 });
		expect(handler).toHaveBeenCalledOnce();
	});

	it('api records Retry-After on the error', async () => {
		vi.mocked(fetch).mockResolvedValue(
			new Response('{}', { status: 429, headers: { 'retry-after': '90' } })
		);
		await expect(api('/x')).rejects.toMatchObject({ status: 429, retryAfterSeconds: 90 });
	});

	it('apiErrorBody parses the JSON body and returns null for plain text', () => {
		expect(apiErrorBody(new ApiError(409, '{"error":"no_key","message":"Add a key."}'))).toEqual({
			error: 'no_key',
			message: 'Add a key.'
		});
		expect(apiErrorBody(new ApiError(500, 'internal error'))).toBeNull();
		expect(apiErrorBody(new Error('x'))).toBeNull();
		expect(apiErrorBody(new ApiError(400, '{"foo":1}'))).toBeNull();
	});
});
