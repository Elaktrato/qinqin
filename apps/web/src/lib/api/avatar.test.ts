import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fixture from '../../../../../docs/contracts/auth/avatar.json';
import { AvatarCache } from '$lib/context/caches';
import { API_ERROR_KEYS } from './apiErrors';
import { avatarObjectUrl, removeAvatar, removeUserAvatar, uploadAvatar } from './avatar';

const ok = (body: unknown, status = 200) => new Response(body === null ? null : JSON.stringify(body), { status });

describe('docs/contracts/auth/avatar.json from the client', () => {
	beforeEach(() => vi.stubGlobal('fetch', vi.fn()));
	afterEach(() => vi.unstubAllGlobals());

	it('uploads the picture as the multipart field file and reads avatarUrl', async () => {
		vi.mocked(fetch).mockResolvedValueOnce(ok(fixture.upload.body));
		const blob = new Blob(['png'], { type: 'image/png' });
		const out = await uploadAvatar(blob);
		expect(out).toBe(fixture.upload.body.avatarUrl);
		const [path, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
		expect(path).toBe(fixture.upload.request.path);
		expect(init.method).toBe(fixture.upload.request.method);
		const form = init.body as FormData;
		expect(form).toBeInstanceOf(FormData);
		expect(form.get('file')).toBeInstanceOf(Blob);
	});

	it('removes your own picture and, for an administrator, another user\'s', async () => {
		vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 204 }));
		await removeAvatar();
		await removeUserAvatar(7);
		const calls = vi.mocked(fetch).mock.calls as [string, RequestInit][];
		expect([calls[0][0], calls[0][1].method]).toEqual([fixture.remove.request.path, fixture.remove.request.method]);
		expect([calls[1][0], calls[1][1].method]).toEqual([fixture.admin_remove.request.path.replace('{id}', '7'), 'DELETE']);
	});

	it('translates every refusal the contract names', () => {
		for (const c of Object.values(fixture)) {
			const code = (c as { body?: { error?: string } }).body?.error;
			if (code) expect(Object.hasOwn(API_ERROR_KEYS, code), code).toBe(true);
		}
	});
});

describe('avatarObjectUrl', () => {
	let made = 0;
	const revoked: string[] = [];
	beforeEach(() => {
		made = 0;
		revoked.length = 0;
		vi.stubGlobal('fetch', vi.fn(async () => new Response(new Blob(['jpg']), { status: 200 })));
		vi.stubGlobal('URL', { createObjectURL: () => `blob:pic-${++made}`, revokeObjectURL: (u: string) => revoked.push(u) });
	});
	afterEach(() => vi.unstubAllGlobals());

	it('fetches a picture once per session with the bearer token and revokes it at the end', async () => {
		const cache = new AvatarCache();
		const url = `${fixture.upload.body.avatarUrl}?size=64`;
		const [a, b] = await Promise.all([avatarObjectUrl(cache, url), avatarObjectUrl(cache, url)]);
		expect(a).toBe('blob:pic-1');
		expect(b).toBe(a);
		expect(fetch).toHaveBeenCalledTimes(1);
		expect(vi.mocked(fetch).mock.calls[0][0]).toBe(url);
		cache.clear();
		expect(revoked).toEqual(['blob:pic-1']);
	});

	it('forgets a failed load, so the next use tries again', async () => {
		const cache = new AvatarCache();
		vi.mocked(fetch).mockResolvedValueOnce(new Response('{"error":"not_found","message":"x"}', { status: 404 }));
		await expect(avatarObjectUrl(cache, '/api/avatars/1/x')).rejects.toThrow();
		expect(await avatarObjectUrl(cache, '/api/avatars/1/x')).toBe('blob:pic-1');
	});

	it('never fetches a path that is not this server\'s API', async () => {
		const cache = new AvatarCache();
		await expect(avatarObjectUrl(cache, 'https://elsewhere.example/a.jpg')).rejects.toThrow();
		await expect(avatarObjectUrl(cache, '//elsewhere.example/a.jpg')).rejects.toThrow();
		expect(fetch).not.toHaveBeenCalled();
	});
});

describe('avatarObjectUrl: object URLs are never left behind', () => {
	const revoked: string[] = [];
	let made = 0;
	beforeEach(() => {
		made = 0;
		revoked.length = 0;
		vi.stubGlobal('URL', { createObjectURL: () => `blob:pic-${++made}`, revokeObjectURL: (u: string) => revoked.push(u) });
	});
	afterEach(() => vi.unstubAllGlobals());

	it('revokes a picture that arrives after the session cleared the cache', async () => {
		let answer: (r: Response) => void = () => undefined;
		vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((r) => (answer = r))));
		const cache = new AvatarCache();
		const late = avatarObjectUrl(cache, '/api/avatars/1/aaaa');
		cache.clear();
		answer(new Response('jpg', { status: 200 }));
		await late;
		expect(revoked).toEqual(['blob:pic-1']);
		expect(cache.slots.size).toBe(0);
	});

	it('revokes the old picture of a user when a new one is loaded, keeping both sizes of the new one', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => new Response('jpg', { status: 200 })));
		const cache = new AvatarCache();
		await avatarObjectUrl(cache, '/api/avatars/1/aaaa?size=64');
		await avatarObjectUrl(cache, '/api/avatars/1/aaaa');
		await avatarObjectUrl(cache, '/api/avatars/2/cccc?size=64');
		await avatarObjectUrl(cache, '/api/avatars/1/bbbb?size=64');
		expect(revoked.sort()).toEqual(['blob:pic-1', 'blob:pic-2']);
		expect([...cache.slots.keys()].sort()).toEqual(['/api/avatars/1/bbbb?size=64', '/api/avatars/2/cccc?size=64']);
		await avatarObjectUrl(cache, '/api/avatars/1/bbbb');
		expect(cache.slots.size).toBe(3);
	});
});
