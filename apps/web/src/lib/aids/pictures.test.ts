import { describe, expect, it, vi } from 'vitest';
import type { EntryPicture } from '$lib/api/images';
import { PictureCache, pictureFor } from './pictures';

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
