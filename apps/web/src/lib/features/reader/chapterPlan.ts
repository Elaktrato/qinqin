// What ChapterText renders for one paragraph: the runs cut by highlight
// edges and by the edges of generated readings, each cut piece with the
// reading it may carry. A reading is only drawn over a piece that is
// exactly its word: a highlight edge or a run boundary inside the word
// drops that word's reading (the text stays selectable and mapped).
import { groupSegsByRun, type RunPiece } from './highlightUi';
import { splitRunsByHighlights, type Highlight } from './highlights';
import type { Run } from './paragraphText';
import type { Piece } from './smartReadings';
import type { WordRange, WordState } from './wordRanges';

export interface PlanSeg extends RunPiece {
	/** A generated reading over exactly this piece. */
	rt?: string;
	/** The reading is known: drawn but not shown until revealed. */
	concealed?: boolean;
	/** The piece is part of a new or learning word (#68). */
	word?: WordState;
	/** The last piece of that word. */
	wordEnd?: boolean;
}

export interface PlanRun {
	run: number;
	/** The book's ruby, only when it is to be shown. */
	ruby?: string;
	bookConcealed?: boolean;
	segs: PlanSeg[];
}

const cpLength = (text: string) => Array.from(text).length;

export function planParagraph(
	runs: Run[],
	drawn: Highlight[],
	pieces: readonly Piece[],
	showBookRuby: boolean,
	words: readonly WordRange[] = []
): PlanRun[] {
	// A reading is drawn only over a word inside one run and clear of every
	// highlight; the others are dropped before cutting, so they never split
	// a highlight or a run.
	const bounds: number[] = [0];
	for (const run of runs) bounds.push(bounds[bounds.length - 1] + cpLength(run.text));
	const inOneRun = (p: Piece) => bounds.some((b, i) => i < runs.length && p.start >= b && p.end <= bounds[i + 1]);
	const clearOfHighlights = (p: { start: number; end: number }) => drawn.every((h) => h.end <= p.start || h.start >= p.end);
	const dict = pieces.filter(
		(p) => p.source === 'dict' && p.rt !== undefined && inOneRun(p) && clearOfHighlights(p)
	);
	// Word states are drawn only clear of every highlight (the highlight wins).
	const marked = words.filter(clearOfHighlights).sort((a, b) => a.start - b.start);
	const cuts = [...new Set([...dict, ...marked].flatMap((p) => [p.start, p.end]))].sort((a, b) => a - b);
	const shown = showBookRuby ? runs : runs.map((run) => ({ text: run.text }));
	const segs = splitRunsByHighlights(shown, drawn, cuts);

	const byRange = new Map(dict.map((p) => [`${p.start}:${p.end}`, p]));
	let pos = 0;
	let wi = 0; // the first word that may still hold a later piece (words are sorted, never overlap)
	const withRt: PlanSeg[] = segs.map((seg) => {
		const start = pos;
		pos += cpLength(seg.text);
		const piece = seg.highlight === null ? byRange.get(`${start}:${pos}`) : undefined;
		const out: PlanSeg = piece ? { ...seg, noteMark: false, rt: piece.rt, concealed: piece.concealed } : { ...seg, noteMark: false };
		if (marked.length > 0 && seg.highlight === null && pos > start) {
			while (wi < marked.length && marked[wi].end <= start) wi++;
			const w = marked[wi];
			if (w && w.start <= start && pos <= w.end) {
				out.word = w.state;
				if (w.end === pos) out.wordEnd = true;
			}
		}
		return out;
	});

	const groups = groupSegsByRun(withRt, runs.length) as PlanRun[];
	const bookAt = new Map(pieces.filter((p) => p.source === 'book').map((p) => [p.start, p]));
	let runStart = 0;
	runs.forEach((run, r) => {
		if (groups[r].ruby !== undefined) groups[r].bookConcealed = bookAt.get(runStart)?.concealed ?? false;
		runStart += cpLength(run.text);
	});
	return groups;
}
