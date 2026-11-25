import { describe, expect, it } from 'vitest';

import {
	cardStarterReviews,
	stageNote,
	readStarterSettings,
	starterForcedHints,
	starterFront,
	starterPatch,
	starterProfile,
	usuallyKanaOf
} from './starter';
import type { ReviewEvent } from './types';

function review(cardId: string, grade: number, ts: string): ReviewEvent {
	return { id: `${cardId}-${ts}`, workspaceId: 1, device: 'd', ts, type: 'review', payload: { cardId, mode: 'vocab', grade: grade as 1 } };
}

describe('cardStarterReviews', () => {
	it('keeps only the card own reviews, as {at, grade}', () => {
		const events = [review('a', 3, '2026-03-01T09:00:00Z'), review('b', 1, '2026-03-01T09:00:00Z'), review('a', 2, '2026-03-02T09:00:00Z')];
		expect(cardStarterReviews('a', events)).toEqual([
			{ at: '2026-03-01T09:00:00Z', grade: 3 },
			{ at: '2026-03-02T09:00:00Z', grade: 2 }
		]);
	});
});

describe('starterProfile', () => {
	it('knows the two languages with stages', () => {
		expect(starterProfile('ja')).toBe('ja');
		expect(starterProfile('zh')).toBe('zh');
		expect(starterProfile('zh-hant')).toBe('zh');
		expect(starterProfile('es')).toBeNull();
	});
});

describe('usuallyKanaOf', () => {
	it('reads the uk tag of the first sense', () => {
		expect(usuallyKanaOf({ senseGroups: [{ tags: ['uk'] }, { tags: [] }] })).toBe(true);
		expect(usuallyKanaOf({ senseGroups: [{ tags: [] }, { tags: ['uk'] }] })).toBe(false);
		expect(usuallyKanaOf({})).toBe(false);
	});
});

describe('starter settings', () => {
	it('defaults to off, base set only', () => {
		expect(readStarterSettings(undefined)).toEqual({ enabled: false, scope: 'base' });
		expect(readStarterSettings({ starter: 'yes' })).toEqual({ enabled: false, scope: 'base' });
	});
	it('reads valid members and ignores the rest', () => {
		expect(readStarterSettings({ starter: { enabled: true, scope: 'all' } })).toEqual({ enabled: true, scope: 'all' });
		expect(readStarterSettings({ starter: { enabled: 'x', scope: 'everything' } })).toEqual({ enabled: false, scope: 'base' });
	});
	it('patches one member', () => {
		expect(starterPatch({ enabled: true })).toEqual({ starter: { enabled: true } });
		expect(starterPatch({ scope: 'all' })).toEqual({ starter: { scope: 'all' } });
	});
});

describe('starterForcedHints', () => {
	it('is the stage row forced member', () => {
		expect(starterForcedHints('ja', 4, { usuallyKana: false })).toEqual({ picture: 'hint', reading: 'never' });
		expect(starterForcedHints('ja', 6, { usuallyKana: false })).toEqual({});
	});
});

describe('starterFront', () => {
	const entry = {
		language: 'ja',
		written: '林檎',
		readings: [
			{ type: 'kana', value: 'りんご' },
			{ type: 'romaji', value: 'ringo' }
		]
	};
	it('stage 1 shows the romaji only', () => {
		expect(starterFront('ja', 1, { usuallyKana: false }, entry)).toEqual({ main: 'ringo', mainLang: 'ja-Latn', annotation: null, annotationLang: null, placement: null });
	});
	it('stage 2 shows kana with romaji', () => {
		expect(starterFront('ja', 2, { usuallyKana: false }, entry)).toMatchObject({ main: 'りんご', annotation: 'ringo' });
	});
	it('stage 5 shows the word with kana above', () => {
		expect(starterFront('ja', 5, { usuallyKana: false }, entry)).toMatchObject({ main: '林檎', annotation: 'りんご', placement: 'above' });
	});
	it('stage 2 puts the romaji below the kana', () => {
		expect(starterFront('ja', 2, { usuallyKana: false }, entry)).toMatchObject({ placement: 'below' });
	});
	it('drops an annotation equal to the main text (a loanword at stage 5)', () => {
		const coffee = { language: 'ja', written: 'コーヒー', readings: [{ type: 'kana', value: 'コーヒー' }] };
		expect(starterFront('ja', 5, { usuallyKana: false }, coffee)).toMatchObject({ main: 'コーヒー', annotation: null, placement: null });
	});
	it('a usually-kana word at its normal card shows its kana', () => {
		expect(starterFront('ja', 4, { usuallyKana: true }, entry)).toMatchObject({ main: 'りんご', annotation: null });
	});
	it('a loanword keeps its katakana', () => {
		const coffee = { language: 'ja', written: 'コーヒー', readings: [{ type: 'kana', value: 'コーヒー' }, { type: 'romaji', value: 'kōhī' }] };
		expect(starterFront('ja', 3, { usuallyKana: false }, coffee)).toMatchObject({ main: 'コーヒー' });
	});
	it('the normal card has no front of its own', () => {
		expect(starterFront('ja', 6, { usuallyKana: false }, entry)).toBeNull();
	});
	it('a word without a needed reading falls back to the written form', () => {
		const bare = { language: 'ja', written: '林檎', readings: [] };
		expect(starterFront('ja', 1, { usuallyKana: false }, bare)).toMatchObject({ main: '林檎' });
	});
	it('Chinese stage 1 shows pinyin, stage 2 hanzi with pinyin', () => {
		const zh = { language: 'zh', written: '苹果', readings: [{ type: 'pinyin', value: 'píngguǒ' }] };
		expect(starterFront('zh', 1, { usuallyKana: false }, zh)).toMatchObject({ main: 'píngguǒ', mainLang: 'zh-Latn-pinyin' });
		expect(starterFront('zh', 2, { usuallyKana: false }, zh)).toMatchObject({ main: '苹果', annotation: 'píngguǒ', annotationLang: 'zh-Latn-pinyin' });
	});
});

describe('stageNote', () => {
	const plain = { usuallyKana: false };
	it('names what a Japanese stage adds', () => {
		expect([1, 2, 3, 4, 5, 6].map((s) => stageNote('ja', s, plain))).toEqual([null, 'kana', 'noRomaji', 'pictureHint', 'kanji', 'normal']);
	});
	it('says katakana for a loanword', () => {
		expect(stageNote('ja', 2, plain, { katakana: true })).toBe('katakana');
	});
	it('names what a Chinese stage adds', () => {
		expect([1, 2, 3, 4, 5].map((s) => stageNote('zh', s, plain))).toEqual([null, 'hanzi', 'pictureHint', 'noPinyin', 'normal']);
	});
	it('a usually-kana word reaches its normal card at stage 4', () => {
		expect(stageNote('ja', 4, { usuallyKana: true })).toBe('normal');
	});
});
