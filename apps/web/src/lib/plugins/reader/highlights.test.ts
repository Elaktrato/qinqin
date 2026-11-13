import { describe, expect, it } from 'vitest';
import {
	HIGHLIGHT_COLORS,
	buildHighlightBody,
	clampToParagraph,
	isHighlightColor,
	nextColor,
	overlaps,
	splitRunsByHighlights,
	visibleHighlights,
	type Highlight,
	type Seg
} from './highlights';
import { offsetFromRun, paragraphString, type Run } from './paragraphText';

function hl(id: number, paragraph: number, start: number, end: number, text = '', over: Partial<Highlight> = {}): Highlight {
	return {
		id,
		bookId: 1,
		chapter: 0,
		paragraph,
		start,
		end,
		text,
		color: 'yellow',
		note: '',
		createdAt: '2026-11-13T10:00:00Z',
		updatedAt: '2026-11-13T10:00:00Z',
		...over
	};
}

const lengths = (...ls: number[]) => (p: number) => ls[p] ?? 0;

describe('clampToParagraph', () => {
	it('keeps a selection inside one paragraph', () => {
		expect(
			clampToParagraph({ startParagraph: 2, startOffset: 3, endParagraph: 2, endOffset: 7 }, lengths(0, 0, 10))
		).toEqual({ paragraph: 2, start: 3, end: 7, clamped: false });
	});

	it('clamps a selection spanning paragraphs to the end of the first', () => {
		expect(
			clampToParagraph({ startParagraph: 0, startOffset: 4, endParagraph: 2, endOffset: 1 }, lengths(9, 5, 5))
		).toEqual({ paragraph: 0, start: 4, end: 9, clamped: true });
	});

	it('normalises a backward selection', () => {
		expect(
			clampToParagraph({ startParagraph: 1, startOffset: 2, endParagraph: 0, endOffset: 3 }, lengths(9, 5))
		).toEqual({ paragraph: 0, start: 3, end: 9, clamped: true });
		expect(
			clampToParagraph({ startParagraph: 0, startOffset: 6, endParagraph: 0, endOffset: 2 }, lengths(9))
		).toEqual({ paragraph: 0, start: 2, end: 6, clamped: false });
	});

	it('is null for an empty selection', () => {
		expect(clampToParagraph({ startParagraph: 0, startOffset: 3, endParagraph: 0, endOffset: 3 }, lengths(9))).toBeNull();
		expect(clampToParagraph({ startParagraph: 0, startOffset: 0, endParagraph: 0, endOffset: 0 }, lengths(0))).toBeNull();
	});

	it('clips offsets to the paragraph', () => {
		expect(
			clampToParagraph({ startParagraph: 0, startOffset: -2, endParagraph: 0, endOffset: 40 }, lengths(9))
		).toEqual({ paragraph: 0, start: 0, end: 9, clamped: false });
	});

	it('skips an empty start at a paragraph end, like the lookup selection does', () => {
		// The drag began after the last character of paragraph 0.
		expect(
			clampToParagraph({ startParagraph: 0, startOffset: 9, endParagraph: 1, endOffset: 3 }, lengths(9, 5))
		).toEqual({ paragraph: 1, start: 0, end: 3, clamped: false });
		expect(
			clampToParagraph({ startParagraph: 0, startOffset: 9, endParagraph: 2, endOffset: 3 }, lengths(9, 5, 5))
		).toEqual({ paragraph: 1, start: 0, end: 5, clamped: true });
		// Nothing selectable at all.
		expect(
			clampToParagraph({ startParagraph: 0, startOffset: 9, endParagraph: 1, endOffset: 0 }, lengths(9, 5))
		).toBeNull();
	});
});

