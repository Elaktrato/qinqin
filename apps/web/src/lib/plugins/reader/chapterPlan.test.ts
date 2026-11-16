import { describe, expect, it } from 'vitest';
import type { Highlight } from './highlights';
import { splitRunsByHighlights } from './highlights';
import { planParagraph } from './chapterPlan';
import type { Piece } from './smartReadings';
import type { Run } from './paragraphText';

function hl(id: number, start: number, end: number): Highlight {
	return { id, start, end, note: '', color: 'yellow', text: '' } as unknown as Highlight;
}
const dict = (start: number, end: number, rt: string, concealed = false): Piece => ({ start, end, rt, concealed, source: 'dict' });

const flat = (plan: ReturnType<typeof planParagraph>) =>
	plan.map((g) => g.segs.map((s) => [s.text, s.startInRun, s.rt ?? null, s.concealed ?? null]));

describe('splitRunsByHighlights cuts', () => {
	it('also cuts at extra positions', () => {
		const segs = splitRunsByHighlights([{ text: '你好世界' }], [], [2]);
		expect(segs.map((s) => [s.text, s.startInRun])).toEqual([['你好', 0], ['世界', 2]]);
	});
	it('keeps the highlight across a cut', () => {
		const segs = splitRunsByHighlights([{ text: '你好世界' }], [hl(1, 0, 4)], [2]);
		expect(segs.map((s) => [s.text, s.highlight?.id])).toEqual([['你好', 1], ['世界', 1]]);
	});
});

describe('planParagraph', () => {
	it('attaches a generated reading to its exact piece', () => {
		const plan = planParagraph([{ text: '你好世界' }], [], [dict(0, 2, 'nǐ hǎo'), dict(2, 4, 'shì jiè', true)], true);
		expect(flat(plan)).toEqual([[['你好', 0, 'nǐ hǎo', false], ['世界', 2, 'shì jiè', true]]]);
	});

	it('a highlight edge inside a word drops that word reading only', () => {
		const plan = planParagraph([{ text: '你好世界' }], [hl(1, 1, 3)], [dict(0, 2, 'nǐ hǎo'), dict(2, 4, 'shì jiè')], true);
		expect(flat(plan)[0].map((s) => s[2])).toEqual([null, null, null]);
	});

	it('a highlight that does not touch the word keeps its reading', () => {
		const plan = planParagraph([{ text: '你好世界' }], [hl(1, 2, 3)], [dict(0, 2, 'nǐ hǎo')], true);
		expect(flat(plan)[0][0]).toEqual(['你好', 0, 'nǐ hǎo', false]);
	});

	it('a word crossing a run boundary renders without a reading', () => {
		const plan = planParagraph([{ text: '你' }, { text: '好' }], [], [dict(0, 2, 'nǐ hǎo')], true);
		expect(plan.map((g) => g.segs.map((s) => s.rt ?? null))).toEqual([[null], [null]]);
	});

	it('uses code points: an astral character before the word', () => {
		const plan = planParagraph([{ text: '𠮷你好' }], [], [dict(1, 3, 'nǐ hǎo')], true);
		expect(flat(plan)).toEqual([[['𠮷', 0, null, null], ['你好', 2, 'nǐ hǎo', false]]]);
	});

	it('book ruby follows the display flag and the book piece', () => {
		const runs: Run[] = [{ text: '漢字', ruby: 'かんじ' }, { text: 'を' }];
		const book: Piece = { start: 0, end: 2, rt: 'かんじ', concealed: true, source: 'book' };
		const shown = planParagraph(runs, [], [book], true);
		expect(shown[0].ruby).toBe('かんじ');
		expect(shown[0].bookConcealed).toBe(true);
		const hidden = planParagraph(runs, [], [], false);
		expect(hidden[0].ruby).toBeUndefined();
	});
});

describe('planParagraph with word states', () => {
	const words = (plan: ReturnType<typeof planParagraph>) =>
		plan.map((g) => g.segs.map((s) => [s.text, s.word ?? null, s.wordEnd ?? false]));

	it('without words the plan is unchanged', () => {
		const runs: Run[] = [{ text: '漢字', ruby: 'かんじ' }, { text: 'を読む' }];
		const pieces = [dict(3, 4, 'よ')];
		for (const hls of [[], [hl(1, 1, 3)]]) {
			expect(planParagraph(runs, hls, pieces, true, [])).toEqual(planParagraph(runs, hls, pieces, true));
			expect(planParagraph(runs, hls, pieces, true, undefined)).toEqual(planParagraph(runs, hls, pieces, true));
		}
	});

	it('cuts at word edges and marks the last piece of each word', () => {
		const plan = planParagraph([{ text: '你好世界' }], [], [], true, [
			{ start: 0, end: 2, state: 'new' },
			{ start: 2, end: 4, state: 'learning' }
		]);
		expect(words(plan)).toEqual([[['你好', 'new', true], ['世界', 'learning', true]]]);
	});

	it('a ja reading piece inside a new word: both pieces new, only the last ends the word', () => {
		const plan = planParagraph([{ text: '食べました' }], [], [dict(0, 1, 'た')], true, [{ start: 0, end: 5, state: 'new' }]);
		expect(words(plan)).toEqual([[['食', 'new', false], ['べました', 'new', true]]]);
		expect(plan[0].segs[0].rt).toBe('た');
	});

	it('a word across two runs keeps its state on both', () => {
		const plan = planParagraph([{ text: '你' }, { text: '好世' }], [], [], true, [{ start: 0, end: 2, state: 'new' }]);
		expect(words(plan)).toEqual([[['你', 'new', false]], [['好', 'new', true], ['世', null, false]]]);
	});

	it('a highlight over half a word drops that word, not its neighbour', () => {
		const plan = planParagraph([{ text: '你好世界' }], [hl(1, 1, 2)], [], true, [
			{ start: 0, end: 2, state: 'new' },
			{ start: 2, end: 4, state: 'new' }
		]);
		expect(words(plan)).toEqual([[['你', null, false], ['好', null, false], ['世界', 'new', true]]]);
	});

	it('plain text between words gets no state', () => {
		const plan = planParagraph([{ text: '你，好' }], [], [], true, [{ start: 2, end: 3, state: 'learning' }]);
		expect(words(plan)).toEqual([[['你，', null, false], ['好', 'learning', true]]]);
	});
});
