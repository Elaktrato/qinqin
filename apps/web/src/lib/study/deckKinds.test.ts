import { describe, expect, it } from 'vitest';

import { buildLevelQueue, levelPlanCounts } from './levelQueue';
import { deckSessionItems, deckSessionPlan, levelSessionItems } from './cardFlow';
import type { DeckSettings } from './deckSettings';
import { DEFAULT_W } from './fsrs/params';
import { buriedLevelEntries, buriedNow } from './siblings';
import { studyDay } from '../time/studyDay';
import type { OptInKind, ReviewEvent, ReviewGrade, StudyCard, StudyCardKind } from './types';

const NOW = new Date('2026-03-01T12:00:00Z');

function card(
	id: string,
	kind: StudyCardKind,
	entryId: number,
	extra: Partial<StudyCard> = {}
): StudyCard {
	return {
		id,
		kind,
		entryId,
		written: `字${entryId}`,
		deckIds: ['general'],
		createdAt: `2026-01-0${Math.min(entryId, 9)}T00:00:00.000Z`,
		...extra
	};
}

function review(cardId: string, ts: string, grade: ReviewGrade = 3, mode: StudyCardKind = 'vocab'): ReviewEvent {
	return {
		id: `${cardId}-${ts}`,
		workspaceId: 1,
		device: 'web',
		ts,
		type: 'review',
		payload: { cardId, mode, grade }
	};
}

function cfg(deckId: string, ...cardTypes: OptInKind[]): Record<string, DeckSettings> {
	return { [deckId]: { deckId, cardTypes, extra: {} } };
}

const base = {
	reviews: [] as ReviewEvent[],
	deckIds: ['general'],
	kinds: ['reverse'] as StudyCardKind[],
	newLimit: 20,
	reviewLimit: 100,
	now: NOW,
	w: DEFAULT_W,
	language: 'zh'
};
const ids = (items: { cardId: string }[]) => items.map((item) => item.cardId);

describe('existing decks are unchanged', () => {
	const cards = [1, 2, 3].map((n) => card(`c-vocab-${n}`, 'vocab', n));
	const reviews = [review('c-vocab-1', '2026-01-05T00:00:00Z', 1)];
	const scenarios = [
		{ kinds: ['vocab'] },
		{ kinds: ['vocab', 'sentence', 'writing', 'tone'] },
		{ kinds: ['sentence'], newLimit: 2 },
		{ kinds: ['vocab', 'tone'], reviewLimit: 1 },
		{ kinds: ['vocab', 'reverse', 'cloze'] }
	] as { kinds: StudyCardKind[]; newLimit?: number; reviewLimit?: number }[];
	for (const [i, scenario] of scenarios.entries()) {
		it(`scenario ${i}: an empty deckSettings and a studyDay change nothing`, () => {
			const plain = deckSessionPlan({ ...base, cards, reviews, ...scenario });
			const withCfg = deckSessionPlan({
				...base,
				cards,
				reviews,
				...scenario,
				deckSettings: {},
				studyDay: studyDay([])
			});
			expect(withCfg).toEqual(plain);
		});
	}
});

