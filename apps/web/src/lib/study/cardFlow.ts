// The session runner's pure decisions: which items a session holds, whether
// an item can be shown, and the small derived values the card components
// need. Kept out of the Svelte pages so they are covered by tests.

import type { StudyDay } from '../time/studyDay';
import { planCompanions } from './companions';
import type { LevelQueueItem } from './levelQueue';
import { buildQueue, scheduleFor } from './scheduler';
import { cleanReadings, eligibleForTone, type Syllable, type Tone } from './tones';
import { tierFor, type SaladTier } from './wordSalad';
import { isHan, writableChars } from './writing';
import type { ReviewEvent, ReviewGrade, ReviewMeta, StudyCard, StudyCardKind } from './types';

/**
 * What a card component reports when the learner has finished it: the
 * grade it suggests (null for vocab, never Easy) and the review meta. The
 * runner preselects the suggestion; the learner confirms or overrides.
 */
export interface CardResult {
	suggested: ReviewGrade | null;
	meta: ReviewMeta;
}

/**
 * One queue item of a session. A `virtual` item has no card yet: it is
 * created by gradeItem on the first grade (with `kind`, `written`,
 * `sentenceId` and `deckIds`), so abandoning a session creates nothing.
 */
export interface FlowItem {
	cardId: string;
	kind: StudyCardKind;
	entryId: number;
	virtual: boolean;
	card: StudyCard | null;
	written?: string;
	/** A sentence card's sentence; set on a virtual item once it is resolved. */
	sentenceId?: number;
	/** Decks a virtual item's card joins. */
	deckIds?: string[];
	/** Set on an in-session re-show of an Again card: how many so far. */
	reshow?: number;
	/** Word Salad tier the first showing used; a re-show keeps it. */
	tier?: SaladTier;
}

/** The entry fields eligibility needs. */
export interface EntryLike {
	language: string;
	written: string;
	readings: readonly { type: string; value: string }[];
	/** Entry kind and glosses; a character without glosses gets no writing card. */
	kind?: string;
	senses?: readonly unknown[];
}

export interface EligibilityContext {
	/** The workspace language. */
	language: string;
	/** Han characters of the word that have stroke data (writing only). */
	usableChars?: string[];
	/** Whether a sentence resolved for this item (sentence only). */
	hasSentence: boolean;
}

/** zh and its regional tags (zh-Hant, zh_TW, ...). */
export function isChinese(language: string): boolean {
	return language.toLowerCase().split(/[-_]/)[0] === 'zh';
}

/** The pinyin reading values of an entry, in order. */
export function pinyinReadings(readings: readonly { type: string; value: string }[]): string[] {
	return readings.filter((reading) => reading.type === 'pinyin').map((reading) => reading.value);
}

/** The first sentence that has no sentence card yet, or null. */
export function pickSentence<T extends { id: number }>(
	sentences: readonly T[],
	carded: ReadonlySet<number>
): T | null {
	return sentences.find((sentence) => !carded.has(sentence.id)) ?? null;
}

/** Sentence ids that already have a sentence card for `entryId`. */
export function cardedSentenceIds(cards: readonly StudyCard[], entryId: number): Set<number> {
	const ids = new Set<number>();
	for (const card of cards) {
		if (card.kind === 'sentence' && card.entryId === entryId && card.sentenceId !== undefined) {
			ids.add(card.sentenceId);
		}
	}
	return ids;
}

/** A character entry with no senses: a pinyin-only prompt matches many homophones. */
function lacksGlosses(entry: { kind?: string; senses?: readonly unknown[] }): boolean {
	return entry.kind === 'character' && entry.senses !== undefined && entry.senses.length === 0;
}

/**
 * isEligible decides, when an item is about to be shown, whether its kind
 * can be studied for this word. Ineligible companions are dropped from the
 * session without ever being created.
 */
export function isEligible(
	kind: StudyCardKind,
	entry: EntryLike,
	ctx: EligibilityContext
): boolean {
	switch (kind) {
		case 'vocab':
			return true;
		case 'sentence':
			return ctx.hasSentence;
		case 'writing':
			if (lacksGlosses(entry)) return false;
			return (ctx.usableChars?.length ?? 0) > 0;
		case 'tone':
			return eligibleForTone(ctx.language, pinyinReadings(entry.readings));
		default:
			return false;
	}
}

