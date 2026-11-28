// What a lesson loads besides the course (#222): the dictionary entries of its words, for their glosses (the worker
// keeps GET /api/entries/{id}, so the roadmap fetches the next units' entries while online, Ruling 9), and the
// character entries of a script lesson. A word whose entry cannot be read has no gloss: it is introduced, not asked.

import type { CourseWord } from '$lib/api/courses';
import { getEntry } from '$lib/api/entries';
import { search } from '$lib/api/search';
import type { Entry, SearchHit } from '$lib/api/types';
import { shortGloss, type WordInfo } from './flow';

const CONCURRENCY = 4;

async function each<T>(items: readonly T[], run: (item: T) => Promise<void>): Promise<void> {
	let next = 0;
	const worker = async () => {
		while (next < items.length) await run(items[next++]);
	};
	await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, worker));
}

/** loadWordInfo: the words by key, in order, each with the short gloss of its entry. Never rejects. */
export async function loadWordInfo(words: readonly CourseWord[], fetchEntry: (id: number) => Promise<Entry> = getEntry): Promise<Map<string, WordInfo>> {
	const unique = [...new Map(words.map((w) => [w.key, w])).values()];
	const glosses = new Map<number, string | null>();
	await each([...new Set(unique.map((w) => w.entryId))], async (id) => {
		try {
			glosses.set(id, shortGloss((await fetchEntry(id)).senses ?? []));
		} catch {
			glosses.set(id, null);
		}
	});
	return new Map(unique.map((w) => [w.key, { key: w.key, form: w.form, reading: w.reading, entryId: w.entryId, gloss: glosses.get(w.entryId) ?? null }]));
}

/** loadCharacterInfo: the character entries of a script lesson, found by search; a character without one is left out. */
export async function loadCharacterInfo(
	language: string,
	chars: readonly string[],
	searchFn: (lang: string, q: string, opts: { kind: string }) => Promise<SearchHit[]> = search
): Promise<Map<string, WordInfo>> {
	const out = new Map<string, WordInfo>();
	await each(chars, async (char) => {
		try {
			const hit = (await searchFn(language, char, { kind: 'character' })).find((h) => h.kind === 'character' && h.written === char);
			if (hit === undefined) return;
			out.set(char, { key: char, form: char, reading: hit.readings[0]?.value ?? '', entryId: hit.id, gloss: shortGloss(hit.glosses ?? []) });
		} catch {
			// Offline or not found: the character is shown without help.
		}
	});
	return new Map(chars.filter((c) => out.has(c)).map((c) => [c, out.get(c)!]));
}
