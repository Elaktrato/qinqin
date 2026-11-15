import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { goto } = vi.hoisted(() => ({ goto: vi.fn() }));
vi.mock('$app/navigation', () => ({ goto }));

import { clearClipCache, clipObjectUrl } from './source';

const blobResponse = (text: string) => new Response(new Blob([text], { type: 'audio/ogg' }), { status: 200 });

describe('clipObjectUrl', () => {
	let n = 0;
	const revoked: string[] = [];
	beforeEach(() => {
		clearClipCache();
		n = 0;
		revoked.length = 0;
		vi.stubGlobal('localStorage', { getItem: (k: string) => (k === 'qinqin.token' ? 'tok' : null) });
		vi.stubGlobal('fetch', vi.fn(async () => blobResponse('OggS')));
		vi.stubGlobal('URL', { createObjectURL: () => `blob:clip-${++n}`, revokeObjectURL: (u: string) => revoked.push(u) });
	});
	afterEach(() => vi.unstubAllGlobals());

	it('fetches the clip with the bearer token (an audio element cannot) and caches the object URL', async () => {
		const a = await clipObjectUrl('/api/audio/clips/aa.opus');
		const b = await clipObjectUrl('/api/audio/clips/aa.opus');
		expect(a).toBe('blob:clip-1');
		expect(b).toBe(a);
		expect(fetch).toHaveBeenCalledTimes(1);
		const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
		expect(url).toBe('/api/audio/clips/aa.opus');
		expect(new Headers(init.headers).get('authorization')).toBe('Bearer tok');
	});

	it('shares one request between concurrent callers', async () => {
		const [a, b] = await Promise.all([clipObjectUrl('/c/x.opus'), clipObjectUrl('/c/x.opus')]);
		expect(a).toBe(b);
		expect(fetch).toHaveBeenCalledTimes(1);
	});

	it('does not cache a failure', async () => {
		vi.mocked(fetch).mockResolvedValueOnce(new Response('nope', { status: 404 }));
		await expect(clipObjectUrl('/c/y.opus')).rejects.toThrow();
		await expect(clipObjectUrl('/c/y.opus')).resolves.toBe('blob:clip-1');
	});

	it('keeps the most recent 40 clips and revokes the oldest', async () => {
		for (let i = 0; i < 41; i++) await clipObjectUrl(`/c/${i}.opus`);
		expect(revoked).toEqual(['blob:clip-1']);
		await clipObjectUrl('/c/0.opus'); // evicted: fetched again
		expect(fetch).toHaveBeenCalledTimes(42);
	});
});
