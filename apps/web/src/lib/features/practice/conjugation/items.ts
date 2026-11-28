// The conjugation drill's items (docs/contracts/drills/README.md: `<entryId>:<family>`): the learner's studied
// Japanese words, first reviewed first, each with the families switched on that it has. A question asks one form of
// the family (it rotates with the item's answers) and is recognised first and after a wrong answer, produced
// otherwise.

import type { DrillAnswer } from '$lib/studycore/drills';
import type { StudyHistory } from '$lib/studycore/types';
import { FAMILY_FORMS, isConjugationFamily, type ConjugationFamily } from '$lib/exercises/conjugationSettings';
import type { DrillItem } from '../types';
import type { ConjugationWord } from './words';

export const CONJUGATION_DRILL = 'conjugation';

export type ConjugationMode = 'produce' | 'recognise';

export interface ConjugationItemData {
	word: ConjugationWord;
	family: ConjugationFamily;
	form: string;
	mode: ConjugationMode;
}

export function itemKey(entryId: number, family: ConjugationFamily): string {
	return `${entryId}:${family}`;
}

export function parseItemKey(key: string): { entryId: number; family: ConjugationFamily } | null {
	const m = /^([1-9][0-9]*):(.+)$/.exec(key);
	if (m === null || !isConjugationFamily(m[2])) return null;
	return { entryId: Number(m[1]), family: m[2] };
}

/** studiedEntryIds: the entries of the workspace's word cards that have a review, in the order of their first review. */
export function studiedEntryIds(history: Pick<StudyHistory, 'cards' | 'reviews'>): number[] {
	const entryOf = new Map(history.cards.filter((c) => c.entryKind !== 'character').map((c) => [c.id, c.entryId]));
	const first = new Map<number, string>();
	for (const r of history.reviews) {
		const entry = entryOf.get(r.payload.cardId);
		if (entry === undefined) continue;
		const at = first.get(entry);
		if (at === undefined || r.ts < at) first.set(entry, r.ts);
	}
	return [...first.entries()].sort((a, b) => (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : a[0] - b[0])).map(([id]) => id);
}

/** questionOf: the form and the direction of the next question of a word × family, from the item's answers. */
export function questionOf(word: ConjugationWord, family: ConjugationFamily, answers: readonly DrillAnswer[]): { form: string; mode: ConjugationMode } {
	const forms = FAMILY_FORMS[family].filter((f) => (word.forms[f]?.length ?? 0) > 0);
	const key = itemKey(word.id, family);
	const mine = answers.filter((a) => a.drill === CONJUGATION_DRILL && a.item === key);
	const last = mine.at(-1);
	return {
		form: forms[mine.length % Math.max(forms.length, 1)] ?? FAMILY_FORMS[family][0],
		mode: last === undefined || last.grade === 1 ? 'recognise' : 'produce'
	};
}

/** conjugationItems: word × switched-on family, in the words' order, families in family order. */
export function conjugationItems(
	entryIds: readonly number[],
	words: ReadonlyMap<number, ConjugationWord>,
	families: readonly ConjugationFamily[],
	answers: readonly DrillAnswer[]
): DrillItem<ConjugationItemData>[] {
	const out: DrillItem<ConjugationItemData>[] = [];
	for (const id of entryIds) {
		const word = words.get(id);
		if (word === undefined) continue;
		for (const family of families) {
			if (!word.families.includes(family)) continue;
			const { form, mode } = questionOf(word, family, answers);
			if ((word.forms[form]?.length ?? 0) === 0) continue;
			out.push({ key: itemKey(id, family), data: { word, family, form, mode } });
		}
	}
	return out;
}
