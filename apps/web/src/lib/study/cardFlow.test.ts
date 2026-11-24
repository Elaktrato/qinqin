import { IDENTITY_CLOCK } from '$lib/study/studyClock';
import { contextFor, NO_LIMIT_ROWS, UTC_CONTEXT, type LimitRows, type StudyContext } from '$lib/study/studyContext';
import { describe, expect, it } from 'vitest';

import deckSessionFixture from '../../../../../docs/contracts/cards/deck-session.json';
import { studyDay, type ZoneChange } from '../time/studyDay';
import { DEFAULT_W } from './fsrs/params';
import {
	cardedSentenceIds,
	deckSessionItems,
	deckSessionPlan,
	dropItem,
	buryAfterAnswer,
	clozeDistractorPool,
	revealsOnKey,
	isChinese,
	isEligible,
	levelSessionItems,
	pickSentence,
	rememberDrop,
	resolveSentence,
	reviewCountFor,
	sessionCounts,
	shouldIgnoreGrade,
	tierForCard
} from './cardFlow';
import { backfillLimit } from './sessionQueue';
import type { DeckSessionOptions, DeckSessionPlan, EligibilityContext, EntryLike, FlowItem } from './cardFlow';
import type { LimitPair } from './limits';
import type { Run } from './vacation';
import type { LevelQueueItem } from './levelQueue';
import type { OptInKind, ReviewEvent, ReviewGrade, StudyCard, StudyCardKind } from './types';
import * as build from '$lib/testing/study';

function card(
	id: string,
	kind: StudyCardKind,
	entryId: number,
	opts: { written?: string; sentenceId?: number; deckIds?: string[]; createdAt?: string } = {}
): StudyCard {
	return build.card({
		id,
		kind,
		entryId,
		written: opts.written ?? '学习',
		deckIds: opts.deckIds,
		createdAt: opts.createdAt,
		sentenceId: opts.sentenceId
	});
}

function review(cardId: string, ts: string, grade: ReviewGrade = 3, id = `${cardId}-${ts}`): ReviewEvent {
	return build.review({ cardId, ts, grade, id });
}

const zhEntry = {
	language: 'zh',
	written: '学习',
	readings: [{ type: 'pinyin', value: 'xué xí' }]
};

describe('pickSentence', () => {
	it('returns the first sentence without a card', () => {
		const sentences = [{ id: 1 }, { id: 2 }, { id: 3 }];
		expect(pickSentence(sentences, new Set([1]))).toEqual({ id: 2 });
		expect(pickSentence(sentences, new Set())).toEqual({ id: 1 });
	});

	it('returns null when every sentence has a card or there are none', () => {
		expect(pickSentence([{ id: 1 }, { id: 2 }], new Set([1, 2]))).toBeNull();
		expect(pickSentence([], new Set())).toBeNull();
	});
});

describe('cardedSentenceIds', () => {
	it('collects the sentence ids of sentence cards for one entry only', () => {
		const cards = [
			card('a', 'sentence', 1, { sentenceId: 10 }),
			card('b', 'sentence', 2, { sentenceId: 20 }),
			card('c', 'vocab', 1, { sentenceId: 11 }),
			card('d', 'sentence', 1)
		];
		expect([...cardedSentenceIds(cards, 1)]).toEqual([10]);
	});
});

describe('isEligible', () => {
	it('always accepts vocab', () => {
		expect(isEligible('vocab', zhEntry, { language: 'ja', hasSentence: false })).toBe(true);
	});

	it('needs a sentence for sentence cards', () => {
		expect(isEligible('sentence', zhEntry, { language: 'zh', hasSentence: true })).toBe(true);
		expect(isEligible('sentence', zhEntry, { language: 'zh', hasSentence: false })).toBe(false);
	});

	it('needs at least one usable character for writing cards', () => {
		expect(
			isEligible('writing', zhEntry, { language: 'zh', hasSentence: false, usableChars: ['学'] })
		).toBe(true);
		expect(
			isEligible('writing', zhEntry, { language: 'ja', hasSentence: false, usableChars: [] })
		).toBe(false);
		expect(isEligible('writing', zhEntry, { language: 'zh', hasSentence: false })).toBe(false);
	});

	it('needs Chinese and a clean pinyin reading for tone cards', () => {
		expect(isEligible('tone', zhEntry, { language: 'zh', hasSentence: false })).toBe(true);
		expect(isEligible('tone', zhEntry, { language: 'zh-Hant', hasSentence: false })).toBe(true);
		expect(isEligible('tone', zhEntry, { language: 'ja', hasSentence: false })).toBe(false);
		expect(
			isEligible(
				'tone',
				{ ...zhEntry, readings: [{ type: 'bopomofo', value: 'ㄒㄩㄝˊ' }] },
				{ language: 'zh', hasSentence: false }
			)
		).toBe(false);
		expect(
			isEligible(
				'tone',
				{ ...zhEntry, readings: [{ type: 'pinyin', value: 'xue2 xi2' }] },
				{ language: 'zh', hasSentence: false }
			)
		).toBe(false);
	});
});