function fromCard(card: StudyCard): FlowItem {
	const item: FlowItem = {
		cardId: card.id,
		kind: card.kind,
		entryId: card.entryId,
		virtual: false,
		card
	};
	if (card.written !== undefined) item.written = card.written;
	if (card.sentenceId !== undefined) item.sentenceId = card.sentenceId;
	return item;
}

function reviewedIds(reviews: readonly ReviewEvent[]): Set<string> {
	const ids = new Set<string>();
	for (const review of reviews) {
		const cardId = review?.payload?.cardId;
		if (typeof cardId === 'string' && cardId !== '') ids.add(cardId);
	}
	return ids;
}

function sessionKinds(kinds: readonly StudyCardKind[], language: string): StudyCardKind[] {
	return kinds.filter((kind) => kind !== 'tone' || isChinese(language));
}

export interface DeckSessionOptions {
	cards: readonly StudyCard[];
	reviews: readonly ReviewEvent[];
	deckIds: readonly string[];
	kinds: readonly StudyCardKind[];
	newLimit: number;
	reviewLimit: number;
	now: Date;
	/** The workspace language; tone needs Chinese. */
	language: string;
	/** `kind:entryId` of companions already found ineligible; never planned. */
	skip?: ReadonlySet<string>;
	/** The workspace's active FSRS weights. */
	w: readonly number[];
	/** The learner's day, for the character writing unlock; UTC when absent. */
	studyDay?: StudyDay;
}

/**
 * How many dropped companions one session replaces from the reserve. A
 * deck of mostly unsuitable words would otherwise fetch every entry one
 * by one before the session could end.
 */
export function backfillLimit(newLimit: number): number {
	const limit = Number.isFinite(newLimit) ? Math.max(0, Math.floor(newLimit)) : 0;
	return Math.max(30, 2 * limit);
}

/** A deck session: the queue, plus companions held back beyond the budget. */
export interface DeckSessionPlan {
	queue: FlowItem[];
	/**
	 * Companions planned beyond the new-card budget, in planning order.
	 * Eligibility is only known once an entry is loaded, so when the runner
	 * drops an ineligible companion the next reserve item takes its place
	 * (see dropItem); otherwise sentence-less old words would use up the
	 * budget in every session and starve the newer ones.
	 */
	reserve: FlowItem[];
	/** Replacements left this session (see backfillLimit). */
	backfillLeft: number;
}

/**
 * deckSessionPlan builds a deck session: the existing cards of the
 * selected kinds (due reviews first, then new cards), followed by at most
 * `newLimit - new cards` virtual companion items for vocab words that
 * lack a card of a selected companion kind; further companions go to the
 * reserve. Companions that can never be eligible are left out entirely:
 * writing for words without Han characters, tone outside Chinese.
 */
export function deckSessionPlan({
	cards,
	reviews,
	deckIds,
	kinds,
	newLimit,
	reviewLimit,
	now,
	language,
	skip,
	w,
	studyDay
}: DeckSessionOptions): DeckSessionPlan {
	const backfillLeft = backfillLimit(newLimit);
	const wanted = sessionKinds(kinds, language);
	if (wanted.length === 0) return { queue: [], reserve: [], backfillLeft };

	const real = buildQueue({ cards, reviews, deckIds, newLimit, reviewLimit, now, kinds: wanted, w });
	const reviewed = reviewedIds(reviews);
	const freshCount = real.filter((card) => !reviewed.has(card.id)).length;
	const limit = Number.isFinite(newLimit) ? Math.max(0, Math.floor(newLimit)) : 0;
	const budget = Math.max(0, limit - freshCount);

	const companions = planCompanions({
		cards,
		kinds: wanted,
		deckIds,
		// Plan everything, then split at the budget: the rest is the reserve.
		newBudget: cards.length * 3,
		reviews,
		now: now.getTime(),
		studyDay
	})
		.filter((item) => skip === undefined || !skip.has(`${item.kind}:${item.entryId}`))
		// Without a snapshot (Round 1 cards) writing is decided when shown.
		.filter(
			(item) =>
				item.kind !== 'writing' ||
				item.written === undefined ||
				writableChars(item.written).length > 0
		)
		.map(
			(item): FlowItem => ({
				cardId: item.cardId,
				kind: item.kind,
				entryId: item.entryId,
				virtual: true,
				card: null,
				...(item.written === undefined ? {} : { written: item.written }),
				deckIds: [...item.deckIds]
			})
		);

	return {
		queue: [...real.map(fromCard), ...companions.slice(0, budget)],
		reserve: companions.slice(budget),
		backfillLeft
	};
}

