import { describe, expect, it, vi } from 'vitest';
import type { EntryPicture } from '$lib/api/images';
import { ApiError } from '$lib/api/client';
import type { OfflinePictures } from '$lib/packages/offlinePictures';
import { onlineOrKept, PictureCache, pictureFor, reportPicture } from './pictures';

const apple: EntryPicture = {
	packId: 'openmoji',
	concept: '1F34E',
	label: 'red apple',
	credit: 'OpenMoji',
	license: 'CC BY-SA 4.0',
	attribution: '',
	basis: 'gloss',
	sense: 0,
	score: 90,
	svg: '<svg viewBox="0 0 1 1"></svg>'
};

describe('pictureFor', () => {
	it('asks once per entry, even for concurrent callers, and remembers the answer', async () => {
		const cache = new PictureCache();
		const fetcher = vi.fn(async () => apple);
		const [a, b] = await Promise.all([pictureFor(cache, 7, fetcher), pictureFor(cache, 7, fetcher)]);
		expect(a).toBe(apple);
		expect(b).toBe(apple);
		await pictureFor(cache, 7, fetcher);
		expect(fetcher).toHaveBeenCalledTimes(1);
		expect(cache.peek(7)).toBe(apple);
	});

	it('remembers that an entry has no picture', async () => {
		const cache = new PictureCache();
		const fetcher = vi.fn(async () => null);
		expect(await pictureFor(cache, 8, fetcher)).toBeNull();
		await pictureFor(cache, 8, fetcher);
		expect(fetcher).toHaveBeenCalledTimes(1);
		expect(cache.peek(8)).toBeNull();
		expect(cache.peek(9)).toBeUndefined();
	});

	it('shows nothing on an error and asks again next time (an error is not "no picture")', async () => {
		const cache = new PictureCache();
		const fetcher = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(apple);
		expect(await pictureFor(cache, 3, fetcher)).toBeNull();
		expect(cache.peek(3)).toBeUndefined();
		expect(await pictureFor(cache, 3, fetcher)).toBe(apple);
	});

	it('clear forgets everything', async () => {
		const cache = new PictureCache();
		await pictureFor(cache, 1, async () => apple);
		cache.clear();
		expect(cache.peek(1)).toBeUndefined();
	});
});

describe('onlineOrKept (#274)', () => {
	const kept = (answer: EntryPicture | null | undefined) => ({ lookup: vi.fn(async () => answer) }) as unknown as OfflinePictures;

	it('asks the server first and does not look at the kept packages when it answers', async () => {
		const offline = kept(null);
		expect(await onlineOrKept(1, offline, async () => apple)).toBe(apple);
		expect(offline.lookup).not.toHaveBeenCalled();
	});

	it('answers from the kept packages when the server cannot be reached', async () => {
		const pear = { ...apple, concept: '1F350' };
		expect(await onlineOrKept(1, kept(pear), async () => Promise.reject(new TypeError('Failed to fetch')))).toBe(pear);
		expect(await onlineOrKept(1, kept(pear), async () => Promise.reject(new ApiError(503, 'down')))).toBe(pear);
		expect(await onlineOrKept(1, kept(null), async () => Promise.reject(new TypeError('Failed to fetch')))).toBeNull();
	});

	it('keeps the error when nothing is kept or the server refused', async () => {
		await expect(onlineOrKept(1, kept(undefined), async () => Promise.reject(new TypeError('Failed to fetch')))).rejects.toThrow('Failed to fetch');
		const offline = kept(apple);
		await expect(onlineOrKept(1, offline, async () => Promise.reject(new ApiError(404, 'gone')))).rejects.toBeInstanceOf(ApiError);
		expect(offline.lookup).not.toHaveBeenCalled();
	});
});

describe('reportPicture (#274)', () => {
	it('sends the report, forgets the answer and tells the kept packages', async () => {
		const offline = { reset: vi.fn(), noteReported: vi.fn() } as unknown as OfflinePictures;
		const cache = new PictureCache(offline);
		cache.loaded.set(7, apple);
		const send = vi.fn(async () => undefined);
		await reportPicture(cache, 7, apple, 'wrong', send);
		expect(send).toHaveBeenCalledWith({ entryId: 7, packId: 'openmoji', concept: '1F34E', reason: 'wrong' });
		expect(cache.peek(7)).toBeUndefined();
		expect(offline.noteReported).toHaveBeenCalledWith(7, 'openmoji', '1F34E');
	});

	it('changes nothing when the report fails', async () => {
		const cache = new PictureCache({ reset: vi.fn(), noteReported: vi.fn() } as unknown as OfflinePictures);
		cache.loaded.set(7, apple);
		await expect(reportPicture(cache, 7, apple, 'wrong', async () => Promise.reject(new Error('offline')))).rejects.toThrow();
		expect(cache.peek(7)).toBe(apple);
	});
});