describe('helpers', () => {
	it('isChinese matches zh and its regional tags only', () => {
		expect(isChinese('zh')).toBe(true);
		expect(isChinese('ZH_tw')).toBe(true);
		expect(isChinese('ja')).toBe(false);
		expect(isChinese('')).toBe(false);
	});

	it('reviewCountFor counts valid reviews of one card', () => {
		const reviews = [
			review('a', '2026-01-01T00:00:00Z'),
			review('a', '2026-01-02T00:00:00Z'),
			review('b', '2026-01-02T00:00:00Z')
		];
		expect(reviewCountFor('a', reviews)).toBe(2);
		expect(reviewCountFor(null, reviews)).toBe(0);
	});

	it('tierForCard is T0 for new or virtual cards and rises with stability', () => {
		const now = new Date('2027-06-01T00:00:00Z');
		expect(tierForCard(null, [], now, DEFAULT_W, IDENTITY_CLOCK)).toBe(0);
		expect(tierForCard('a', [], now, DEFAULT_W, IDENTITY_CLOCK)).toBe(0);
		// A long run of Good reviews spaced far apart builds large stability.
		const reviews = [
			review('a', '2026-01-01T00:00:00Z', 4),
			review('a', '2026-02-01T00:00:00Z', 4),
			review('a', '2026-05-01T00:00:00Z', 4),
			review('a', '2026-12-01T00:00:00Z', 4)
		];
		expect(tierForCard('a', reviews, now, DEFAULT_W, IDENTITY_CLOCK)).toBe(2);
	});

});

describe('deckSessionItems', () => {
	const now = new Date('2026-03-01T00:00:00Z');
	const cards = [
		card('v1', 'vocab', 1, { written: '学习', createdAt: '2026-01-01T00:00:00Z' }),
		card('v2', 'vocab', 2, { written: 'ひらがな', createdAt: '2026-01-02T00:00:00Z' }),
		card('v3', 'vocab', 3, { written: '中文', createdAt: '2026-01-03T00:00:00Z' })
	];
	const base = {
		ctx: UTC_CONTEXT,
		cards,
		reviews: [] as ReviewEvent[],
		deckIds: ['general'],
		newLimit: 20,
		reviewLimit: 100,
		now,
		w: DEFAULT_W,
		language: 'zh'
	};

	it('honours the selected kinds: a tone-only session has no vocab items', () => {
		const items = deckSessionItems({ ...base, kinds: ['tone'] });
		expect(items.every((item) => item.kind === 'tone')).toBe(true);
		expect(items.map((item) => item.entryId)).toEqual([1, 2, 3]);
		expect(items.every((item) => item.virtual && item.card === null)).toBe(true);
	});

	it('vocab-only sessions plan no companions', () => {
		const items = deckSessionItems({ ...base, kinds: ['vocab'] });
		expect(items.map((item) => item.cardId)).toEqual(['v1', 'v2', 'v3']);
		expect(items.every((item) => !item.virtual && item.card !== null)).toBe(true);
	});

	it('drops tone outside Chinese workspaces', () => {
		expect(deckSessionItems({ ...base, kinds: ['tone'], language: 'ja' })).toEqual([]);
	});

	it('skips writing companions for words without Han characters', () => {
		const items = deckSessionItems({ ...base, kinds: ['writing'] });
		expect(items.map((item) => item.entryId)).toEqual([1, 3]);
		expect(items[0]).toMatchObject({ kind: 'writing', written: '学习', deckIds: ['general'] });
	});

	it('shares the new-card limit between new cards and companions', () => {
		const items = deckSessionItems({ ...base, kinds: ['vocab', 'sentence'], newLimit: 4 });
		expect(items.map((item) => item.cardId)).toEqual([
			'v1',
			'v2',
			'v3',
			'companion:sentence:1'
		]);
	});

	it('reviews do not use up the new-card budget', () => {
		const reviews = [review('v1', '2026-01-05T00:00:00Z', 1)];
		const items = deckSessionItems({ ...base, reviews, kinds: ['vocab', 'sentence'], newLimit: 3 });
		expect(items.map((item) => item.cardId)).toEqual([
			'v1',
			'v2',
			'v3',
			'companion:sentence:1'
		]);
	});

	it('includes existing companion cards of a selected kind and does not replan them', () => {
		const existing = [...cards, card('s1', 'sentence', 1, { sentenceId: 7 })];
		const items = deckSessionItems({ ...base, cards: existing, kinds: ['sentence'] });
		expect(items.map((item) => item.cardId)).toEqual([
			's1',
			'companion:sentence:2',
			'companion:sentence:3'
		]);
		expect(items[0]).toMatchObject({ kind: 'sentence', virtual: false, sentenceId: 7 });
	});
});

describe('Round 1 cards without a written snapshot', () => {
	it('get companions of every kind, writing included (checked when shown)', () => {
		const legacy: StudyCard = { id: 'old', kind: 'vocab', entryId: 5, deckIds: ['general'], createdAt: '2025-01-01T00:00:00Z' };
		const items = deckSessionItems({ ctx: UTC_CONTEXT, w: DEFAULT_W,
			cards: [legacy],
			reviews: [],
			deckIds: ['general'],
			kinds: ['writing', 'tone'],
			newLimit: 10,
			reviewLimit: 10,
			now: new Date('2026-03-01T00:00:00Z'),
			language: 'zh'
		});
		expect(items.map((item) => item.cardId)).toEqual(['companion:writing:5', 'companion:tone:5']);
		expect(items[0].written).toBeUndefined();
	});
});

