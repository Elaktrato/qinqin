// The reader's one source of dictionary matches for the open chapter
// (#78, #68): loads them (annotations.ts) only when generated readings, word
// highlighting or the Words panel ask for them, and turns them into reading
// pieces (smartReadings.ts) and word-state ranges (wordRanges.ts). Matches
// stay in memory (LRU of 6 chapters keyed bookId:chapter:variant), so a
// change of the threshold, the known index or a setting re-applies the
// rules without a request. Segment requests always ask for readings, so
// switching readings on later costs no second segmentation.
import type { SegmentMatch } from '$lib/api/types';
import type { KnownIndex } from '$lib/study/known';
import { createAnnotationLoader, type SegmentFn } from './annotations';
import type { ReaderDisplay } from './displaySettings';
import { paragraphString, type Run } from './paragraphText';
import { annotateParagraph, type Piece } from './smartReadings';
import { wordRanges, type WordRange } from './wordRanges';

/** What needs the matches: generated readings, and word states or coverage. */
export interface ReadingsWant {
	readings: boolean;
	/** Word highlighting on, or the Words panel open. */
	words: boolean;
}

export interface ReadingsInput {
	/** bookId:chapter:variant (and anything else that changes the text). */
	key: string;
	lang: string;
	/** The displayed runs (variant applied), one list per paragraph. */
	runs: readonly Run[][];
	/** The paragraph in view: segmented first. */
	start: number;
	display: ReaderDisplay;
	index: KnownIndex;
	/** Default: readings unless `never`, words when highlighting is on. */
	want?: ReadingsWant;
}

const LANGUAGES = new Set(['zh', 'ja']);

function wantOf(display: ReaderDisplay, want?: ReadingsWant): ReadingsWant {
	return want ?? { readings: display.readings !== 'never', words: display.highlightWords };
}

export class ReadingsController {
	pieces = $state.raw<ReadonlyMap<number, Piece[]>>(new Map());
	/** New and learning words per paragraph; empty unless highlighting is on. */
	words = $state.raw<ReadonlyMap<number, WordRange[]>>(new Map());
	/** The loaded matches per paragraph (coverage reads them). */
	matches = $state.raw<ReadonlyMap<number, SegmentMatch[]>>(new Map());
	/** Paragraphs with text, and how many of them have their matches. */
	progress = $state.raw<{ done: number; total: number }>({ done: 0, total: 0 });
	/** Chunks whose request failed in the last run (their paragraphs stay plain). */
	failed = $state(0);

	#loader;
	#key = '';
	#matches = new Map<number, SegmentMatch[]>();
	#input: ReadingsInput | null = null;

	constructor(segment: SegmentFn) {
		this.#loader = createAnnotationLoader({ segment });
	}

	#annotate(p: number): Piece[] {
		const input = this.#input;
		const matches = this.#matches.get(p);
		if (!input || !matches) return [];
		return annotateParagraph(input.runs[p] ?? [], matches, input.index, input.display, input.lang);
	}

	#words(p: number): WordRange[] | null {
		const input = this.#input;
		const matches = this.#matches.get(p);
		if (!input || !matches || !input.display.highlightWords) return null;
		return wordRanges(matches, input.index, input.display.smartThreshold, input.lang);
	}

	#rebuild(): void {
		const pieces = new Map<number, Piece[]>();
		const words = new Map<number, WordRange[]>();
		for (const p of this.#matches.keys()) {
			pieces.set(p, this.#annotate(p));
			const w = this.#words(p);
			if (w !== null) words.set(p, w);
		}
		this.pieces = pieces;
		this.words = words;
	}

	#publish(): void {
		this.matches = new Map(this.#matches);
		const total = this.#input?.runs.filter((r) => paragraphString([...r]) !== '').length ?? 0;
		this.progress = { done: this.#matches.size, total };
	}

	async run(input: ReadingsInput): Promise<void> {
		const want = wantOf(input.display, input.want);
		this.#input = input;
		if ((!want.readings && !want.words) || !LANGUAGES.has(input.lang)) {
			this.stop();
			return;
		}
		if (input.key !== this.#key) {
			this.#loader.abort();
			this.#key = input.key;
			this.#matches = new Map();
			this.pieces = new Map();
			this.words = new Map();
		}
		this.#publish();
		const texts = input.runs.map((runs) => paragraphString([...runs]));
		const { failed } = await this.#loader.load(input.key, texts, input.start, (p, matches) => {
			if (this.#input?.key !== input.key) return;
			this.#matches.set(p, matches);
			this.pieces = new Map(this.pieces).set(p, this.#annotate(p));
			const w = this.#words(p);
			if (w !== null) this.words = new Map(this.words).set(p, w);
			this.#publish();
		});
		if (this.#input?.key === input.key) this.failed = failed;
	}

	/** A new setting or known index: re-apply the rules to the loaded matches. */
	update(display: ReaderDisplay, index: KnownIndex, want?: ReadingsWant): void {
		if (!this.#input) return;
		const w = wantOf(display, want);
		if (!w.readings && !w.words) {
			this.stop();
			return;
		}
		this.#input = { ...this.#input, display, index, want: w };
		this.#rebuild();
	}

	stop(): void {
		this.#loader.abort();
		this.#key = '';
		this.#matches = new Map();
		this.pieces = new Map();
		this.words = new Map();
		this.matches = new Map();
		this.progress = { done: 0, total: 0 };
		this.failed = 0;
	}
}
