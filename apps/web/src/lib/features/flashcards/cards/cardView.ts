// The display content of one vocab card. The front shows the word, its
// readings, and an example sentence with the word blanked; the back is
// the same content plus glosses grouped by dictionary, in the order of the
// sense display rule (docs/contracts/senses: slang, vulgar and derogatory
// glosses last, folded behind "more"). Building this separately from the
// page keeps the reveal rules testable.

import type { Entry, Sentence } from '$lib/api/types';
import { shownWritten } from '$lib/entry/displayForm';
import { entrySenses, unitsOf } from '$lib/entry/entrySenses';
import type { SenseMark } from '$lib/entry/senseDisplay';

/**
 * withShownWritten is the entry a card is drawn with: its written form is
 * shownWritten(entry, the card's snapshot), so a card copied from a starter
 * deck's kana row shows that kana on every face. The same entry otherwise.
 */
export function withShownWritten(entry: Entry, snapshot: string | undefined): Entry {
	const written = shownWritten(entry, snapshot);
	return written === entry.written ? entry : { ...entry, written };
}

const ONE_KANA = /^[\u3041-\u3096\u30a1-\u30fa\u30fc]$/u;

/** The placeholder that replaces the studied word in an example sentence. */
export const BLANK = '____';

/** One reading as the card displays it; `plain` and `ord` are not needed. */
export interface VocabReading {
	type: string;
	value: string;
}

/** One gloss on a card; mark: the slang, vulgar or derogatory mark of a sensitive gloss, else null. */
export interface VocabGloss {
	text: string;
	mark: SenseMark | null;
}

/** One dictionary's glosses for the word, in display order. */
export interface VocabGlossGroup {
	dictionaryName: string;
	glosses: VocabGloss[];
}

export interface VocabFace {
	written: string;
	readings: VocabReading[];
	sentenceLines: string[];
}

export interface VocabBackFace extends VocabFace {
	/** The glosses shown at once. */
	glosses: VocabGlossGroup[];
	/** The folded ones, behind "Show n more meanings" (empty for most words). */
	folded: VocabGlossGroup[];
}

export interface VocabFaces {
	front: VocabFace;
	back: VocabBackFace;
}

/**
 * sentenceLines blanks the written form inside the example sentence. An
 * absent sentence (or an id that no longer resolves, which the caller
 * passes as null) has no block at all; a sentence that does not contain
 * the word is shown verbatim rather than silently dropped. A one-kana
 * headword (の, で — shown in kana by the display form) is never blanked:
 * the same kana sits inside other words (この), so blanking would garble
 * the sentence.
 */
function sentenceLines(entry: Entry, sentence: Sentence | null | undefined): string[] {
	if (sentence === null || sentence === undefined) return [];
	if (
		entry.written.length === 0 ||
		ONE_KANA.test(entry.written) ||
		!sentence.hanzi.includes(entry.written)
	) {
		return [sentence.hanzi];
	}
	return [sentence.hanzi.split(entry.written).join(BLANK)];
}

/**
 * groupGlosses puts the entry's senses through the sense display rule and
 * groups the shown and the folded units by dictionary: a dictionary appears
 * at its first unit, and later units of the same dictionary append to it.
 * Grouping is by name because that is what the card shows; a dictionary
 * renamed between responses still collapses to one group.
 */
function groupGlosses(entry: Entry, pinned: string | undefined): Pick<VocabBackFace, 'glosses' | 'folded'> {
	const shown: VocabGlossGroup[] = [];
	const folded: VocabGlossGroup[] = [];
	const byName = new Map<string, VocabGlossGroup>();
	for (const unit of unitsOf(entrySenses(entry), pinned)) {
		const name = unit.of.dictionaryName;
		const key = `${unit.folded ? 1 : 0}\u0000${name}`;
		let group = byName.get(key);
		if (group === undefined) {
			group = { dictionaryName: name, glosses: [] };
			byName.set(key, group);
			(unit.folded ? folded : shown).push(group);
		}
		for (const text of unit.glosses) group.glosses.push({ text, mark: unit.mark });
	}
	return { glosses: shown, folded };
}

/** groupReadings keeps the API order but gathers readings of one type (on, kun, pinyin). */
function groupReadings(readings: readonly VocabReading[]): VocabReading[] {
	const types = [...new Set(readings.map((reading) => reading.type))];
	return types.flatMap((type) => readings.filter((reading) => reading.type === type));
}

/**
 * buildVocabFaces turns one resolved entry and its optional example
 * sentence into the two card faces; `pinned` is the card's pinned reading
 * (#346): the back shows only that reading's meanings. `language` is accepted so callers do
 * not have to special-case a workspace's scripts; the blanking rule is
 * language-independent.
 */
export function buildVocabFaces(
	entry: Entry,
	sentence: Sentence | null | undefined,
	language: string,
	pinned?: string
): VocabFaces {
	void language;

	const readings = entry.readings.map(({ type, value }): VocabReading => ({ type, value }));
	if (entry.kind === 'character') {
		// A character's readings (on/kun, several pinyin) would give the
		// answer away and a blanked sentence would show half of it: the
		// front is the glyph alone, the readings appear after the reveal.
		return {
			front: { written: entry.written, readings: [], sentenceLines: [] },
			back: {
				written: entry.written,
				readings: groupReadings(readings),
				sentenceLines: [],
				...groupGlosses(entry, pinned)
			}
		};
	}

	const front: VocabFace = {
		written: entry.written,
		readings,
		sentenceLines: sentenceLines(entry, sentence)
	};

	return {
		front,
		back: {
			...front,
			...groupGlosses(entry, pinned)
		}
	};
}