describe('deckSessionPlan offline', () => {
	const now = new Date('2026-03-01T00:00:00Z');
	const cards = [1, 2, 3].map((n) => card(`v${n}`, 'vocab', n, { createdAt: `2026-01-0${n}T00:00:00Z` }));
	const options = {
		ctx: UTC_CONTEXT,
		cards,
		reviews: [] as ReviewEvent[],
		deckIds: ['general'],
		kinds: ['vocab', 'sentence'] as StudyCardKind[],
		newLimit: 10,
		reviewLimit: 100,
		now,
		w: DEFAULT_W,
		language: 'zh'
	};

	it('keeps real cards, drops every virtual companion, and leaves no reserve', () => {
		const online = deckSessionPlan(options);
		expect(online.queue.some((item) => item.virtual)).toBe(true);
		const offline = deckSessionPlan({ ...options, offline: true });
		expect(offline.queue.every((item) => !item.virtual)).toBe(true);
		expect(offline.queue.map((item) => item.cardId)).toEqual(['v1', 'v2', 'v3']);
		expect(offline.reserve).toEqual([]);
	});
});

describe('deckSessionPlan and dropItem', () => {
	const now = new Date('2026-03-01T00:00:00Z');
	// Words 1 and 2 (oldest) have no sentences; 3 and 4 do.
	const cards = [1, 2, 3, 4].map((entryId) =>
		card(`v${entryId}`, 'vocab', entryId, { createdAt: `2026-01-0${entryId}T00:00:00Z` })
	);
	const options = {
		ctx: UTC_CONTEXT,
		cards,
		reviews: [] as ReviewEvent[],
		deckIds: ['general'],
		kinds: ['sentence'] as StudyCardKind[],
		newLimit: 2,
		reviewLimit: 100,
		now,
		w: DEFAULT_W,
		language: 'zh'
	};

	it('caps companions in the queue at the budget and keeps the rest in reserve', () => {
		const plan = deckSessionPlan(options);
		expect(plan.queue.map((item) => item.entryId)).toEqual([1, 2]);
		expect(plan.reserve.map((item) => item.entryId)).toEqual([3, 4]);
		expect(deckSessionItems(options)).toEqual(plan.queue);
	});

	it('backfills a dropped companion from the reserve so eligible words still come up', () => {
		let state = deckSessionPlan(options);
		state = dropItem(state, 'companion:sentence:1');
		state = dropItem(state, 'companion:sentence:2');
		expect(state.queue.map((item) => item.entryId)).toEqual([3, 4]);
		expect(state.reserve).toEqual([]);
	});

	it('does not backfill when a real card is dropped', () => {
		const existing = [...cards, card('s9', 'sentence', 9, { sentenceId: 1 })];
		let state = deckSessionPlan({ ...options, cards: existing, newLimit: 1 });
		expect(state.queue.map((item) => item.cardId)).toEqual(['s9']);
		const reserve = state.reserve.length;
		state = dropItem(state, 's9');
		expect(state.queue).toEqual([]);
		expect(state.reserve).toHaveLength(reserve);
	});

	it('leaves the state alone for an unknown id', () => {
		const plan = deckSessionPlan(options);
		expect(dropItem(plan, 'nope')).toEqual(plan);
	});

	it('study all ignores the session and deck daily limits', () => {
		const limited = contextFor(UTC_CONTEXT.day, [], now.getTime(), [], {
			workspace: { new: 0, reviews: 0 },
			decks: { general: { new: 1, reviews: 1 } },
			existingDecks: null
		});
		const base = { ...options, ctx: limited, kinds: ['vocab'] as StudyCardKind[], newLimit: 0, reviewLimit: 0 };
		expect(deckSessionPlan(base).queue).toHaveLength(0);
		expect(deckSessionPlan({ ...base, studyAll: true }).queue.map((item) => item.cardId)).toEqual([
			'v1',
			'v2',
			'v3',
			'v4'
		]);
	});
});

describe('deckSessionPlan on the shared builder (#175)', () => {
	const now = new Date('2026-03-01T00:00:00Z');
	const words = (n: number) =>
		Array.from({ length: n }, (_, i) =>
			card(`v${String(i + 1).padStart(2, '0')}`, 'vocab', i + 1, { createdAt: `2026-01-01T00:00:${String(i).padStart(2, '0')}Z` })
		);
	const base = {
		ctx: UTC_CONTEXT,
		reviews: [] as ReviewEvent[],
		deckIds: ['general'],
		newLimit: 5,
		reviewLimit: 100,
		now,
		w: DEFAULT_W,
		language: 'zh'
	};

	it('Study all queues every new card, past the default 20 new per deck', () => {
		const cards = words(25);
		const plan = deckSessionPlan({ ...base, cards, kinds: ['vocab'], studyAll: true });
		expect(plan.queue).toHaveLength(25);
		expect(deckSessionPlan({ ...base, cards, kinds: ['vocab'] }).queue).toHaveLength(5);
	});

	it('the reserve never holds more than a session can draw (backfillLeft)', () => {
		const unlimited = contextFor(UTC_CONTEXT.day, [], now.getTime(), [], {
			workspace: { new: null, reviews: null },
			decks: {},
			existingDecks: null
		});
		const plan = deckSessionPlan({ ...base, ctx: unlimited, cards: words(40), kinds: ['vocab', 'sentence'], newLimit: 0 });
		expect(plan.queue).toEqual([]);
		expect(plan.backfillLeft).toBe(30);
		expect(plan.reserve).toHaveLength(30);
	});

	it('Study all backfills without a bound', () => {
		const plan = deckSessionPlan({ ...base, cards: words(2), kinds: ['vocab'], studyAll: true });
		expect(plan.backfillLeft).toBe(1_000_000);
	});
});

