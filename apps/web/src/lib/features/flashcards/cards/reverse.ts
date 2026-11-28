// The reverse card's pure logic: meaning in, word out. The front shows
// the first shown sense's glosses (never the written form), the back reuses
// buildVocabFaces.

import type { Entry } from '$lib/api/types';
import { entrySenses, shownGlosses, unitsOf } from '$lib/entry/entrySenses';
import { normalizeAnswer } from '$lib/exercises/cloze';
import type { ReviewGrade } from '$lib/studycore/types';

export interface ReverseFront {
	/** Parts of speech of the first sense group. */
	pos: string[];
	/** Up to three glosses. */
	glosses: string[];
}

const MAX_GLOSSES = 3;

/**
 * The first display unit's pos and glosses (the sense display rule,
 * docs/contracts/senses: never a folded slang or vulgar gloss; only the
 * card's pinned reading's when it has one); without
 * sense groups, the flat senses' shown glosses.
 */
export function buildReverseFront(entry: Entry, pinned?: string): ReverseFront {
	const units = unitsOf(entrySenses(entry), pinned);
	if (entry.senseGroups === undefined || entry.senseGroups.length === 0) {
		return { pos: [], glosses: shownGlosses(units, MAX_GLOSSES) };
	}
	const first = units[0];
	if (first === undefined) return { pos: [], glosses: [] };
	return { pos: [...first.of.pos], glosses: first.glosses.slice(0, MAX_GLOSSES) };
}

/** The accepted typed answers (normalised): written, forms and variants. */
export function acceptedReverseAnswers(
	entry: Pick<Entry, 'written' | 'forms' | 'variants'>
): Set<string> {
	const all = [
		entry.written,
		...(entry.forms ?? []).map((f) => f.text),
		...(entry.variants ?? []).map((v) => v.written)
	]
		.map(normalizeAnswer)
		.filter((text) => text !== '');
	return new Set(all);
}

/**
 * Nothing typed: no suggestion (self-grade). Accepted: Good. Not accepted:
 * Again. Never Easy. A hint lowers it afterwards (hints.ts `lowerForHints`).
 */
export function suggestReverseGrade(result: {
	typed: string;
	accepted: ReadonlySet<string>;
}): ReviewGrade | null {
	const typed = normalizeAnswer(result.typed);
	if (typed === '') return null;
	if (!result.accepted.has(typed)) return 1;
	return 3;
}
