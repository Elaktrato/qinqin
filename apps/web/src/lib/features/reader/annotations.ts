// Loads dictionary matches for a chapter's paragraphs, a few thousand
// characters per request, visible paragraph first, at most two requests in
// flight, a small LRU so reopening a chapter costs nothing. Memory only:
// the readings depend on mastery, which changes with every review.
import type { SegmentMatch } from '$lib/api/types';

/** One slice of a paragraph inside a chunk's text. All offsets are code points. */
export interface ChunkPart {
	p: number;
	/** Offset of the slice inside paragraph p. */
	from: number;
	/** Offset of the slice inside the chunk text. */
	at: number;
	len: number;
}

export interface Chunk {
	text: string;
	parts: ChunkPart[];
}

export const MAX_CHUNK_CODE_POINTS = 4000;
const SENTENCE_END = new Set(['。', '！', '？', '!', '?']);
const SEPARATOR = '\n';

interface Unit {
	p: number;
	from: number;
	chars: string[];
}

function unitsOf(p: number, chars: string[], max: number): Unit[] {
	if (chars.length <= max) return [{ p, from: 0, chars }];
	const sentences: string[][] = [];
	let current: string[] = [];
	for (const ch of chars) {
		current.push(ch);
		if (SENTENCE_END.has(ch)) {
			sentences.push(current);
			current = [];
		}
	}
	if (current.length > 0) sentences.push(current);

	const units: Unit[] = [];
	let from = 0;
	let acc: string[] = [];
	const flush = (): void => {
		if (acc.length === 0) return;
		units.push({ p, from, chars: acc });
		from += acc.length;
		acc = [];
	};
	for (const sentence of sentences) {
		if (acc.length + sentence.length > max) flush();
		if (sentence.length > max) {
			for (let i = 0; i < sentence.length; i += max) {
				acc = sentence.slice(i, i + max);
				flush();
			}
		} else {
			acc.push(...sentence);
		}
	}
	flush();
	return units;
}

/**
 * chunkParagraphs packs paragraph texts into request-sized chunks in visit
 * order: `startIndex` (the paragraph in view) onward, then backward.
 * Paragraphs are joined by a newline, which no dictionary word contains.
 * A paragraph longer than the limit is cut after sentence punctuation,
 * else at the limit. Empty paragraphs are skipped.
 */
export function chunkParagraphs(
	texts: readonly string[],
	startIndex: number,
	maxCodePoints = MAX_CHUNK_CODE_POINTS
): Chunk[] {
	const start = Math.min(Math.max(0, startIndex), Math.max(0, texts.length - 1));
	const order: number[] = [];
	for (let i = start; i < texts.length; i++) order.push(i);
	for (let i = start - 1; i >= 0; i--) order.push(i);

	const chunks: Chunk[] = [];
	let text: string[] = [];
	let parts: ChunkPart[] = [];
	const flush = (): void => {
		if (parts.length > 0) chunks.push({ text: text.join(''), parts });
		text = [];
		parts = [];
	};
	for (const p of order) {
		if (texts[p].trim() === '') continue;
		for (const unit of unitsOf(p, Array.from(texts[p]), maxCodePoints)) {
			if (text.length > 0 && text.length + 1 + unit.chars.length > maxCodePoints) flush();
			if (text.length > 0) text.push(SEPARATOR);
			parts.push({ p, from: unit.from, at: text.length, len: unit.chars.length });
			text.push(...unit.chars);
		}
	}
	flush();
	return chunks;
}

export type SegmentFn = (text: string, signal?: AbortSignal) => Promise<SegmentMatch[]>;

export interface AnnotationLoader {
	/**
	 * Loads the chapter. `onParagraph(p, matches)` runs once per paragraph
	 * with matches in paragraph offsets (cached ones first). Resolves when
	 * done or aborted; `failed` counts chunks whose request failed - their
	 * paragraphs stay plain and are retried by the next load of the key.
	 */
	load(
		key: string,
		texts: readonly string[],
		startIndex: number,
		onParagraph: (p: number, matches: SegmentMatch[]) => void
	): Promise<{ failed: number }>;
	abort(): void;
}

export function createAnnotationLoader(opts: {
	segment: SegmentFn;
	concurrency?: number;
	lru?: number;
	maxCodePoints?: number;
}): AnnotationLoader {
	const concurrency = opts.concurrency ?? 2;
	const capacity = opts.lru ?? 6;
	const max = opts.maxCodePoints ?? MAX_CHUNK_CODE_POINTS;
	const cache = new Map<string, Map<number, SegmentMatch[]>>();
	let controller: AbortController | null = null;

	function entryFor(key: string): Map<number, SegmentMatch[]> {
		const hit = cache.get(key);
		if (hit) {
			cache.delete(key);
			cache.set(key, hit);
			return hit;
		}
		const fresh = new Map<number, SegmentMatch[]>();
		cache.set(key, fresh);
		while (cache.size > capacity) cache.delete(cache.keys().next().value as string);
		return fresh;
	}

	function abort(): void {
		controller?.abort();
		controller = null;
	}

	async function load(
		key: string,
		texts: readonly string[],
		startIndex: number,
		onParagraph: (p: number, matches: SegmentMatch[]) => void
	): Promise<{ failed: number }> {
		abort();
		const mine = new AbortController();
		controller = mine;
		const entry = entryFor(key);

		const todo = texts.map((text, p) => (entry.has(p) ? '' : text));
		for (const [p, matches] of entry) if (p < texts.length) onParagraph(p, matches);
		const chunks = chunkParagraphs(todo, startIndex, max);

		const remaining = new Map<number, number>();
		for (const chunk of chunks) for (const part of chunk.parts) remaining.set(part.p, (remaining.get(part.p) ?? 0) + 1);
		const gathered = new Map<number, SegmentMatch[]>();
		const broken = new Set<number>();
		let failed = 0;
		let next = 0;

		const settle = (part: ChunkPart): void => {
			const left = (remaining.get(part.p) ?? 1) - 1;
			remaining.set(part.p, left);
			if (left > 0 || broken.has(part.p) || mine.signal.aborted) return;
			const matches = gathered.get(part.p) ?? [];
			entry.set(part.p, matches);
			onParagraph(part.p, matches);
		};

		const worker = async (): Promise<void> => {
			while (!mine.signal.aborted && next < chunks.length) {
				const chunk = chunks[next++];
				let matches: SegmentMatch[] | null = null;
				try {
					matches = await opts.segment(chunk.text, mine.signal);
				} catch {
					if (!mine.signal.aborted) failed++;
				}
				if (mine.signal.aborted) return;
				for (const part of chunk.parts) {
					if (matches === null) {
						broken.add(part.p);
					} else {
						const list = gathered.get(part.p) ?? [];
						for (const m of matches) {
							if (m.start >= part.at && m.end <= part.at + part.len) {
								list.push({ ...m, start: m.start - part.at + part.from, end: m.end - part.at + part.from });
							}
						}
						gathered.set(part.p, list);
					}
					settle(part);
				}
			}
		};
		await Promise.all(Array.from({ length: Math.min(concurrency, chunks.length) }, worker));
		if (controller === mine) controller = null;
		return { failed };
	}

	return { load, abort };
}
