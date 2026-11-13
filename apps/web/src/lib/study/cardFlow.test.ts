import { describe, expect, it } from 'vitest';

import {
	captureListeners,
	cardedSentenceIds,
	deckSessionItems,
	deckSessionPlan,
	dropItem,
	isChinese,
	isEligible,
	levelSessionItems,
	maskWritten,
	pickSentence,
	pinyinReadings,
	reviewCountFor,
	sessionCounts,
	shouldIgnoreGrade,
	tierForCard,
	toneVerdict
} from './cardFlow';
import { parsePinyin } from './tones';
import type { ReviewEvent, ReviewGrade, StudyCard, StudyCardKind } from './types';

function card(
	id: string,
	kind: StudyCardKind,
	entryId: number,
	opts: { written?: string; sentenceId?: number; deckIds?: string[]; createdAt?: string } = {}
): StudyCard {
	const result: StudyCard = {
		id,
		kind,
		entryId,
		written: opts.written ?? '学习',
		deckIds: opts.deckIds ?? ['general'],
		createdAt: opts.createdAt ?? '2026-01-01T00:00:00.000Z'
	};
	if (opts.sentenceId !== undefined) result.sentenceId = opts.sentenceId;
	return result;
}

function review(cardId: string, ts: string, grade: ReviewGrade = 3, id = `${cardId}-${ts}`): ReviewEvent {
	return {
		id,
		workspaceId: 1,
		device: 'web',
		ts,
		type: 'review',
		payload: { cardId, mode: 'vocab', grade }
	};
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

	it('pinyinReadings keeps pinyin values only', () => {
		expect(
			pinyinReadings([
				{ type: 'pinyin', value: 'háng' },
				{ type: 'bopomofo', value: 'ㄏㄤˊ' },
				{ type: 'pinyin', value: 'xíng' }
			])
		).toEqual(['háng', 'xíng']);
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
		expect(tierForCard(null, [], now)).toBe(0);
		expect(tierForCard('a', [], now)).toBe(0);
		// A long run of Good reviews spaced far apart builds large stability.
		const reviews = [
			review('a', '2026-01-01T00:00:00Z', 4),
			review('a', '2026-02-01T00:00:00Z', 4),
			review('a', '2026-05-01T00:00:00Z', 4),
			review('a', '2026-12-01T00:00:00Z', 4)
		];
		expect(tierForCard('a', reviews, now)).toBe(2);
	});

	it('maskWritten hides the usable characters not yet written', () => {
		expect(maskWritten('食べ物', ['食', '物'], 0)).toBe('□べ□');
		expect(maskWritten('食べ物', ['食', '物'], 1)).toBe('食べ□');
		expect(maskWritten('食べ物', ['食', '物'], 2)).toBe('食べ物');
		expect(maskWritten('好好', ['好'], 0)).toBe('□□');
	});
});

describe('toneVerdict', () => {
	it('marks each syllable against the best matching reading', () => {
		const candidates = [parsePinyin('xué xí')];
		expect(toneVerdict([2, 2], candidates)).toEqual({
			correct: true,
			wrong: 0,
			marks: [true, true],
			best: candidates[0]
		});
		const verdict = toneVerdict([2, 4], candidates);
		expect(verdict.wrong).toBe(1);
		expect(verdict.marks).toEqual([true, false]);
	});

	it('accepts any reading of a polyphone with the same length', () => {
		const candidates = [parsePinyin('háng'), parsePinyin('xíng')];
		expect(toneVerdict([2], candidates).correct).toBe(true);
		const both = [parsePinyin('zhǎng'), parsePinyin('cháng')];
		const verdict = toneVerdict([2], both);
		expect(verdict.correct).toBe(true);
		expect(verdict.best?.[0].text).toBe('cháng');
	});

	it('marks everything wrong when no reading has the same length', () => {
		const verdict = toneVerdict([1, 1], [parsePinyin('hǎo')]);
		expect(verdict).toEqual({ correct: false, wrong: 2, marks: [false, false], best: null });
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
		cards,
		reviews: [] as ReviewEvent[],
		deckIds: ['general'],
		newLimit: 20,
		reviewLimit: 100,
		now,
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

describe('deckSessionPlan and dropItem', () => {
	const now = new Date('2026-03-01T00:00:00Z');
	// Words 1 and 2 (oldest) have no sentences; 3 and 4 do.
	const cards = [1, 2, 3, 4].map((entryId) =>
		card(`v${entryId}`, 'vocab', entryId, { createdAt: `2026-01-0${entryId}T00:00:00Z` })
	);
	const options = {
		cards,
		reviews: [] as ReviewEvent[],
		deckIds: ['general'],
		kinds: ['sentence'] as StudyCardKind[],
		newLimit: 2,
		reviewLimit: 100,
		now,
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
});

describe('levelSessionItems', () => {
	const cards = [card('v1', 'vocab', 1)];
	const queue = [
		{ cardId: 'v1', entryId: 1, virtual: false },
		{ cardId: 'level:2', entryId: 2, virtual: true }
	];

	it('maps level items to vocab flow items', () => {
		const items = levelSessionItems(queue, cards, ['vocab', 'tone']);
		expect(items).toEqual([
			{ cardId: 'v1', kind: 'vocab', entryId: 1, virtual: false, card: cards[0], written: '学习' },
			{ cardId: 'level:2', kind: 'vocab', entryId: 2, virtual: true, card: null }
		]);
	});

	it('is empty when vocab is not selected', () => {
		expect(levelSessionItems(queue, cards, ['tone'])).toEqual([]);
	});
});

describe('sessionCounts', () => {
	it('splits due and new and counts per kind', () => {
		const now = new Date('2026-03-01T00:00:00Z');
		const cards = [card('v1', 'vocab', 1), card('v2', 'vocab', 2)];
		const reviews = [review('v1', '2026-01-05T00:00:00Z', 1)];
		const items = deckSessionItems({
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
			byKind: { vocab: 2, sentence: 0, writing: 0, tone: 2 }
		});
	});
});

describe('captureListeners', () => {
	it('records listeners added during the call and removes them on release', () => {
		const added: [string, unknown][] = [];
		const removed: [string, unknown][] = [];
		const target = {
			addEventListener(type: string, cb: unknown) {
				added.push([type, cb]);
			},
			removeEventListener(type: string, cb: unknown) {
				removed.push([type, cb]);
			}
		};
		const original = target.addEventListener;
		const cb = () => {};
		const { result, release } = captureListeners(target, () => {
			target.addEventListener('mouseup', cb);
			return 42;
		});
		expect(result).toBe(42);
		expect(added).toEqual([['mouseup', cb]]);
		expect(target.addEventListener).toBe(original);
		release();
		expect(removed).toEqual([['mouseup', cb]]);
		release();
		expect(removed).toHaveLength(1);
	});

	it('restores the target even when the call throws', () => {
		const target = {
			addEventListener() {},
			removeEventListener() {}
		};
		const original = target.addEventListener;
		expect(() =>
			captureListeners(target, () => {
				throw new Error('boom');
			})
		).toThrow('boom');
		expect(target.addEventListener).toBe(original);
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
