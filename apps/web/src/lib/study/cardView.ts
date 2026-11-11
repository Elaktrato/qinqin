// The display content of one vocab card. The front shows the word, its
// readings, and an example sentence with the word blanked; the back is
// the same content plus glosses grouped by dictionary. Building this
// separately from the page keeps the reveal rules testable.

import type { Entry, SenseView, Sentence } from '../api/types';

/** The placeholder that replaces the studied word in an example sentence. */
export const BLANK = '____';

/** One reading as the card displays it; `plain` and `ord` are not needed. */
export interface VocabReading {
	type: string;
	value: string;
}

/** One dictionary's glosses for the word, in API order. */
export interface VocabGlossGroup {
	dictionaryName: string;
	glosses: string[];
}

export interface VocabFace {
	written: string;
	readings: VocabReading[];
	sentenceLines: string[];
}

export interface VocabBackFace extends VocabFace {
	glosses: VocabGlossGroup[];
}

export interface VocabFaces {
	front: VocabFace;
	back: VocabBackFace;
}

/**
 * sentenceLines blanks the written form inside the example sentence. An
 * absent sentence (or an id that no longer resolves, which the caller
 * passes as null) has no block at all; a sentence that does not contain
 * the word is shown verbatim rather than silently dropped.
 */
function sentenceLines(entry: Entry, sentence: Sentence | null | undefined): string[] {
	if (sentence === null || sentence === undefined) return [];
	if (entry.written.length === 0 || !sentence.hanzi.includes(entry.written)) {
		return [sentence.hanzi];
	}
	return [sentence.hanzi.split(entry.written).join(BLANK)];
}

/**
 * groupGlosses keeps the API's sense order: a dictionary appears at its
 * first gloss, and later glosses from the same dictionary append to it.
 * Grouping is by name because that is what the card shows; a dictionary
 * renamed between responses still collapses to one group.
 */
function groupGlosses(senses: readonly SenseView[]): VocabGlossGroup[] {
	const groups: VocabGlossGroup[] = [];
	const byName = new Map<string, VocabGlossGroup>();

	for (const sense of senses) {
		let group = byName.get(sense.dictionaryName);
		if (group === undefined) {
			group = { dictionaryName: sense.dictionaryName, glosses: [] };
			byName.set(sense.dictionaryName, group);
			groups.push(group);
		}
		group.glosses.push(sense.gloss);
	}

	return groups;
}

/**
 * buildVocabFaces turns one resolved entry and its optional example
 * sentence into the two card faces. `language` is accepted so callers do
 * not have to special-case a workspace's scripts; the blanking rule is
 * language-independent.
 */
export function buildVocabFaces(
	entry: Entry,
	sentence: Sentence | null | undefined,
	language: string
): VocabFaces {
	void language;

	const lines = sentenceLines(entry, sentence);
	const readings = entry.readings.map(({ type, value }): VocabReading => ({ type, value }));
	const front: VocabFace = {
		written: entry.written,
		readings,
		sentenceLines: lines
	};

	return {
		front,
		back: {
			...front,
			glosses: groupGlosses(entry.senses)
		}
	};
}
