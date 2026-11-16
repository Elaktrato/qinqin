import { describe, expect, it, vi } from 'vitest';
import type { SegmentMatch } from '$lib/api/types';
import { DEFAULT_DISPLAY, type ReaderDisplay } from './displaySettings';
import { ReadingsController } from './readings.svelte';
import { EMPTY_KNOWN_INDEX, type KnownIndex } from '$lib/study/known';
import type { Run } from './paragraphText';

const zhMatch = (start: number, end: number, entry: number, value: string): SegmentMatch => ({
	surface: '你好', start, end, lemma: '你好', reason: '', entries: [{ id: entry, kind: 'word' }], reading: { type: 'pinyin', value }
});
const display = (over: Partial<ReaderDisplay>): ReaderDisplay => ({ ...DEFAULT_DISPLAY, ...over });
const scored = (entries: [number, number][]): KnownIndex => ({ scores: new Map(entries), carded: new Set(entries.map(([id]) => id)), marks: new Set() });
const runs: Run[][] = [[{ text: '你好' }], [{ text: '你好' }]];

describe('ReadingsController', () => {
	it('makes no request in never mode and keeps no pieces', async () => {
		const segment = vi.fn(async () => []);
		const c = new ReadingsController(segment);
		await c.run({ key: 'a', lang: 'zh', runs, start: 0, display: display({ readings: 'never' }), index: EMPTY_KNOWN_INDEX });
		expect(segment).not.toHaveBeenCalled();
		expect(c.pieces.size).toBe(0);
	});

	it('makes no request for other languages', async () => {
		const segment = vi.fn(async () => []);
		const c = new ReadingsController(segment);
		await c.run({ key: 'a', lang: 'en', runs, start: 0, display: display({ readings: 'always' }), index: EMPTY_KNOWN_INDEX });
		expect(segment).not.toHaveBeenCalled();
	});

	it('fills pieces per paragraph as chunks arrive', async () => {
		const segment = vi.fn(async () => [zhMatch(0, 2, 1, 'nǐ hǎo'), zhMatch(3, 5, 1, 'nǐ hǎo')]);
		const c = new ReadingsController(segment);
		await c.run({ key: 'a', lang: 'zh', runs, start: 0, display: display({ readings: 'always' }), index: EMPTY_KNOWN_INDEX });
		expect(c.pieces.get(0)).toEqual([{ start: 0, end: 2, rt: 'nǐ hǎo', concealed: false, source: 'dict' }]);
		expect(c.pieces.get(1)?.[0].rt).toBe('nǐ hǎo');
	});

	it('update re-applies the smart rule without a new request', async () => {
		const segment = vi.fn(async () => [zhMatch(0, 2, 1, 'nǐ hǎo')]);
		const c = new ReadingsController(segment);
		const smart = display({ readings: 'smart', smartThreshold: 80 });
		await c.run({ key: 'a', lang: 'zh', runs: [runs[0]], start: 0, display: smart, index: scored([[1, 50]]) });
		expect(c.pieces.get(0)?.[0].concealed).toBe(false);
		c.update(smart, scored([[1, 90]]));
		expect(c.pieces.get(0)?.[0].concealed).toBe(true);
		c.update({ ...smart, smartThreshold: 95 }, scored([[1, 90]]));
		expect(c.pieces.get(0)?.[0].concealed).toBe(false);
		expect(segment).toHaveBeenCalledTimes(1);
	});

	it('a new key starts clean and a cached chapter needs no request', async () => {
		const segment = vi.fn(async () => [zhMatch(0, 2, 1, 'nǐ hǎo')]);
		const c = new ReadingsController(segment);
		const d = display({ readings: 'always' });
		await c.run({ key: 'a', lang: 'zh', runs: [runs[0]], start: 0, display: d, index: EMPTY_KNOWN_INDEX });
		await c.run({ key: 'b', lang: 'zh', runs: [runs[0]], start: 0, display: d, index: EMPTY_KNOWN_INDEX });
		expect(segment).toHaveBeenCalledTimes(2);
		await c.run({ key: 'a', lang: 'zh', runs: [runs[0]], start: 0, display: d, index: EMPTY_KNOWN_INDEX });
		expect(segment).toHaveBeenCalledTimes(2);
		expect(c.pieces.get(0)).toBeDefined();
	});

	it('counts failed requests and leaves paragraphs plain', async () => {
		const c = new ReadingsController(async () => {
			throw new Error('x');
		});
		await c.run({ key: 'a', lang: 'zh', runs, start: 0, display: display({ readings: 'always' }), index: EMPTY_KNOWN_INDEX });
		expect(c.failed).toBe(1);
		expect(c.pieces.size).toBe(0);
	});

	it('stop aborts and clears', async () => {
		const c = new ReadingsController(async () => [zhMatch(0, 2, 1, 'x')]);
		await c.run({ key: 'a', lang: 'zh', runs, start: 0, display: display({ readings: 'always' }), index: EMPTY_KNOWN_INDEX });
		c.stop();
		expect(c.pieces.size).toBe(0);
	});
});