describe('reverse and cloze planning per deck', () => {
	it('plans reverse only for words of a deck that enables it', () => {
		const cards = [
			card('c-vocab-1', 'vocab', 1, { deckIds: ['A'] }),
			card('c-vocab-2', 'vocab', 2, { deckIds: ['B'] }),
			card('c-vocab-3', 'vocab', 3, { deckIds: ['A', 'B'] })
		];
		const items = deckSessionItems({
			...base,
			cards,
			deckIds: ['A', 'B'],
			deckSettings: cfg('A', 'reverse')
		});
		expect(ids(items)).toEqual(['companion:reverse:1', 'companion:reverse:3']);
		// B only in the session: A's switch does not apply to a word seen through B.
		const onlyB = deckSessionItems({ ...base, cards, deckIds: ['B'], deckSettings: cfg('A', 'reverse') });
		expect(onlyB).toEqual([]);
	});

	it('plans nothing opt-in without deckSettings', () => {
		const cards = [card('c-vocab-1', 'vocab', 1)];
		expect(deckSessionItems({ ...base, cards, kinds: ['reverse', 'cloze'] })).toEqual([]);
	});

	it('honours skipKinds', () => {
		const cards = [
			card('c-vocab-1', 'vocab', 1, { skipKinds: ['reverse'] }),
			card('c-vocab-2', 'vocab', 2)
		];
		const items = deckSessionItems({ ...base, cards, deckSettings: cfg('general', 'reverse') });
		expect(ids(items)).toEqual(['companion:reverse:2']);
	});

	it('gives a word whose vocab card is queued no virtual reverse', () => {
		const cards = [card('c-vocab-1', 'vocab', 1), card('c-vocab-2', 'vocab', 2)];
		const reviews = [review('c-vocab-2', '2026-01-05T00:00:00Z', 1)];
		const items = deckSessionItems({
			...base,
			cards,
			reviews,
			kinds: ['vocab', 'reverse'],
			deckSettings: cfg('general', 'reverse')
		});
		expect(ids(items)).toEqual(['c-vocab-2', 'c-vocab-1']);
	});

	it('plans one opt-in item per word, reverse preferred, cloze when reverse is remembered ineligible', () => {
		const cards = [card('c-vocab-1', 'vocab', 1), card('c-vocab-2', 'vocab', 2)];
		const common = { ...base, cards, kinds: ['reverse', 'cloze'] as StudyCardKind[], deckSettings: cfg('general', 'reverse', 'cloze') };
		expect(ids(deckSessionItems(common))).toEqual(['companion:reverse:1', 'companion:reverse:2']);
		expect(ids(deckSessionItems({ ...common, skip: new Set(['reverse:1']) }))).toEqual([
			'companion:reverse:2',
			'companion:cloze:1'
		]);
		// Only cloze enabled: cloze for both.
		expect(
			ids(deckSessionItems({ ...common, deckSettings: cfg('general', 'cloze') }))
		).toEqual(['companion:cloze:1', 'companion:cloze:2']);
	});

	it('cloze is planned when the reverse card exists but is not due', () => {
		const cards = [card('c-vocab-1', 'vocab', 1), card('c-reverse-1', 'reverse', 1)];
		const reviews = [review('c-reverse-1', '2026-02-28T00:00:00Z', 4, 'reverse')];
		const items = deckSessionItems({
			...base,
			cards,
			reviews,
			now: new Date('2026-03-02T12:00:00Z'),
			kinds: ['reverse', 'cloze'],
			deckSettings: cfg('general', 'reverse', 'cloze')
		});
		expect(ids(items)).toEqual(['companion:cloze:1']);
	});

	it('does not queue a real reverse card of a deck with reverse switched off', () => {
		const cards = [card('c-vocab-1', 'vocab', 1), card('c-reverse-1', 'reverse', 1)];
		expect(deckSessionItems({ ...base, cards, deckSettings: cfg('other', 'reverse') })).toEqual([]);
		expect(ids(deckSessionItems({ ...base, cards, deckSettings: cfg('general', 'reverse') }))).toEqual([
			'c-reverse-1'
		]);
	});

	it('a disallowed real card does not use a review slot', () => {
		const cards = [
			card('c-reverse-1', 'reverse', 1, { createdAt: '2026-01-01T00:00:00Z' }),
			card('c-vocab-2', 'vocab', 2, { createdAt: '2026-01-02T00:00:00Z' })
		];
		const reviews = [
			review('c-reverse-1', '2026-01-05T00:00:00Z', 1, 'reverse'),
			review('c-vocab-2', '2026-01-06T00:00:00Z', 1)
		];
		const items = deckSessionItems({
			...base,
			cards,
			reviews,
			kinds: ['vocab', 'reverse'],
			reviewLimit: 1,
			deckSettings: {}
		});
		expect(ids(items)).toEqual(['c-vocab-2']);
	});
});

describe('burying in deck sessions', () => {
	const cards = [
		card('c-vocab-1', 'vocab', 1),
		card('c-reverse-1', 'reverse', 1),
		card('c-vocab-2', 'vocab', 2)
	];

	it('an answer today removes the word\'s opt-in items (real and virtual)', () => {
		const reviews = [review('c-vocab-1', '2026-03-01T08:00:00Z', 3)];
		const items = deckSessionItems({
			...base,
			cards,
			reviews,
			kinds: ['reverse', 'cloze'],
			deckSettings: cfg('general', 'reverse', 'cloze')
		});
		// entry 1 is buried (real reverse, virtual cloze); entry 2 gets one virtual item.
		expect(ids(items)).toEqual(['companion:reverse:2']);
	});

	it('the next learner day lifts it', () => {
		const reviews = [review('c-vocab-1', '2026-03-01T08:00:00Z', 3)];
		const items = deckSessionItems({
			...base,
			cards,
			reviews,
			now: new Date('2026-03-02T08:00:00Z'),
			kinds: ['reverse'],
			deckSettings: cfg('general', 'reverse')
		});
		expect(ids(items)).toEqual(['c-reverse-1', 'companion:reverse:2']);
	});

	it('a reverse answered today also drops the virtual legacy companions of the word', () => {
		const c = [card('c-vocab-1', 'vocab', 1), card('c-reverse-1', 'reverse', 1)];
		const reviews = [review('c-reverse-1', '2026-03-01T08:00:00Z', 3, 'reverse')];
		const items = deckSessionItems({
			...base,
			cards: c,
			reviews,
			kinds: ['writing', 'tone'],
			deckSettings: cfg('general', 'reverse')
		});
		expect(items).toEqual([]);
	});

	it('legacy pairs still show together (vocab then writing answered today)', () => {
		const c = [card('c-vocab-1', 'vocab', 1)];
		const reviews = [review('c-vocab-1', '2026-03-01T08:00:00Z', 3)];
		const items = deckSessionItems({ ...base, cards: c, reviews, kinds: ['writing'] });
		expect(ids(items)).toEqual(['companion:writing:1']);
	});
});

