import { describe, expect, it } from 'vitest';

import { hasStrokeData, strokeIndexCount } from './strokeIndex';

describe('hasStrokeData', () => {
	it('knows glyphs with stroke data', () => {
		expect(hasStrokeData('日')).toBe(true);
		expect(hasStrokeData('好')).toBe(true);
	});

	it('knows glyphs without it (shinjitai the Chinese data lacks)', () => {
		for (const ch of ['気', '毎', '読', '歩', '駅']) expect(hasStrokeData(ch)).toBe(false);
	});

	it('is false for empty input and non-Han glyphs', () => {
		expect(hasStrokeData('')).toBe(false);
		expect(hasStrokeData('a')).toBe(false);
	});

	it('matches hanzi-writer-data exactly (regenerate with node scripts/prepare-stroke-index.mjs)', () => {
		const files = Object.keys(import.meta.glob('/node_modules/hanzi-writer-data/*.json'));
		const chars = files
			.map((path) => path.slice(path.lastIndexOf('/') + 1, -'.json'.length))
			.filter((name) => name !== 'package')
			.map((name) => [...name][0]);
		for (const ch of chars) expect(hasStrokeData(ch), ch).toBe(true);
		expect(chars.filter((ch) => !hasStrokeData(ch))).toEqual([]);
		expect(strokeIndexCount()).toBe(new Set(chars).size);
	});
});