/** deckSessionItems is the queue of deckSessionPlan (no reserve). */
export function deckSessionItems(options: DeckSessionOptions): FlowItem[] {
	return deckSessionPlan(options).queue;
}

/**
 * dropItem removes an item that turned out to be ineligible. A dropped
 * companion frees its new-card slot, so the next reserve companion is
 * appended to the queue while the session's backfill bound lasts; a
 * dropped real card frees nothing.
 */
export function dropItem(plan: DeckSessionPlan, cardId: string): DeckSessionPlan {
	const dropped = plan.queue.find((item) => item.cardId === cardId);
	if (dropped === undefined) return plan;
	const queue = plan.queue.filter((item) => item.cardId !== cardId);
	if (!dropped.virtual || plan.reserve.length === 0 || plan.backfillLeft <= 0) {
		return { ...plan, queue };
	}
	const [next, ...reserve] = plan.reserve;
	return { queue: [...queue, next], reserve, backfillLeft: plan.backfillLeft - 1 };
}

/**
 * rememberDrop decides whether a dropped item's ineligibility is final
 * enough to remember for later sessions. Only companions are remembered.
 * A writing drop is remembered only when the word has no Han character at
 * all: missing stroke data may be a transient network failure.
 */
export function rememberDrop(
	item: FlowItem,
	written: string,
	entry?: { kind?: string; senses?: readonly unknown[] }
): boolean {
	if (!item.virtual) return false;
	if (item.kind === 'writing' && entry !== undefined && lacksGlosses(entry)) return true;
	return item.kind !== 'writing' || writableChars(written).length === 0;
}

/**
 * resolveSentence picks the sentence a sentence item shows: a companion
 * takes the word's first sentence without a card; an existing card keeps
 * its own sentence, or falls back to the word's first sentence when the
 * stored one is gone (a pack update retires ids). The fallback is display
 * only: nothing is written and reviews stay on the same card.
 */
export function resolveSentence<T extends { id: number }>(
	item: FlowItem,
	sentences: readonly T[],
	carded: ReadonlySet<number>
): T | null {
	if (item.virtual) return pickSentence(sentences, carded);
	const stored = item.card?.sentenceId ?? item.sentenceId;
	return sentences.find((sentence) => sentence.id === stored) ?? sentences[0] ?? null;
}

/**
 * levelSessionItems maps a level queue to flow items, each with its own
 * kind. Items whose kind is not selected are dropped, so a setup with no
 * applicable kind yields an empty session. A virtual recognition item
 * carries no deck (gradeItem defaults to General, as it always did); a
 * virtual writing item names General explicitly.
 */
export function levelSessionItems(
	items: readonly LevelQueueItem[],
	cards: readonly StudyCard[],
	kinds: readonly StudyCardKind[]
): FlowItem[] {
	const byId = new Map(cards.map((card) => [card.id, card]));
	const out: FlowItem[] = [];
	for (const item of items) {
		if (!kinds.includes(item.kind)) continue;
		const card = item.virtual ? undefined : byId.get(item.cardId);
		if (card !== undefined) {
			out.push(fromCard(card));
			continue;
		}
		out.push({
			cardId: item.cardId,
			kind: item.kind,
			entryId: item.entryId,
			virtual: item.virtual,
			card: null,
			...(item.kind === 'vocab' ? {} : { deckIds: ['general'] })
		});
	}
	return out;
}

/** Due reviews, new items, and items per kind of one planned session. */
export function sessionCounts(
	items: readonly FlowItem[],
	reviews: readonly ReviewEvent[]
): { due: number; fresh: number; byKind: Record<StudyCardKind, number> } {
	const reviewed = reviewedIds(reviews);
	const byKind: Record<StudyCardKind, number> = {
		vocab: 0,
		sentence: 0,
		writing: 0,
		tone: 0,
		reverse: 0,
		cloze: 0
	};
	let due = 0;
	for (const item of items) {
		byKind[item.kind] += 1;
		if (!item.virtual && reviewed.has(item.cardId)) due += 1;
	}
	return { due, fresh: items.length - due, byKind };
}