describe('ReadingsController as the one match source', () => {
	const both = { readings: true, words: true };
	const wordsOnly = { readings: false, words: true };
	it('readings never + words: requests made, only book pieces, words filled', async () => {
		const segment = vi.fn(async () => [zhMatch(0, 2, 1, 'nǐ hǎo')]);
		const c = new ReadingsController(segment);
		const d = display({ readings: 'never', highlightWords: true });
		const r: Run[][] = [[{ text: '你好' }], [{ text: '漢', ruby: 'かん' }]];
		await c.run({ key: 'a', lang: 'zh', runs: r, start: 0, display: d, index: EMPTY_KNOWN_INDEX, want: wordsOnly });
		expect(segment).toHaveBeenCalled();
		expect([...c.pieces.values()].flat().every((p) => p.source === 'book')).toBe(true);
		expect(c.words.get(0)).toEqual([{ start: 0, end: 2, state: 'new' }]);
		expect(c.matches.get(0)?.length).toBe(1);
	});

	it('neither wanted: no request', async () => {
		const segment = vi.fn(async () => []);
		const c = new ReadingsController(segment);
		await c.run({ key: 'a', lang: 'zh', runs, start: 0, display: display({}), index: EMPTY_KNOWN_INDEX, want: { readings: false, words: false } });
		expect(segment).not.toHaveBeenCalled();
	});

	it('switching readings on after words costs no request (same key)', async () => {
		const segment = vi.fn(async () => [zhMatch(0, 2, 1, 'nǐ hǎo')]);
		const c = new ReadingsController(segment);
		await c.run({ key: 'a', lang: 'zh', runs, start: 0, display: display({ highlightWords: true }), index: EMPTY_KNOWN_INDEX, want: wordsOnly });
		const n = segment.mock.calls.length;
		const on = display({ readings: 'always', highlightWords: true });
		await c.run({ key: 'a', lang: 'zh', runs, start: 0, display: on, index: EMPTY_KNOWN_INDEX, want: both });
		expect(segment).toHaveBeenCalledTimes(n);
		expect(c.pieces.get(0)?.[0].rt).toBe('nǐ hǎo');
	});

	it('update with a new index recomputes words without a request', async () => {
		const segment = vi.fn(async () => [zhMatch(0, 2, 1, 'nǐ hǎo')]);
		const c = new ReadingsController(segment);
		const d = display({ highlightWords: true });
		await c.run({ key: 'a', lang: 'zh', runs: [runs[0]], start: 0, display: d, index: EMPTY_KNOWN_INDEX, want: wordsOnly });
		expect(c.words.get(0)?.[0].state).toBe('new');
		c.update(d, scored([[1, 10]]), wordsOnly);
		expect(c.words.get(0)?.[0].state).toBe('learning');
		c.update(d, scored([[1, 90]]), wordsOnly);
		expect(c.words.get(0)).toEqual([]);
		expect(segment).toHaveBeenCalledTimes(1);
	});

	it('words stay empty while highlighting is off (the panel alone wants matches)', async () => {
		const c = new ReadingsController(async () => [zhMatch(0, 2, 1, 'x')]);
		await c.run({ key: 'a', lang: 'zh', runs, start: 0, display: display({}), index: EMPTY_KNOWN_INDEX, want: wordsOnly });
		expect(c.words.size).toBe(0);
		expect(c.matches.size).toBe(2);
	});

	it('progress counts paragraphs with text', async () => {
		const c = new ReadingsController(async () => [zhMatch(0, 2, 1, 'x')]);
		const r: Run[][] = [[{ text: '你好' }], [{ text: '' }], [{ text: '你好' }]];
		await c.run({ key: 'a', lang: 'zh', runs: r, start: 0, display: display({}), index: EMPTY_KNOWN_INDEX, want: wordsOnly });
		expect(c.progress).toEqual({ done: 2, total: 2 });
	});
});
