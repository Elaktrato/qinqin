import { describe, expect, it, vi } from 'vitest';

import type { EntryPicture } from '../api/images';
import { PictureCache } from './pictureCache';

const pic = (concept: string): EntryPicture => ({
	packId: 'p',
	concept,
	label: concept,
	credit: 'c',
	license: 'l',
	attribution: 'a',
	basis: 'manual',
	sense: 0,
	score: 100,
	svg: '<svg xmlns="http://www.w3.org/2000/svg"></svg>'
});

describe('PictureCache', () => {
	it('asks once per entry, however many callers', async () => {
		const fetch = vi.fn(async (id: number) => pic(String(id)));
		const cache = new PictureCache(fetch);
		const [a, b] = await Promise.all([cache.load(1), cache.load(1)]);
		expect(a).toBe(b);
		await cache.load(1);
		expect(fetch).toHaveBeenCalledTimes(1);
		expect(cache.peek(1)?.concept).toBe('1');
	});

	it('remembers "no picture" as null', async () => {
		const cache = new PictureCache(async () => null);
		expect(cache.peek(5)).toBeUndefined();
		expect(await cache.load(5)).toBeNull();
		expect(cache.peek(5)).toBeNull();
	});

	it('turns a failure into no picture and asks again next time', async () => {
		const fetch = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(pic('x'));
		const cache = new PictureCache(fetch);
		expect(await cache.load(2)).toBeNull();
		expect(cache.peek(2)).toBeUndefined();
		expect((await cache.load(2))?.concept).toBe('x');
	});

	it('keeps at most `limit` pictures, dropping the oldest', async () => {
		const cache = new PictureCache(async (id) => pic(String(id)), 2);
		await cache.load(1);
		await cache.load(2);
		await cache.load(3);
		expect(cache.peek(1)).toBeUndefined();
		expect(cache.peek(2)).not.toBeUndefined();
		expect(cache.peek(3)).not.toBeUndefined();
	});
});
