// What a lesson loads besides the course (#222): the dictionary entries of its words, for their glosses (the worker
// keeps GET /api/entries/{id}, so the roadmap fetches the next units' entries while online, Ruling 9), and the
// character entries of a script lesson. A word whose entry cannot be read has no gloss: it is introduced, not asked.
// A test (#224) also loads the gap exercises of its grammar lessons and the learner's known index.

import type { CourseWord } from '$lib/api/courses';
import { getEntry } from '$lib/api/entries';
import { search } from '$lib/api/search';
import type { Entry, SearchHit } from '$lib/api/types';
import { buildExercises, clozeParts } from '$lib/features/grammar/exercises';
import { loadDisplayLesson, type DisplayLesson } from '$lib/features/grammar/lessonData';
import { splitPoint } from '$lib/studycore/grammarRuns';
import { knownIndex, type KnownIndex } from '$lib/studycore/known';
import { activeWeights } from '$lib/studycore/readModel';
import { isValidReview, scheduleFor, type Schedule } from '$lib/studycore/scheduler';
import type { StudyClock } from '$lib/studycore/studyClock';
import type { StudyHistory } from '$lib/studycore/types';
import { shortGloss, type WordInfo } from './flow';
import type { GapItem } from './tests';

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

/** loadGrammarItems: the fill-the-gap exercises of each grammar point's lesson, by point; a point whose lesson is
 * missing or cannot load gives none. Never rejects. */
export async function loadGrammarItems(
	points: readonly string[],
	load: (pack: string, id: string) => Promise<DisplayLesson | null> = loadDisplayLesson
): Promise<Map<string, GapItem[]>> {
	const out = new Map<string, GapItem[]>();
	await each([...new Set(points)], async (point) => {
		const ids = splitPoint(point);
		if (ids === null) return;
		try {
			const data = await load(ids.packId, ids.lessonId);
			if (data === null) return;
			const items: GapItem[] = [];
			for (const ex of buildExercises(data.lesson, data.lesson.id)) {
				if (ex.kind !== 'cloze') continue;
				const parts = clozeParts(ex.example.text, ex.example.focus);
				if (parts === null) continue;
				items.push({ id: ex.example.id, before: parts.before, after: parts.after, answer: ex.example.focus, choices: ex.choices, translation: ex.example.translation || null, title: data.lesson.title });
			}
			if (items.length > 0) out.set(point, items);
		} catch {
			// Offline or gone: the test has no questions on this point.
		}
	});
	return new Map(points.filter((p) => out.has(p)).map((p) => [p, out.get(p)!]));
}

/**
 * courseKnownIndex: the shared known predicate's index (lib/studycore/known.ts) over a workspace's history: its live
 * vocab cards scored by their replayed schedules and its known marks — the level check's index, built from the study
 * core alone (the courses feature never imports the flashcards feature).
 */
export function courseKnownIndex(history: Pick<StudyHistory, 'cards' | 'reviews' | 'known' | 'fsrs'>, clock: StudyClock): KnownIndex {
	const byCard = new Map<string, StudyHistory['reviews']>();
	for (const review of history.reviews) {
		if (!isValidReview(review)) continue;
		const list = byCard.get(review.payload.cardId);
		if (list === undefined) byCard.set(review.payload.cardId, [review]);
		else list.push(review);
	}
	const w = activeWeights(history);
	const schedules = new Map<string, Schedule>();
	for (const card of history.cards) {
		const reviews = byCard.get(card.id);
		if (reviews === undefined) continue;
		const s = scheduleFor(card.id, reviews, new Date(0), w, clock);
		if (s !== null) schedules.set(card.id, s);
	}
	return knownIndex(history.cards, (id) => schedules.get(id) ?? null, history.known ?? []);
}
