// The on-demand whole-book word count (#68): chapters are fetched and
// segmented one after another (the same chunks and segment function as the
// reader, at most `concurrency` requests in flight), and only a small tally
// per chapter is kept, in memory, for the life of the book page. The open
// chapter's tally comes from the reader (put). The owner recreates the
// counter when the text changes (variant). Client-side: the variant
// conversion is client-side and a server chapter cache was declined (#78).
import type { SegmentMatch } from '$lib/api/types';
import { createAnnotationLoader, type SegmentFn } from './annotations';
import { tallyChapter, type ChapterTally } from './coverage';
import { paragraphString, type Run } from './paragraphText';

export interface BookCounter {
	/** Tallies by chapter number. */
	readonly tallies: ReadonlyMap<number, ChapterTally>;
	put(n: number, tally: ChapterTally): void;
	/** Counts chapters 0..chapters-1 not yet tallied; resolves with the chapters that failed. */
	count(chapters: number, onProgress: (done: number, total: number) => void): Promise<{ failed: number[] }>;
	abort(): void;
}

export function createBookCounter(opts: {
	getChapter: (n: number, signal: AbortSignal) => Promise<{ paragraphs: Run[][] }>;
	segment: SegmentFn;
	displayRuns: (p: Run[]) => Run[];
	lang: string;
	concurrency?: number;
}): BookCounter {
	const tallies = new Map<number, ChapterTally>();
	// lru 1: nothing of a counted chapter but its tally stays in memory.
	const loader = createAnnotationLoader({ segment: opts.segment, concurrency: opts.concurrency ?? 2, lru: 1 });
	let controller: AbortController | null = null;

	function abort(): void {
		controller?.abort();
		controller = null;
		loader.abort();
	}

	async function count(chapters: number, onProgress: (done: number, total: number) => void): Promise<{ failed: number[] }> {
		abort();
		const mine = new AbortController();
		controller = mine;
		const failed: number[] = [];
		for (let n = 0; n < chapters; n++) {
			if (mine.signal.aborted) break;
			if (!tallies.has(n)) {
				try {
					const chapter = await opts.getChapter(n, mine.signal);
					if (mine.signal.aborted) break;
					const texts = chapter.paragraphs.map((p) => paragraphString(opts.displayRuns(p)));
					const matches = new Map<number, SegmentMatch[]>();
					const res = await loader.load(`count:${n}`, texts, 0, (p, m) => matches.set(p, m));
					if (mine.signal.aborted) break;
					if (res.failed > 0) failed.push(n);
					else tallies.set(n, tallyChapter(n, opts.lang, texts, matches));
				} catch {
					if (mine.signal.aborted) break;
					failed.push(n);
				}
			}
			onProgress(n + 1, chapters);
		}
		if (controller === mine) controller = null;
		return { failed };
	}

	return {
		tallies,
		put: (n, tally) => void tallies.set(n, tally),
		count,
		abort
	};
}
