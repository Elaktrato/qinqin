// #288: the study modal's "This session" is the session's length. A Japanese
// deck with Word Salad selected said 20; the session went 0/20, then 0/1, then
// "no cards", because a word without a sentence was only found out when its
// card was about to be shown. With the server's eligibility answer
// (EligibilityIndex) planning never plans such a card.

import { describe, expect, it } from 'vitest';
import * as build from '$lib/testing/study';
import { DEFAULT_W } from '$lib/studycore/fsrsParams';
import { UTC_CONTEXT } from '$lib/studycore/studyContext';
import type { StudyCard, StudyCardKind } from '$lib/studycore/types';
import { deckSessionPlan, dropItem, type DeckSessionPlan } from '../session/cardFlow';
import { EligibilityIndex } from '../session/eligibility.svelte';
import { planSetup, type SetupPlanInput } from './setupPlan';

const NOW = new Date('2026-11-27T09:00:00Z');

const WORDS = [
	'私', '学校', '行く', '水', '飲む', '食べる', '本', '読む', '学生', '先生',
	'日本', '時間', '友達', '電車', '会社', '映画', '天気', '料理', '部屋', '家族',
	'仕事', '毎日', '自分', '名前', '言葉'
];

/** Vocab cards of the Japanese words, entry ids 101.., reviewed once a long time ago (not due). */
function deck(words: readonly string[]): { cards: StudyCard[]; reviews: ReturnType<typeof build.review>[] } {
	const cards = words.map((written, i) =>
		build.card({ id: `c-vocab-${101 + i}`, entryId: 101 + i, written, createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString() })
	);
	const reviews = cards.map((card) => build.review({ cardId: card.id, ts: '2026-11-26T08:00:00Z', grade: 4 }));
	return { cards, reviews };
}

/** The server's answer: a sentence (and so a word salad) only for the words in `withSentence`. */
async function serverIndex(cards: readonly StudyCard[], withSentence: ReadonlySet<string>): Promise<EligibilityIndex> {
	const byId = new Map(cards.map((card) => [card.entryId, card.written ?? '']));
	const index = new EligibilityIndex({
		fetch: async (ids) =>
			Object.fromEntries(ids.map((id) => [String(id), withSentence.has(byId.get(id) ?? '') ? ['sentence', 'writing', 'reverse', 'cloze'] : ['writing', 'reverse']])),
		now: () => NOW.getTime()
	});
	await index.ensure(cards.map((card) => card.entryId));
	return index;
}

function input(cards: StudyCard[], reviews: ReturnType<typeof build.review>[], over: Partial<SetupPlanInput> = {}): SetupPlanInput {
	return {
		status: 'ready',
		mode: 'decks',
		deckIds: ['general'],
		kinds: ['sentence'],
		newLimit: 20,
		reviewLimit: 100,
		cards,
		reviews,
		deckSettings: {},
		weights: DEFAULT_W,
		ctx: UTC_CONTEXT,
		language: 'ja',
		level: { scheme: null, levelName: null, schemesLoaded: false, schemeError: '', schemeCount: 0, entries: [], loading: false, error: '' },
		...over
	};
}

function plan(cards: StudyCard[], reviews: ReturnType<typeof build.review>[], kinds: StudyCardKind[], skip?: ReadonlySet<string>): DeckSessionPlan {
	return deckSessionPlan({
		cards,
		reviews,
		deckIds: ['general'],
		kinds,
		newLimit: 20,
		reviewLimit: 100,
		now: NOW,
		w: DEFAULT_W,
		ctx: UTC_CONTEXT,
		language: 'ja',
		skip
	});
}

/**
 * The session runner, as the session page does it: the card at the counter is
 * resolved; one that cannot be shown is dropped (a dropped companion is
 * replaced from the reserve), one that can is shown. The counter line after
 * every step, and how many cards were shown.
 */
function replay(start: DeckSessionPlan, canShow: (entryId: number) => boolean): { counters: string[]; shown: number } {
	let current = start;
	let index = 0;
	const counters = [`${index}/${current.queue.length}`];
	while (index < current.queue.length) {
		const item = current.queue[index];
		if (canShow(item.entryId)) index += 1;
		else current = dropItem(current, item.cardId);
		counters.push(`${index}/${current.queue.length}`);
	}
	return { counters, shown: index };
}