describe('levelSessionItems', () => {
	const cards = [card('v1', 'vocab', 1)];
	const queue: LevelQueueItem[] = [
		{ cardId: 'v1', entryId: 1, virtual: false, kind: 'vocab' },
		{ cardId: 'level:2', entryId: 2, virtual: true, kind: 'vocab' }
	];

	it('maps level items to vocab flow items', () => {
		const items = levelSessionItems(queue, cards, ['vocab', 'tone']);
		expect(items).toEqual([
			{ cardId: 'v1', kind: 'vocab', entryId: 1, virtual: false, card: cards[0], written: '学习' },
			{ cardId: 'level:2', kind: 'vocab', entryId: 2, virtual: true, card: null }
		]);
	});

	it('is empty when no selected kind applies', () => {
		expect(levelSessionItems(queue, cards, ['tone'])).toEqual([]);
	});

	it('maps a virtual writing item to a writing flow item', () => {
		const items = levelSessionItems(
			[{ cardId: 'level:writing:11', entryId: 11, virtual: true, kind: 'writing' }],
			[],
			['vocab', 'writing']
		);
		expect(items).toEqual([
			{
				cardId: 'level:writing:11',
				kind: 'writing',
				entryId: 11,
				virtual: true,
				card: null,
				deckIds: ['general']
			}
		]);
	});

	it('drops items whose kind is not selected', () => {
		const mixed: LevelQueueItem[] = [
			{ cardId: 'level:writing:11', entryId: 11, virtual: true, kind: 'writing' },
			{ cardId: 'level:12', entryId: 12, virtual: true, kind: 'vocab' }
		];
		expect(levelSessionItems(mixed, [], ['writing']).map((i) => i.cardId)).toEqual([
			'level:writing:11'
		]);
	});
});

describe('sessionCounts', () => {
	it('splits due and new and counts per kind', () => {
		const now = new Date('2026-03-01T00:00:00Z');
		const cards = [card('v1', 'vocab', 1), card('v2', 'vocab', 2)];
		const reviews = [review('v1', '2026-01-05T00:00:00Z', 1)];
		const items = deckSessionItems({ ctx: UTC_CONTEXT, w: DEFAULT_W,
			cards,
			reviews,
			deckIds: ['general'],
			newLimit: 10,
			reviewLimit: 10,
			now,
			language: 'zh',
			kinds: ['vocab', 'tone']
		});
		expect(sessionCounts(items, reviews)).toEqual({
			due: 1,
			fresh: 3,
			byKind: { vocab: 2, sentence: 0, writing: 0, tone: 2, reverse: 0, cloze: 0 }
		});
	});
});

describe('shouldIgnoreGrade', () => {
	const base = { now: 1_000, focusedAt: 900, hadSuggestion: true };

	it('ignores a keyboard activation of the just-focused suggestion (held Enter/Space)', () => {
		expect(shouldIgnoreGrade({ ...base, source: 'activation' })).toBe(true);
	});

	it('accepts the activation once the focus has settled', () => {
		expect(shouldIgnoreGrade({ ...base, now: 1_300, source: 'activation' })).toBe(false);
	});

	it('never ignores digit keys or pointer clicks', () => {
		expect(shouldIgnoreGrade({ ...base, source: 'key-digit' })).toBe(false);
		expect(shouldIgnoreGrade({ ...base, source: 'click' })).toBe(false);
	});

	it('never guards a card without a suggestion (vocab) or before the focus moved', () => {
		expect(shouldIgnoreGrade({ ...base, hadSuggestion: false, source: 'activation' })).toBe(false);
		expect(shouldIgnoreGrade({ ...base, focusedAt: null, source: 'activation' })).toBe(false);
	});
});

describe('backfill bound', () => {
	const now = new Date('2026-03-01T00:00:00Z');
	const many = Array.from({ length: 40 }, (_, i) =>
		card(`v${i + 1}`, 'vocab', i + 1, {
			createdAt: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString()
		})
	);
	// Unlimited daily limits: this block tests the backfill bound, not the allowance.
	const options = {
		ctx: { ...UTC_CONTEXT, limits: { workspace: { new: null, reviews: null }, decks: {}, existingDecks: null } },
		cards: many,
		reviews: [] as ReviewEvent[],
		deckIds: ['general'],
		kinds: ['sentence'] as StudyCardKind[],
		newLimit: 2,
		reviewLimit: 100,
		now,
		w: DEFAULT_W,
		language: 'zh'
	};

	it('is max(30, 2 x newLimit)', () => {
		expect(backfillLimit(2)).toBe(30);
		expect(backfillLimit(20)).toBe(40);
		expect(backfillLimit(Number.NaN)).toBe(30);
	});

	it('stops replacing dropped companions after the bound', () => {
		let state = deckSessionPlan(options);
		expect(state.backfillLeft).toBe(30);
		let drops = 0;
		while (state.queue.length > 0) {
			state = dropItem(state, state.queue[0].cardId);
			drops += 1;
		}
		// Two in the queue plus thirty replacements, then the session ends.
		expect(drops).toBe(32);
		expect(state.backfillLeft).toBe(0);
		// The reserve held only what the bound lets a session draw (#175).
		expect(state.reserve.length).toBe(0);
	});

	it('skips remembered ineligible companions at planning time', () => {
		const plan = deckSessionPlan({
			...options,
			skip: new Set(['sentence:1', 'sentence:2', 'writing:3'])
		});
		expect(plan.queue.map((item) => item.entryId)).toEqual([3, 4]);
		expect(plan.reserve[0].entryId).toBe(5);
	});
});

