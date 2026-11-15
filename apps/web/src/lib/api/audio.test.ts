import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { goto } = vi.hoisted(() => ({ goto: vi.fn() }));
vi.mock('$app/navigation', () => ({ goto }));

import { clearAudioCache, getEntryAudio, resolveAudio, type AudioResolution } from './audio';

const clip = (n: string) => ({
	url: `/api/audio/clips/${n}.opus`,
	packId: 'p',
	license: 'CC0',
	attribution: 'A',
	source: ''
});
const res = (n: string): AudioResolution => ({ terms: [clip(n)], syllables: null });
const json = (body: unknown) =>
	new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

describe('audio api client', () => {
	beforeEach(() => {
		clearAudioCache();
		vi.stubGlobal('localStorage', { getItem: (k: string) => (k === 'qinqin.token' ? 'tok' : null) });
		vi.stubGlobal('fetch', vi.fn());
	});
	afterEach(() => vi.unstubAllGlobals());

	it('getEntryAudio fetches once per entry and caches', async () => {
		vi.mocked(fetch).mockResolvedValue(json({ terms: [clip('a')], syllables: [null, [clip('b')]] }));
		const first = await getEntryAudio(7);
		expect(first.syllables?.[0]).toBeNull();
		expect(first.syllables?.[1]?.[0].url).toContain('b.opus');
		await getEntryAudio(7);
		expect(fetch).toHaveBeenCalledTimes(1);
		const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
		expect(url).toBe('/api/audio/entries/7');
		expect(new Headers(init.headers).get('authorization')).toBe('Bearer tok');
	});

	it('resolveAudio chunks 450 ids into 3 requests and shares the cache', async () => {
		vi.mocked(fetch).mockImplementation(async (_url, init) => {
			const ids = (JSON.parse(String((init as RequestInit).body)) as { entryIds: number[] }).entryIds;
			return json(Object.fromEntries(ids.filter((i) => i !== 5).map((i) => [String(i), res(`c${i}`)])));
		});
		const ids = Array.from({ length: 450 }, (_, i) => i + 1);
		const out = await resolveAudio(ids);
		expect(fetch).toHaveBeenCalledTimes(3);
		const sizes = vi.mocked(fetch).mock.calls.map(([, init]) => (JSON.parse(String((init as RequestInit).body)) as { entryIds: number[] }).entryIds.length);
		expect(sizes).toEqual([200, 200, 50]);
		expect(Object.keys(out)).toHaveLength(450);
		expect(out['1'].terms[0].url).toContain('c1');
		// An id the server left out is an empty resolution, not a retry.
		expect(out['5']).toEqual({ terms: [], syllables: null });

		await resolveAudio([1, 2, 5]);
		await getEntryAudio(3);
		expect(fetch).toHaveBeenCalledTimes(3);
	});

	it('resolveAudio never throws: a failed chunk is left out and retried next time', async () => {
		vi.mocked(fetch).mockResolvedValueOnce(new Response('boom', { status: 500 }));
		const out = await resolveAudio([1, 2]);
		expect(out).toEqual({});
		vi.mocked(fetch).mockResolvedValueOnce(json({ '1': res('x') }));
		expect(Object.keys(await resolveAudio([1]))).toEqual(['1']);
	});
});