describe('#288: the count holds', () => {
	it('without an answer from the server the old count comes back: 0/20, then 0/1, then no cards', () => {
		const { cards, reviews } = deck(WORDS);
		expect(planSetup(input(cards, reviews), NOW).session).toBe(20);
		const run = replay(plan(cards, reviews, ['sentence']), () => false);
		expect(run.counters[0]).toBe('0/20');
		expect(run.counters).toContain('0/1');
		expect(run.counters.at(-1)).toBe('0/0');
		expect(run.shown).toBe(0);
	});

	it('with the answer nothing is promised, and the modal says why Word Salad has no cards', async () => {
		const { cards, reviews } = deck(WORDS);
		const index = await serverIndex(cards, new Set());
		const setup = planSetup(input(cards, reviews, { skip: index.skip() }), NOW);
		expect(setup.session).toBe(0);
		expect(setup.counts).toEqual({ due: 0, fresh: 0 });
		expect(setup.hidden).toContainEqual({ kind: 'sentence', reason: 'noSentences' });
		expect(setup.available).not.toContain('sentence');
		expect(plan(cards, reviews, ['sentence'], index.skip()).queue).toEqual([]);
	});

	it('half the words have a sentence: the modal count is the session length, nothing is dropped', async () => {
		const { cards, reviews } = deck(WORDS.slice(0, 10));
		const withSentence = new Set(WORDS.slice(0, 10).filter((_, i) => i % 2 === 0));
		const index = await serverIndex(cards, withSentence);
		const setup = planSetup(input(cards, reviews, { skip: index.skip() }), NOW);
		const session = plan(cards, reviews, ['sentence'], index.skip());
		expect(setup.session).toBe(5);
		expect(session.queue).toHaveLength(5);
		const shownWords = new Set(cards.filter((card) => withSentence.has(card.written ?? '')).map((card) => card.entryId));
		const run = replay(session, (entryId) => shownWords.has(entryId));
		expect(run.shown).toBe(5);
		expect(run.counters.every((line) => line.endsWith('/5'))).toBe(true);
		expect(setup.available).toContain('sentence');
	});
});

describe('"This session" is the queue Start plans', () => {
	it('a review cap leaves a word without its queued card: its reverse companion is in the session and in the count', () => {
		const { cards, reviews } = deck(['私', '学校']);
		// Both vocab cards due today.
		const due = cards.map((card) => build.review({ cardId: card.id, ts: '2026-11-20T08:00:00Z', grade: 1 }));
		const deckSettings = { general: { deckId: 'general', cardTypes: ['reverse' as const], extra: {} } };
		const kinds: StudyCardKind[] = ['vocab', 'reverse'];
		const setup = planSetup(input(cards, due, { kinds, reviewLimit: 1, deckSettings }), NOW);
		const session = deckSessionPlan({
			cards,
			reviews: due,
			deckIds: ['general'],
			kinds,
			newLimit: 20,
			reviewLimit: 1,
			now: NOW,
			w: DEFAULT_W,
			ctx: UTC_CONTEXT,
			language: 'ja',
			deckSettings
		});
		expect(session.queue.map((item) => item.kind)).toEqual(['vocab', 'reverse']);
		expect(setup.session).toBe(session.queue.length);
		void reviews;
	});

	it('for every limit, the count is the queue length', async () => {
		const { cards, reviews } = deck(WORDS);
		const index = await serverIndex(cards, new Set(WORDS.filter((_, i) => i % 3 === 0)));
		const half = reviews.map((review, i) => (i % 2 === 0 ? build.review({ cardId: review.payload.cardId, ts: '2026-11-01T08:00:00Z', grade: 2 }) : review));
		for (const newLimit of [1, 3, 10, 20]) {
			for (const reviewLimit of [1, 5, 100]) {
				for (const kinds of [['vocab'], ['sentence'], ['vocab', 'sentence', 'writing']] as StudyCardKind[][]) {
					const setup = planSetup(input(cards, half, { kinds, newLimit, reviewLimit, skip: index.skip() }), NOW);
					const session = deckSessionPlan({
						cards,
						reviews: half,
						deckIds: ['general'],
						kinds,
						newLimit,
						reviewLimit,
						now: NOW,
						w: DEFAULT_W,
						ctx: UTC_CONTEXT,
						language: 'ja',
						skip: index.skip()
					});
					expect(setup.session, `${kinds} new ${newLimit} reviews ${reviewLimit}`).toBe(session.queue.length);
				}
			}
		}
	});
});