describe('writing needs glosses for character entries', () => {
	const kanji = { language: 'ja', written: '学', readings: [], kind: 'character' };
	const ctx = { language: 'ja', hasSentence: false, usableChars: ['学'] };

	it('is ineligible without senses, eligible with them, and unaffected for words', () => {
		expect(isEligible('writing', { ...kanji, senses: [] }, ctx)).toBe(false);
		expect(isEligible('writing', { ...kanji, senses: [{}] }, ctx)).toBe(true);
		expect(isEligible('writing', { ...kanji, kind: 'word', senses: [] }, ctx)).toBe(true);
		expect(isEligible('vocab', { ...kanji, senses: [] }, ctx)).toBe(true);
	});

	it('remembers that drop', () => {
		const item: FlowItem = {
			cardId: 'level:writing:1',
			kind: 'writing',
			entryId: 1,
			virtual: true,
			card: null
		};
		expect(rememberDrop(item, '学', { kind: 'character', senses: [] })).toBe(true);
		expect(rememberDrop(item, '学', { kind: 'character', senses: [{}] })).toBe(false);
	});
});

describe('rememberDrop', () => {
	const virtual = (kind: StudyCardKind): FlowItem => ({
		cardId: `companion:${kind}:1`,
		kind,
		entryId: 1,
		virtual: true,
		card: null
	});

	it('remembers definitive drops of companions', () => {
		expect(rememberDrop(virtual('sentence'), '学习')).toBe(true);
		expect(rememberDrop(virtual('tone'), '学习')).toBe(true);
		expect(rememberDrop(virtual('writing'), 'ひらがな')).toBe(true);
	});

	it('does not remember writing drops that may come from a stroke-data network error', () => {
		expect(rememberDrop(virtual('writing'), '学习')).toBe(false);
	});

	it('never remembers real cards', () => {
		const real = { ...virtual('sentence'), virtual: false, cardId: 's1' };
		expect(rememberDrop(real, '学习')).toBe(false);
	});
});

describe('resolveSentence', () => {
	const sentences = [{ id: 1 }, { id: 2 }, { id: 3 }];
	const real = (sentenceId?: number): FlowItem => ({
		cardId: 's',
		kind: 'sentence',
		entryId: 1,
		virtual: false,
		card: card('s', 'sentence', 1, { sentenceId }),
		...(sentenceId === undefined ? {} : { sentenceId })
	});

	it('keeps a real card on its own sentence', () => {
		expect(resolveSentence(real(2), sentences, new Set([1, 2]))).toEqual({ id: 2 });
	});

	it('falls back to the first sentence when the stored one is gone', () => {
		expect(resolveSentence(real(99), sentences, new Set([99]))).toEqual({ id: 1 });
		expect(resolveSentence(real(99), [], new Set())).toBeNull();
	});

	it('gives a companion the first sentence without a card', () => {
		const companion: FlowItem = {
			...real(),
			cardId: 'companion:sentence:1',
			virtual: true,
			card: null
		};
		expect(resolveSentence(companion, sentences, new Set([1]))).toEqual({ id: 2 });
		expect(resolveSentence(companion, sentences, new Set([1, 2, 3]))).toBeNull();
	});
});

