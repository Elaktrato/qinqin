import { describe, expect, it } from 'vitest';

import fixture from '../../../../../../../docs/contracts/cards/card-ids.json';
import { newCardId } from '$lib/studycore/canonical';
import { COMPANION_PREFIX } from './companions';
import { BASE_XP } from '$lib/studycore/exp';
import { cardKey, parseReview } from '$lib/studycore/reviewParse';
import { CARD_KINDS, OPT_IN_KINDS, type StudyCardKind } from '$lib/studycore/types';

interface Case {
	kind: StudyCardKind;
	entryId: number;
	sentenceId?: number;
	id: string;
	cardKey: string;
	virtualId?: string;
}

describe('card ids contract', () => {
	for (const c of fixture.cases as Case[]) {
		it(`${c.kind} ${c.entryId}`, () => {
			expect(newCardId(c.kind, c.entryId)).toBe(c.id);
			expect(cardKey(c.kind, c.entryId, c.sentenceId)).toBe(c.cardKey);
			if (c.virtualId !== undefined) {
				expect(`${COMPANION_PREFIX}${c.kind}:${c.entryId}`).toBe(c.virtualId);
			}
		});
	}

	it('keeps the global kind order', () => {
		expect([...CARD_KINDS]).toEqual(['vocab', 'sentence', 'writing', 'tone', 'reverse', 'cloze']);
		expect([...OPT_IN_KINDS]).toEqual(['reverse', 'cloze']);
	});

	it('has base XP for all six kinds', () => {
		for (const kind of CARD_KINDS) expect(typeof BASE_XP[kind]).toBe('number');
		expect(BASE_XP.reverse).toBe(10);
		expect(BASE_XP.cloze).toBe(15);
	});

	it('parseReview keeps the new modes', () => {
		for (const mode of ['reverse', 'cloze']) {
			const event = {
				id: 'e1',
				workspaceId: 1,
				device: 'd',
				ts: '2026-01-01T00:00:00Z',
				type: 'review',
				payload: { cardId: 'c-x', grade: 3, mode }
			};
			expect(parseReview(event as never)?.payload.mode).toBe(mode);
		}
	});
});
