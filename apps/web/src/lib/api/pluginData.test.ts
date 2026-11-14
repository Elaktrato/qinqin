import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { goto } = vi.hoisted(() => ({ goto: vi.fn() }));

vi.mock('$app/navigation', () => ({ goto }));

import { ApiError } from './client';
import { getUserPluginData, putUserPluginData } from './pluginData';

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json' }
	});
}

function lastCall() {
	const calls = vi.mocked(fetch).mock.calls;
	const [url, init] = calls[calls.length - 1];
	return { url: String(url), init: init as RequestInit };
}

describe('user-global plugin data client', () => {
	beforeEach(() => {
		vi.stubGlobal('localStorage', {
			getItem: (k: string) => (k === 'qinqin.token' ? 'tok' : null)
		});
		vi.stubGlobal('fetch', vi.fn());
		goto.mockReset();
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('GETs the row without a workspace parameter and returns its data', async () => {
		vi.mocked(fetch).mockResolvedValue(
			jsonResponse({ pluginId: 'qinqin-core', key: 'home-layout', workspaceId: null, data: { a: 1 } })
		);

		expect(await getUserPluginData('qinqin-core', 'home-layout')).toEqual({ a: 1 });
		expect(lastCall().url).toBe('/api/plugins/qinqin-core/data/home-layout');
		expect(lastCall().init.method).toBe('GET');
	});

	it('decodes data a row carries as a JSON string', async () => {
		vi.mocked(fetch).mockResolvedValue(jsonResponse({ data: '{"a":2}' }));

		expect(await getUserPluginData('qinqin-core', 'k')).toEqual({ a: 2 });
	});

	it('returns null for a missing row (404)', async () => {
		vi.mocked(fetch).mockResolvedValue(new Response('plugin data not found', { status: 404 }));

		expect(await getUserPluginData('qinqin-core', 'home-layout')).toBeNull();
	});

	it('rethrows other failures', async () => {
		vi.mocked(fetch).mockResolvedValue(new Response('boom', { status: 500 }));

		await expect(getUserPluginData('qinqin-core', 'home-layout')).rejects.toBeInstanceOf(ApiError);
	});

	it('PUTs the value as the JSON body without a workspace parameter', async () => {
		vi.mocked(fetch).mockResolvedValue(jsonResponse({ data: { version: 1 } }));

		await putUserPluginData('qinqin-core', 'home-layout', { version: 1, widgets: ['x'] });

		const { url, init } = lastCall();
		expect(url).toBe('/api/plugins/qinqin-core/data/home-layout');
		expect(init.method).toBe('PUT');
		expect(JSON.parse(String(init.body))).toEqual({ version: 1, widgets: ['x'] });
	});

	it('escapes the plugin id and key in the path', async () => {
		vi.mocked(fetch).mockResolvedValue(new Response('', { status: 404 }));

		await getUserPluginData('a/b', 'c d');

		expect(lastCall().url).toBe('/api/plugins/a%2Fb/data/c%20d');
	});
});
