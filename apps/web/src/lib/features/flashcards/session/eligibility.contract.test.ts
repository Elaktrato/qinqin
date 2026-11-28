// docs/contracts/cards/eligibility.json: the companion kinds the server answers
// for an entry (POST /api/study/eligibility) are exactly the kinds the cards'
// show-time rules accept (cardFlow.isEligible, with the sentence, cloze and tone
// rules the session page resolves them by). Go decodes the same cases
// (server/internal/eligibility/contract_test.go).

import { describe, expect, it } from 'vitest';
import fixture from '../../../../../../../docs/contracts/cards/eligibility.json';
import { clozeCandidates, resolveClozeShowing, type SegmentLike } from '$lib/exercises/cloze';
import { SERVER_KINDS } from './eligibility.svelte';
import { writableChars } from '$lib/exercises/writing';
import { isEligible, pickSentence, type EntryLike } from './cardFlow';

interface Case {
	name: string;
	entry: {
		id: number;
		language: string;
		kind: string;
		written: string;
		forms: { text: string }[];
		readings: { type: string; value: string }[];
		glosses: number;
	};
	segmentable: boolean;
	sentences: { id: number; hanzi: string }[];
	matchesBySentence: Record<string, SegmentLike[]>;
	strokes: string[];
	kinds: string[];
}

describe('companion eligibility (docs/contracts/cards/eligibility.json)', () => {
	it('has the header', () => {
		expect(fixture.version).toBe(1);
		expect(fixture.rule).toBe('cards/eligibility');
		expect(SERVER_KINDS).toEqual(['sentence', 'writing', 'tone', 'reverse', 'cloze']);
	});

	for (const c of fixture.cases as Case[]) {
		it(c.name, () => {
			const entry: EntryLike = {
				language: c.entry.language,
				written: c.entry.written,
				readings: c.entry.readings,
				kind: c.entry.kind,
				senses: Array.from({ length: c.entry.glosses }, (_, i) => ({ gloss: `g${i}` }))
			};
			const usable = c.sentences.filter((sentence) => sentence.hanzi.trim() !== '');
			// The session page: a companion takes the first usable sentence.
			const hasSentence = pickSentence(usable, new Set()) !== null;
			// The session page segments the candidates; a language the server cannot segment fails there.
			const hasCloze =
				c.segmentable &&
				clozeCandidates(c.sentences).length > 0 &&
				resolveClozeShowing({
					entry: { id: c.entry.id, written: c.entry.written, forms: c.entry.forms },
					sentences: c.sentences,
					matchesOf: (sentence) => c.matchesBySentence[String(sentence.id)] ?? [],
					recorded: 0
				}) !== null;
			// The session page: the characters of the word whose stroke data loads.
			const usableChars = writableChars(c.entry.written).filter((ch) => c.strokes.includes(ch));
			const kinds = SERVER_KINDS.filter((kind) =>
				isEligible(kind, entry, { language: c.entry.language, hasSentence, hasCloze, usableChars })
			);
			expect(kinds).toEqual(c.kinds);
		});
	}
});