describe('burying in level sessions', () => {
	it('a vocab card buried by a reverse answered today is neither queued nor virtual; the next word takes its slot', () => {
		const cards = [card('c-vocab-1', 'vocab', 1), card('c-reverse-1', 'reverse', 1)];
		const reviews = [review('c-reverse-1', '2026-03-01T08:00:00Z', 3, 'reverse')];
		const buried = buriedNow({ cards, reviews, now: NOW, studyDay: studyDay([]) });
		const excludeEntries = buriedLevelEntries(buried, cards);
		expect([...excludeEntries]).toEqual([1]);
		const entries = [1, 2, 3].map((id) => ({ id, kind: 'word' }));
		const queue = buildLevelQueue({
			entries,
			cards,
			reviews,
			newLimit: 2,
			reviewLimit: 10,
			now: NOW,
			w: DEFAULT_W,
			excludeEntries
		});
		expect(queue.map((item) => item.entryId)).toEqual([2, 3]);
		// levelSessionItems also drops anything buried that slipped in.
		const plain = buildLevelQueue({ entries, cards, reviews, newLimit: 3, reviewLimit: 10, now: NOW, w: DEFAULT_W });
		expect(
			levelSessionItems(plain, cards, ['vocab'], buried).map((item) => item.entryId)
		).toEqual([2, 3]);
	});
});

describe('level exclusion only follows vocab and writing', () => {
	for (const sibling of ['reverse', 'cloze'] as const) {
		it(`answering vocab while a ${sibling} card exists does not hide the word from a level session`, () => {
			const cards = [card('c-vocab-5', 'vocab', 5), card(`c-${sibling}-5`, sibling, 5)];
			const reviews = [review('c-vocab-5', '2026-03-01T08:00:00Z', 3)];
			const buried = buriedNow({ cards, reviews, now: NOW, studyDay: studyDay([]) });
			expect(buried.cardIds.has(`c-${sibling}-5`)).toBe(true);
			expect([...buriedLevelEntries(buried, cards)]).toEqual([]);
		});
	}

	it('answering a reverse card hides the word (its vocab card is buried)', () => {
		const cards = [card('c-vocab-5', 'vocab', 5), card('c-reverse-5', 'reverse', 5)];
		const reviews = [review('c-reverse-5', '2026-03-01T08:00:00Z', 3, 'reverse')];
		const buried = buriedNow({ cards, reviews, now: NOW, studyDay: studyDay([]) });
		expect([...buriedLevelEntries(buried, cards)]).toEqual([5]);
	});
});

describe('orphan opt-in cards', () => {
	it('a reverse card without a live vocab row of its word is not queued', () => {
		const cards = [card('c-reverse-1', 'reverse', 1), card('c-vocab-2', 'vocab', 2), card('c-reverse-2', 'reverse', 2)];
		const items = deckSessionItems({
			...base,
			cards,
			deckSettings: cfg('general', 'reverse')
		});
		expect(ids(items)).toEqual(['c-reverse-2']);
	});
});

describe('level counts leave buried words out', () => {
	it('levelPlanCounts honours excludeEntries', () => {
		const entries = [1, 2, 3].map((id) => ({ id, kind: 'word' }));
		const options = { entries, cards: [], reviews: [], now: NOW, w: DEFAULT_W };
		expect(levelPlanCounts(options).items).toBe(3);
		expect(levelPlanCounts({ ...options, excludeEntries: new Set([2]) }).items).toBe(2);
	});
});
