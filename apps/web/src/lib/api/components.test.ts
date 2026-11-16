import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { goto } = vi.hoisted(() => ({ goto: vi.fn() }));
vi.mock('$app/navigation', () => ({ goto }));

import fixture from '../../../../../docs/contracts/radicals/components-response.json';
import { clearComponentsCache, fetchComponents, getComponentPacks } from './components';

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('fetchComponents', () => {
	beforeEach(() => {
		clearComponentsCache();
		vi.stubGlobal('fetch', vi.fn());
	});
	afterEach(() => vi.unstubAllGlobals());

	it('requests the primary subtag and decodes the contract body', async () => {
		vi.mocked(fetch).mockResolvedValue(jsonResponse(fixture.components));
		const got = await fetchComponents('ja');
		const url = new URL(String(vi.mocked(fetch).mock.calls[0][0]), 'http://localhost');
		expect(url.pathname).toBe('/api/components');
		expect(url.searchParams.get('language')).toBe('ja');
		expect(got.parts).toEqual(fixture.components.parts);
		expect(got.packs).toEqual([{ id: 'ja-comp', license: 'CC BY-SA 3.0', attribution: 'Test fixture' }]);
		expect(got.chars['語']).toEqual(['言', '口', '吾', '五', '二']);
		await fetchComponents('JA');
		expect(fetch).toHaveBeenCalledTimes(1);
	});

	it('shares one request between concurrent callers and keeps zh-TW under zh', async () => {
		let resolve!: (r: Response) => void;
		vi.mocked(fetch).mockReturnValue(new Promise<Response>((r) => (resolve = r)));
		const a = fetchComponents('zh-TW');
		const b = fetchComponents('zh');
		resolve(jsonResponse(fixture.emptyComponents));
		expect(await a).toBe(await b);
		expect(fetch).toHaveBeenCalledTimes(1);
		expect(new URL(String(vi.mocked(fetch).mock.calls[0][0]), 'http://x').searchParams.get('language')).toBe('zh');
	});

	it('does not cache errors and tolerates a malformed body', async () => {
		vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ error: 'x' }, 500));
		await expect(fetchComponents('ja')).rejects.toBeTruthy();
		vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ parts: 'nope', chars: null }));
		expect(await fetchComponents('ja')).toEqual({ packs: [], parts: [], chars: {} });
		expect(fetch).toHaveBeenCalledTimes(2);
	});
});

describe('getComponentPacks', () => {
	afterEach(() => vi.unstubAllGlobals());
	it('lists the packs without credentials', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse([{ packId: 'p', name: 'P', version: '1', language: 'ja', license: 'CC BY-SA 3.0', attribution: 'a', notice: '' }])));
		const got = await getComponentPacks();
		expect(got[0].packId).toBe('p');
		const init = vi.mocked(fetch).mock.calls[0][1];
		expect(new Headers(init?.headers).get('authorization')).toBeNull();
	});
});