describe('buryAfterAnswer', () => {
	function item(cardId: string, kind: StudyCardKind, entryId: number, virtual = false, extra: Partial<FlowItem> = {}): FlowItem {
		return { cardId, kind, entryId, virtual, card: null, ...extra };
	}
	const answered = (kind: StudyCardKind, entryId: number, cardId: string) => ({ kind, entryId, cardId });

	it('removes later items of the word that the answer buries and backfills a virtual one', () => {
		const plan = {
			queue: [
				item('c-vocab-1', 'vocab', 1),
				item('c-vocab-2', 'vocab', 2),
				item('companion:reverse:1', 'reverse', 1, true)
			],
			reserve: [item('companion:sentence:5', 'sentence', 5, true)],
			backfillLeft: 3
		};
		const out = buryAfterAnswer(plan, 0, answered('vocab', 1, 'c-vocab-1'));
		expect(out.buried).toBe(1);
		expect(out.plan.queue.map((i) => i.cardId)).toEqual(['c-vocab-1', 'c-vocab-2', 'companion:sentence:5']);
		expect(out.plan.reserve).toEqual([]);
		expect(out.plan.backfillLeft).toBe(2);
	});

	it('a removed real card frees no slot', () => {
		const plan = {
			queue: [item('c-reverse-1', 'reverse', 1), item('c-vocab-1', 'vocab', 1)],
			reserve: [item('companion:sentence:5', 'sentence', 5, true)],
			backfillLeft: 3
		};
		const out = buryAfterAnswer(plan, 0, answered('reverse', 1, 'c-reverse-1'));
		expect(out.buried).toBe(1);
		expect(out.plan.queue.map((i) => i.cardId)).toEqual(['c-reverse-1']);
		expect(out.plan.reserve).toHaveLength(1);
	});

	it('keeps a pending re-show of the same card and items before the answered index', () => {
		const plan = {
			queue: [
				item('c-reverse-1', 'reverse', 1),
				item('c-vocab-1', 'vocab', 1),
				item('c-reverse-1', 'reverse', 1, false, { reshow: 1 })
			],
			reserve: [],
			backfillLeft: 0
		};
		const out = buryAfterAnswer(plan, 1, answered('vocab', 1, 'c-vocab-1'));
		expect(out.buried).toBe(0);
		expect(out.plan).toEqual(plan);
	});

	it('leaves the legacy pair vocab then writing untouched', () => {
		const plan = {
			queue: [item('c-vocab-1', 'vocab', 1), item('c-writing-1', 'writing', 1)],
			reserve: [],
			backfillLeft: 0
		};
		const out = buryAfterAnswer(plan, 0, answered('vocab', 1, 'c-vocab-1'));
		expect(out.buried).toBe(0);
		expect(out.plan.queue).toHaveLength(2);
	});

	it('removes a backfilled item that is itself buried', () => {
		const plan = {
			queue: [item('c-reverse-1', 'reverse', 1), item('companion:cloze:1', 'cloze', 1, true)],
			reserve: [item('companion:writing:1', 'writing', 1, true), item('companion:tone:9', 'tone', 9, true)],
			backfillLeft: 5
		};
		const out = buryAfterAnswer(plan, 0, answered('reverse', 1, 'c-reverse-1'));
		expect(out.buried).toBe(2);
		expect(out.plan.queue.map((i) => i.cardId)).toEqual(['c-reverse-1', 'companion:tone:9']);
	});
});

describe('eligibility of reverse and cloze', () => {
	const ctx = { language: 'zh', hasSentence: false };
	const word = { ...zhEntry, kind: 'word', senses: [{}] };

	it('reverse needs a word entry with a gloss', () => {
		expect(isEligible('reverse', word, ctx)).toBe(true);
		expect(isEligible('reverse', { ...zhEntry, kind: 'character', senses: [{}] }, ctx)).toBe(false);
		expect(isEligible('reverse', { ...word, senses: [] }, ctx)).toBe(false);
		expect(isEligible('reverse', zhEntry, ctx)).toBe(false);
	});

	it('cloze needs a resolved eligible sentence', () => {
		expect(isEligible('cloze', word, { ...ctx, hasCloze: true })).toBe(true);
		expect(isEligible('cloze', word, ctx)).toBe(false);
	});

	it('a transient drop is never remembered', () => {
		const item = {
			cardId: 'companion:cloze:1',
			kind: 'cloze',
			entryId: 1,
			virtual: true,
			card: null
		} as FlowItem;
		expect(rememberDrop(item, '学习')).toBe(true);
		expect(rememberDrop(item, '学习', undefined, { transient: true })).toBe(false);
		expect(rememberDrop({ ...item, kind: 'reverse' }, '学习')).toBe(true);
	});
});

describe('runner helpers for reverse and cloze', () => {
	it('revealsOnKey: vocab and reverse reveal on Space/Enter, the others own their keys', () => {
		expect(revealsOnKey('vocab')).toBe(true);
		expect(revealsOnKey('reverse')).toBe(true);
		for (const kind of ['sentence', 'writing', 'tone', 'cloze'] as const) {
			expect(revealsOnKey(kind)).toBe(false);
		}
	});

	it('clozeDistractorPool: written snapshots of other vocab cards in the session decks', () => {
		const cards = [
			card('v1', 'vocab', 1, { written: '喜欢' }),
			card('v2', 'vocab', 2, { written: '朋友' }),
			card('v3', 'vocab', 3, { written: '学习', deckIds: ['other'] }),
			card('v4', 'vocab', 4, { written: '' }),
			card('w2', 'writing', 5, { written: '工作' }),
			card('v6', 'vocab', 6, { written: '朋友' })
		];
		expect(clozeDistractorPool(cards, ['general'], 1)).toEqual(['朋友']);
		expect(clozeDistractorPool(cards, ['general', 'other'], 1).sort()).toEqual(['学习', '朋友']);
	});
});

