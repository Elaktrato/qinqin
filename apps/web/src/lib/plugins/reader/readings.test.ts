import { describe, expect, it, vi } from 'vitest';
import type { SegmentMatch } from '$lib/api/types';
import { DEFAULT_DISPLAY, type ReaderDisplay } from './displaySettings';
import { ReadingsController } from './readings.svelte';
import type { Run } from './paragraphText';

const zhMatch = (start: number, end: number, entry: number, value: string): SegmentMatch => ({
	surface: '你好', start, end, lemma: '你好', reason: '', entries: [{ id: entry, kind: 'word' }], reading: { type: 'pinyin', value }
});
const display = (over: Partial<ReaderDisplay>): ReaderDisplay => ({ ...DEFAULT_DISPLAY, ...over });
const runs: Run[][] = [[{ text: '你好' }], [{ text: '你好' }]];

describe('ReadingsController', () => {
	it('makes no request in never mode and keeps no pieces', async () => {
		const segment = vi.fn(async () => []);
		const c = new ReadingsController(segment);
		await c.run({ key: 'a', lang: 'zh', runs, start: 0, display: display({ readings: 'never' }), index: new Map() });
		expect(segment).not.toHaveBeenCalled();
		expect(c.pieces.size).toBe(0);
	});

	it('makes no request for other languages', async () => {
		const segment = vi.fn(async () => []);
		const c = new ReadingsController(segment);
		await c.run({ key: 'a', lang: 'en', runs, start: 0, display: display({ readings: 'always' }), index: new Map() });
		expect(segment).not.toHaveBeenCalled();
	});

	it('fills pieces per paragraph as chunks arrive', async () => {
		const segment = vi.fn(async () => [zhMatch(0, 2, 1, 'nǐ hǎo'), zhMatch(3, 5, 1, 'nǐ hǎo')]);
		const c = new ReadingsController(segment);
		await c.run({ key: 'a', lang: 'zh', runs, start: 0, display: display({ readings: 'always' }), index: new Map() });
		expect(c.pieces.get(0)).toEqual([{ start: 0, end: 2, rt: 'nǐ hǎo', concealed: false, source: 'dict' }]);
		expect(c.pieces.get(1)?.[0].rt).toBe('nǐ hǎo');
	});

	it('update re-applies the smart rule without a new request', async () => {
		const segment = vi.fn(async () => [zhMatch(0, 2, 1, 'nǐ hǎo')]);
		const c = new ReadingsController(segment);
		const smart = display({ readings: 'smart', smartThreshold: 80 });
		await c.run({ key: 'a', lang: 'zh', runs: [runs[0]], start: 0, display: smart, index: new Map([[1, 50]]) });
		expect(c.pieces.get(0)?.[0].concealed).toBe(false);
		c.update(smart, new Map([[1, 90]]));
		expect(c.pieces.get(0)?.[0].concealed).toBe(true);
		c.update({ ...smart, smartThreshold: 95 }, new Map([[1, 90]]));
		expect(c.pieces.get(0)?.[0].concealed).toBe(false);
		expect(segment).toHaveBeenCalledTimes(1);
	});

	it('a new key starts clean and a cached chapter needs no request', async () => {
		const segment = vi.fn(async () => [zhMatch(0, 2, 1, 'nǐ hǎo')]);
		const c = new ReadingsController(segment);
		const d = display({ readings: 'always' });
		await c.run({ key: 'a', lang: 'zh', runs: [runs[0]], start: 0, display: d, index: new Map() });
		await c.run({ key: 'b', lang: 'zh', runs: [runs[0]], start: 0, display: d, index: new Map() });
		expect(segment).toHaveBeenCalledTimes(2);
		await c.run({ key: 'a', lang: 'zh', runs: [runs[0]], start: 0, display: d, index: new Map() });
		expect(segment).toHaveBeenCalledTimes(2);
		expect(c.pieces.get(0)).toBeDefined();
	});

	it('counts failed requests and leaves paragraphs plain', async () => {
		const c = new ReadingsController(async () => {
			throw new Error('x');
		});
		await c.run({ key: 'a', lang: 'zh', runs, start: 0, display: display({ readings: 'always' }), index: new Map() });
		expect(c.failed).toBe(1);
		expect(c.pieces.size).toBe(0);
	});

	it('stop aborts and clears', async () => {
		const c = new ReadingsController(async () => [zhMatch(0, 2, 1, 'x')]);
		await c.run({ key: 'a', lang: 'zh', runs, start: 0, display: display({ readings: 'always' }), index: new Map() });
		c.stop();
		expect(c.pieces.size).toBe(0);
	});
});
