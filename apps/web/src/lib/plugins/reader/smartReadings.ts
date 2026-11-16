// Which readings the reader shows, and which of them it conceals because
// the learner already knows the word (docs/contracts/reader/). "Known" is
// the existing mastery definition: the best vocab card of an entry has a
// memory score (cardScore) at or above the threshold (default
// MASTERY_THRESHOLD, as the decks view's "mastered").
import type { SegmentMatch } from '$lib/api/types';
import { cardScore } from '$lib/study/mastery';
import type { Schedule } from '$lib/study/scheduler';
import type { StudyCard } from '$lib/study/types';
import type { ReaderDisplay } from './displaySettings';
import { alignFurigana } from './furigana';
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

export type MasteryIndex = ReadonlyMap<number, number>;

const HAN = /[\p{Script=Han}々〆]/u;

/**
 * masteryIndex: entry id -> the best score among its reviewed vocab cards.
 * `schedules` is the replay of the review log (scheduleIndex of the decks
 * view), so the whole index costs no extra replay.
 */
export function masteryIndex(
	cards: readonly StudyCard[],
	schedules: ReadonlyMap<string, Pick<Schedule, 'stability'> | null>
): Map<number, number> {
	const index = new Map<number, number>();
	for (const card of cards) {
		if (card.kind !== 'vocab') continue;
		const schedule = schedules.get(card.id);
		if (!schedule) continue;
		const score = cardScore(schedule.stability);
		const best = index.get(card.entryId);
		if (best === undefined || score > best) index.set(card.entryId, score);
	}
	return index;
}

/**
 * isKnown: the entry whose reading is shown (the first candidate) has a
 * score of at least `threshold`. A mastered homograph further down the
 * list never hides a reading the learner has not mastered.
 */
export function isKnown(match: Pick<SegmentMatch, 'entries'>, index: MasteryIndex, threshold: number): boolean {
	const first = match.entries[0];
	return first !== undefined && (index.get(first.id) ?? 0) >= threshold;
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
	index: MasteryIndex,
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
			concealed = han.length > 0 && han.every((i) => knownAt.has(i));
		}
		pieces.push({ start, end: pos, rt: run.ruby, concealed, source: 'book' });
	}

	if (display.readings !== 'never') {
		for (const m of matches) {
			if (!m.reading || !HAN.test(m.surface)) continue;
			if (bookSpans.some((b) => m.start < b.end && b.start < m.end)) continue;
			const concealed = knownMatch.get(m) === true;
			if (lang === 'ja') {
				const aligned = alignFurigana(m.surface, m.lemma, m.reading.value);
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
