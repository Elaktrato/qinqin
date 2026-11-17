// Text coverage (#68): how many running words of a chapter or book the
// learner knows, and the most frequent words they do not. Pure: a tally per
// chapter from the loaded matches (kept small for the whole-book count),
// then figures and the list for any familiarity function, so a review or a
// mark recomputes them without a request. Contract:
// docs/contracts/reader/coverage.json.
import type { SegmentMatch } from '$lib/api/types';
import type { Familiarity } from '$lib/study/known';
import { isWordChar, isWordToken } from './wordRanges';

export interface Occurrence {
	chapter: number;
	p: number;
	start: number;
}

export interface TypeTally {
	entryId: number;
	count: number;
	lemma: string;
	reading?: string;
	first: Occurrence;
}

export interface ChapterTally {
	types: Map<number, TypeTally>;
	tokens: number;
	unmatched: number;
}

export interface Coverage {
	tokens: number;
	known: number;
	learning: number;
	new: number;
	types: { new: number; learning: number };
	unmatched: number;
	percent: number | null;
}

export type UnknownItem = TypeTally & { state: 'new' | 'learning' };

const before = (a: Occurrence, b: Occurrence): boolean =>
	a.chapter !== b.chapter ? a.chapter < b.chapter : a.p !== b.p ? a.p < b.p : a.start < b.start;

/** unmatchedRuns counts maximal runs of word characters outside every match (code points). */
function unmatchedRuns(text: string, matches: readonly SegmentMatch[], lang: string): number {
	const sorted = matches.length > 1 ? [...matches].sort((a, b) => a.start - b.start) : matches;
	let runs = 0;
	let inRun = false;
	let i = 0;
	let m = 0;
	for (const ch of text) {
		while (m < sorted.length && sorted[m].end <= i) m++;
		const covered = m < sorted.length && sorted[m].start <= i;
		if (!covered && isWordChar(ch, lang)) {
			if (!inRun) runs++;
			inRun = true;
		} else {
			inRun = false;
		}
		i++;
	}
	return runs;
}

/** tallyChapter counts tokens per type (first candidate) and the unmatched runs of one chapter. */
export function tallyChapter(
	chapter: number,
	lang: string,
	texts: readonly string[],
	matches: ReadonlyMap<number, readonly SegmentMatch[]>
): ChapterTally {
	const types = new Map<number, TypeTally>();
	let tokens = 0;
	let unmatched = 0;
	texts.forEach((text, p) => {
		const list = matches.get(p) ?? [];
		for (const m of list) {
			const first = m.entries[0];
			if (first === undefined || !isWordToken(m.surface, lang)) continue;
			tokens++;
			const t = types.get(first.id);
			if (t === undefined) {
				const item: TypeTally = { entryId: first.id, count: 1, lemma: m.lemma, first: { chapter, p, start: m.start } };
				if (m.reading) item.reading = m.reading.value;
				types.set(first.id, item);
			} else {
				t.count++;
				if (t.reading === undefined && m.reading) t.reading = m.reading.value;
				if (before({ chapter, p, start: m.start }, t.first)) t.first = { chapter, p, start: m.start };
			}
		}
		if (text !== '') unmatched += unmatchedRuns(text, list, lang);
	});
	return { types, tokens, unmatched };
}

/** mergeTallies sums chapters (a book): counts add, the earliest occurrence stays. */
export function mergeTallies(tallies: Iterable<ChapterTally>): ChapterTally {
	const types = new Map<number, TypeTally>();
	let tokens = 0;
	let unmatched = 0;
	for (const tally of tallies) {
		tokens += tally.tokens;
		unmatched += tally.unmatched;
		for (const t of tally.types.values()) {
			const cur = types.get(t.entryId);
			if (cur === undefined) {
				types.set(t.entryId, { ...t, first: { ...t.first } });
				continue;
			}
			cur.count += t.count;
			if (before(t.first, cur.first)) {
				cur.first = { ...t.first };
				cur.lemma = t.lemma;
				if (t.reading !== undefined) cur.reading = t.reading;
			} else if (cur.reading === undefined && t.reading !== undefined) {
				cur.reading = t.reading;
			}
		}
	}
	return { types, tokens, unmatched };
}

/** coverageOf: known tokens / tokens, floored to a whole percent; null without tokens. */
export function coverageOf(tally: ChapterTally, stateOf: (entryId: number) => Familiarity): Coverage {
	const out: Coverage = { tokens: tally.tokens, known: 0, learning: 0, new: 0, types: { new: 0, learning: 0 }, unmatched: tally.unmatched, percent: null };
	for (const t of tally.types.values()) {
		const state = stateOf(t.entryId);
		out[state] += t.count;
		if (state !== 'known') out.types[state]++;
	}
	if (out.tokens > 0) out.percent = Math.floor((100 * out.known) / out.tokens);
	return out;
}

/** unknownList: the types not known, by count descending, then first occurrence. */
export function unknownList(tally: ChapterTally, stateOf: (entryId: number) => Familiarity): UnknownItem[] {
	const out: UnknownItem[] = [];
	for (const t of tally.types.values()) {
		const state = stateOf(t.entryId);
		if (state !== 'known') out.push({ ...t, state });
	}
	return out.sort((a, b) => b.count - a.count || (before(a.first, b.first) ? -1 : before(b.first, a.first) ? 1 : 0));
}