/** How many valid reviews a card has; seeds the Word Salad shuffle. */
export function reviewCountFor(cardId: string | null, reviews: readonly ReviewEvent[]): number {
	if (cardId === null) return 0;
	let count = 0;
	for (const review of reviews) {
		const grade = review?.payload?.grade;
		if (review?.payload?.cardId === cardId && grade >= 1 && grade <= 4) count += 1;
	}
	return count;
}

/** The Word Salad tier from the card's derived FSRS stability. */
export function tierForCard(
	cardId: string | null,
	reviews: readonly ReviewEvent[],
	now: Date,
	w: readonly number[]
): SaladTier {
	if (cardId === null) return 0;
	return tierFor(scheduleFor(cardId, reviews, now, w)?.stability ?? null);
}

/**
 * maskWritten shows the word with every usable character that is not yet
 * written replaced by a box; `done` counts the characters completed in
 * order. Kana and other characters stay visible as context.
 */
export function maskWritten(written: string, chars: readonly string[], done: number): string {
	let out = '';
	for (const ch of written) {
		const at = chars.indexOf(ch);
		out += at >= 0 && at >= done ? '□' : ch;
	}
	return out;
}

export interface ToneVerdict {
	correct: boolean;
	wrong: number;
	/** Per syllable: right against the best matching reading. */
	marks: boolean[];
	/** The reading the answer was checked against, null when none fits. */
	best: Syllable[] | null;
}

/**
 * toneVerdict checks chosen tones against every reading with the same
 * syllable count (cleanReadings output) and keeps the closest one, so a
 * polyphone answer for any of its readings is right. Ties keep the first.
 */
export function toneVerdict(
	chosen: readonly Tone[],
	candidates: readonly (readonly Syllable[])[]
): ToneVerdict {
	let best: readonly Syllable[] | null = null;
	let bestWrong = chosen.length;
	for (const candidate of candidates) {
		if (candidate.length !== chosen.length) continue;
		const wrong = candidate.reduce((sum, syllable, i) => sum + (syllable.tone === chosen[i] ? 0 : 1), 0);
		if (best === null || wrong < bestWrong) {
			best = candidate;
			bestWrong = wrong;
		}
	}
	if (best === null) {
		return { correct: false, wrong: chosen.length, marks: chosen.map(() => false), best: null };
	}
	const reading = best;
	return {
		correct: bestWrong === 0,
		wrong: bestWrong,
		marks: chosen.map((tone, i) => reading[i].tone === tone),
		best: [...reading]
	};
}

/**
 * The Han characters of `written` when every character is Han and their
 * count equals the syllable count; otherwise null (erhua such as 花儿,
 * mixed scripts), and the pads show toneless pinyin instead.
 */
export function tonePadLabels(written: string, syllableCount: number): string[] | null {
	const chars = [...written.trim()];
	if (chars.length === 0 || chars.length !== syllableCount) return null;
	return chars.every(isHan) ? chars : null;
}

/** The tone check candidates of an entry: its clean pinyin readings. */
export function toneCandidates(readings: readonly { type: string; value: string }[]): Syllable[][] {
	return cleanReadings(pinyinReadings(readings));
}

/** How long after the suggestion gains focus a keyboard activation is suspect. */
export const SUGGESTION_SETTLE_MS = 300;

/**
 * shouldIgnoreGrade guards one case only: when a card finishes, the runner
 * focuses the suggested grade button, and a still-held Enter (key repeat)
 * or a Space released just afterwards activates that button natively.
 * Such a keyboard activation (`activation`, a click with detail 0) within
 * SUGGESTION_SETTLE_MS of the focus is ignored. Digit keys, pointer clicks
 * and cards without a suggestion (vocab) are never ignored.
 */
export function shouldIgnoreGrade({
	now,
	focusedAt,
	source,
	hadSuggestion
}: {
	now: number;
	focusedAt: number | null;
	source: 'key-digit' | 'click' | 'activation';
	hadSuggestion: boolean;
}): boolean {
	if (!hadSuggestion || source !== 'activation' || focusedAt === null) return false;
	return now - focusedAt < SUGGESTION_SETTLE_MS;
}