describe('deckSessionPlan with daily limits', () => {
	const now = new Date('2026-03-01T12:00:00Z');
	const vocab = [1, 2, 3, 4, 5].map((entryId) =>
		card(`v${entryId}`, 'vocab', entryId, { written: '学习', createdAt: `2026-01-0${entryId}T00:00:00Z` })
	);
	const opts = {
		cards: vocab,
		reviews: [] as ReviewEvent[],
		deckIds: ['general'],
		kinds: ['vocab', 'sentence'] as StudyCardKind[],
		newLimit: 50,
		reviewLimit: 100,
		now,
		w: DEFAULT_W,
		language: 'zh'
	};
	const ctxNew = (n: number | null): StudyContext => ({
		...UTC_CONTEXT,
		limits: { workspace: { new: n }, decks: {}, existingDecks: null }
	});

	it('counts companions as new: the allowance is shared with the real new cards', () => {
		const plan = deckSessionPlan({ ...opts, ctx: ctxNew(7) });
		expect(plan.queue).toHaveLength(7);
		expect(plan.queue.filter((item) => item.virtual)).toHaveLength(2);
		expect(plan.reserve).toHaveLength(0);
	});

	it('the session limit stays the cap and the allowance beyond it is the reserve', () => {
		const plan = deckSessionPlan({ ...opts, newLimit: 6, ctx: ctxNew(8) });
		expect(plan.queue).toHaveLength(6);
		expect(plan.reserve).toHaveLength(2);
	});

	it('a dropped companion is replaced from the reserve only while the allowance holds', () => {
		let plan = deckSessionPlan({ ...opts, newLimit: 6, ctx: ctxNew(8) });
		const dropped = plan.queue.find((item) => item.virtual)!;
		plan = dropItem(plan, dropped.cardId);
		expect(plan.queue).toHaveLength(6);
		expect(plan.reserve).toHaveLength(1);
	});

	it('a companion whose word sits in a full deck is skipped, the next one is admitted', () => {
		const cards = [
			card('v1', 'vocab', 1, { written: '学习', deckIds: ['full'], createdAt: '2026-01-01T00:00:00Z' }),
			card('v2', 'vocab', 2, { written: '学习', deckIds: ['general'], createdAt: '2026-01-02T00:00:00Z' })
		];
		const ctx: StudyContext = { ...UTC_CONTEXT, limits: { workspace: null, decks: { full: { new: 0 } }, existingDecks: null } };
		const plan = deckSessionPlan({ ...opts, cards, deckIds: ['full', 'general'], kinds: ['sentence'], ctx });
		expect(plan.queue.map((item) => item.entryId)).toEqual([2]);
	});

	it('is empty on a vacation day', () => {
		const plan = deckSessionPlan({ ...opts, ctx: { ...UTC_CONTEXT, vacationToday: true } });
		expect(plan.queue).toEqual([]);
	});

	it('with no limit rows and fewer cards than 20 nothing changes', () => {
		const plan = deckSessionPlan({ ...opts, ctx: UTC_CONTEXT });
		expect(plan.queue).toHaveLength(10);
	});
});

describe('daily counts include cards that are not shown', () => {
	const now = new Date('2026-03-01T12:00:00Z');
	const rev = (n: number, cardId: string): ReviewEvent => ({
		id: `01JREG${String(n).padStart(20, '0')}`, workspaceId: 1, device: 'w', ts: '2026-03-01T08:00:00Z', type: 'review',
		payload: { cardId, mode: 'reverse', grade: 3 }
	});
	const mk = (id: string, kind: StudyCardKind, entryId: number, deckIds: string[]): StudyCard => ({
		id, kind, entryId, deckIds, createdAt: '2026-01-01T00:00:00Z', written: '学习'
	});
	const settings = (deckId: string, on: boolean) => ({
		[deckId]: { deckId, cardTypes: on ? ['reverse'] : [], extra: {} }
	}) as never;
	const lim = (decks: Record<string, { new: number }>): StudyContext => ({
		...UTC_CONTEXT,
		limits: { workspace: null, decks, existingDecks: null }
	});

	it('a reverse card reviewed today still uses the deck allowance after Reverse is switched off', () => {
		const cards = [
			mk('v1', 'vocab', 1, ['A']), mk('r1', 'reverse', 1, ['A']),
			mk('v2', 'vocab', 2, ['A']), mk('r2', 'reverse', 2, ['A']),
			mk('v3', 'vocab', 3, ['A'])
		];
		const reviews = [rev(1, 'r1'), rev(2, 'r2')];
		const plan = deckSessionPlan({
			cards, reviews, deckIds: ['A'], kinds: ['vocab'], newLimit: 50, reviewLimit: 50, now, w: DEFAULT_W,
			language: 'zh', deckSettings: settings('A', false), ctx: lim({ A: { new: 2 } })
		});
		expect(plan.queue.filter((i) => !i.virtual && i.kind === 'vocab' && i.cardId === 'v3')).toHaveLength(0);
		expect(plan.queue).toHaveLength(0);
	});

	it('a reverse card in decks A and B reviewed today counts toward B in a session of B', () => {
		const cards = [
			mk('v1', 'vocab', 1, ['B']), mk('r1', 'reverse', 1, ['A', 'B']),
			mk('v2', 'vocab', 2, ['B'])
		];
		const plan = deckSessionPlan({
			cards, reviews: [rev(1, 'r1')], deckIds: ['B'], kinds: ['vocab'], newLimit: 50, reviewLimit: 50, now, w: DEFAULT_W,
			language: 'zh', deckSettings: settings('A', true), ctx: lim({ B: { new: 1 } })
		});
		expect(plan.queue).toHaveLength(0);
	});
});

describe('deckSessionPlan with a new-card key (#75)', () => {
	it('passes the key to the real queue', () => {
		const cards = [1, 2, 3].map((n) => card(`v${n}`, 'vocab', n, { createdAt: `2026-01-0${n}T00:00:00Z` }));
		const options = {
			ctx: UTC_CONTEXT,
			cards,
			reviews: [] as ReviewEvent[],
			deckIds: ['general'],
			kinds: ['vocab'] as StudyCardKind[],
			newLimit: 2,
			reviewLimit: 100,
			now: new Date('2026-03-01T00:00:00Z'),
			w: DEFAULT_W,
			language: 'zh'
		};
		expect(deckSessionPlan(options).queue.map((i) => i.cardId)).toEqual(['v1', 'v2']);
		const ranked = deckSessionPlan({ ...options, newKey: (c: StudyCard) => ({ 3: 1, 2: 2 })[c.entryId] ?? null });
		expect(ranked.queue.map((i) => i.cardId)).toEqual(['v3', 'v2']);
	});
});

