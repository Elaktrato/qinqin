// docs/contracts/tones/pairs.json (#180): the tone-pair drill's item keys, which word practises which pair, how a
// typed answer reads, and a pair's accuracy.
import { describe, expect, it } from 'vitest';
import fixture from '../../../../../docs/contracts/tones/pairs.json';
import { validItemKey } from '$lib/studycore/drills';
import {
	ACCURACY_WINDOW,
	STRONG_FROM,
	TONE_PAIRS,
	WEAK_BELOW,
	pairAccuracy,
	pairKeyOf,
	pairTones,
	parseTypedTones
} from './tonePairs';

describe('tones/pairs fixture', () => {
	it('is the rule this module implements', () => {
		expect(fixture.rule).toBe('tones/pairs');
		expect([...TONE_PAIRS]).toEqual(fixture.pairs);
		expect(ACCURACY_WINDOW).toBe(fixture.accuracy.window);
		expect(WEAK_BELOW).toBe(fixture.accuracy.weakBelow);
		expect(STRONG_FROM).toBe(fixture.accuracy.strongFrom);
	});

	it('names 20 drill items, each its two tones', () => {
		expect(TONE_PAIRS).toHaveLength(20);
		for (const key of TONE_PAIRS) {
			expect(validItemKey(key)).toBe(true);
			expect(pairTones(key)?.join('-')).toBe(key);
		}
		expect(pairTones('5-1')).toBeNull();
		expect(pairTones('3-4-1')).toBeNull();
		expect(pairTones('sample-1')).toBeNull();
	});

	it.each(fixture.words)('word: $name', (c) => {
		const readings = c.readings.map((value) => ({ type: 'pinyin', value }));
		expect(pairKeyOf(c.written, readings)).toBe(c.expect);
	});

	it('reads a capitalised reading of a hand-written pack', () => {
		expect(pairKeyOf('中国', [{ type: 'pinyin', value: 'Zhōng guó' }])).toBe('1-2');
	});

	it('reads only pinyin readings', () => {
		expect(pairKeyOf('你好', [{ type: 'bopomofo', value: 'ㄋㄧˇ ㄏㄠˇ' }])).toBeNull();
		expect(pairKeyOf('你好', [{ type: 'bopomofo', value: 'ㄋㄧˇ ㄏㄠˇ' }, { type: 'pinyin', value: 'nǐ hǎo' }])).toBe('3-3');
	});

	it.each(fixture.typed)('typed: $name', (c) => {
		expect(parseTypedTones(c.text)).toEqual(c.expect);
	});

	it.each(fixture.accuracy.cases)('accuracy: $name', (c) => {
		expect(pairAccuracy(c.grades as (1 | 2 | 3 | 4)[])).toEqual(c.expect);
	});
});
