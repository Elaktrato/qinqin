// The look-alike drill's items (#228; docs/contracts/lookalikes/README.md, "Candidates"): the sets with a member in the
// learner's study (a character of a reviewed card's written form), Japanese kana sets always, each with the number of
// answers it has (which decides the mode of its next question).

import type { StudyHistory } from '$lib/studycore/types';
import type { DrillItem } from '../types';
import { candidateSets, LOOK_ALIKES_DRILL, type LookAlikeSet, type SetsFile } from './sets';

export interface LookAlikeItemData {
	set: LookAlikeSet;
	file: SetsFile;
	/** The workspace language (`zh`, `zh-Hant`, `ja`): its script and its examples. */
	language: string;
	/** The set's answers so far (recognise when even). */
	answers: number;
}

/**
 * studiedWritten: the written snapshots of the workspace's cards that have a review, in the order of their first
 * review, each once; a card without a snapshot gives none.
 */
export function studiedWritten(history: Pick<StudyHistory, 'cards' | 'reviews'>): string[] {
	const writtenOf = new Map(history.cards.filter((c) => typeof c.written === 'string' && c.written !== '').map((c) => [c.id, c.written as string]));
	const first = new Map<string, string>();
	for (const r of history.reviews) {
		const written = writtenOf.get(r.payload.cardId);
		if (written === undefined) continue;
		const at = first.get(written);
		if (at === undefined || r.ts < at) first.set(written, r.ts);
	}
	return [...first.entries()].sort((a, b) => (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).map(([w]) => w);
}

/** lookAlikeItems: the candidate sets of a workspace as drill items. */
export function lookAlikeItems(file: SetsFile, language: string, history: Pick<StudyHistory, 'cards' | 'reviews' | 'drillAnswers'>): DrillItem<LookAlikeItemData>[] {
	const answers = new Map<string, number>();
	for (const a of history.drillAnswers ?? []) if (a.drill === LOOK_ALIKES_DRILL) answers.set(a.item, (answers.get(a.item) ?? 0) + 1);
	return candidateSets(file, language, studiedWritten(history)).map((set) => ({
		key: set.key,
		data: { set, file, language, answers: answers.get(set.key) ?? 0 }
	}));
}