describe('docs/contracts/cards/deck-session.json', () => {
	interface DeckCase {
		name: string;
		note: string;
		history: ZoneChange[];
		now: string;
		language: string;
		deckIds: string[];
		kinds: StudyCardKind[];
		newLimit: number;
		reviewLimit: number;
		weights: 'default';
		cards: StudyCard[];
		reviews: { cardId: string; ts: string; grade: ReviewGrade }[];
		offline?: boolean;
		skip?: string[];
		vacation?: Run[];
		limits?: { workspace: Partial<LimitPair> | null; decks: Record<string, Partial<LimitPair>> };
		deckSettings?: Record<string, OptInKind[]>;
		newRank?: Record<string, number>;
	}

	/** The deckSessionPlan options of a fixture case (reviews get ids in list order). */
	function deckOptions(c: DeckCase): DeckSessionOptions {
		const now = new Date(c.now);
		const limits: LimitRows = c.limits ? { ...c.limits, existingDecks: null } : NO_LIMIT_ROWS;
		const ctx = contextFor(studyDay(c.history), c.vacation ?? [], now.getTime(), c.history, limits);
		const kindOf = new Map(c.cards.map((card) => [card.id, card.kind]));
		const reviews: ReviewEvent[] = c.reviews.map((r, i) => ({
			id: `01KA${String(i + 1).padStart(22, '0')}`,
			workspaceId: 7,
			device: 'web',
			ts: r.ts,
			type: 'review',
			payload: { cardId: r.cardId, mode: kindOf.get(r.cardId) ?? 'vocab', grade: r.grade }
		}));
		const deckSettings =
			c.deckSettings === undefined
				? undefined
				: Object.fromEntries(Object.entries(c.deckSettings).map(([deckId, cardTypes]) => [deckId, { deckId, cardTypes, extra: {} }]));
		const rank = c.newRank;
		return {
			cards: c.cards,
			reviews,
			deckIds: c.deckIds,
			kinds: c.kinds,
			newLimit: c.newLimit,
			reviewLimit: c.reviewLimit,
			now,
			language: c.language,
			w: DEFAULT_W,
			ctx,
			...(c.skip ? { skip: new Set(c.skip) } : {}),
			...(deckSettings ? { deckSettings } : {}),
			...(c.offline ? { offline: true } : {}),
			...(rank ? { newKey: (card: StudyCard) => rank[String(card.entryId)] ?? null } : {})
		};
	}

	const planIds = (p: DeckSessionPlan) => ({
		queue: p.queue.map((i) => i.cardId),
		reserve: p.reserve.map((i) => i.cardId),
		backfillLeft: p.backfillLeft
	});

	const fixture = deckSessionFixture as unknown as {
		rule: string;
		plans: (DeckCase & { expect: ReturnType<typeof planIds> })[];
		steps: (DeckCase & {
			expect: ReturnType<typeof planIds>;
			steps: (
				| { op: 'drop'; cardId: string; expect?: ReturnType<typeof planIds> }
				| {
						op: 'bury';
						index: number;
						answered: { kind: StudyCardKind; entryId: number; cardId: string };
						expect?: ReturnType<typeof planIds> & { buried: number };
				  }
			)[];
		})[];
		eligible: { name: string; kind: StudyCardKind; entry: EntryLike; ctx: EligibilityContext; expect: boolean }[];
	};

	it('has the case lists', () => {
		expect(fixture.rule).toBe('cards/deck-session');
		expect(fixture.plans.length).toBeGreaterThanOrEqual(20);
		expect(fixture.steps.length).toBeGreaterThanOrEqual(3);
		expect(fixture.eligible.length).toBeGreaterThanOrEqual(10);
		// "default" is the only weight set the cases use: deckOptions passes DEFAULT_W (scheduler/fsrs.json).
		for (const c of [...fixture.plans, ...fixture.steps]) expect(c.weights, c.name).toBe('default');
	});
	for (const c of fixture.plans) {
		it(`plan: ${c.name}`, () => {
			const options = deckOptions(c);
			expect(planIds(deckSessionPlan(options))).toEqual(c.expect);
			expect(backfillLimit(c.newLimit)).toBe(c.expect.backfillLeft);
		});
	}
	for (const c of fixture.steps) {
		it(`steps: ${c.name}`, () => {
			let plan = deckSessionPlan(deckOptions(c));
			expect(planIds(plan)).toEqual(c.expect);
			for (const s of c.steps) {
				if (s.op === 'drop') {
					plan = dropItem(plan, s.cardId);
					if (s.expect) expect(planIds(plan), s.cardId).toEqual(s.expect);
				} else {
					const res = buryAfterAnswer(plan, s.index, s.answered);
					plan = res.plan;
					expect({ ...planIds(plan), buried: res.buried }).toEqual(s.expect);
				}
			}
		});
	}
	for (const c of fixture.eligible) {
		it(`isEligible: ${c.name}`, () => {
			expect(isEligible(c.kind, c.entry, c.ctx)).toBe(c.expect);
		});
	}
});
