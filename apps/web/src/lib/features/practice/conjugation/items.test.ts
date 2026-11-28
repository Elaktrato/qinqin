// The drill's items: the learner's studied Japanese words × the families switched on, and how each is asked.
import { describe, expect, it } from 'vitest';
import type { DrillAnswer } from '$lib/studycore/drills';
import type { StudyHistory } from '$lib/studycore/types';
import { conjugationItems, itemKey, parseItemKey, questionOf, studiedEntryIds } from './items';
import type { ConjugationWord } from './words';

const ans = (written: string, reading: string) => [{ written, reading, romaji: '' }];
function word(id: number, written: string, families: string[], forms: Record<string, ReturnType<typeof ans>>): ConjugationWord {
	return { id, class: 'v1', written, reading: written, readings: [], families, forms };
}
const miru = word(7, '見る', ['polite', 'past', 'te-form'], {
	polite: ans('見ます', 'みます'),
	'polite-negative': ans('見ません', 'みません'),
	'polite-volitional': ans('見ましょう', 'みましょう'),
	past: ans('見た', 'みた'),
	'past-negative': ans('見なかった', 'みなかった'),
	te: ans('見て', 'みて')
});
const takai = word(9, '高い', ['polite', 'past'], { polite: ans('高いです', 'たかいです'), past: ans('高かった', 'たかかった') });

function review(n: number, cardId: string, ts: string) {
	return { id: `r${n}`, workspaceId: 1, ts, type: 'review' as const, payload: { cardId, mode: 'vocab' as const, grade: 3 as const } };
}
function card(id: string, entryId: number, entryKind?: 'character') {
	return { id, kind: 'vocab' as const, entryId, deckIds: ['d'], createdAt: '2026-11-01T00:00:00Z', ...(entryKind ? { entryKind } : {}) };
}
function answer(n: number, item: string, grade: 1 | 2 | 3 | 4, mode = 'produce'): DrillAnswer {
	return { id: `a${n}`, workspaceId: 1, ts: '', at: n, drill: 'conjugation', item, mode, grade };
}

const history = {
	decks: [],
	cards: [card('c-takai', 9), card('c-miru', 7), card('c-new', 11), card('c-char', 12, 'character')],
	reviews: [review(2, 'c-takai', '2026-11-10T00:00:00Z'), review(1, 'c-miru', '2026-11-09T00:00:00Z'), review(3, 'c-takai', '2026-11-08T00:00:00Z'), review(4, 'c-char', '2026-11-01T00:00:00Z')],
	merged: 0,
	grammarRuns: [],
	courseEvents: []
} as unknown as StudyHistory;

describe('the conjugation items', () => {
	it('keys an item by entry and family', () => {
		expect(itemKey(7, 'te-form')).toBe('7:te-form');
		expect(parseItemKey('7:te-form')).toEqual({ entryId: 7, family: 'te-form' });
		expect(parseItemKey('x:te-form')).toBeNull();
		expect(parseItemKey('7:imperative')).toBeNull();
		expect(parseItemKey('7')).toBeNull();
	});

	it('takes the words with a review, first reviewed first; never a character entry or an unreviewed card', () => {
		expect(studiedEntryIds(history)).toEqual([9, 7]);
	});

	it('pairs each word with the families switched on that it has, in family order', () => {
		const items = conjugationItems([9, 7, 11], new Map([[7, miru], [9, takai]]), ['polite', 'te-form', 'potential'], []);
		expect(items.map((i) => i.key)).toEqual(['9:polite', '7:polite', '7:te-form']);
	});

	it('asks a new item to be recognised, then produced, rotating through the family forms', () => {
		expect(questionOf(miru, 'polite', [])).toEqual({ form: 'polite', mode: 'recognise' });
		expect(questionOf(miru, 'polite', [answer(1, '7:polite', 3, 'recognise')])).toEqual({ form: 'polite-negative', mode: 'produce' });
		expect(questionOf(miru, 'polite', [answer(1, '7:polite', 3), answer(2, '7:polite', 3)])).toEqual({ form: 'polite-volitional', mode: 'produce' });
		expect(questionOf(miru, 'polite', [answer(1, '7:polite', 3), answer(2, '7:polite', 3), answer(3, '7:polite', 1)])).toEqual({ form: 'polite', mode: 'recognise' });
		// A family form the word does not have is skipped (高い has no ましょう).
		expect(questionOf(takai, 'polite', [answer(1, '9:polite', 3)]).form).toBe('polite');
	});

	it('carries the word and the question in the item', () => {
		const [item] = conjugationItems([7], new Map([[7, miru]]), ['te-form'], [answer(1, '7:te-form', 3), answer(2, '8:te-form', 1)]);
		expect(item.data).toEqual({ word: miru, family: 'te-form', form: 'te', mode: 'produce' });
	});
});
