import { UTC_CONTEXT } from '$lib/studycore/studyContext';
import { describe, expect, it } from 'vitest';

import { DEFAULT_W } from '$lib/studycore/fsrsParams';
import type { Deck, StudyCard } from '$lib/studycore/types';
import { addDays } from '$lib/time/studyDay';
import { summarizeDecks } from './deckSummaries';
import * as build from '$lib/testing/study';

const NOW = new Date('2026-03-10T12:00:00.000Z');
const day = { dayOf: (ms: number) => new Date(ms).toISOString().slice(0, 10), today: () => '2026-03-10' };
const deck = (id: string, name: string): Deck => ({ id, name, createdAt: '2026-01-01T00:00:00.000Z' });
const card = (n: number, deckIds: string[]): StudyCard => build.card({ id: `c-vocab-${n}`, entryId: n, deckIds });

function summarize(cards: StudyCard[], decks: Deck[], settings = {}) {
	return summarizeDecks({
		decks,
		cards,
		reviews: [],
		deckSettings: settings,
		index: new Map(),
		now: NOW,
		w: DEFAULT_W,
		ctx: { ...UTC_CONTEXT, day: day as never },
		addDays,
		kindsFor: () => ['vocab']
	});
}

describe('summarizeDecks', () => {
	it('lists General only when it holds cards, then decks by name', () => {
		const decks = [deck('b', 'Verbs'), deck('a', 'adjectives')];
		const none = summarize([card(1, ['b'])], decks);
		expect(none.decks.map((d) => d.id)).toEqual(['a', 'b']);
		const withGeneral = summarize([card(1, ['general']), card(2, ['b'])], decks);
		expect(withGeneral.decks.map((d) => d.id)).toEqual(['general', 'a', 'b']);
		expect(withGeneral.decks[0].name).toBe('General');
		expect(withGeneral.overall.words).toBe(2);
	});

	it('flags decks that enable reverse or cloze', () => {
		const settings = { b: { deckId: 'b', cardTypes: ['reverse'], extra: {} } };
		const out = summarize([card(1, ['b'])], [deck('b', 'Verbs')], settings);
		expect(out.decks[0].extras).toBe(true);
		expect(summarize([card(1, ['b'])], [deck('b', 'Verbs')]).decks[0].extras).toBe(false);
	});
});