describe('visibleHighlights', () => {
	const texts = ['猫が好き', '𠮷野家で食べた', 'abc def'];
	const textOf = (p: number) => texts[p] ?? null;

	it('draws highlights whose snapshot matches, sorted by start per paragraph', () => {
		const a = hl(1, 1, 3, 5, 'で食');
		const b = hl(2, 1, 0, 1, '𠮷');
		const c = hl(3, 0, 0, 1, '猫');
		const other = hl(4, 0, 0, 1, '猫', { chapter: 1 });
		const { drawn, changed } = visibleHighlights([a, b, c, other], 0, textOf);
		expect(changed).toEqual([]);
		expect(drawn.get(1)?.map((h) => h.id)).toEqual([2, 1]);
		expect(drawn.get(0)?.map((h) => h.id)).toEqual([3]);
		expect([...drawn.keys()].sort()).toEqual([0, 1]);
	});

	it('counts astral characters as one code point', () => {
		const { drawn } = visibleHighlights([hl(1, 1, 1, 3, '野家')], 0, textOf);
		expect(drawn.get(1)?.map((h) => h.id)).toEqual([1]);
	});

	it('lists a snapshot mismatch as changed and does not draw it', () => {
		const moved = hl(1, 0, 0, 2, '犬が');
		const gone = hl(2, 9, 0, 1, '猫');
		const past = hl(3, 0, 2, 9, 'が好き');
		const { drawn, changed } = visibleHighlights([moved, gone, past], 0, textOf);
		expect(drawn.size).toBe(0);
		// In reading order: paragraph 0 before the missing paragraph 9.
		expect(changed.map((h) => h.id)).toEqual([1, 3, 2]);
	});

	it('compares the snapshot exactly: edge whitespace, case or a longer slice is a change', () => {
		const { drawn, changed } = visibleHighlights(
			[hl(1, 2, 3, 7, 'def'), hl(2, 2, 0, 3, 'ABC'), hl(3, 0, 0, 2, '猫')],
			0,
			textOf
		);
		expect(drawn.size).toBe(0);
		// Reading order: paragraph 0, then paragraph 2 by start.
		expect(changed.map((h) => h.id)).toEqual([3, 2, 1]);
	});

	it('reports code-point offsets stored as UTF-16 offsets as changed', () => {
		// 𠮷野 is [0,2) in code points but [0,3) in UTF-16 units.
		const { drawn, changed } = visibleHighlights([hl(1, 1, 0, 3, '𠮷野')], 0, textOf);
		expect(drawn.size).toBe(0);
		expect(changed.map((h) => h.id)).toEqual([1]);
	});

	it('does not draw overlapping highlights twice: the later one is listed as changed', () => {
		const { drawn, changed } = visibleHighlights([hl(1, 2, 0, 3, 'abc'), hl(2, 2, 2, 5, 'c d')], 0, textOf);
		expect(drawn.get(2)?.map((h) => h.id)).toEqual([1]);
		expect(changed.map((h) => h.id)).toEqual([2]);
	});
});

// The concatenated segment texts of one run are its text; the segments in
// order rebuild the paragraph.
function joined(segs: Seg[]): string {
	return segs.map((s) => s.text).join('');
}

function view(segs: Seg[]) {
	return segs.map((s) => [s.run, s.text, s.startInRun, s.ruby ?? null, s.highlight?.id ?? null]);
}

