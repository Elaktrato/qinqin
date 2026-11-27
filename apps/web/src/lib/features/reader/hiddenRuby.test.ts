import { describe, expect, it } from 'vitest';
import { isReadingTextShown, readRomanisation } from '$lib/languages/romanisation';
import { shownPieces, shownRuns } from './smartReadings';

// Hidden romanisation in the reader text (#284): generated readings and a book's own ruby of a hidden type are
// not drawn; furigana (kana) and the other type stay.
const keep = (settings: Record<string, unknown>, lang: string) => (rt: string) =>
	isReadingTextShown(rt, lang, readRomanisation(settings));

describe('shownPieces', () => {
	const pieces = [
		{ start: 0, end: 2, rt: 'xuéxí', concealed: false, source: 'dict' as const },
		{ start: 2, end: 3, rt: 'ㄏㄠˇ', concealed: false, source: 'book' as const },
		{ start: 3, end: 4, concealed: false, source: 'book' as const }
	];

	it('drops pinyin and keeps bopomofo and pieces without ruby text', () => {
		expect(shownPieces(pieces, keep({ romanisation: { pinyin: 'never' } }, 'zh-Hans')).map((p) => p.start)).toEqual([2, 3]);
	});

	it('is the same list when nothing is hidden', () => {
		expect(shownPieces(pieces, keep({}, 'zh'))).toBe(pieces);
	});

	it('keeps furigana with romaji hidden', () => {
		const ja = [{ start: 0, end: 1, rt: 'た', concealed: false, source: 'dict' as const }];
		expect(shownPieces(ja, keep({ romanisation: { romaji: 'never' } }, 'ja'))).toEqual(ja);
	});
});

describe('shownRuns', () => {
	it("drops a book run's hidden ruby but keeps its text", () => {
		const runs = [{ text: '学习', ruby: 'xuéxí' }, { text: '了' }];
		expect(shownRuns(runs, keep({ romanisation: { pinyin: 'never' } }, 'zh'))).toEqual([{ text: '学习' }, { text: '了' }]);
		expect(shownRuns(runs, keep({}, 'zh'))).toBe(runs);
	});
});
