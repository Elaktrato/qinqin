// The reader's generated readings of the open chapter: loads dictionary
// matches (annotations.ts) only when the setting asks for them and turns
// them into pieces (smartReadings.ts). Matches stay in memory, so a change
// of the threshold or of the mastery index re-applies the rule without a
// request.
import type { SegmentMatch } from '$lib/api/types';
import { createAnnotationLoader, type SegmentFn } from './annotations';
import type { ReaderDisplay } from './displaySettings';
import { paragraphString, type Run } from './paragraphText';
import { annotateParagraph, type MasteryIndex, type Piece } from './smartReadings';

export interface ReadingsInput {
	/** bookId:chapter:variant (and anything else that changes the text). */
	key: string;
	lang: string;
	/** The displayed runs (variant applied), one list per paragraph. */
	runs: readonly Run[][];
	/** The paragraph in view: segmented first. */
	start: number;
	display: ReaderDisplay;
	index: MasteryIndex;
}

const LANGUAGES = new Set(['zh', 'ja']);

export class ReadingsController {
	pieces = $state.raw<ReadonlyMap<number, Piece[]>>(new Map());
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

	#rebuild(): void {
		const next = new Map<number, Piece[]>();
		for (const p of this.#matches.keys()) next.set(p, this.#annotate(p));
		this.pieces = next;
	}

	async run(input: ReadingsInput): Promise<void> {
		this.#input = input;
		if (input.display.readings === 'never' || !LANGUAGES.has(input.lang)) {
			this.stop();
			return;
		}
		if (input.key !== this.#key) {
			this.#loader.abort();
			this.#key = input.key;
			this.#matches = new Map();
			this.pieces = new Map();
		}
		const texts = input.runs.map((runs) => paragraphString([...runs]));
		const { failed } = await this.#loader.load(input.key, texts, input.start, (p, matches) => {
			if (this.#input?.key !== input.key) return;
			this.#matches.set(p, matches);
			this.pieces = new Map(this.pieces).set(p, this.#annotate(p));
		});
		if (this.#input?.key === input.key) this.failed = failed;
	}

	/** A new setting or mastery index: re-apply the rule to the loaded matches. */
	update(display: ReaderDisplay, index: MasteryIndex): void {
		if (!this.#input) return;
		if (display.readings === 'never') {
			this.stop();
			return;
		}
		this.#input = { ...this.#input, display, index };
		this.#rebuild();
	}

	stop(): void {
		this.#loader.abort();
		this.#key = '';
		this.#matches = new Map();
		this.pieces = new Map();
		this.failed = 0;
	}
}
