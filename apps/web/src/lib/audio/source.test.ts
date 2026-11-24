import { ClipCache } from '$lib/context/caches';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { goto } = vi.hoisted(() => ({ goto: vi.fn() }));
vi.mock('$app/navigation', () => ({ goto }));

import { clipObjectUrl, readyClipUrl } from './source';

// A fresh ClipCache per test (record 0009: the session owns one).
let cache = new ClipCache();
beforeEach(() => {
	cache = new ClipCache();
});

const blobResponse = (text: string) => new Response(new Blob([text], { type: 'audio/ogg' }), { status: 200 });

describe('clipObjectUrl', () => {
	let n = 0;
	const revoked: string[] = [];
	beforeEach(() => {
		cache.clear();
		n = 0;
		revoked.length = 0;
		vi.stubGlobal('localStorage', { getItem: (k: string) => (k === 'qinqin.token' ? 'tok' : null) });
		vi.stubGlobal('fetch', vi.fn(async () => blobResponse('OggS')));
		vi.stubGlobal('URL', { createObjectURL: () => `blob:clip-${++n}`, revokeObjectURL: (u: string) => revoked.push(u) });
	});
	afterEach(() => vi.unstubAllGlobals());

	it('fetches the clip with the bearer token (an audio element cannot) and caches the object URL', async () => {
		const a = await clipObjectUrl(cache, '/api/audio/clips/aa.opus');
		const b = await clipObjectUrl(cache, '/api/audio/clips/aa.opus');
		expect(a).toBe('blob:clip-1');
		expect(b).toBe(a);
		expect(fetch).toHaveBeenCalledTimes(1);
		const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
		expect(url).toBe('/api/audio/clips/aa.opus');
		expect(new Headers(init.headers).get('authorization')).toBe('Bearer tok');
	});

	it('shares one request between concurrent callers', async () => {
		const [a, b] = await Promise.all([clipObjectUrl(cache, '/c/x.opus'), clipObjectUrl(cache, '/c/x.opus')]);
		expect(a).toBe(b);
		expect(fetch).toHaveBeenCalledTimes(1);
	});

	it('does not cache a failure', async () => {
		vi.mocked(fetch).mockResolvedValueOnce(new Response('nope', { status: 404 }));
		await expect(clipObjectUrl(cache, '/c/y.opus')).rejects.toThrow();
		await expect(clipObjectUrl(cache, '/c/y.opus')).resolves.toBe('blob:clip-1');
	});

	it('keeps the most recent 40 clips and revokes the oldest', async () => {
		for (let i = 0; i < 41; i++) await clipObjectUrl(cache, `/c/${i}.opus`);
		expect(revoked).toEqual(['blob:clip-1']);
		await clipObjectUrl(cache, '/c/0.opus'); // evicted: fetched again
		expect(fetch).toHaveBeenCalledTimes(42);
	});

	it('readyClipUrl is null until the clip is fetched, then the object URL, synchronously', async () => {
		expect(readyClipUrl(cache, '/c/r.opus')).toBeNull();
		const p = clipObjectUrl(cache, '/c/r.opus');
		expect(readyClipUrl(cache, '/c/r.opus')).toBeNull(); // still in flight
		const url = await p;
		expect(readyClipUrl(cache, '/c/r.opus')).toBe(url);
	});

	it('never revokes a clip that is still being fetched, and trims once the fetches settle', async () => {
		const gates: (() => void)[] = [];
		vi.mocked(fetch).mockImplementation(() => new Promise((resolve) => gates.push(() => resolve(blobResponse('OggS')))));
		const pending = Array.from({ length: 41 }, (_, i) => clipObjectUrl(cache, `/c/p${i}.opus`));
		expect(revoked).toEqual([]);
		gates.forEach((g) => g());
		const urls = await Promise.all(pending);
		expect(urls).toHaveLength(41);
		expect(revoked).toHaveLength(1); // trimmed to 40 after they settled
		expect(revoked[0]).toBe(urls[0]);
	});
});
