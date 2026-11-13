// The session runner's pure decisions: which items a session holds, whether
// an item can be shown, and the small derived values the card components
// need. Kept out of the Svelte pages so they are covered by tests.

import { planCompanions } from './companions';
import type { LevelQueueItem } from './levelQueue';
import { buildQueue, scheduleFor } from './scheduler';
import { cleanReadings, eligibleForTone, type Syllable, type Tone } from './tones';
import { tierFor, type SaladTier } from './wordSalad';
import { writableChars } from './writing';
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
}

/** The entry fields eligibility needs. */
export interface EntryLike {
	language: string;
	written: string;
	readings: readonly { type: string; value: string }[];
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
	language
}: DeckSessionOptions): DeckSessionPlan {
	const wanted = sessionKinds(kinds, language);
	if (wanted.length === 0) return { queue: [], reserve: [] };

	const real = buildQueue({ cards, reviews, deckIds, newLimit, reviewLimit, now, kinds: wanted });
	const reviewed = reviewedIds(reviews);
	const freshCount = real.filter((card) => !reviewed.has(card.id)).length;
	const limit = Number.isFinite(newLimit) ? Math.max(0, Math.floor(newLimit)) : 0;
	const budget = Math.max(0, limit - freshCount);

	const companions = planCompanions({
		cards,
		kinds: wanted,
		deckIds,
		// Plan everything, then split at the budget: the rest is the reserve.
		newBudget: cards.length * 3
	})
		.filter((item) => item.kind !== 'writing' || writableChars(item.written).length > 0)
		.map(
			(item): FlowItem => ({
				cardId: item.cardId,
				kind: item.kind,
				entryId: item.entryId,
				virtual: true,
				card: null,
				written: item.written,
				deckIds: [...item.deckIds]
			})
		);

	return {
		queue: [...real.map(fromCard), ...companions.slice(0, budget)],
		reserve: companions.slice(budget)
	};
}

/** deckSessionItems is the queue of deckSessionPlan (no reserve). */
export function deckSessionItems(options: DeckSessionOptions): FlowItem[] {
	return deckSessionPlan(options).queue;
}

/**
 * dropItem removes an item that turned out to be ineligible. A dropped
 * companion frees its new-card slot, so the next reserve companion is
 * appended to the queue; a dropped real card frees nothing.
 */
export function dropItem(plan: DeckSessionPlan, cardId: string): DeckSessionPlan {
	const dropped = plan.queue.find((item) => item.cardId === cardId);
	if (dropped === undefined) return plan;
	const queue = plan.queue.filter((item) => item.cardId !== cardId);
	if (!dropped.virtual || plan.reserve.length === 0) return { queue, reserve: plan.reserve };
	const [next, ...reserve] = plan.reserve;
	return { queue: [...queue, next], reserve };
}

/**
 * levelSessionItems maps a level queue to flow items. Level sessions stay
 * vocab-only, so a setup without vocab yields an empty session.
 */
export function levelSessionItems(
	items: readonly LevelQueueItem[],
	cards: readonly StudyCard[],
	kinds: readonly StudyCardKind[]
): FlowItem[] {
	if (!kinds.includes('vocab')) return [];
	const byId = new Map(cards.map((card) => [card.id, card]));
	return items.map((item): FlowItem => {
		const card = item.virtual ? undefined : byId.get(item.cardId);
		if (card !== undefined) return fromCard(card);
		return {
			cardId: item.cardId,
			kind: 'vocab',
			entryId: item.entryId,
			virtual: item.virtual,
			card: null
		};
	});
}

/** Due reviews, new items, and items per kind of one planned session. */
export function sessionCounts(
	items: readonly FlowItem[],
	reviews: readonly ReviewEvent[]
): { due: number; fresh: number; byKind: Record<StudyCardKind, number> } {
	const reviewed = reviewedIds(reviews);
	const byKind: Record<StudyCardKind, number> = { vocab: 0, sentence: 0, writing: 0, tone: 0 };
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
	now: Date
): SaladTier {
	if (cardId === null) return 0;
	return tierFor(scheduleFor(cardId, reviews, now)?.stability ?? null);
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

/** The tone check candidates of an entry: its clean pinyin readings. */
export function toneCandidates(readings: readonly { type: string; value: string }[]): Syllable[][] {
	return cleanReadings(pinyinReadings(readings));
}

export interface ListenerTarget {
	addEventListener(type: string, listener: unknown, options?: unknown): void;
	removeEventListener(type: string, listener: unknown, options?: unknown): void;
}

/**
 * captureListeners runs `fn` while recording every listener it adds to
 * `target`, and returns a release function that removes them again. It
 * exists for hanzi-writer, which adds document-level pointer-end
 * listeners in its constructor and has no destroy(): without this every
 * writing card would leave two listeners on the document.
 */
export function captureListeners<T>(
	target: ListenerTarget,
	fn: () => T
): { result: T; release: () => void } {
	const own = Object.prototype.hasOwnProperty.call(target, 'addEventListener');
	const original = target.addEventListener;
	const recorded: [string, unknown, unknown][] = [];
	target.addEventListener = function (type: string, listener: unknown, options?: unknown) {
		recorded.push([type, listener, options]);
		return original.call(this, type, listener, options);
	};
	let result: T;
	try {
		result = fn();
	} finally {
		if (own) {
			target.addEventListener = original;
		} else {
			delete (target as { addEventListener?: unknown }).addEventListener;
		}
	}
	let released = false;
	return {
		result,
		release: () => {
			if (released) return;
			released = true;
			for (const [type, listener, options] of recorded) {
				target.removeEventListener(type, listener, options);
			}
		}
	};
}
