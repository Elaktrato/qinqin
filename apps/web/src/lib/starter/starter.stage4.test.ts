import { describe, expect, it } from 'vitest';
import { readHintSettings, resolveHints } from '$lib/features/flashcards/face/hints';
import { stageNote, starterForcedHints } from './starter';

describe('a stage that announces "no pinyin" shows none, whatever the reading setting says', () => {
	it('Chinese stage 4: a reading setting of always still leaves the reading behind the Hint control', () => {
		const word = { usuallyKana: false };
		expect(stageNote('zh', 4, word)).toBe('noPinyin');
		const settings = readHintSettings({ hints: { reading: { vocab: 'always' } } });
		const plan = resolveHints({ cardKind: 'vocab', settings, entry: { hasReading: true, hasPicture: true }, forced: starterForcedHints('zh', 4, word) });
		expect(plan.always).toEqual([]);
		expect(plan.onRequest).toEqual(['reading', 'picture']);
	});
});
