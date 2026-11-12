import { describe, expect, it, vi } from 'vitest';
import { cachedSegment } from './segmentCache';

function fake() {
	return vi.fn(async (_lang: string, text: string, offset: number, _signal?: AbortSignal) => {
		const surface = Array.from(text).slice(offset, offset + 2).join('');
		return { surface, start: offset, end: offset + 2, lemma: surface, reason: '', entries: [] };
	});
}

describe('cachedSegment', () => {
	it('reuses a result for the same language and window, translating offsets', async () => {
		const inner = fake();
		const segment = cachedSegment(inner, 10);
		expect(await segment('zh', '我学习', 1)).toMatchObject({ surface: '学习', start: 1, end: 3 });
		// Same window ("学习") at a different offset in another text.
		expect(await segment('zh', '你们学习', 2)).toMatchObject({ surface: '学习', start: 2, end: 4 });
		expect(inner).toHaveBeenCalledTimes(1);
		await segment('ja', '学习', 0);
		expect(inner).toHaveBeenCalledTimes(2);
	});

	it('caches misses too but never failures', async () => {
		const inner = vi
			.fn()
			.mockResolvedValueOnce(null)
			.mockRejectedValueOnce(new Error('offline'))
			.mockResolvedValueOnce(null);
		const segment = cachedSegment(inner, 10);
		expect(await segment('zh', '。', 0)).toBeNull();
		expect(await segment('zh', '。', 0)).toBeNull();
		await expect(segment('zh', '？', 0)).rejects.toThrow('offline');
		expect(await segment('zh', '？', 0)).toBeNull();
		expect(inner).toHaveBeenCalledTimes(3);
	});

	it('does not call through for an out-of-range offset', async () => {
		const inner = fake();
		expect(await cachedSegment(inner, 10)('zh', 'ab', 5)).toBeNull();
		expect(inner).not.toHaveBeenCalled();
	});

	it('evicts the oldest entries beyond its size', async () => {
		const inner = fake();
		const segment = cachedSegment(inner, 2);
		await segment('zh', 'a', 0);
		await segment('zh', 'b', 0);
		await segment('zh', 'c', 0);
		await segment('zh', 'a', 0);
		expect(inner).toHaveBeenCalledTimes(4);
		await segment('zh', 'c', 0);
		expect(inner).toHaveBeenCalledTimes(4);
	});
});
