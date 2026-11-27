// The reverse card's pure logic: meaning in, word out. The front shows
// the first sense's glosses (never the written form), the back reuses
// buildVocabFaces.

import type { Entry } from '$lib/api/types';
import { normalizeAnswer } from '$lib/exercises/cloze';
import type { ReviewGrade } from '$lib/studycore/types';

export interface ReverseFront {
	/** Parts of speech of the first sense group. */
	pos: string[];
	/** Up to three glosses. */
	glosses: string[];
}

const MAX_GLOSSES = 3;

/** The first sense group's pos and glosses; falls back to the flat senses. */
export function buildReverseFront(entry: Entry): ReverseFront {
	const group = entry.senseGroups?.find((g) => g.glosses.length > 0);
	if (group !== undefined) {
		return { pos: [...group.pos], glosses: group.glosses.slice(0, MAX_GLOSSES) };
	}
	return { pos: [], glosses: entry.senses.map((s) => s.gloss).slice(0, MAX_GLOSSES) };
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