describe('splitRunsByHighlights', () => {
	it('returns one segment per run without highlights', () => {
		const runs: Run[] = [{ text: '猫' }, { text: '漢字', ruby: 'かんじ' }];
		expect(view(splitRunsByHighlights(runs, []))).toEqual([
			[0, '猫', 0, null, null],
			[1, '漢字', 0, 'かんじ', null]
		]);
	});

	it('splits a run where a highlight starts and ends mid-run', () => {
		const runs: Run[] = [{ text: 'abcdef' }];
		const h = hl(1, 0, 2, 4);
		expect(view(splitRunsByHighlights(runs, [h]))).toEqual([
			[0, 'ab', 0, null, null],
			[0, 'cd', 2, null, 1],
			[0, 'ef', 4, null, null]
		]);
	});

	it('covers a highlight spanning several runs, ruby on the first segment of its run only', () => {
		const runs: Run[] = [{ text: '今日' , ruby: 'きょう' }, { text: 'は' }, { text: '漢字', ruby: 'かんじ' }, { text: 'です' }];
		// Plain text 今日は漢字です: highlight 日は漢 = [1, 4).
		const h = hl(7, 0, 1, 4);
		const segs = splitRunsByHighlights(runs, [h]);
		expect(view(segs)).toEqual([
			[0, '今', 0, 'きょう', null],
			[0, '日', 1, null, 7],
			[1, 'は', 0, null, 7],
			[2, '漢', 0, 'かんじ', 7],
			[2, '字', 1, null, null],
			[3, 'です', 0, null, null]
		]);
		expect(joined(segs)).toBe(paragraphString(runs));
		// Ruby is never part of the text.
		expect(joined(segs.filter((s) => s.highlight))).toBe('日は漢');
	});

	it('keeps adjacent highlights apart', () => {
		const runs: Run[] = [{ text: 'abcdef' }];
		const a = hl(1, 0, 0, 2);
		const b = hl(2, 0, 2, 5);
		expect(view(splitRunsByHighlights(runs, [b, a]))).toEqual([
			[0, 'ab', 0, null, 1],
			[0, 'cde', 2, null, 2],
			[0, 'f', 5, null, null]
		]);
	});

	it('cuts on code points and reports startInRun in UTF-16 units (astral characters)', () => {
		const runs: Run[] = [{ text: 'a𠮷b' }, { text: '😀c' }];
		// Plain text a𠮷b😀c: highlight 𠮷b😀 = [1, 4).
		const segs = splitRunsByHighlights(runs, [hl(1, 0, 1, 4)]);
		expect(view(segs)).toEqual([
			[0, 'a', 0, null, null],
			[0, '𠮷b', 1, null, 1],
			[1, '😀', 0, null, 1],
			[1, 'c', 2, null, null]
		]);
		// DOM offset inside a segment + startInRun is the run's UTF-16 offset.
		const c = segs[3];
		expect(offsetFromRun(runs, c.run, c.startInRun)).toBe(4);
	});

	it('ignores empty, out-of-range and overlapping highlights and clips past the end', () => {
		const runs: Run[] = [{ text: 'abc' }];
		const segs = splitRunsByHighlights(runs, [
			hl(1, 0, 1, 1),
			hl(2, 0, 5, 9),
			hl(3, 0, 1, 9),
			hl(4, 0, 2, 3)
		]);
		expect(view(segs)).toEqual([
			[0, 'a', 0, null, null],
			[0, 'bc', 1, null, 3]
		]);
	});

	it('keeps empty runs (with their ruby) as one segment', () => {
		const runs: Run[] = [{ text: '' , ruby: 'x' }, { text: 'ab' }];
		expect(view(splitRunsByHighlights(runs, [hl(1, 0, 0, 2)]))).toEqual([
			[0, '', 0, 'x', null],
			[1, 'ab', 0, null, 1]
		]);
	});
});

describe('overlaps', () => {
	const list = [hl(1, 0, 2, 5), hl(2, 1, 0, 3), hl(3, 0, 8, 9, '', { chapter: 1 })];

	it('finds a highlight sharing a code point in the same paragraph', () => {
		expect(overlaps(list, 0, 4, 6)?.id).toBe(1);
		expect(overlaps(list, 0, 0, 3)?.id).toBe(1);
		expect(overlaps(list, 0, 3, 4)?.id).toBe(1);
		expect(overlaps(list, 0, 0, 9)?.id).toBe(1);
	});

	it('allows adjacent ranges and other paragraphs', () => {
		expect(overlaps(list, 0, 0, 2)).toBeNull();
		expect(overlaps(list, 0, 5, 7)).toBeNull();
		expect(overlaps(list, 2, 2, 5)).toBeNull();
	});

	it('limits to a chapter when one is given', () => {
		expect(overlaps(list, 0, 8, 9)?.id).toBe(3);
		expect(overlaps(list, 0, 8, 9, 0)).toBeNull();
		expect(overlaps(list, 0, 8, 9, 1)?.id).toBe(3);
	});
});

