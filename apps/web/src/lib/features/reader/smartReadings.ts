// Which readings the reader shows, and which of them it conceals because
// the learner already knows the word (docs/contracts/reader/). "Known" is
// the shared predicate of study/known.ts: the learner's manual mark, or the
// best vocab card of an entry has a memory score (cardScore) at or above
// the reader's threshold.
import type { SegmentMatch } from '$lib/api/types';
import { isKnownEntry, type KnownIndex } from '$lib/study/known';
import type { ReaderDisplay } from './displaySettings';
import { alignFurigana, fold } from './furigana';
import type { Run } from './paragraphText';

/** One reading over paragraph code points [start, end). */
export interface Piece {
	start: number;
	end: number;
	rt?: string;
	/** Known: rendered but invisible until revealed. */
	concealed: boolean;
	/** The book's own ruby (a whole run) or a generated dictionary reading. */
	source: 'book' | 'dict';
}

const HAN = /[\p{Script=Han}々〆]/u;

/**
 * isKnown: the entry whose reading is shown (the first candidate) is known
 * (marked, or a score of at least `threshold`). A mastered homograph further
 * down the list never hides a reading the learner has not mastered.
 */
export function isKnown(match: Pick<SegmentMatch, 'entries'>, index: KnownIndex, threshold: number): boolean {
	const first = match.entries[0];
	return first !== undefined && isKnownEntry(first.id, index, threshold);
}

/**
 * annotateParagraph computes the readings of one paragraph. `runs` are the
 * displayed runs (variant applied) the matches were segmented from.
 * Book ruby follows `display.bookRuby` and wins over generated readings;
 * in `smart` mode a reading of a known word is concealed, and so is a book
 * ruby whose every kanji lies inside known matches.
 */
export function annotateParagraph(
	runs: readonly Run[],
	matches: readonly SegmentMatch[],
	index: KnownIndex,
	display: ReaderDisplay,
	lang: string
): Piece[] {
	const smart = display.readings === 'smart';
	const pieces: Piece[] = [];

	const knownAt = new Set<number>();
	const knownMatch = new Map<SegmentMatch, boolean>();
	for (const m of matches) {
		const known = smart && isKnown(m, index, display.smartThreshold);
		knownMatch.set(m, known);
		if (known) for (let i = m.start; i < m.end; i++) knownAt.add(i);
	}

	// Book ruby runs, in paragraph code points.
	const bookSpans: { start: number; end: number }[] = [];
	let pos = 0;
	for (const run of runs) {
		const chars = Array.from(run.text);
		const start = pos;
		pos += chars.length;
		if (!run.ruby || !display.bookRuby) continue;
		bookSpans.push({ start, end: pos });
		let concealed = false;
		if (smart) {
			const han: number[] = [];
			chars.forEach((c, i) => {
				if (HAN.test(c)) han.push(start + i);
			});
			// Known only when the known matches' readings spell the book's ruby
			// (明日 with ruby あす stays visible for a learner who knows あした).
			const covering = matches
				.filter((m) => knownMatch.get(m) === true && m.start < pos && start < m.end)
				.sort((a, b) => a.start - b.start);
			const spelled = covering.map((m) => m.reading?.value ?? null);
			concealed =
				han.length > 0 &&
				han.every((i) => knownAt.has(i)) &&
				!spelled.includes(null) &&
				fold(spelled.join('')) === fold(run.ruby);
		}
		pieces.push({ start, end: pos, rt: run.ruby, concealed, source: 'book' });
	}

	if (display.readings !== 'never') {
		for (const m of matches) {
			if (!m.reading || !HAN.test(m.surface)) continue;
			if (bookSpans.some((b) => m.start < b.end && b.start < m.end)) continue;
			const concealed = knownMatch.get(m) === true;
			if (lang === 'ja') {
				const aligned = alignFurigana(m.surface, m.stem ?? m.lemma, m.reading.value);
				if (!aligned) continue;
				let at = m.start;
				for (const part of aligned) {
					const end = at + Array.from(part.text).length;
					if (part.rt !== undefined) pieces.push({ start: at, end, rt: part.rt, concealed, source: 'dict' });
					at = end;
				}
			} else {
				pieces.push({ start: m.start, end: m.end, rt: m.reading.value, concealed, source: 'dict' });
			}
		}
	}
	return pieces.sort((a, b) => a.start - b.start);
}
