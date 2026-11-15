// Sibling burying: once a card of a word is answered, its other cards
// wait until the learner's next day whenever a reverse or cloze card is
// involved. Pure and derived from the review log; nothing is rescheduled
// or written. Rule and fixtures: docs/contracts/cards/.

import type { StudyDay } from '../time/studyDay';
import { CARD_KINDS, OPT_IN_KINDS, type OptInKind, type ReviewEvent, type StudyCard, type StudyCardKind } from './types';

/** Whether answering `answered` buries a card of kind `other` (same word). */
export function buries(answered: StudyCardKind, other: StudyCardKind): boolean {
	return (
		OPT_IN_KINDS.includes(answered as OptInKind) || OPT_IN_KINDS.includes(other as OptInKind)
	);
}

export interface BuryInput {
	cards: readonly StudyCard[];
	reviews: readonly ReviewEvent[];
	now: Date;
	/** The learner's day (see lib/time/studyDay.ts). */
	studyDay: Pick<StudyDay, 'dayOf'>;
}

export interface Buried {
	cardIds: Set<string>;
	/** `kind:entryId`, for virtual items that have no card id yet. */
	keys: Set<string>;
}

/** The cards answered today, by entry: `entryId -> [{cardId, kind}]`. */
function answeredToday({ cards, reviews, now, studyDay }: BuryInput): Map<number, Map<string, StudyCardKind>> {
	const byId = new Map(cards.map((card) => [card.id, card]));
	const today = studyDay.dayOf(now.getTime());
	const out = new Map<number, Map<string, StudyCardKind>>();
	for (const review of reviews) {
		const cardId = review?.payload?.cardId;
		const grade = review?.payload?.grade;
		if (typeof cardId !== 'string' || !(grade >= 1 && grade <= 4)) continue;
		const card = byId.get(cardId);
		if (card === undefined) continue;
		const ms = Date.parse(review.ts);
		if (Number.isNaN(ms) || studyDay.dayOf(ms) !== today) continue;
		let entry = out.get(card.entryId);
		if (entry === undefined) out.set(card.entryId, (entry = new Map()));
		entry.set(card.id, card.kind);
	}
	return out;
}

/** Entry -> the kinds answered today, in kind order. */
export function answeredEntriesToday(input: BuryInput): Map<number, StudyCardKind[]> {
	const out = new Map<number, StudyCardKind[]>();
	for (const [entryId, answered] of answeredToday(input)) {
		const kinds = new Set(answered.values());
		out.set(
			entryId,
			CARD_KINDS.filter((kind) => kinds.has(kind))
		);
	}
	return out;
}

/** buriedNow: the cards (and virtual `kind:entry` keys) buried at `now`. */
export function buriedNow(input: BuryInput): Buried {
	const cardIds = new Set<string>();
	const keys = new Set<string>();
	const answered = answeredToday(input);
	if (answered.size === 0) return { cardIds, keys };
	for (const card of input.cards) {
		const entry = answered.get(card.entryId);
		if (entry === undefined) continue;
		for (const [answeredId, kind] of entry) {
			if (answeredId !== card.id && buries(kind, card.kind)) {
				cardIds.add(card.id);
				break;
			}
		}
	}
	for (const [entryId, entry] of answered) {
		for (const kind of CARD_KINDS) {
			for (const answeredKind of new Set(entry.values())) {
				if (answeredKind !== kind && buries(answeredKind, kind)) {
					keys.add(`${kind}:${entryId}`);
					break;
				}
			}
		}
	}
	return { cardIds, keys };
}

/**
 * The entries of a level session that must be skipped: some card of the
 * word that a level session studies (vocab, writing) is buried. A reverse
 * or cloze answer buries all of a word's kinds at once, so skipping the
 * whole entry is exact.
 */
export function buriedLevelEntries(buried: Buried, cards: readonly StudyCard[]): Set<number> {
	const out = new Set<number>();
	for (const card of cards) {
		// Only the kinds a level session studies count: a buried reverse or
		// cloze card of a word whose vocab card was answered must not hide
		// the word from a level session.
		if (buried.cardIds.has(card.id) && (card.kind === 'vocab' || card.kind === 'writing')) {
			out.add(card.entryId);
		}
	}
	for (const key of buried.keys) {
		const [kind, entry] = key.split(':');
		if (kind === 'vocab' || kind === 'writing') out.add(Number(entry));
	}
	return out;
}