describe('buildHighlightBody', () => {
	it('returns the exact slice and its code-point span', () => {
		expect(buildHighlightBody('猫が好き', 1, 3, 'green')).toEqual({
			tooLong: false,
			body: { start: 1, end: 3, text: 'が好', color: 'green' }
		});
	});

	it('trims edge whitespace by moving start and end, never the text alone', () => {
		const para = ' 　漢字 です  。';
		// [0, 8) is " 　漢字 です " → 漢字 です at [2, 7).
		const built = buildHighlightBody(para, 0, 8, 'yellow');
		expect(built).toEqual({ tooLong: false, body: { start: 2, end: 7, text: '漢字 です', color: 'yellow' } });
		// U+2008 PUNCTUATION SPACE is space too; the 。 stays.
		expect(buildHighlightBody(para, 6, 9, 'pink')).toEqual({
			tooLong: false,
			body: { start: 6, end: 7, text: 'す', color: 'pink' }
		});
		expect(buildHighlightBody(para, 7, 10, 'pink')).toEqual({
			tooLong: false,
			body: { start: 9, end: 10, text: '。', color: 'pink' }
		});
	});

	it('trims exactly what Go strings.TrimSpace trims (U+0085 yes, U+FEFF no)', () => {
		expect(buildHighlightBody('\u0085猫\n', 0, 3, 'blue')).toEqual({
			tooLong: false,
			body: { start: 1, end: 2, text: '猫', color: 'blue' }
		});
		expect(buildHighlightBody('﻿猫', 0, 2, 'blue')).toEqual({
			tooLong: false,
			body: { start: 0, end: 2, text: '﻿猫', color: 'blue' }
		});
	});

	it('counts astral characters as one code point', () => {
		const para = 'a 𠮷野😀 b';
		// Code points: a,space,𠮷,野,😀,space,b.
		expect(buildHighlightBody(para, 1, 6, 'yellow')).toEqual({
			tooLong: false,
			body: { start: 2, end: 5, text: '𠮷野😀', color: 'yellow' }
		});
	});

	it('normalises a reversed span and clips it to the paragraph', () => {
		expect(buildHighlightBody('abc', 9, -1, 'yellow')).toEqual({
			tooLong: false,
			body: { start: 0, end: 3, text: 'abc', color: 'yellow' }
		});
	});

	it('is null when nothing but whitespace is selected', () => {
		expect(buildHighlightBody('a   b', 1, 4, 'yellow')).toBeNull();
		expect(buildHighlightBody('abc', 2, 2, 'yellow')).toBeNull();
		expect(buildHighlightBody('', 0, 3, 'yellow')).toBeNull();
	});

	it('flags spans over 500 code points after trimming', () => {
		const exact = '𠮷'.repeat(500);
		expect(buildHighlightBody(` ${exact} `, 0, 502, 'yellow')).toEqual({
			tooLong: false,
			body: { start: 1, end: 501, text: exact, color: 'yellow' }
		});
		expect(buildHighlightBody('字'.repeat(501), 0, 501, 'yellow')).toEqual({ tooLong: true });
	});
});

describe('nextColor', () => {
	it('defaults to yellow and keeps the last used colour', () => {
		expect(nextColor(null)).toBe('yellow');
		for (const c of HIGHLIGHT_COLORS) expect(nextColor(c)).toBe(c);
	});

	it('falls back to yellow for an unknown stored value', () => {
		expect(nextColor('purple' as never)).toBe('yellow');
		expect(isHighlightColor('pink')).toBe(true);
		expect(isHighlightColor('Pink')).toBe(false);
		expect(isHighlightColor(3)).toBe(false);
		expect(HIGHLIGHT_COLORS).toEqual(['yellow', 'green', 'blue', 'pink']);
	});
});
